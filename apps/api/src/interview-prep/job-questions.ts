import type { DataSource } from 'typeorm';
import {
  findQuestion,
  type InterviewQuestion,
} from './interview-prep.questions.js';

/** Exact public form of a generated question ID: "jd-" + lowercase UUID. */
export const JD_QUESTION_ID =
  /^jd-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;

const CATEGORY_LABEL: Record<string, string> = {
  skill: 'Technical skill',
  architecture: 'Architecture and design',
  troubleshooting: 'Troubleshooting',
  experience: 'Technical experience',
};

/**
 * Curated catalog first (no database access); then, only for an exact
 * `jd-<uuid>`, the owner's persisted generated question. Ownership of the
 * set and job is guaranteed by the composite foreign keys on ownerId.
 * Database errors propagate; callers map them to their storage error.
 */
/** The job a generated "jd-<uuid>" question belongs to; null for curated or unknown IDs. */
export async function questionJobId(
  db: DataSource,
  ownerId: string,
  id: unknown,
): Promise<string | null> {
  const uuid = typeof id === 'string' ? JD_QUESTION_ID.exec(id)?.[1] : null;
  if (!uuid) return null;
  const [row] = (await db.query(
    `SELECT s."jobId" FROM ai_job_hunter.interview_job_questions q
     JOIN ai_job_hunter.interview_question_sets s
       ON s."ownerId" = q."ownerId" AND s.id = q."setId"
     WHERE q."ownerId" = $1 AND q.id = $2`,
    [ownerId, uuid],
  )) as { jobId: string }[];
  return row?.jobId ?? null;
}
export async function resolveQuestion(
  db: DataSource,
  ownerId: string,
  id: unknown,
): Promise<InterviewQuestion | undefined> {
  const curated = findQuestion(id);
  if (curated) return curated;
  const uuid = typeof id === 'string' ? JD_QUESTION_ID.exec(id)?.[1] : null;
  if (!uuid) return undefined;
  const [row] = (await db.query(
    `SELECT category, kind, question, why FROM ai_job_hunter.interview_job_questions
     WHERE "ownerId" = $1 AND id = $2`,
    [ownerId, uuid],
  )) as {
    category: string;
    kind: InterviewQuestion['kind'];
    question: string;
    why: string;
  }[];
  if (!row) return undefined;
  return {
    id: id as string,
    topic: 'technical',
    category: CATEGORY_LABEL[row.category] ?? 'Technical',
    kind: row.kind,
    variants: [row.question],
    hints: [],
    // Claim notices only where the user describes their own work.
    checkClaims: row.kind === 'personal',
    why: row.why,
  };
}
