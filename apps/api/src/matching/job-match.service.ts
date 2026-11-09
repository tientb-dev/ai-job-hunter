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
import { createHash, randomUUID } from 'node:crypto';
import { AiError } from '../ai/ai.errors.js';
import { CvMatchError } from './cv-match.error.js';
import { MatchingService } from './matching.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import type { JobDocument } from '../opportunities/job-import.upload.js';
import {
  LOCAL_OWNER_ID,
  OpportunitiesService,
} from '../opportunities/opportunities.service.js';
import { SavedCv } from './saved-cv.entity.js';
import {
  validateMatchAssessment,
  canonicalRequirements,
  matchOutputSchema,
  matchJobText,
  matchPrompt,
  type MatchRequirement,
} from './cv-match.js';

@Injectable()
export class JobMatchService {
  private active = false;

  // Saved matches do not expire; this is only how long a client may rely on a
  // readiness answer before checking again.
  static readonly RECHECK_MS = 15 * 60 * 1000;

  private async cvIdentity() {
    const cv = await this.cvs.findOne({
      where: { ownerId: LOCAL_OWNER_ID },
      select: { ownerId: true, text: true, updatedAt: true },
    });
    if (!cv || typeof cv.text !== 'string') return null;
    return {
      updatedAt: cv.updatedAt,
      hash: createHash('sha256').update(cv.text, 'utf8').digest('hex'),
    };
  }
  /**
   * A saved match is valid only for the same CV text, job revision and
   * matching policy. A byte-identical CV re-upload keeps it valid and re-binds
   * its CV timestamp so downstream pins keep matching the current CV.
   */
  private async resolve(
    row: CvMatchRecord,
    cv: { updatedAt: Date; hash: string },
    jobUpdatedAt: Date,
  ) {
    if (row.policyVersion !== MATCHING_POLICY_VERSION)
      return { status: 'EXPIRED' as const };
    if (row.cvTextHash !== cv.hash) return { status: 'STALE_CV' as const };
    if (row.jobUpdatedAt.getTime() !== jobUpdatedAt.getTime())
      return { status: 'STALE_JOB' as const };
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

  async requireSnapshot(id: string, matchId: string): Promise<MatchSnapshot> {
    const cv = await this.cvIdentity();
    const job = await this.jobs.get(id);
    if (!cv)
      throw new ConflictException(
        'Saved CV is unavailable. Reanalyze CV Match.',
      );
    const row = await this.matchRows.findOneBy({
      matchId,
      ownerId: LOCAL_OWNER_ID,
      jobId: id,
    });
    const current = row ? await this.resolve(row, cv, job.updatedAt) : null;
    if (current?.status !== 'VALID')
      throw new ConflictException(
        'Match context is unavailable or stale. Reanalyze CV Match.',
      );
    return current.snapshot;
  }
  async remainingSnapshotMs(id: string, matchId: string): Promise<number> {
    await this.requireSnapshot(id, matchId);
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
  ) {}
  async cv() {
    const cv = await this.cvs.findOneBy({ ownerId: LOCAL_OWNER_ID });
    return cv ? { fileName: cv.fileName, updatedAt: cv.updatedAt } : null;
  }
  async currentMatch(id: string) {
    const job = await this.jobs.get(id);
    const cv = await this.cvIdentity();
    if (!cv) return { status: 'CV_UNAVAILABLE' as const };
    const row = await this.matchRows.findOneBy({
      ownerId: LOCAL_OWNER_ID,
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
  async saveCv(document?: JobDocument) {
    if (!document)
      throw new BadRequestException('Choose a CV PDF or DOCX up to 5 MiB.');
    try {
      const { source, pdfLayout } =
        await this.extraction.parseCvWithLayout(document);
      if (!source.text.trim()) throw new Error();
      await this.cvs.upsert(
        {
          ownerId: LOCAL_OWNER_ID,
          fileName: document.fileName,
          text: source.text,
          sourceMetadata: {
            ...(pdfLayout ? { pdfLayout } : {}),
            kind: 'parsed-upload',
            format: source.format === 'text' ? null : source.format,
            parser: 'bounded-document-parser/v1',
            segments: source.segments,
            warnings: null,
            originalBytesRetained: false,
          },
        },
        ['ownerId'],
      );
      return this.cv();
    } catch {
      throw new BadRequestException(
        'Could not save this CV. Use a text-based PDF or DOCX up to 5 MiB; the previous CV is retained.',
      );
    }
  }
  private async recheckSuggestionSnapshot(
    id: string,
    matchId: string,
    snapshot: MatchSnapshot,
  ): Promise<void> {
    try {
      const latest = await this.requireSnapshot(id, matchId);
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
  async suggest(id: string, body: unknown): Promise<CvSuggestionsResponse> {
    const matchId = suggestionMatchId(body);
    if (this.active) throw new CvSuggestionsError('CV_SUGGESTIONS_BUSY');
    this.active = true;
    try {
      const snapshot = await this.requireSnapshot(id, matchId);
      const cv = await this.cvs.findOne({
        where: { ownerId: LOCAL_OWNER_ID },
        select: { ownerId: true, text: true, updatedAt: true },
      });
      if (
        !cv ||
        !cv.text?.trim() ||
        cv.updatedAt.toISOString() !== snapshot.cvUpdatedAt
      )
        throw new CvSuggestionsError('CV_SUGGESTIONS_STALE_MATCH');
      await this.recheckSuggestionSnapshot(id, matchId, snapshot);
      const service = new CvSuggestionsService(this.ai);
      let result: CvSuggestionsResponse;
      try {
        result = await service.generate(snapshot, cv.text);
      } catch (error) {
        await this.recheckSuggestionSnapshot(id, matchId, snapshot);
        throw error;
      }
      await this.recheckSuggestionSnapshot(id, matchId, snapshot);
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
  async analyze(id: string) {
    if (this.active)
      throw new ConflictException(
        'A CV match is already running. Retry after it finishes.',
      );
    this.active = true;
    try {
      const cv = await this.cvs.findOne({
        where: { ownerId: LOCAL_OWNER_ID },
        select: { ownerId: true, text: true, fileName: true, updatedAt: true },
      });
      if (!cv || typeof cv.text !== 'string' || !cv.text.trim())
        throw new CvMatchError('CV_MATCH_CV_UNAVAILABLE');
      const job = await this.jobs.get(id);
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
      )
        throw new BadRequestException(
          'Save job requirements or JD content before analyzing.',
        );
      const jd = matchJobText(job);
      const canonical = canonicalRequirements(job);
      if (!canonical.length) throw new CvMatchError('CV_MATCH_INCOMPLETE');
      const prompt = matchPrompt(cv.text, jd, canonical);
      if (Buffer.byteLength(prompt) > 64 * 1024)
        throw new BadRequestException(
          'CV and job exceed the local matching context budget. Shorten saved job content or use a concise CV and retry.',
        );
      let output: unknown;
      try {
        output = await this.ai.generateStructured({
          prompt,
          schema: matchOutputSchema(cv.text, canonical),
        });
      } catch (error) {
        if (error instanceof AiError && error.code === 'TIMEOUT')
          throw new CvMatchError('CV_MATCH_TIMEOUT');
        if (
          error instanceof AiError &&
          ['INVALID_JSON', 'SCHEMA_VALIDATION_FAILURE'].includes(error.code)
        )
          throw new CvMatchError('CV_MATCH_INVALID_OUTPUT');
        throw new CvMatchError('CV_MATCH_UNAVAILABLE');
      }
      const proposals = (output as { requirements: MatchRequirement[] })
        .requirements;
      const verified = validateMatchAssessment(
        proposals,
        cv.text,
        jd,
        canonical,
      );
      const latestCv = await this.cv();
      const latestJob = await this.jobs.get(id);
      if (
        latestCv?.updatedAt.getTime() !== cv.updatedAt.getTime() ||
        latestJob.updatedAt.getTime() !== job.updatedAt.getTime()
      )
        throw new ConflictException(
          'CV or job changed during analysis. Reanalyze using the latest saved data.',
        );
      const result = this.matching.matchSavedCv(
        verified,
        cv.text,
        jd,
        canonical,
      );
      const analyzedAt = new Date();
      const matchId = randomUUID();
      await this.matchRows.manager.transaction(async (m) => {
        const rows = m.getRepository(CvMatchRecord);
        await rows.delete({ ownerId: LOCAL_OWNER_ID, jobId: id });
        await rows.insert({
          matchId,
          ownerId: LOCAL_OWNER_ID,
          jobId: id,
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
