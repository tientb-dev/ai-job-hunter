import { unknownExperience } from './cv-match.conditions.js';
import { buildCvSkillMatch } from './cv-skill-match.js';
import { buildEvidenceReview } from './evidence-review.js';
import { CvSuggestionsError } from './cv-suggestions.error.js';
import {
  CvSuggestionsService,
  suggestionMatchId,
  type CvSuggestionsResponse,
} from './cv-suggestions.js';
import {
  MATCHING_POLICY_VERSION,
  immutableValue,
  type MatchSnapshot,
  type SavedCvAssessment,
} from './match-context.js';
import type { ConditionAssessment } from './cv-match.conditions.js';
import { CvMatchRecord } from './cv-match.entity.js';
import { matchPassages } from './cv-match.passages.js';
import { evidenceSummary } from './cv-match.summary.js';
import { createHash, randomUUID } from 'node:crypto';
import { AiError } from '../ai/ai.errors.js';
import {
  cachedDecomposition,
  decompositionPrompt,
  decompositionSchema,
  MAX_AI_DECOMPOSITIONS,
  needsDecomposition,
  rememberDecomposition,
  validateDecomposition,
  type DecompositionProposal,
} from './cv-match.decomposition.js';
import { CvMatchError } from './cv-match.error.js';
import { MatchingService } from './matching.service.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
  Injectable,
  Optional,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import type { JobDocument } from '../opportunities/job-import.upload.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';
import { SavedCv } from './saved-cv.entity.js';
import {
  validateMatchAssessment,
  canonicalRequirements,
  canonicalRequirementsUnverified,
  matchOutputSchema,
  matchJobText,
  matchPrompt,
  missingRequirements,
  completionPrompt,
  completionOutputSchema,
  completionRejection,
  matchQuoteChoices,
  withoutQuoteEnums,
  type MatchRequirement,
} from './cv-match.js';
import {
  emitMatchCompletion,
  emitMatchDecomposition,
  emitMatchPersistence,
  emitMatchProviderTiming,
  type MatchDecompositionTarget,
  emitMatchFailure,
  matchAttempt,
  emitMatchEvidenceSummary,
  type MatchFailureTrace,
} from './cv-match.diagnostics.js';
import { CV_MATCH_AI } from '../ai/ai.module.js';
import { CV_MATCH_AI_CONFIG, type AiConfig } from '../ai/ai.config.js';
import {
  ReviewedCvService,
  type ReviewedCv,
} from '../reviewed-cv/reviewed-cv.service.js';
import {
  quoteOrigin,
  type ReviewedCvText,
} from '../reviewed-cv/reviewed-cv.text.js';
import type { OutputSchema } from '../ai/ai-provider.js';

/** Pure, read-only validity of a saved match; resolve() adds the CV re-bind write. */
export function savedMatchStatus(
  row: Pick<
    CvMatchRecord,
    | 'policyVersion'
    | 'cvTextHash'
    | 'jobUpdatedAt'
    | 'cvId'
    | 'profileRevisionId'
  >,
  cv: { id: string; hash: string; profileRevisionId: string },
  jobUpdatedAt: Date,
) {
  if (row.policyVersion !== MATCHING_POLICY_VERSION) return 'EXPIRED' as const;
  // Stale only against the CV this job uses, never the account default.
  // A newer completed review, or a legacy raw-text match (null), is stale.
  if (
    row.cvId !== cv.id ||
    row.cvTextHash !== cv.hash ||
    row.profileRevisionId !== cv.profileRevisionId
  )
    return 'STALE_CV' as const;
  if (row.jobUpdatedAt.getTime() !== jobUpdatedAt.getTime())
    return 'STALE_JOB' as const;
  return 'VALID' as const;
}
// Fixed Ollama seed so an unchanged CV/JD tends to repeat its analysis.
export const CV_MATCH_SEED = 107;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function cvIdFrom(body: unknown): string {
  const cvId =
    body && typeof body === 'object' && 'cvId' in body ? body.cvId : null;
  if (typeof cvId !== 'string' || !UUID.test(cvId))
    throw new BadRequestException('Choose a saved CV.');
  return cvId;
}
export const cvTextHash = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Marks where each CV quote came from. User-entered review facts are labelled
 * so they are never presented as verified uploaded-file evidence.
 */
export function withCvOrigins<
  T extends {
    conditions?: readonly ConditionAssessment[];
    requirements: readonly {
      cvQuote: string;
      coverage?: { components: readonly { cvQuote: string }[] };
    }[];
  },
>(result: T, reviewed: ReviewedCvText): T {
  const origin = (quote: string) =>
    quote.trim() ? (quoteOrigin(reviewed, quote) ?? undefined) : undefined;
  return {
    ...result,
    ...(result.conditions && {
      conditions: result.conditions.map((condition) => ({
        ...condition,
        evidence: condition.evidence.map((evidence) => {
          const touched = reviewed.lines.filter(
            (line) => line.start < evidence.end && line.end > evidence.start,
          );
          const cvOrigin = touched.some(
            (line) => line.origin === 'user_entered',
          )
            ? 'user_entered'
            : touched.length
              ? 'source'
              : undefined;
          return { ...evidence, cvOrigin };
        }),
      })),
    }),
    requirements: result.requirements.map((item) => ({
      ...item,
      cvOrigin: origin(item.cvQuote),
      ...(item.coverage && {
        coverage: {
          ...item.coverage,
          components: item.coverage.components.map((component) => ({
            ...component,
            cvOrigin: origin(component.cvQuote),
          })),
        },
      }),
    })),
  };
}

/** Per account, counting CVs uploaded from My CV and from individual jobs. */
export const MAX_SAVED_CVS = 5;
// Match output grows with requirements x components; the model supports 65,536.
export const MATCH_MAX_OUTPUT_TOKENS = 16_384;
@Injectable()
export class JobMatchService {
  private active = false;

  // Saved matches do not expire; this is only how long a client may rely on a
  // readiness answer before checking again.
  static readonly RECHECK_MS = 15 * 60 * 1000;

  /** The job's CV: explicit selection, else the CV its saved match used, else the default. */
  private async jobCvText(ownerId: string, jobId: string) {
    const job = await this.jobs.get(ownerId, jobId);
    const id =
      job.cvId ??
      (await this.matchRows.findOneBy({ ownerId, jobId }))?.cvId ??
      null;
    return this.cvs.findOne({
      where: id ? { ownerId, id } : { ownerId, isDefault: true },
      select: {
        id: true,
        ownerId: true,
        name: true,
        isDefault: true,
        text: true,
        fileName: true,
        updatedAt: true,
      },
    });
  }
  /** The job's CV with its Source CV Review state; null without readable text. */
  private async reviewedJobCv(ownerId: string, jobId: string) {
    const cv = await this.jobCvText(ownerId, jobId);
    if (!cv || typeof cv.text !== 'string' || !cv.text.trim()) return null;
    return { cv, review: await this.reviewedCvs.forCv(ownerId, cv) };
  }
  private async cvIdentity(ownerId: string, jobId: string) {
    const found = await this.reviewedJobCv(ownerId, jobId);
    if (!found) return null;
    return {
      id: found.cv.id,
      updatedAt: found.cv.updatedAt,
      hash: cvTextHash(found.cv.text),
      review: found.review,
    };
  }
  private static reviewed(review: ReviewedCv) {
    return review.status === 'COMPLETE' ? review : null;
  }
  /**
   * A saved match is valid only for the same CV text, job revision and
   * matching policy. A byte-identical CV re-upload keeps it valid and re-binds
   * its CV timestamp so downstream pins keep matching the current CV.
   */
  private async resolve(
    row: CvMatchRecord,
    cv: {
      id: string;
      updatedAt: Date;
      hash: string;
      profileRevisionId: string;
    },
    jobUpdatedAt: Date,
  ) {
    const status = savedMatchStatus(row, cv, jobUpdatedAt);
    if (status !== 'VALID') return { status };
    if (row.cvUpdatedAt.getTime() !== cv.updatedAt.getTime()) {
      row.cvUpdatedAt = cv.updatedAt;
      await this.matchRows.update(
        { matchId: row.matchId },
        { cvUpdatedAt: cv.updatedAt },
      );
    }
    const snapshot: MatchSnapshot = immutableValue({
      matchId: row.matchId,
      ownerId: row.ownerId,
      jobId: row.jobId,
      cvUpdatedAt: row.cvUpdatedAt.toISOString(),
      jobUpdatedAt: row.jobUpdatedAt.toISOString(),
      profileRevisionId: row.profileRevisionId,
      assessment: structuredClone(row.assessment) as SavedCvAssessment,
    });
    return {
      status: 'VALID' as const,
      snapshot,
      analyzedAt: row.analyzedAt.toISOString(),
    };
  }

  async requireSnapshot(
    ownerId: string,
    id: string,
    matchId: string,
  ): Promise<MatchSnapshot> {
    const job = await this.jobs.get(ownerId, id);
    const cv = await this.cvIdentity(ownerId, id);
    const reviewed = cv && JobMatchService.reviewed(cv.review);
    if (!cv || !reviewed)
      throw new ConflictException(
        'Saved CV is unavailable or not reviewed. Reanalyze CV Match.',
      );
    const row = await this.matchRows.findOneBy({
      matchId,
      ownerId,
      jobId: id,
    });
    const current = row
      ? await this.resolve(
          row,
          { ...cv, profileRevisionId: reviewed.profileRevisionId },
          job.updatedAt,
        )
      : null;
    if (current?.status !== 'VALID')
      throw new ConflictException(
        'Match context is unavailable or stale. Reanalyze CV Match.',
      );
    return current.snapshot;
  }
  async remainingSnapshotMs(
    ownerId: string,
    id: string,
    matchId: string,
  ): Promise<number> {
    await this.requireSnapshot(ownerId, id, matchId);
    return JobMatchService.RECHECK_MS;
  }
  constructor(
    @InjectRepository(SavedCv) private readonly cvs: Repository<SavedCv>,
    private readonly extraction: ExtractionService,
    private readonly ai: AiService,
    private readonly matching: MatchingService,
    private readonly jobs: OpportunitiesService,
    @InjectRepository(CvMatchRecord)
    private readonly matchRows: Repository<CvMatchRecord>,
    private readonly reviewedCvs: ReviewedCvService,
    @Optional()
    @Inject(CV_MATCH_AI_CONFIG)
    private readonly aiConfig?: AiConfig,
    @Optional() @Inject(CV_MATCH_AI) private readonly matchAi?: AiService,
  ) {}
  private static dto(cv: SavedCv) {
    return {
      id: cv.id,
      name: cv.name,
      fileName: cv.fileName,
      isDefault: cv.isDefault,
      updatedAt: cv.updatedAt,
      fileSize: cv.fileSize,
      originalAvailable: cv.mediaType !== null,
    };
  }
  /** The exact bytes of an uploaded CV, when they were retained. */
  async cvFile(ownerId: string, cvId: string) {
    const cv = await this.cvs.findOne({
      where: { ownerId, id: cvId },
      select: { fileName: true, mediaType: true, originalBytes: true },
    });
    if (!cv) throw new NotFoundException('CV not found.');
    if (!cv.originalBytes)
      throw new NotFoundException(
        'The original file was not kept for this CV. Upload it again to download it.',
      );
    return { fileName: cv.fileName, bytes: cv.originalBytes };
  }
  async listCvs(ownerId: string) {
    const rows = await this.cvs.find({
      where: { ownerId },
      order: { isDefault: 'DESC', updatedAt: 'DESC' },
    });
    return rows.map(JobMatchService.dto);
  }
  /** The account default CV. */
  async cv(ownerId: string) {
    const cv = await this.cvs.findOneBy({ ownerId, isDefault: true });
    return cv ? JobMatchService.dto(cv) : null;
  }
  async jobCv(ownerId: string, jobId: string) {
    const cv = await this.jobCvText(ownerId, jobId);
    return cv ? JobMatchService.dto(cv) : null;
  }
  /** Pins a CV to one job; other jobs and the default are unaffected. */
  async selectJobCv(ownerId: string, jobId: string, body: unknown) {
    const cvId = cvIdFrom(body);
    await this.jobs.get(ownerId, jobId);
    if (!(await this.cvs.existsBy({ ownerId, id: cvId })))
      throw new NotFoundException('CV not found.');
    // Raw update: choosing a CV is not a job edit and must not move updatedAt.
    await this.cvs.query(
      'UPDATE ai_job_hunter.opportunities SET "cvId" = $1 WHERE id = $2 AND "ownerId" = $3',
      [cvId, jobId, ownerId],
    );
    return this.jobCv(ownerId, jobId);
  }
  async updateCv(ownerId: string, cvId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Invalid CV update.');
    const { name, isDefault, ...rest } = body as Record<string, unknown>;
    if (
      Object.keys(rest).length ||
      (name !== undefined &&
        (typeof name !== 'string' ||
          !name.trim() ||
          name.trim().length > 120)) ||
      (isDefault !== undefined && isDefault !== true)
    )
      throw new BadRequestException('Use a CV name of 1 to 120 characters.');
    await this.cvs.manager.transaction(async (m) => {
      const repo = m.getRepository(SavedCv);
      if (!(await repo.existsBy({ ownerId, id: cvId })))
        throw new NotFoundException('CV not found.');
      if (typeof name === 'string')
        await repo.update({ ownerId, id: cvId }, { name: name.trim() });
      if (isDefault) {
        await repo.update({ ownerId, isDefault: true }, { isDefault: false });
        await repo.update({ ownerId, id: cvId }, { isDefault: true });
      }
    });
    return this.listCvs(ownerId);
  }
  /** Deletes an unused CV. A CV a job still uses, or the default, is kept. */
  async deleteCv(ownerId: string, cvId: string) {
    await this.cvs.manager.transaction(async (m) => {
      const cv = await m.getRepository(SavedCv).findOne({
        where: { ownerId, id: cvId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cv) throw new NotFoundException('CV not found.');
      if (cv.isDefault)
        throw new ConflictException(
          'Choose another default CV before deleting this one.',
        );
      const [{ jobs }] = (await m.query(
        `SELECT count(*)::int AS jobs FROM ai_job_hunter.opportunities o
          LEFT JOIN ai_job_hunter.cv_matches m
            ON m."ownerId" = o."ownerId" AND m."jobId" = o.id
          WHERE o."ownerId" = $1 AND coalesce(o."cvId", m."cvId") = $2`,
        [ownerId, cvId],
      )) as [{ jobs: number }];
      if (jobs)
        throw new ConflictException(
          'This CV is still used by one or more jobs. Choose another CV for those jobs before deleting it.',
        );
      // Remaining matches on this CV belong to jobs that switched CV, so they are already stale.
      await m.getRepository(CvMatchRecord).delete({ ownerId, cvId });
      await m.getRepository(SavedCv).delete({ ownerId, id: cvId });
    });
    return this.listCvs(ownerId);
  }
  async currentMatch(ownerId: string, id: string) {
    const job = await this.jobs.get(ownerId, id);
    const cv = await this.cvIdentity(ownerId, id);
    if (!cv) return { status: 'CV_UNAVAILABLE' as const };
    const reviewed = JobMatchService.reviewed(cv.review);
    // Review comes first: no match state is shown for an unreviewed CV.
    if (!reviewed)
      return {
        status: 'CV_REVIEW_REQUIRED' as const,
        cvId: cv.id,
        reviewStatus: cv.review.status,
      };
    const row = await this.matchRows.findOneBy({
      ownerId,
      jobId: id,
    });
    const freshReview = () => ({
      cvUpdatedAt: cv.updatedAt,
      skillMatch: buildCvSkillMatch(job, reviewed.reviewed),
      evidenceReview: buildEvidenceReview(
        job,
        reviewed.reviewed,
        reviewed.profileRevisionId,
        [],
      ),
    });
    if (!row) return { status: 'MISSING' as const, ...freshReview() };
    const current = await this.resolve(
      row,
      { ...cv, profileRevisionId: reviewed.profileRevisionId },
      job.updatedAt,
    );
    if (current.status !== 'VALID')
      return { status: current.status, ...freshReview() };
    const { snapshot } = current;
    return {
      status: 'VALID' as const,
      matchValidForMs: JobMatchService.RECHECK_MS,
      result: {
        ...snapshot.assessment,
        ...(snapshot.assessment.conditions && {
          conditions: snapshot.assessment.conditions.map((condition) => ({
            ...condition,
            ...(condition.status === 'UNKNOWN' &&
              condition.kind === 'EXPERIENCE' && {
                unknownExperience: unknownExperience(
                  condition.jdQuote,
                  reviewed.reviewed,
                ),
              }),
          })),
        }),
        skillMatch: buildCvSkillMatch(job, reviewed.reviewed),
        evidenceReview: buildEvidenceReview(
          job,
          reviewed.reviewed,
          reviewed.profileRevisionId,
          snapshot.assessment.requirements,
        ),
        matchId: snapshot.matchId,
        cvUpdatedAt: snapshot.cvUpdatedAt,
        jobUpdatedAt: snapshot.jobUpdatedAt,
        analyzedAt: current.analyzedAt,
      },
    };
  }
  async saveCv(ownerId: string, document?: JobDocument) {
    if (!document)
      throw new BadRequestException('Choose a CV PDF or DOCX up to 5 MiB.');
    let parsed: Awaited<ReturnType<ExtractionService['parseCvWithLayout']>>;
    try {
      parsed = await this.extraction.parseCvWithLayout(document);
      if (!parsed.source.text.trim()) throw new Error();
    } catch {
      throw new BadRequestException(
        'Could not save this CV. Use a text-based PDF or DOCX up to 5 MiB; your other CVs are unchanged.',
      );
    }
    const { source, pdfLayout } = parsed;
    const id = await this.cvs.manager.transaction(async (m) => {
      // Serializes concurrent uploads per account so the limit cannot be exceeded.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `saved_cvs:${ownerId}`,
      ]);
      const repo = m.getRepository(SavedCv);
      if ((await repo.countBy({ ownerId })) >= MAX_SAVED_CVS)
        throw new ConflictException(
          'You can keep up to 5 CVs. Delete a CV you no longer need before adding another.',
        );
      const first = !(await repo.existsBy({ ownerId, isDefault: true }));
      const { identifiers } = await repo.insert({
        ownerId,
        name: document.fileName.trim().slice(0, 120) || 'CV',
        isDefault: first,
        fileName: document.fileName,
        text: source.text,
        sourceMetadata: {
          ...(pdfLayout ? { pdfLayout } : {}),
          kind: 'parsed-upload',
          format: source.format === 'text' ? null : source.format,
          parser: 'bounded-document-parser/v1',
          segments: source.segments,
          warnings: null,
          // Provenance snapshots never carry bytes; the original lives on this row.
          originalBytesRetained: false,
        },
        originalBytes: document.bytes,
        mediaType: document.mediaType,
        fileSize: document.bytes.length,
      });
      return identifiers[0]!.id as string;
    });
    return JobMatchService.dto(await this.cvs.findOneByOrFail({ ownerId, id }));
  }
  private async recheckSuggestionSnapshot(
    ownerId: string,
    id: string,
    matchId: string,
    snapshot: MatchSnapshot,
  ): Promise<void> {
    try {
      const latest = await this.requireSnapshot(ownerId, id, matchId);
      if (
        latest.matchId !== snapshot.matchId ||
        latest.cvUpdatedAt !== snapshot.cvUpdatedAt ||
        latest.jobUpdatedAt !== snapshot.jobUpdatedAt
      )
        throw new CvSuggestionsError('CV_SUGGESTIONS_STALE_MATCH');
    } catch (error) {
      if (
        error instanceof HttpException &&
        [404, 409].includes(error.getStatus())
      )
        throw new CvSuggestionsError('CV_SUGGESTIONS_STALE_MATCH');
      throw error;
    }
  }
  async suggest(
    ownerId: string,
    id: string,
    body: unknown,
  ): Promise<CvSuggestionsResponse> {
    const matchId = suggestionMatchId(body);
    if (this.active) throw new CvSuggestionsError('CV_SUGGESTIONS_BUSY');
    this.active = true;
    try {
      const snapshot = await this.requireSnapshot(ownerId, id, matchId);
      const found = await this.reviewedJobCv(ownerId, id);
      const reviewed = found && JobMatchService.reviewed(found.review);
      if (
        !found ||
        !reviewed ||
        reviewed.profileRevisionId !== snapshot.profileRevisionId ||
        found.cv.updatedAt.toISOString() !== snapshot.cvUpdatedAt
      )
        throw new CvSuggestionsError('CV_SUGGESTIONS_STALE_MATCH');
      await this.recheckSuggestionSnapshot(ownerId, id, matchId, snapshot);
      const service = new CvSuggestionsService(this.ai);
      let result: CvSuggestionsResponse;
      try {
        result = await service.generate(snapshot, reviewed.reviewed.text);
      } catch (error) {
        await this.recheckSuggestionSnapshot(ownerId, id, matchId, snapshot);
        throw error;
      }
      await this.recheckSuggestionSnapshot(ownerId, id, matchId, snapshot);
      return result;
    } catch (error) {
      if (error instanceof CvSuggestionsError) throw error;
      if (error instanceof HttpException) {
        if (error.getStatus() === 404)
          throw new CvSuggestionsError('CV_SUGGESTIONS_JOB_NOT_FOUND');
        if (error.getStatus() === 409)
          throw new CvSuggestionsError('CV_SUGGESTIONS_STALE_MATCH');
      }
      throw new CvSuggestionsError('CV_SUGGESTIONS_UNAVAILABLE');
    } finally {
      this.active = false;
    }
  }
  async analyze(ownerId: string, id: string) {
    const started = performance.now();
    const trace: MatchFailureTrace = { stage: 'SETUP' };
    return matchAttempt.run(randomUUID(), async () => {
      try {
        const result = await this.runAnalysis(ownerId, id, trace);
        emitMatchProviderTiming(this.aiConfig, 'ANALYSIS', {
          elapsedMs: Math.round(performance.now() - started),
        });
        return result;
      } catch (error) {
        emitMatchFailure(
          error,
          trace,
          this.aiConfig?.provider,
          performance.now() - started,
        );
        throw error;
      }
    });
  }
  /**
   * Requirements the deterministic grammar cannot interpret get one bounded,
   * schema-validated AI split. Only literal JD spans with consistent AND/OR
   * connectors are accepted; anything else, and any provider failure, leaves
   * the row UNDECOMPOSED ("Needs review"). Never fatal, never a CV judgment.
   */
  private async decompose(
    canonical: MatchRequirement[],
    trace: MatchFailureTrace,
  ): Promise<MatchRequirement[]> {
    const diagnostics: MatchDecompositionTarget[] = [];
    const pending: {
      row: MatchRequirement;
      target: MatchDecompositionTarget;
    }[] = [];
    for (const [index, row] of canonical.entries()) {
      if (!needsDecomposition(row)) continue;
      const target: MatchDecompositionTarget = {
        index,
        reason: cachedDecomposition(row)
          ? 'CACHED'
          : pending.length >= MAX_AI_DECOMPOSITIONS
            ? 'DEFERRED_LIMIT'
            : 'BATCH_ERROR',
      };
      diagnostics.push(target);
      if (target.reason === 'BATCH_ERROR') pending.push({ row, target });
    }
    let outcome = 'CACHED';
    if (pending.length) {
      trace.stage = 'DECOMPOSITION';
      try {
        const rows = pending.map(({ row }) => row);
        const reply = (await (this.matchAi ?? this.ai).generateStructured({
          prompt: decompositionPrompt(rows),
          schema: decompositionSchema(rows),
          onProviderTiming: (timing) =>
            emitMatchProviderTiming(this.aiConfig, 'DECOMPOSITION', timing),
        })) as { items: DecompositionProposal[] };
        for (const { row, target } of pending) {
          const [proposal, duplicate] = reply.items.filter(
            (item) => item.parentId === row.parentId,
          );
          if (duplicate) target.reason = 'DUPLICATE_PARENT';
          else if (!proposal) target.reason = 'OMITTED';
          else {
            const group = validateDecomposition(row, proposal);
            if (typeof group === 'string') target.reason = group;
            else {
              rememberDecomposition(row, group);
              target.reason = 'ACCEPTED';
            }
          }
        }
        outcome = pending.every(({ target }) => target.reason === 'ACCEPTED')
          ? 'COMPLETED'
          : 'PARTIAL';
      } catch (error) {
        outcome =
          error instanceof AiError && /^[A-Z_]{1,40}$/u.test(error.code)
            ? error.code
            : 'ERROR';
      }
    }
    if (diagnostics.length) {
      trace.decompositionTargets = true;
      emitMatchDecomposition(
        outcome,
        pending.length,
        diagnostics.filter(({ reason }) => reason === 'ACCEPTED').length,
        diagnostics,
      );
    }
    return canonical.map((item) => {
      const cached = cachedDecomposition(item);
      return cached ? { ...item, decomposition: cached } : item;
    });
  }
  private async runAnalysis(
    ownerId: string,
    id: string,
    trace: MatchFailureTrace,
  ) {
    if (this.active) {
      trace.reason = 'ANALYSIS_ALREADY_RUNNING';
      throw new ConflictException(
        'A CV match is already running. Retry after it finishes.',
      );
    }
    this.active = true;
    try {
      const job = await this.jobs.get(ownerId, id);
      const found = await this.reviewedJobCv(ownerId, id);
      if (!found)
        throw new CvMatchError('CV_MATCH_CV_UNAVAILABLE', 'CV_TEXT_EMPTY');
      const saved = found.cv;
      const review = JobMatchService.reviewed(found.review);
      // Never analyze raw text: Match consumes the completed review only.
      if (!review) throw new CvMatchError('CV_MATCH_REVIEW_REQUIRED');
      const cv = { ...saved, text: review.reviewed.text };
      if (
        ![
          job.skills,
          job.experience,
          job.domain,
          job.preferredSkills,
          job.description,
          job.jdText,
          job.postText,
        ].some((text) => text.trim())
      ) {
        trace.reason = 'NO_JOB_CONTENT';
        throw new BadRequestException(
          'Save job requirements or JD content before analyzing.',
        );
      }
      const jd = matchJobText(job);
      const canonical = await this.decompose(canonicalRequirements(job), trace);
      if (!canonical.length)
        throw new CvMatchError(
          'CV_MATCH_INCOMPLETE',
          'NO_CANONICAL_REQUIREMENTS',
        );
      const hosted =
        this.aiConfig?.provider === 'gemini' ||
        this.aiConfig?.provider === 'openai';
      const allowed = hosted
        ? new Set(matchQuoteChoices(cv.text, canonical))
        : undefined;
      let passages = allowed
        ? matchPassages(review.reviewed, review.profileRevisionId, allowed)
        : undefined;
      // The exact quote path remains available for older provider responses.
      const quoteRule = (text: string) =>
        hosted
          ? `Use passageId when a reference is available. If returning cvQuote, copy one complete CV line, or up to three consecutive lines, exactly; never a fragment. Keep surrounding negations and qualifiers.\n${text}`
          : text;
      let prompt = quoteRule(
        matchPrompt(cv.text, jd, canonical, passages?.input),
      );
      if (passages && Buffer.byteLength(prompt) > 64 * 1024) {
        passages = undefined;
        prompt = quoteRule(matchPrompt(cv.text, jd, canonical));
      }
      if (Buffer.byteLength(prompt) > 64 * 1024) {
        trace.reason = 'PROMPT_BUDGET_EXCEEDED';
        throw new BadRequestException(
          'CV and job exceed the local matching context budget. Shorten saved job content or use a concise CV and retry.',
        );
      }
      const generate = async (
        stage: 'INITIAL' | 'COMPLETION',
        request: { prompt: string; schema: OutputSchema; seed?: number },
      ) => {
        trace.stage = stage;
        try {
          return (
            (await (this.matchAi ?? this.ai).generateStructured({
              ...request,
              maxOutputTokens: MATCH_MAX_OUTPUT_TOKENS,
              onProviderTiming: (timing) =>
                emitMatchProviderTiming(this.aiConfig, stage, timing),
            })) as {
              requirements: MatchRequirement[];
            }
          ).requirements;
        } catch (error) {
          trace.stage = stage;
          trace.aiCode = error instanceof AiError ? error.code : undefined;
          trace.upstreamHttpStatus =
            error instanceof AiError ? error.httpStatus : undefined;
          trace.upstreamAttempts =
            error instanceof AiError ? error.attempts : undefined;
          if (error instanceof AiError && error.code === 'TIMEOUT')
            throw new CvMatchError('CV_MATCH_TIMEOUT');
          if (
            error instanceof AiError &&
            ['INVALID_JSON', 'SCHEMA_VALIDATION_FAILURE'].includes(error.code)
          )
            throw new CvMatchError('CV_MATCH_INVALID_OUTPUT');
          // Deterministic (temperature 0): never resend the identical request.
          if (
            error instanceof AiError &&
            error.code === 'OUTPUT_LIMIT_EXCEEDED'
          )
            throw new CvMatchError(
              'CV_MATCH_OUTPUT_LIMIT',
              'OUTPUT_LIMIT_EXCEEDED',
              error.usage,
            );
          // Transient overload/rate limit after the provider's own retries.
          if (
            error instanceof AiError &&
            error.code === 'UPSTREAM_HTTP_FAILURE' &&
            [429, 503].includes(error.httpStatus ?? 0)
          )
            throw new CvMatchError('CV_MATCH_PROVIDER_BUSY');
          throw new CvMatchError('CV_MATCH_UNAVAILABLE');
        }
      };
      const schema = matchOutputSchema(cv.text, canonical);
      let proposals = await generate('INITIAL', {
        prompt,
        seed: CV_MATCH_SEED,
        schema: hosted ? withoutQuoteEnums(schema) : schema,
      });
      // Hosted providers: one bounded completion call for omitted requirements. Never
      // retried; its items still pass the full validation below.
      const missing = hosted ? missingRequirements(proposals, canonical) : [];
      if (missing.length) {
        let outcome = 'ERROR';
        let returned = 0;
        try {
          const items = await generate('COMPLETION', {
            prompt: quoteRule(
              completionPrompt(cv.text, jd, missing, passages?.input),
            ),
            schema: withoutQuoteEnums(completionOutputSchema(cv.text, missing)),
          });
          returned = items.length;
          const rejected = completionRejection(items, missing);
          outcome = rejected ?? 'COMPLETED';
          if (rejected)
            throw new CvMatchError(
              'CV_MATCH_INCOMPLETE',
              `COMPLETION_${rejected}`,
              {
                missing: missing.length,
                returned: items.length,
              },
            );
          proposals = [...proposals, ...items];
        } catch (error) {
          if (outcome === 'ERROR' && error instanceof CvMatchError)
            outcome = error.errorCode;
          throw error;
        } finally {
          emitMatchCompletion(outcome, missing.length, returned);
        }
      }
      trace.stage = 'VALIDATION';
      const verified = validateMatchAssessment(
        proposals,
        cv.text,
        jd,
        canonical,
        allowed,
        passages?.quotes,
      );
      trace.stage = 'SOURCE_VERIFICATION';
      const latestCv = await this.jobCv(ownerId, id);
      const latestJob = await this.jobs.get(ownerId, id);
      if (
        latestCv?.id !== cv.id ||
        latestCv.updatedAt.getTime() !== cv.updatedAt.getTime() ||
        (await this.reviewedCvs
          .forCv(ownerId, saved)
          .then(
            (latest) =>
              latest.status !== 'COMPLETE' ||
              latest.profileRevisionId !== review.profileRevisionId,
          )) ||
        latestJob.updatedAt.getTime() !== job.updatedAt.getTime()
      ) {
        trace.reason = 'SOURCE_CHANGED';
        throw new ConflictException(
          'CV or job changed during analysis. Reanalyze using the latest saved data.',
        );
      }
      trace.stage = 'SCORING';
      const result = withCvOrigins(
        this.matching.matchSavedCv(
          verified,
          cv.text,
          jd,
          canonical,
          canonicalRequirementsUnverified(job),
          review.reviewed,
        ),
        review.reviewed,
      );
      const analyzedAt = new Date();
      const matchId = randomUUID();
      trace.stage = 'PERSISTENCE';
      // A re-analysis with missed-evidence doubt never replaces a saved match of
      // the same CV text and job revision that had none; it returns that one.
      const previous = result.evidenceUncertain
        ? await this.matchRows.findOneBy({ ownerId, jobId: id })
        : null;
      const kept =
        previous?.assessment &&
        (previous.assessment as { evidenceUncertain?: unknown })
          .evidenceUncertain === false
          ? await this.resolve(
              previous,
              {
                ...saved,
                hash: cvTextHash(saved.text),
                profileRevisionId: review.profileRevisionId,
              },
              job.updatedAt,
            )
          : null;
      if (kept?.status === 'VALID') {
        if (trace.decompositionTargets)
          emitMatchPersistence('RETAINED_PREVIOUS');
        return {
          ...kept.snapshot.assessment,
          skillMatch: buildCvSkillMatch(job, review.reviewed),
          evidenceReview: buildEvidenceReview(
            job,
            review.reviewed,
            review.profileRevisionId,
            kept.snapshot.assessment.requirements,
          ),
          matchId: kept.snapshot.matchId,
          cvUpdatedAt: kept.snapshot.cvUpdatedAt,
          jobUpdatedAt: kept.snapshot.jobUpdatedAt,
          analyzedAt: kept.analyzedAt,
          keptPrevious: true as const,
        };
      }
      await this.matchRows.manager.transaction(async (m) => {
        const rows = m.getRepository(CvMatchRecord);
        await rows.delete({ ownerId, jobId: id });
        await rows.insert({
          matchId,
          ownerId,
          jobId: id,
          cvId: cv.id,
          // Identity of the saved CV file text; the review revision is separate.
          cvTextHash: cvTextHash(saved.text),
          profileRevisionId: review.profileRevisionId,
          cvUpdatedAt: cv.updatedAt,
          jobUpdatedAt: job.updatedAt,
          policyVersion: MATCHING_POLICY_VERSION,
          assessment: structuredClone(result) as never,
          analyzedAt,
        });
      });
      if (trace.decompositionTargets) emitMatchPersistence('PERSISTED_FRESH');
      emitMatchEvidenceSummary(() =>
        evidenceSummary(
          proposals,
          verified,
          result,
          cv.text,
          canonical,
          allowed,
        ),
      );
      return {
        ...result,
        skillMatch: buildCvSkillMatch(job, review.reviewed),
        evidenceReview: buildEvidenceReview(
          job,
          review.reviewed,
          review.profileRevisionId,
          result.requirements,
        ),
        matchId,
        cvUpdatedAt: cv.updatedAt,
        jobUpdatedAt: job.updatedAt,
        analyzedAt: analyzedAt.toISOString(),
      };
    } finally {
      this.active = false;
    }
  }
}
