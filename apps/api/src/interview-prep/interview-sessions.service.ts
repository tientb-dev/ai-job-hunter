import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { InterviewPrepError } from './interview-prep.policy.js';
import { INTERVIEW_QUESTIONS } from './interview-prep.questions.js';
import { parseVersion } from './interview-answers.service.js';
import {
  parseContract,
  parseCreate,
  parseItem,
  sessionDto,
  type SessionItem,
  type SessionRow,
} from './interview-sessions.policy.js';

const T = 'ai_job_hunter.interview_sessions';
const COLS =
  'id, source, "jobId", status, items, "currentIndex", version, "createdAt", "updatedAt"';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// TypeORM returns [rows, count] for UPDATE/DELETE and rows for INSERT/SELECT.
const rows = (result: unknown): SessionRow[] =>
  Array.isArray(result) && Array.isArray(result[0])
    ? (result[0] as SessionRow[])
    : (result as SessionRow[]);
const pick = <X>(xs: readonly X[]) => xs[randomInt(xs.length)]!;
const sample = <X>(xs: readonly X[], n: number) => {
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
};
const item = (questionId: string, questionText: string): SessionItem => ({
  questionId,
  questionText,
  answer: null,
  feedback: null,
  skipped: false,
});

/**
 * Owner-scoped mock interview sessions. Each write is ONE conditional SQL
 * statement on (status, version, currentIndex), so stale tabs get a 409.
 */
@Injectable()
export class InterviewSessionsService {
  constructor(private readonly db: DataSource) {}

  async create(ownerId: string, body: unknown) {
    const request = parseCreate(body);
    const items =
      request.source === 'curated'
        ? sample(INTERVIEW_QUESTIONS, request.count).map((q) =>
            item(q.id, pick(q.variants)),
          )
        : await this.jobItems(ownerId, request);
    const result = await this.run(() =>
      this.db.query(
        `INSERT INTO ${T} ("ownerId", source, "jobId", items)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING ${COLS}`,
        [
          ownerId,
          request.source,
          request.source === 'job' ? request.jobId : null,
          JSON.stringify(items),
        ],
      ),
    );
    return sessionDto(rows(result)[0]!);
  }

  /** The owner's active session, or null: this is how a refresh resumes. */
  async active(ownerId: string, body: unknown) {
    parseContract(body);
    const [row] = rows(
      await this.run(() =>
        this.db.query(
          `SELECT ${COLS} FROM ${T} WHERE "ownerId" = $1 AND status = 'active'`,
          [ownerId],
        ),
      ),
    );
    return row ? sessionDto(row) : null;
  }

  async get(ownerId: string, id: unknown, body: unknown) {
    parseContract(body);
    const [row] = await this.find(ownerId, this.id(id));
    if (!row) throw new InterviewPrepError('INTERVIEW_SESSION_NOT_FOUND');
    return sessionDto(row);
  }

  /** Answers or skips the current question and advances. */
  async saveItem(
    ownerId: string,
    idRaw: unknown,
    indexRaw: unknown,
    body: unknown,
  ) {
    const id = this.id(idRaw);
    const index = this.index(indexRaw);
    const [current] = await this.find(ownerId, id);
    if (!current) throw new InterviewPrepError('INTERVIEW_SESSION_NOT_FOUND');
    const target = current.items[index];
    if (!target) throw new InterviewPrepError('INTERVIEW_INVALID_REQUEST');
    const { expectedVersion, item: saved } = parseItem(body, target.questionId);
    const next: SessionItem = { ...saved, questionText: target.questionText };
    // The read above only validates; this statement decides the outcome.
    const result = await this.run(() =>
      this.db.query(
        `UPDATE ${T} SET items = jsonb_set(items, ARRAY[$3::int::text], $4::jsonb),
           "currentIndex" = $3::int + 1, version = version + 1, "updatedAt" = now()
         WHERE "ownerId" = $1 AND id = $2 AND status = 'active'
           AND "currentIndex" = $3::int AND version = $5 AND items->($3::int)->>'questionId' = $6
         RETURNING ${COLS}`,
        [
          ownerId,
          id,
          index,
          JSON.stringify(next),
          expectedVersion,
          target.questionId,
        ],
      ),
    );
    const [row] = rows(result);
    if (!row) throw new InterviewPrepError('INTERVIEW_SESSION_CONFLICT');
    return sessionDto(row);
  }

  /** Ends the session (early end allowed); unreached questions stay "unanswered". */
  async complete(ownerId: string, idRaw: unknown, body: unknown) {
    const id = this.id(idRaw);
    const expectedVersion = this.bodyVersion(body);
    const result = await this.run(() =>
      this.db.query(
        `UPDATE ${T} SET status = 'completed', version = version + 1, "updatedAt" = now()
         WHERE "ownerId" = $1 AND id = $2 AND status = 'active' AND version = $3
         RETURNING ${COLS}`,
        [ownerId, id, expectedVersion],
      ),
    );
    const [row] = rows(result);
    if (!row) throw await this.missingOrConflict(ownerId, id);
    return sessionDto(row);
  }

  /** Discard (active) or delete (completed): both remove the row. */
  async remove(ownerId: string, idRaw: unknown, versionRaw: unknown) {
    const id = this.id(idRaw);
    const expectedVersion = parseVersion(versionRaw);
    const result = await this.run(() =>
      this.db.query(
        `DELETE FROM ${T} WHERE "ownerId" = $1 AND id = $2 AND version = $3 RETURNING id`,
        [ownerId, id, expectedVersion],
      ),
    );
    if (!rows(result).length) throw await this.missingOrConflict(ownerId, id);
  }

  private async jobItems(
    ownerId: string,
    request: { jobId: string; setId: string; count: number },
  ) {
    // Owner, job and set must all match; JD sets are append-only, so any
    // existing set of this job is a valid source.
    const questions = (await this.run(() =>
      this.db.query(
        `SELECT q.id, q.question FROM ai_job_hunter.interview_job_questions q
         JOIN ai_job_hunter.interview_question_sets s ON s."ownerId" = q."ownerId" AND s.id = q."setId"
         WHERE q."ownerId" = $1 AND s."jobId" = $2 AND s.id = $3
         ORDER BY q.position LIMIT $4`,
        [ownerId, request.jobId, request.setId, request.count],
      ),
    )) as { id: string; question: string }[];
    if (!questions.length)
      throw new InterviewPrepError('INTERVIEW_JOB_NOT_FOUND');
    return questions.map((q) => item(`jd-${q.id}`, q.question));
  }

  private find(ownerId: string, id: string) {
    return this.run(async () =>
      rows(
        await this.db.query(
          `SELECT ${COLS} FROM ${T} WHERE "ownerId" = $1 AND id = $2`,
          [ownerId, id],
        ),
      ),
    );
  }

  // Informational read AFTER the atomic decision; it never decides the outcome.
  private async missingOrConflict(ownerId: string, id: string) {
    const [row] = await this.find(ownerId, id);
    return new InterviewPrepError(
      row ? 'INTERVIEW_SESSION_CONFLICT' : 'INTERVIEW_SESSION_NOT_FOUND',
    );
  }

  private id(value: unknown): string {
    if (typeof value !== 'string' || !UUID.test(value))
      throw new InterviewPrepError('INTERVIEW_SESSION_NOT_FOUND');
    return value;
  }
  private index(value: unknown): number {
    const n =
      typeof value === 'string' && /^[0-7]$/u.test(value)
        ? Number(value)
        : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 7)
      throw new InterviewPrepError('INTERVIEW_INVALID_REQUEST');
    return n;
  }
  private bodyVersion(body: unknown): number {
    const b = body as Record<string, unknown> | null;
    if (
      !b ||
      typeof b !== 'object' ||
      Array.isArray(b) ||
      Object.keys(b).join(',') !== 'expectedVersion' ||
      typeof b.expectedVersion !== 'number'
    )
      throw new InterviewPrepError('INTERVIEW_INVALID_REQUEST');
    return parseVersion(b.expectedVersion);
  }

  private async run<R>(query: () => Promise<R>): Promise<R> {
    try {
      return await query();
    } catch (error) {
      if (error instanceof InterviewPrepError) throw error;
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '23505')
        throw new InterviewPrepError('INTERVIEW_SESSION_ACTIVE');
      // FK: the job was deleted between checks.
      if (code === '23503')
        throw new InterviewPrepError('INTERVIEW_JOB_NOT_FOUND');
      if (code === '23514')
        throw new InterviewPrepError('INTERVIEW_INVALID_REQUEST');
      throw new InterviewPrepError('INTERVIEW_STORAGE_UNAVAILABLE');
    }
  }
}
