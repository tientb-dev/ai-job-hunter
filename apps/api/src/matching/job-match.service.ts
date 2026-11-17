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
import { CvMatchRecord } from './cv-match.entity.js';
import { evidenceSummary } from './cv-match.summary.js';
import { createHash, randomUUID } from 'node:crypto';
import { AiError } from '../ai/ai.errors.js';
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
  emitMatchFailure,
  matchAttempt,
  emitMatchEvidenceSummary,
  type MatchFailureTrace,
} from './cv-match.diagnostics.js';
import { AI_CONFIG, type AiConfig } from '../ai/ai.config.js';
import type { OutputSchema } from '../ai/ai-provider.js';

/** Pure, read-only validity of a saved match; resolve() adds the CV re-bind write. */
export function savedMatchStatus(
  row: Pick<
    CvMatchRecord,
    'policyVersion' | 'cvTextHash' | 'jobUpdatedAt' | 'cvId'
  >,
  cv: { id: string; hash: string },
  jobUpdatedAt: Date,
) {
  if (row.policyVersion !== MATCHING_POLICY_VERSION) return 'EXPIRED' as const;
  // Stale only against the CV this job uses, never the account default.
  if (row.cvId !== cv.id || row.cvTextHash !== cv.hash)
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

/** Per account, counting CVs uploaded from My CV and from individual jobs. */
export const MAX_SAVED_CVS = 5;
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
  private async cvIdentity(ownerId: string, jobId: string) {
    const cv = await this.jobCvText(ownerId, jobId);
    if (!cv || typeof cv.text !== 'string') return null;
    return {
      id: cv.id,
      updatedAt: cv.updatedAt,
      hash: cvTextHash(cv.text),
    };
  }
  /**
   * A saved match is valid only for the same CV text, job revision and
   * matching policy. A byte-identical CV re-upload keeps it valid and re-binds
   * its CV timestamp so downstream pins keep matching the current CV.
   */
  private async resolve(
    row: CvMatchRecord,
    cv: { id: string; updatedAt: Date; hash: string },
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
    if (!cv)
      throw new ConflictException(
        'Saved CV is unavailable. Reanalyze CV Match.',
      );
    const row = await this.matchRows.findOneBy({
      matchId,
      ownerId,
      jobId: id,
    });
    const current = row ? await this.resolve(row, cv, job.updatedAt) : null;
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
    @Optional() @Inject(AI_CONFIG) private readonly aiConfig?: AiConfig,
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
    const row = await this.matchRows.findOneBy({
      ownerId,
      jobId: id,
    });
    if (!row) return { status: 'MISSING' as const };
    const current = await this.resolve(row, cv, job.updatedAt);
    if (current.status !== 'VALID') return { status: current.status };
    const { snapshot } = current;
    return {
      status: 'VALID' as const,
      matchValidForMs: JobMatchService.RECHECK_MS,
      result: {
        ...snapshot.assessment,
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
      const cv = await this.jobCvText(ownerId, id);
      if (
        !cv ||
        !cv.text?.trim() ||
        cv.updatedAt.toISOString() !== snapshot.cvUpdatedAt
      )
        throw new CvSuggestionsError('CV_SUGGESTIONS_STALE_MATCH');
      await this.recheckSuggestionSnapshot(ownerId, id, matchId, snapshot);
      const service = new CvSuggestionsService(this.ai);
      let result: CvSuggestionsResponse;
      try {
        result = await service.generate(snapshot, cv.text);
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
        return await this.runAnalysis(ownerId, id, trace);
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
      const cv = await this.jobCvText(ownerId, id);
      if (!cv || typeof cv.text !== 'string' || !cv.text.trim())
        throw new CvMatchError('CV_MATCH_CV_UNAVAILABLE', 'CV_TEXT_EMPTY');
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
      const canonical = canonicalRequirements(job);
      if (!canonical.length)
        throw new CvMatchError(
          'CV_MATCH_INCOMPLETE',
          'NO_CANONICAL_REQUIREMENTS',
        );
      const gemini = this.aiConfig?.provider === 'gemini';
      // Gemini schemas carry no passage enum (#63); the server still verifies quotes.
      const quoteRule = (text: string) =>
        gemini
          ? `For every cvQuote, copy one complete CV line, or up to three consecutive lines, exactly; never a fragment. Keep surrounding negations and qualifiers.\n${text}`
          : text;
      const prompt = quoteRule(matchPrompt(cv.text, jd, canonical));
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
            (await this.ai.generateStructured(request)) as {
              requirements: MatchRequirement[];
            }
          ).requirements;
        } catch (error) {
          trace.stage = stage;
          trace.aiCode = error instanceof AiError ? error.code : undefined;
          trace.upstreamHttpStatus =
            error instanceof AiError ? error.httpStatus : undefined;
          if (error instanceof AiError && error.code === 'TIMEOUT')
            throw new CvMatchError('CV_MATCH_TIMEOUT');
          if (
            error instanceof AiError &&
            ['INVALID_JSON', 'SCHEMA_VALIDATION_FAILURE'].includes(error.code)
          )
            throw new CvMatchError('CV_MATCH_INVALID_OUTPUT');
          throw new CvMatchError('CV_MATCH_UNAVAILABLE');
        }
      };
      const schema = matchOutputSchema(cv.text, canonical);
      let proposals = await generate('INITIAL', {
        prompt,
        seed: CV_MATCH_SEED,
        schema: gemini ? withoutQuoteEnums(schema) : schema,
      });
      // Gemini only: one bounded completion call for omitted requirements. Never
      // retried; its items still pass the full validation below.
      const missing = gemini ? missingRequirements(proposals, canonical) : [];
      if (missing.length) {
        let outcome = 'ERROR';
        let returned = 0;
        try {
          const items = await generate('COMPLETION', {
            prompt: quoteRule(completionPrompt(cv.text, jd, missing)),
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
      // Gemini schemas carry no passage enums; enforce the same passages here.
      const allowed = gemini
        ? new Set(matchQuoteChoices(cv.text, canonical))
        : undefined;
      const verified = validateMatchAssessment(
        proposals,
        cv.text,
        jd,
        canonical,
        allowed,
      );
      trace.stage = 'SOURCE_VERIFICATION';
      const latestCv = await this.jobCv(ownerId, id);
      const latestJob = await this.jobs.get(ownerId, id);
      if (
        latestCv?.id !== cv.id ||
        latestCv.updatedAt.getTime() !== cv.updatedAt.getTime() ||
        latestJob.updatedAt.getTime() !== job.updatedAt.getTime()
      ) {
        trace.reason = 'SOURCE_CHANGED';
        throw new ConflictException(
          'CV or job changed during analysis. Reanalyze using the latest saved data.',
        );
      }
      trace.stage = 'SCORING';
      const result = this.matching.matchSavedCv(
        verified,
        cv.text,
        jd,
        canonical,
        canonicalRequirementsUnverified(job),
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
              { ...cv, hash: cvTextHash(cv.text) },
              job.updatedAt,
            )
          : null;
      if (kept?.status === 'VALID')
        return {
          ...kept.snapshot.assessment,
          matchId: kept.snapshot.matchId,
          cvUpdatedAt: kept.snapshot.cvUpdatedAt,
          jobUpdatedAt: kept.snapshot.jobUpdatedAt,
          analyzedAt: kept.analyzedAt,
          keptPrevious: true as const,
        };
      await this.matchRows.manager.transaction(async (m) => {
        const rows = m.getRepository(CvMatchRecord);
        await rows.delete({ ownerId, jobId: id });
        await rows.insert({
          matchId,
          ownerId,
          jobId: id,
          cvId: cv.id,
          cvTextHash: createHash('sha256')
            .update(cv.text, 'utf8')
            .digest('hex'),
          cvUpdatedAt: cv.updatedAt,
          jobUpdatedAt: job.updatedAt,
          policyVersion: MATCHING_POLICY_VERSION,
          assessment: structuredClone(result) as never,
          analyzedAt,
        });
      });
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
