import { normalizeAnswer } from './interview-answers.service.js';
import {
  InterviewPrepError,
  MAX_ANSWER_CHARS,
  type FeedbackResponse,
} from './interview-prep.policy.js';

export const MIN_SESSION_QUESTIONS = 5;
export const MAX_SESSION_QUESTIONS = 8;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface SessionItem {
  questionId: string;
  questionText: string;
  /** Confirmed answer; null = not answered yet (or skipped when `skipped`). */
  answer: string | null;
  feedback: FeedbackResponse | null;
  skipped: boolean;
}
export type CreateSession =
  | { source: 'curated'; count: number }
  | { source: 'job'; count: number; jobId: string; setId: string };

const invalid = (message?: string) =>
  new InterviewPrepError('INTERVIEW_INVALID_REQUEST', message);
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const hasKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).sort().join(',') === [...keys].sort().join(',');

/** Strict read body: exactly { contractVersion: '1' }. */
export function parseContract(body: unknown): void {
  if (
    !isObject(body) ||
    !hasKeys(body, ['contractVersion']) ||
    body.contractVersion !== '1'
  )
    throw invalid();
}

export function parseCreate(body: unknown): CreateSession {
  if (!isObject(body) || body.contractVersion !== '1') throw invalid();
  const count = body.count;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < MIN_SESSION_QUESTIONS ||
    count > MAX_SESSION_QUESTIONS
  )
    throw invalid(
      `Choose ${MIN_SESSION_QUESTIONS}–${MAX_SESSION_QUESTIONS} questions.`,
    );
  if (
    body.source === 'curated' &&
    hasKeys(body, ['contractVersion', 'source', 'count'])
  )
    return { source: 'curated', count };
  if (
    body.source === 'job' &&
    hasKeys(body, ['contractVersion', 'source', 'count', 'jobId', 'setId']) &&
    typeof body.jobId === 'string' &&
    UUID.test(body.jobId) &&
    typeof body.setId === 'string' &&
    UUID.test(body.setId)
  )
    return { source: 'job', count, jobId: body.jobId, setId: body.setId };
  throw invalid();
}

/**
 * Strict body: { expectedVersion, answer, feedback }. answer null = skip
 * (feedback must then be null); feedback is optional for an answer.
 */
export function parseItem(
  body: unknown,
  questionId: string,
): { expectedVersion: number; item: Omit<SessionItem, 'questionText'> } {
  if (
    !isObject(body) ||
    !hasKeys(body, ['expectedVersion', 'answer', 'feedback'])
  )
    throw invalid();
  const v = body.expectedVersion;
  if (
    typeof v !== 'number' ||
    !Number.isSafeInteger(v) ||
    v < 1 ||
    v > 2 ** 31 - 1
  )
    throw invalid();
  if (body.answer === null) {
    if (body.feedback !== null) throw invalid();
    return {
      expectedVersion: v,
      item: { questionId, answer: null, feedback: null, skipped: true },
    };
  }
  const answer = normalizeAnswer(body.answer, MAX_ANSWER_CHARS);
  if (answer === null)
    throw invalid(`Enter an answer of 1–${MAX_ANSWER_CHARS} characters.`);
  const feedback =
    body.feedback === null ? null : parseFeedback(body.feedback, questionId);
  return {
    expectedVersion: v,
    item: { questionId, answer, feedback, skipped: false },
  };
}

// ------------------------------------------------- feedback (FeedbackResponse)
const WITHHELD = [
  'CHANGED_FACTS',
  'CHANGED_MEANING',
  'TOO_LONG',
  'OFF_TOPIC',
  'NOT_ENOUGH_DETAIL',
  'UNCLEAR',
];
const FEEDBACK_KEYS = [
  'contractVersion',
  'mode',
  'questionId',
  'answersQuestion',
  'mainIssue',
  'corrections',
  'suggestion',
  'suggestionWithheld',
  'followUpQuestions',
  'phrases',
  'technicalNote',
  'cvCheck',
];
// Limits mirror buildResponse/guards in interview-prep.policy.ts.
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.length >= 1 && v.length <= max;
const textOrNull = (v: unknown, max: number) => v === null || text(v, max);
const list = (v: unknown, max: number, item: (x: unknown) => boolean) =>
  Array.isArray(v) && v.length <= max && v.every(item);
const pair = (v: unknown, a: string, aMax: number, b: string, bMax: number) =>
  isObject(v) && hasKeys(v, [a, b]) && text(v[a], aMax) && text(v[b], bMax);

/** Exact FeedbackResponse shape for this question, or INVALID_REQUEST. */
export function parseFeedback(
  value: unknown,
  questionId: string,
): FeedbackResponse {
  const f = value as Record<string, unknown>;
  const review = isObject(f) && f.mode === 'review';
  const cv = isObject(f) ? f.cvCheck : null;
  const ok =
    isObject(f) &&
    hasKeys(f, FEEDBACK_KEYS) &&
    f.contractVersion === '1' &&
    (f.mode === 'express' || f.mode === 'review') &&
    f.questionId === questionId &&
    (review
      ? f.answersQuestion === null ||
        ['yes', 'partly', 'no'].includes(f.answersQuestion as string)
      : f.answersQuestion === null) &&
    (review ? textOrNull(f.mainIssue, 240) : f.mainIssue === null) &&
    list(f.corrections, review ? 3 : 0, (c) =>
      pair(c, 'original', 200, 'better', 200),
    ) &&
    textOrNull(f.suggestion, 900) &&
    (f.suggestionWithheld === null ||
      WITHHELD.includes(f.suggestionWithheld as string)) &&
    !(f.suggestion !== null && f.suggestionWithheld !== null) &&
    list(f.followUpQuestions, 2, (x) => text(x, 140)) &&
    list(f.phrases, 3, (p) => pair(p, 'text', 90, 'noteVi', 120)) &&
    textOrNull(f.technicalNote, 240) &&
    isObject(cv) &&
    hasKeys(cv, ['status', 'notices']) &&
    ['checked', 'unavailable', 'not_applicable'].includes(
      cv.status as string,
    ) &&
    list(cv.notices, cv.status === 'checked' ? 3 : 0, (x) => text(x, 600));
  if (!ok) throw invalid('This feedback cannot be saved. Request it again.');
  return f as unknown as FeedbackResponse;
}

// ---------------------------------------------------------------- response
export interface SessionRow {
  id: string;
  source: 'curated' | 'job';
  jobId: string | null;
  status: 'active' | 'completed';
  items: SessionItem[];
  currentIndex: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export function sessionDto(row: SessionRow) {
  const items = row.items;
  const answered = items.filter((i) => i.answer !== null);
  const verdicts = { yes: 0, partly: 0, no: 0 };
  for (const i of answered) {
    const v = i.feedback?.answersQuestion;
    if (v) verdicts[v] += 1;
  }
  return {
    contractVersion: '1' as const,
    id: row.id,
    source: row.source,
    jobId: row.jobId,
    status: row.status,
    currentIndex: Number(row.currentIndex),
    version: Number(row.version),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    items,
    summary: {
      total: items.length,
      answered: answered.length,
      skipped: items.filter((i) => i.skipped).length,
      // Not reached (session ended early or still in progress); never "skipped".
      unanswered: items.filter((i) => i.answer === null && !i.skipped).length,
      withFeedback: answered.filter((i) => i.feedback).length,
      answersQuestion: verdicts,
    },
  };
}
