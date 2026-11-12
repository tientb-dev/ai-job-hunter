import {
  applyReview,
  approveReview,
  initialReview,
  reviewRequest,
} from './tailored-draft-review.policy.js';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AI_CONFIG, GEMINI_MODEL, type AiConfig } from '../ai/ai.config.js';
import { OLLAMA_CONTEXT_PROFILE } from '../ai/ollama.context.js';
import {
  JobMatchService,
  cvTextHash,
  savedMatchStatus,
} from '../matching/job-match.service.js';
import { SavedCv } from '../matching/saved-cv.entity.js';
import { SavedCvSourceService } from '../matching/saved-cv-source.service.js';
import { canonicalRequirements } from '../matching/cv-match.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';
import {
  CvProfileRevision,
  CvSourceRevision,
  TailoredCvDraft,
} from './tailored-cv.entity.js';
import {
  profileDocument,
  revision,
  timestamp,
  uuid,
  version,
} from './tailored-cv.contract.js';
import {
  TailoredDraftError,
  type DraftJobSnapshot,
} from './tailored-draft.contract.js';
import { TailoredDraftGenerator } from './tailored-draft.generator.js';
import { reviewedPlan, draftHash } from './tailored-draft.policy.js';
interface GenerateRequest {
  profileRevisionId: string;
  expectedProfileRevision: number;
  expectedJobUpdatedAt: string;
  matchId: string;
}
interface ProgressRow {
  id: string;
  jobUpdatedAt: Date;
  policyVersion: string | null;
  cvTextHash: string | null;
  matchJobUpdatedAt: Date | null;
  draftUpdatedAt: Date | null;
  draftJobUpdatedAt: Date | null;
  pending: number | null;
  approved: boolean;
}
const array = (value: string) =>
  `jsonb_array_elements(CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${value} ELSE '[]'::jsonb END)`;
// Latest tailored draft per job (same order as list()), summarized in SQL with
// the review policy's semantics so documents never leave the database:
// - pending: factReviews with proposal 'pending'; without a saved review,
//   initialReview() marks every fact with a truthy proposedWording as pending.
// - approved: approval.revision equals the draft revision.
const JOB_PROGRESS_SQL = `
SELECT o.id, o."updatedAt" AS "jobUpdatedAt",
  m."policyVersion", m."cvTextHash", m."jobUpdatedAt" AS "matchJobUpdatedAt",
  d."updatedAt" AS "draftUpdatedAt", d."jobUpdatedAt" AS "draftJobUpdatedAt",
  d.pending, coalesce(d.approved, false) AS approved
FROM ai_job_hunter.opportunities o
LEFT JOIN ai_job_hunter.cv_matches m
  ON m."ownerId" = o."ownerId" AND m."jobId" = o.id
LEFT JOIN LATERAL (
  SELECT x."updatedAt", x."jobUpdatedAt",
    CASE
      WHEN coalesce(x.document->'review', 'null') = 'null' THEN
        CASE WHEN jsonb_typeof(x.document->'sections') = 'array' THEN (
          SELECT count(*)::int FROM ${array("x.document->'sections'")} s,
            ${array("s->'entries'")} e, ${array("e->'facts'")} f
          WHERE coalesce(f->'proposedWording', 'null')
            NOT IN ('null', 'false', '0', '""')
        ) END
      WHEN jsonb_typeof(x.document->'review'->'factReviews') = 'object' THEN (
        SELECT count(*)::int
        FROM jsonb_each(x.document->'review'->'factReviews') r
        WHERE r.value->>'proposal' = 'pending'
      )
    END AS pending,
    coalesce(
      x.document->'review'->'approval'->'revision' = to_jsonb(x.revision),
      false
    ) AS approved
  FROM ai_job_hunter.tailored_cv_drafts x
  WHERE x."ownerId" = o."ownerId" AND x."jobId" = o.id
    AND x.document->>'kind' = 'tailored_cv'
  ORDER BY x."createdAt" DESC, x.id DESC
  LIMIT 1
) d ON true
WHERE o."ownerId" = $1`;

/** Drafts run only on the model whose prompts and guards were verified. */
export function draftModelSupported(config: AiConfig): boolean {
  return (
    config.model ===
    (config.provider === 'gemini' ? GEMINI_MODEL : OLLAMA_CONTEXT_PROFILE.model)
  );
}
export function draftModelProvenance(config: AiConfig) {
  return {
    provider: config.provider,
    model: config.model,
    // Hosted models expose no digest; the pinned model name identifies them.
    modelDigest:
      config.provider === 'ollama' ? OLLAMA_CONTEXT_PROFILE.digest : null,
  };
}

@Injectable()
export class TailoredDraftService {
  private active = false;
  constructor(
    private readonly db: DataSource,
    private readonly current: SavedCvSourceService,
    private readonly jobs: OpportunitiesService,
    private readonly matches: JobMatchService,
    private readonly generator: TailoredDraftGenerator,
    @Inject(AI_CONFIG) private readonly config: AiConfig,
  ) {}
  // Read-only preflight. Reuse the exact generation context checks; never call AI
  // or create a source/profile/draft just to determine readiness.
  async readiness(ownerId: string, jobId: string, body: unknown) {
    jobId = uuid(jobId);
    const value = version(body, [
      'expectedJobUpdatedAt',
      'expectedSavedCvUpdatedAt',
      'matchId',
    ]);
    const expectedJobUpdatedAt = timestamp(value.expectedJobUpdatedAt);
    const expectedCv =
      value.expectedSavedCvUpdatedAt === null
        ? null
        : timestamp(value.expectedSavedCvUpdatedAt);
    const matchId = value.matchId === null ? null : uuid(value.matchId);
    // Latest reviewed profile for the current CV, so the client can tell when
    // an opened draft was built from an earlier review. Null until known.
    let currentProfileRevisionId: string | null = null;
    const blocked = (reason: string) => ({
      contractVersion: '1' as const,
      ready: false as const,
      reason,
      pins: null,
      matchValidForMs: 0,
      currentProfileRevisionId,
    });
    return this.db.transaction(async (manager) => {
      try {
        const job = await this.jobs.forTailoring(manager, ownerId, jobId);
        if (job.updatedAt.toISOString() !== expectedJobUpdatedAt)
          return blocked('CV_DRAFT_STALE_JOB');
        if (!canonicalRequirements(job).length)
          return blocked('CV_DRAFT_JOB_REQUIREMENTS_REQUIRED');
        if (!expectedCv) return blocked('CV_DRAFT_CV_UNAVAILABLE');
        const cv = await manager
          .getRepository(SavedCv)
          .findOne({ where: { ownerId }, select: { updatedAt: true } });
        if (!cv) return blocked('CV_DRAFT_CV_UNAVAILABLE');
        if (cv.updatedAt.toISOString() !== expectedCv)
          return blocked('CV_DRAFT_STALE_CV');
        const current = await this.current.forCapture(
          manager,
          ownerId,
          expectedCv,
        );
        const found = await this.reviewedProfile(manager, ownerId, {
          ...current,
          updatedAt: new Date(expectedCv),
        });
        if (!found) return blocked('CV_DRAFT_PROFILE_NOT_FOUND');
        const { source, profile } = found;
        currentProfileRevisionId = profile.id;
        // Profile completion errors should be visible even before the first match.
        if (!matchId)
          return blocked(
            (await this.profileIssue(manager, ownerId, found, current.text)) ??
              'CV_DRAFT_MATCH_REQUIRED',
          );
        const request = {
          profileRevisionId: profile.id,
          expectedProfileRevision: profile.revision,
          expectedJobUpdatedAt,
          matchId,
        };
        await this.context(manager, ownerId, jobId, request);
        const matchValidForMs = await this.matches.remainingSnapshotMs(
          jobId,
          matchId,
        );
        if (!matchValidForMs) return blocked('CV_DRAFT_STALE_MATCH');
        return {
          contractVersion: '1' as const,
          ready: true as const,
          reason: null,
          pins: { ...request, sourceRevisionId: source.id },
          matchValidForMs,
          currentProfileRevisionId,
        };
      } catch (error) {
        if (error instanceof TailoredDraftError)
          return blocked(error.errorCode);
        if (error instanceof NotFoundException)
          return blocked('CV_DRAFT_JOB_NOT_FOUND');
        throw error;
      }
    });
  }
  /**
   * Read-only reviewed CV facts for other modules (Interview Prep). Same gate as
   * drafts: current CV, its latest profile revision, and a complete review.
   * Contact details and links are excluded. Returns null when unavailable.
   */
  async reviewedFacts(ownerId: string): Promise<string[] | null> {
    const manager = this.db.manager;
    const cv = await manager.getRepository(SavedCv).findOne({
      where: { ownerId },
      select: { ownerId: true, text: true, fileName: true, updatedAt: true },
    });
    if (!cv?.text.trim()) return null;
    const found = await this.reviewedProfile(manager, ownerId, cv);
    if (!found) return null;
    const full = await manager.getRepository(CvProfileRevision).findOne({
      where: { ownerId, id: found.profile.id },
      select: { document: true },
    });
    if (!full) return null;
    try {
      return reviewedPlan(
        profileDocument(full.document, found.source.id, cv.text),
      )
        .facts.filter((f) => !['contact', 'links'].includes(f.sectionKind))
        .map((f) => f.value.trim())
        .filter(Boolean);
    } catch {
      return null; // Incomplete or unresolved review: no fact check, never guess.
    }
  }
  // Current CV's source and latest review profile. Read-only; shared with progress().
  private async reviewedProfile(
    manager: EntityManager,
    ownerId: string,
    cv: { updatedAt: Date; text: string; fileName: string },
  ) {
    const source = await manager.getRepository(CvSourceRevision).findOne({
      where: {
        ownerId,
        savedCvUpdatedAt: cv.updatedAt,
        textHash: draftHash(cv.text),
        fileName: cv.fileName,
      },
    });
    if (!source) return null;
    const profile = await manager.getRepository(CvProfileRevision).findOne({
      where: { ownerId, sourceRevisionId: source.id },
      order: { createdAt: 'DESC', revision: 'DESC', id: 'DESC' },
      select: { id: true, revision: true },
    });
    return profile ? { source, profile } : null;
  }
  private async profileIssue(
    manager: EntityManager,
    ownerId: string,
    found: { source: CvSourceRevision; profile: CvProfileRevision },
    text: string,
  ) {
    const full = await manager.getRepository(CvProfileRevision).findOneOrFail({
      where: { ownerId, id: found.profile.id },
      select: { document: true },
    });
    try {
      reviewedPlan(profileDocument(full.document, found.source.id, text));
      return null;
    } catch (error) {
      return error instanceof TailoredDraftError
        ? error.errorCode
        : 'CV_DRAFT_PROFILE_INCOMPLETE';
    }
  }
  /**
   * Read-only workflow facts for every job of the owner, for the Dashboard.
   * Returns facts only; the client's nextJobAction() decides the next step.
   * Never calls AI, never writes (no match re-bind), never loads draft documents.
   */
  async progress(ownerId: string) {
    const manager = this.db.manager;
    const cv = await manager.getRepository(SavedCv).findOne({
      where: { ownerId },
      select: { ownerId: true, text: true, fileName: true, updatedAt: true },
    });
    let sourceReason: string | null = null;
    if (cv) {
      const found = await this.reviewedProfile(manager, ownerId, cv);
      sourceReason = found
        ? ((await this.profileIssue(manager, ownerId, found, cv.text)) ??
          'CV_DRAFT_MATCH_REQUIRED')
        : 'CV_DRAFT_PROFILE_NOT_FOUND';
    }
    const hash = cv ? cvTextHash(cv.text) : null;
    const rows: ProgressRow[] = await manager.query(JOB_PROGRESS_SQL, [
      ownerId,
    ]);
    return {
      contractVersion: '1' as const,
      cv: { saved: Boolean(cv), sourceReason },
      jobs: rows.map((row) => ({
        id: row.id,
        matchStatus: !hash
          ? ('CV_UNAVAILABLE' as const)
          : !row.policyVersion
            ? ('MISSING' as const)
            : savedMatchStatus(
                {
                  policyVersion: row.policyVersion,
                  cvTextHash: row.cvTextHash!,
                  jobUpdatedAt: row.matchJobUpdatedAt!,
                },
                hash,
                row.jobUpdatedAt,
              ),
        draft: row.draftUpdatedAt && {
          // null: the saved review is malformed, so no step is inferred from it.
          pending: row.pending,
          approved: row.approved,
          jobUpdatedAt: row.draftJobUpdatedAt!.toISOString(),
          updatedAt: row.draftUpdatedAt.toISOString(),
        },
      })),
    };
  }
  private request(body: unknown): GenerateRequest {
    try {
      const value = version(body, [
        'profileRevisionId',
        'expectedProfileRevision',
        'expectedJobUpdatedAt',
        'matchId',
      ]);
      return {
        profileRevisionId: uuid(value.profileRevisionId),
        expectedProfileRevision: revision(value.expectedProfileRevision),
        expectedJobUpdatedAt: timestamp(value.expectedJobUpdatedAt),
        matchId: uuid(value.matchId),
      };
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    }
  }
  private async context(
    manager: EntityManager,
    ownerId: string,
    jobId: string,
    request: GenerateRequest,
  ) {
    const profile = await manager.getRepository(CvProfileRevision).findOne({
      where: { ownerId, id: request.profileRevisionId },
      select: {
        id: true,
        ownerId: true,
        profileId: true,
        revision: true,
        sourceRevisionId: true,
        document: true,
      },
    });
    if (!profile) throw new TailoredDraftError('CV_DRAFT_PROFILE_NOT_FOUND');
    const latest = await manager.getRepository(CvProfileRevision).findOne({
      where: { ownerId, profileId: profile.profileId },
      order: { revision: 'DESC' },
    });
    if (
      profile.revision !== request.expectedProfileRevision ||
      latest?.id !== profile.id
    )
      throw new TailoredDraftError('CV_DRAFT_STALE_PROFILE');
    const source = await manager.getRepository(CvSourceRevision).findOne({
      where: { ownerId, id: profile.sourceRevisionId },
      select: {
        id: true,
        fileName: true,
        text: true,
        textHash: true,
        savedCvUpdatedAt: true,
      },
    });
    if (!source || draftHash(source.text) !== source.textHash)
      throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
    let document;
    try {
      document = profileDocument(profile.document, source.id, source.text);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
    }
    const plan = reviewedPlan(document);
    let job;
    try {
      job = await this.jobs.forTailoring(manager, ownerId, jobId);
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new TailoredDraftError('CV_DRAFT_JOB_NOT_FOUND');
      throw error;
    }
    if (job.updatedAt.toISOString() !== request.expectedJobUpdatedAt)
      throw new TailoredDraftError('CV_DRAFT_STALE_JOB');
    let match;
    try {
      const current = await this.current.forCapture(
        manager,
        ownerId,
        source.savedCvUpdatedAt.toISOString(),
      );
      if (current.text !== source.text || current.fileName !== source.fileName)
        throw new Error();
      match = await this.matches.requireSnapshot(jobId, request.matchId);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_STALE_MATCH');
    }
    const canonical = canonicalRequirements(job);
    if (
      !canonical.length ||
      match.ownerId !== ownerId ||
      match.jobId !== jobId ||
      match.cvUpdatedAt !== source.savedCvUpdatedAt.toISOString() ||
      match.jobUpdatedAt !== request.expectedJobUpdatedAt ||
      draftHash(
        canonical.map((row) => [row.parentId, row.requirement, row.priority]),
      ) !==
        draftHash(
          match.assessment.requirements.map((row) => [
            row.parentId,
            row.requirement,
            row.priority,
          ]),
        )
    )
      throw new TailoredDraftError('CV_DRAFT_STALE_MATCH');
    const jobSnapshot: DraftJobSnapshot = {
      title: job.title,
      company: job.company,
      skills: job.skills,
      preferredSkills: job.preferredSkills,
      experience: job.experience,
      domain: job.domain,
      seniority: job.seniority,
      description: job.description,
      postText: job.postText,
      jdText: job.jdText,
      hasDiscovery: Boolean(job.discovery),
      discoveryRequirements: job.discovery?.requirementSkills ?? null,
    };
    return {
      plan,
      match,
      job: jobSnapshot,
      pins: {
        sourceRevisionId: source.id,
        sourceHash: source.textHash,
        profileRevisionId: profile.id,
        profileId: profile.profileId,
        profileRevision: profile.revision,
        profileHash: draftHash(profile.document),
        jobId,
        jobUpdatedAt: job.updatedAt.toISOString(),
        jobHash: draftHash(jobSnapshot),
        matchId: match.matchId,
      },
    };
  }
  async generate(ownerId: string, jobId: string, body: unknown) {
    const request = this.request(body);
    if (!draftModelSupported(this.config))
      throw new TailoredDraftError('CV_DRAFT_UNAVAILABLE');
    try {
      jobId = uuid(jobId);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    }
    if (this.active) throw new TailoredDraftError('CV_DRAFT_BUSY');
    this.active = true;
    const runner = this.db.createQueryRunner();
    const lockKey = `p83:generation:${ownerId}`;
    let locked = false;
    try {
      await runner.connect();
      const [lock] = await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [lockKey],
      );
      if (!lock.locked) throw new TailoredDraftError('CV_DRAFT_BUSY');
      locked = true;
      const initial = await this.db.transaction((manager) =>
        this.context(manager, ownerId, jobId, request),
      );
      const reload = async (manager: EntityManager) => {
        try {
          return await this.context(manager, ownerId, jobId, request);
        } catch (error) {
          if (
            error instanceof TailoredDraftError &&
            error.errorCode === 'CV_DRAFT_PROFILE_NOT_FOUND'
          )
            throw new TailoredDraftError('CV_DRAFT_STALE_PROFILE');
          if (
            error instanceof TailoredDraftError &&
            error.errorCode === 'CV_DRAFT_JOB_NOT_FOUND'
          )
            throw new TailoredDraftError('CV_DRAFT_STALE_JOB');
          throw error;
        }
      };
      const recheck = async () => {
        const current = await this.db.transaction(reload);
        if (current.pins.profileHash !== initial.pins.profileHash)
          throw new TailoredDraftError('CV_DRAFT_STALE_PROFILE');
        if (current.pins.jobHash !== initial.pins.jobHash)
          throw new TailoredDraftError('CV_DRAFT_STALE_JOB');
      };
      const began = performance.now();
      const generated = await this.generator.generate(initial, recheck);
      generated.document.review = initialReview(generated.document);
      const metadata = {
        pipelineVersion: 'p8.3-v1',
        ...draftModelProvenance(this.config),
        generatedAt: new Date().toISOString(),
        latencyMs: Math.round(performance.now() - began),
        batches: generated.measurements,
        acceptedWording: 'reviewed-profile',
        proposalsAcceptedAutomatically: false,
      };
      const row = await this.db.transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`p8:${ownerId}:${initial.pins.profileId}`],
        );
        const current = await reload(manager);
        if (draftHash(current.pins) !== draftHash(initial.pins))
          throw new TailoredDraftError('CV_DRAFT_SAVE_CONFLICT');
        const [size] = await manager.query(
          'SELECT octet_length($1::jsonb::text) AS document, octet_length($2::jsonb::text) AS metadata',
          [JSON.stringify(generated.document), JSON.stringify(metadata)],
        );
        if (size.document > 131072 || size.metadata > 16384)
          throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
        const repo = manager.getRepository(TailoredCvDraft);
        return repo.save(
          repo.create({
            id: randomUUID(),
            ownerId,
            jobId,
            profileRevisionId: initial.pins.profileRevisionId,
            jobUpdatedAt: new Date(initial.pins.jobUpdatedAt),
            revision: 1,
            document: generated.document,
            generationMetadata: metadata,
            updatedAt: new Date(),
          }),
        );
      });
      return this.dto(row);
    } catch (error) {
      if (error instanceof TailoredDraftError) throw error;
      throw new TailoredDraftError('CV_DRAFT_UNAVAILABLE');
    } finally {
      try {
        if (locked)
          await runner.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [lockKey],
          );
      } finally {
        try {
          await runner.release();
        } finally {
          this.active = false;
        }
      }
    }
  }
  private metadata(row: TailoredCvDraft) {
    return {
      contractVersion: '1',
      id: row.id,
      jobId: row.jobId,
      profileRevisionId: row.profileRevisionId,
      jobUpdatedAt: row.jobUpdatedAt.toISOString(),
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private dto(row: TailoredCvDraft) {
    if (
      !row.document ||
      !('kind' in row.document) ||
      row.document.kind !== 'tailored_cv'
    )
      throw new TailoredDraftError('CV_DRAFT_NOT_FOUND');
    return {
      ...this.metadata(row),
      document: {
        ...row.document,
        review: row.document.review ?? initialReview(row.document),
      },
      generationMetadata: row.generationMetadata,
    };
  }
  async get(ownerId: string, id: string) {
    try {
      id = uuid(id);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    }
    const row = await this.db.getRepository(TailoredCvDraft).findOne({
      where: { ownerId, id },
      select: {
        id: true,
        jobId: true,
        profileRevisionId: true,
        jobUpdatedAt: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
        document: true,
        generationMetadata: true,
      },
    });
    if (!row) throw new TailoredDraftError('CV_DRAFT_NOT_FOUND');
    return this.dto(row);
  }
  async review(ownerId: string, id: string, body: unknown, approve = false) {
    const request = reviewRequest(body, approve);
    try {
      id = uuid(id);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    }
    return this.db.transaction(async (manager) => {
      const repo = manager.getRepository(TailoredCvDraft);
      const row = await repo.findOne({
        where: { ownerId, id },
        select: {
          id: true,
          ownerId: true,
          jobId: true,
          profileRevisionId: true,
          jobUpdatedAt: true,
          revision: true,
          document: true,
          generationMetadata: true,
          createdAt: true,
          updatedAt: true,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new TailoredDraftError('CV_DRAFT_NOT_FOUND');
      const saved = this.dto(row);
      if (
        row.revision !== request.expectedRevision ||
        row.revision >= 2147483646
      )
        throw new TailoredDraftError('CV_DRAFT_SAVE_CONFLICT');
      const profile = await manager.getRepository(CvProfileRevision).findOne({
        where: { ownerId, id: row.profileRevisionId },
        select: { id: true, document: true },
      });
      if (
        !profile ||
        saved.document.pins.profileRevisionId !== profile.id ||
        draftHash(profile.document) !== saved.document.pins.profileHash
      )
        throw new TailoredDraftError('CV_DRAFT_STALE_PROFILE');
      const originals = new Map(
        profile.document.sections.flatMap((s) =>
          s.entries.flatMap((e) =>
            e.facts.map((f) => [f.id, f.value] as const),
          ),
        ),
      );
      const now = new Date();
      row.document = approve
        ? approveReview(
            saved.document,
            request.reviewedFactIds,
            row.revision + 1,
            now.toISOString(),
          )
        : applyReview(saved.document, request.operations, originals);
      if (Buffer.byteLength(JSON.stringify(row.document)) > 96 * 1024)
        throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
      const [size] = await manager.query(
        'SELECT octet_length($1::jsonb::text) AS bytes',
        [JSON.stringify(row.document)],
      );
      if (size.bytes > 131072)
        throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
      row.revision++;
      row.updatedAt = now;
      return this.dto(await repo.save(row));
    });
  }
  async list(ownerId: string, jobId: string, query: unknown) {
    let before: string | null = null;
    try {
      jobId = uuid(jobId);
      if (
        !query ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).some((key) => key !== 'before')
      )
        throw new Error();
      if ('before' in query) before = uuid(query.before);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    }
    await this.db.transaction(async (manager) => {
      try {
        await this.jobs.forTailoring(manager, ownerId, jobId);
      } catch (error) {
        if (error instanceof NotFoundException)
          throw new TailoredDraftError('CV_DRAFT_JOB_NOT_FOUND');
        throw error;
      }
    });
    const rows = this.db
      .getRepository(TailoredCvDraft)
      .createQueryBuilder('draft')
      .where('draft.ownerId = :ownerId AND draft.jobId = :jobId', {
        ownerId,
        jobId,
      })
      .andWhere("draft.document ->> 'kind' = :kind", { kind: 'tailored_cv' });
    if (before) {
      const cursor = await rows
        .clone()
        .andWhere('draft.id = :before', { before })
        .getOne();
      if (!cursor) throw new TailoredDraftError('CV_DRAFT_NOT_FOUND');
      rows.andWhere(
        '(draft.createdAt, draft.id) < (SELECT c."createdAt", c.id FROM ai_job_hunter.tailored_cv_drafts c WHERE c.id = :before AND c."ownerId" = :ownerId AND c."jobId" = :jobId)',
        { before },
      );
    }
    const found = await rows
      .orderBy('draft.createdAt', 'DESC')
      .addOrderBy('draft.id', 'DESC')
      .take(21)
      .getMany();
    return {
      contractVersion: '1',
      items: found.slice(0, 20).map((row) => this.metadata(row)),
      nextCursor: found.length > 20 ? found[19]!.id : null,
    };
  }
}
