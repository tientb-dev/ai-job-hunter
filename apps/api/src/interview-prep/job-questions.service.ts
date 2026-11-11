import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AiService } from '../ai/ai.service.js';
import { AiError } from '../ai/ai.errors.js';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';
import { InterviewPrepError } from './interview-prep.policy.js';
import { InterviewPrepService } from './interview-prep.service.js';
import {
  JOB_QUESTIONS_SCHEMA,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  TARGET_QUESTIONS,
  jdSnapshot,
  jobQuestionsPrompt,
  validateQuestions,
  type JobQuestion,
} from './job-questions.policy.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SETS = 'ai_job_hunter.interview_question_sets';
const QUESTIONS = 'ai_job_hunter.interview_job_questions';
const INVALID_OUTPUT = new Set([
  'INVALID_JSON',
  'SCHEMA_VALIDATION_FAILURE',
  'MALFORMED_RESPONSE',
  'OUTPUT_LIMIT_EXCEEDED',
  'RESPONSE_TOO_LARGE',
]);
const invalid = () => new InterviewPrepError('INTERVIEW_INVALID_REQUEST');

function parseList(body: unknown) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).join(',') !== 'contractVersion' ||
    (body as { contractVersion?: unknown }).contractVersion !== '1'
  )
    throw invalid();
}
function parseGenerate(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !== 'basedOnSetId,contractVersion' ||
    value.contractVersion !== '1'
  )
    throw invalid();
  if (value.basedOnSetId === null) return null;
  if (typeof value.basedOnSetId !== 'string' || !UUID.test(value.basedOnSetId))
    throw invalid();
  return value.basedOnSetId;
}
function aiFailure(error: unknown): never {
  if (error instanceof AiError) {
    if (error.code === 'TIMEOUT')
      throw new InterviewPrepError('INTERVIEW_TIMEOUT');
    if (INVALID_OUTPUT.has(error.code))
      throw new InterviewPrepError('INTERVIEW_INVALID_OUTPUT');
  }
  throw new InterviewPrepError('INTERVIEW_AI_UNAVAILABLE');
}

interface SetRow {
  id: string;
  createdAt: Date;
  jdHash: string;
}
interface QuestionRow extends JobQuestion {
  id: string;
  setId: string;
  position: number;
}
const questionDto = (q: QuestionRow) => ({
  id: `jd-${q.id}`,
  position: Number(q.position),
  category: q.category,
  kind: q.kind,
  question: q.question,
  why: q.why,
  evidence: q.evidence,
});
const setDto = (set: SetRow, questions: QuestionRow[], active: boolean) => ({
  id: set.id,
  createdAt: new Date(set.createdAt).toISOString(),
  active,
  partial: questions.length < TARGET_QUESTIONS,
  questions: questions.map(questionDto),
});

/**
 * JD-grounded technical question sets. Sets are append-only and the newest is
 * active; nothing here deletes sets or answers.
 */
@Injectable()
export class JobQuestionsService {
  constructor(
    private readonly db: DataSource,
    private readonly ai: AiService,
    private readonly jobs: OpportunitiesService,
    private readonly prep: InterviewPrepService,
  ) {}

  async list(ownerId: string, jobId: string, body: unknown) {
    parseList(body);
    return this.storage(async () => {
      const job = await this.job(this.db.manager, ownerId, jobId);
      const snapshot = jdSnapshot(job);
      const sets = (await this.db.query(
        `SELECT id, "createdAt", "jdHash" FROM ${SETS}
         WHERE "ownerId" = $1 AND "jobId" = $2 ORDER BY "createdAt" DESC, id DESC`,
        [ownerId, jobId],
      )) as SetRow[];
      const questions = (await this.db.query(
        `SELECT q.id, q."setId", q.position, q.category, q.kind, q.question, q.why, q.evidence
         FROM ${QUESTIONS} q JOIN ${SETS} s ON s."ownerId" = q."ownerId" AND s.id = q."setId"
         WHERE q."ownerId" = $1 AND s."jobId" = $2 ORDER BY q.position`,
        [ownerId, jobId],
      )) as QuestionRow[];
      return {
        contractVersion: '1' as const,
        job: { id: job.id, title: job.title, company: job.company },
        jdEmpty: snapshot.empty,
        jdChanged: sets.length > 0 && sets[0]!.jdHash !== snapshot.hash,
        sets: sets.map((set, i) =>
          setDto(
            set,
            questions.filter((q) => q.setId === set.id),
            i === 0,
          ),
        ),
      };
    });
  }

  async generate(ownerId: string, jobId: string, body: unknown) {
    const basedOnSetId = parseGenerate(body);
    // One local generation at a time, shared with practice feedback.
    return this.prep.exclusive(async () => {
      const { snapshot, existing } = await this.storage(async () => {
        const job = await this.job(this.db.manager, ownerId, jobId);
        // Fail fast for a stale tab before spending a model call.
        await this.requireActive(this.db.manager, ownerId, jobId, basedOnSetId);
        // Regeneration avoids the ACTIVE set only (not older sets).
        const existing = basedOnSetId
          ? ((await this.db.query(
              `SELECT category, kind, question, why, evidence FROM ${QUESTIONS}
               WHERE "ownerId" = $1 AND "setId" = $2 ORDER BY position`,
              [ownerId, basedOnSetId],
            )) as JobQuestion[])
          : [];
        return { snapshot: jdSnapshot(job), existing };
      });
      if (snapshot.empty) throw new InterviewPrepError('INTERVIEW_JD_EMPTY');

      const ask = async (avoid: string[]) => {
        try {
          return await this.ai.generateStructured({
            prompt: jobQuestionsPrompt(snapshot.text, avoid),
            schema: JOB_QUESTIONS_SCHEMA,
          });
        } catch (error) {
          return aiFailure(error);
        }
      };
      // Provider failures are never retried automatically. The model runs at
      // temperature 0, so new questions need an explicit avoid list; the same
      // questions also seed the duplicate check (exact and near-duplicates).
      let valid = validateQuestions(
        await ask(existing.map((q) => q.question)),
        snapshot.source,
        [],
        existing,
      ).valid;
      if (valid.length < TARGET_QUESTIONS) {
        // A successful but thin response: one retry, pooled without duplicates.
        try {
          const more = await ask(
            [...existing, ...valid].map((q) => q.question),
          );
          valid = [
            ...valid,
            ...validateQuestions(more, snapshot.source, valid, existing).valid,
          ];
        } catch (error) {
          // A failed retry keeps the first attempt's result when it is enough.
          if (valid.length < MIN_QUESTIONS) throw error;
        }
      }
      valid = valid.slice(0, MAX_QUESTIONS);
      if (valid.length < MIN_QUESTIONS)
        throw new InterviewPrepError(
          existing.length
            ? 'INTERVIEW_NO_NEW_QUESTIONS'
            : 'INTERVIEW_TOO_FEW_QUESTIONS',
        );

      const saved = await this.storage(() =>
        this.db.transaction(async (m) => {
          // Serializes generators for this job across processes too.
          await m.query(
            "SELECT pg_advisory_xact_lock(hashtext('interview-question-sets'), hashtext($1))",
            [jobId],
          );
          // FOR SHARE: a concurrent JD edit waits for this commit, or wins first.
          const job = await this.job(m, ownerId, jobId, true);
          if (jdSnapshot(job).hash !== snapshot.hash)
            throw new InterviewPrepError('INTERVIEW_JD_CHANGED');
          await this.requireActive(m, ownerId, jobId, basedOnSetId);
          const [set] = (await m.query(
            `INSERT INTO ${SETS} ("ownerId", "jobId", "jdHash") VALUES ($1, $2, $3)
             RETURNING id, "createdAt", "jdHash"`,
            [ownerId, jobId, snapshot.hash],
          )) as SetRow[];
          const params: unknown[] = [ownerId, set!.id];
          const values = valid.map((q, i) => {
            params.push(
              i + 1,
              q.category,
              q.kind,
              q.question,
              q.why,
              q.evidence,
            );
            const n = params.length;
            return `($1, $2, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
          });
          const questions = (await m.query(
            `INSERT INTO ${QUESTIONS} ("ownerId", "setId", position, category, kind, question, why, evidence)
             VALUES ${values.join(', ')}
             RETURNING id, "setId", position, category, kind, question, why, evidence`,
            params,
          )) as QuestionRow[];
          return setDto(
            set!,
            questions.sort((a, b) => a.position - b.position),
            true,
          );
        }),
      );
      return {
        contractVersion: '1' as const,
        set: saved,
        partial: saved.partial,
      };
    });
  }

  private async job(
    m: EntityManager,
    ownerId: string,
    jobId: string,
    lock = false,
  ) {
    const job = await this.jobs.forInterview(m, ownerId, jobId, lock);
    if (!job) throw new InterviewPrepError('INTERVIEW_JOB_NOT_FOUND');
    return job;
  }

  private async requireActive(
    m: EntityManager,
    ownerId: string,
    jobId: string,
    basedOnSetId: string | null,
  ) {
    const [active] = (await m.query(
      `SELECT id FROM ${SETS} WHERE "ownerId" = $1 AND "jobId" = $2
       ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
      [ownerId, jobId],
    )) as { id: string }[];
    if ((active?.id ?? null) !== basedOnSetId)
      throw new InterviewPrepError('INTERVIEW_SET_OUTDATED');
  }

  /** Our own errors pass through; any database failure is a safe 503. */
  private async storage<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof InterviewPrepError) throw error;
      throw new InterviewPrepError('INTERVIEW_STORAGE_UNAVAILABLE');
    }
  }
}
