import { Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  InterviewPrepError,
  type SavedAnswerDto,
} from './interview-prep.policy.js';
import { findQuestion } from './interview-prep.questions.js';

export const MAX_REFERENCE_ANSWER = 2000;
// Same set as the database CHECK: C0 controls except tab/newline, plus DEL.
const disallowed = (text: string) =>
  [...text].some((ch) => {
    const code = ch.codePointAt(0)!;
    return code <= 0x08 || (code >= 0x0b && code <= 0x1f) || code === 0x7f;
  });
const invalid = () =>
  new InterviewPrepError(
    'INTERVIEW_INVALID_REQUEST',
    `Enter an answer of 1–${MAX_REFERENCE_ANSWER} characters.`,
  );

export function parseQuestionId(id: unknown): string {
  if (!findQuestion(id)) throw invalid();
  return id as string;
}
export function parseVersion(value: unknown): number {
  const n =
    typeof value === 'string' && /^[1-9]\d{0,9}$/u.test(value)
      ? Number(value)
      : value;
  if (
    typeof n !== 'number' ||
    !Number.isSafeInteger(n) ||
    n < 1 ||
    n > 2147483647
  )
    throw invalid();
  return n;
}
/** Strict body: exactly { answer, expectedVersion }; answer limits in code points. */
export function parseSaveBody(body: unknown): {
  answer: string;
  expectedVersion: number | null;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'answer,expectedVersion')
    throw invalid();
  if (typeof value.answer !== 'string') throw invalid();
  const answer = value.answer.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  const length = [...answer].length;
  if (!length || length > MAX_REFERENCE_ANSWER || disallowed(answer))
    throw invalid();
  if (value.expectedVersion === null) return { answer, expectedVersion: null };
  // JSON body: a real number only (query strings are parsed by parseVersion).
  if (typeof value.expectedVersion !== 'number') throw invalid();
  return { answer, expectedVersion: parseVersion(value.expectedVersion) };
}

interface Row {
  questionId: string;
  answer: string;
  version: number;
  updatedAt: Date;
}
const dto = (row: Row): SavedAnswerDto => ({
  questionId: row.questionId,
  answer: row.answer,
  version: Number(row.version),
  updatedAt: new Date(row.updatedAt).toISOString(),
});
// TypeORM returns [rows, count] for UPDATE/DELETE and rows for INSERT/SELECT.
const rows = (result: unknown): Row[] =>
  Array.isArray(result) && Array.isArray(result[0])
    ? (result[0] as Row[])
    : (result as Row[]);
const T = 'ai_job_hunter.interview_answers';
const COLS = '"questionId", answer, version, "updatedAt"';

/**
 * Owner-scoped reference answers. Each write is ONE conditional SQL statement,
 * so two tabs can never both pass the same stale-version check.
 */
@Injectable()
export class InterviewAnswersService {
  constructor(private readonly db: DataSource) {}

  async list(ownerId: string): Promise<SavedAnswerDto[]> {
    const result = await this.run(() =>
      this.db.query(
        `SELECT ${COLS} FROM ${T} WHERE "ownerId" = $1 ORDER BY "questionId"`,
        [ownerId],
      ),
    );
    // Retired or unknown IDs stay stored but are hidden from the active catalog.
    return rows(result)
      .filter((row) => findQuestion(row.questionId))
      .map(dto);
  }

  async save(ownerId: string, questionIdRaw: unknown, body: unknown) {
    const questionId = parseQuestionId(questionIdRaw);
    const { answer, expectedVersion } = parseSaveBody(body);
    const result = await this.run(() =>
      expectedVersion === null
        ? this.db.query(
            `INSERT INTO ${T} ("ownerId", "questionId", answer) VALUES ($1, $2, $3)
             ON CONFLICT ("ownerId", "questionId") DO NOTHING RETURNING ${COLS}`,
            [ownerId, questionId, answer],
          )
        : this.db.query(
            `UPDATE ${T} SET answer = $3, version = version + 1, "updatedAt" = now()
             WHERE "ownerId" = $1 AND "questionId" = $2 AND version = $4 RETURNING ${COLS}`,
            [ownerId, questionId, answer, expectedVersion],
          ),
    );
    const [saved] = rows(result);
    if (!saved) throw await this.conflict(ownerId, questionId);
    return dto(saved);
  }

  async remove(ownerId: string, questionIdRaw: unknown, versionRaw: unknown) {
    const questionId = parseQuestionId(questionIdRaw);
    const expectedVersion = parseVersion(versionRaw);
    const result = await this.run(() =>
      this.db.query(
        `DELETE FROM ${T} WHERE "ownerId" = $1 AND "questionId" = $2 AND version = $3
         RETURNING "questionId"`,
        [ownerId, questionId, expectedVersion],
      ),
    );
    if (!rows(result).length) throw await this.conflict(ownerId, questionId);
  }

  // Informational read AFTER the atomic decision; it never decides the outcome.
  private async conflict(ownerId: string, questionId: string) {
    const result = await this.run(() =>
      this.db.query(
        `SELECT ${COLS} FROM ${T} WHERE "ownerId" = $1 AND "questionId" = $2`,
        [ownerId, questionId],
      ),
    );
    const [current] = rows(result);
    return new InterviewPrepError(
      'INTERVIEW_ANSWER_CONFLICT',
      undefined,
      current ? dto(current) : null,
    );
  }

  private async run<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (error) {
      // CHECK violation: the database rejected what validation should have.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === '23514'
      )
        throw invalid();
      throw new InterviewPrepError('INTERVIEW_STORAGE_UNAVAILABLE');
    }
  }
}
