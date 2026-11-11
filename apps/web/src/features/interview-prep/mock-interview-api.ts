import {
  PracticeError,
  decodeFeedback,
  type PracticeFeedback,
} from './interview-prep-api';

export const SESSION_COUNTS = [5, 6, 7, 8] as const;
export interface SessionItem {
  questionId: string;
  questionText: string;
  answer: string | null;
  feedback: PracticeFeedback | null;
  skipped: boolean;
}
export interface MockSession {
  id: string;
  source: 'curated' | 'job';
  jobId: string | null;
  status: 'active' | 'completed';
  currentIndex: number;
  version: number;
  items: SessionItem[];
  summary: {
    total: number;
    answered: number;
    skipped: number;
    unanswered: number;
    withFeedback: number;
  };
}
/** 409 from a stale tab: reload the session and continue from the server. */
export class SessionConflictError extends PracticeError {}

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const int = (v: unknown): v is number => Number.isSafeInteger(v);
const invalid = () =>
  new PracticeError(
    'INVALID_RESPONSE',
    'The app received an unexpected response. Try again.',
  );
const item = (v: unknown): v is SessionItem => {
  if (
    !record(v) ||
    !str(v.questionId) ||
    !str(v.questionText) ||
    !(v.answer === null || str(v.answer)) ||
    typeof v.skipped !== 'boolean'
  )
    return false;
  if (v.feedback !== null) decodeFeedback(v.feedback);
  return true;
};
export function decodeSession(v: unknown): MockSession {
  if (
    !record(v) ||
    v.contractVersion !== '1' ||
    !str(v.id) ||
    !['curated', 'job'].includes(v.source as string) ||
    !(v.jobId === null || str(v.jobId)) ||
    !['active', 'completed'].includes(v.status as string) ||
    !int(v.currentIndex) ||
    !int(v.version) ||
    !Array.isArray(v.items) ||
    !v.items.length ||
    !v.items.every(item) ||
    v.currentIndex < 0 ||
    v.currentIndex > v.items.length ||
    !record(v.summary) ||
    !['total', 'answered', 'skipped', 'unanswered', 'withFeedback'].every((k) =>
      int((v.summary as Record<string, unknown>)[k]),
    )
  )
    throw invalid();
  return v as unknown as MockSession;
}

const BASE = '/api/v1/interview-prep/sessions';
// POST reads: the local-only guard needs an Origin header, which browsers omit on GET.
async function call(
  url: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PracticeError(
      'NETWORK',
      'The app could not reach the API. Your text is kept — try again.',
    );
  }
  if (response.status === 204) return null;
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload;
  if (record(payload) && str(payload.errorCode) && str(payload.message))
    throw payload.errorCode === 'INTERVIEW_SESSION_CONFLICT'
      ? new SessionConflictError(payload.errorCode, payload.message)
      : new PracticeError(payload.errorCode, payload.message);
  throw new PracticeError(
    'UNAVAILABLE',
    'Mock interviews are unavailable right now. Try again.',
  );
}
const C = { contractVersion: '1' };

export async function activeSession(
  signal: AbortSignal,
): Promise<MockSession | null> {
  const payload = await call(`${BASE}/active`, 'POST', C, signal);
  if (!record(payload) || payload.contractVersion !== '1') throw invalid();
  return payload.session === null ? null : decodeSession(payload.session);
}
export async function readSession(
  id: string,
  signal: AbortSignal,
): Promise<MockSession> {
  return decodeSession(
    await call(`${BASE}/${encodeURIComponent(id)}/read`, 'POST', C, signal),
  );
}
export async function createSession(
  request:
    | { source: 'curated'; count: number }
    | { source: 'job'; count: number; jobId: string; setId: string },
): Promise<MockSession> {
  return decodeSession(await call(BASE, 'POST', { ...C, ...request }));
}
/** answer null = Skip. Feedback is optional and sent exactly as received. */
export async function saveSessionItem(
  session: MockSession,
  answer: string | null,
  feedback: PracticeFeedback | null,
): Promise<MockSession> {
  return decodeSession(
    await call(
      `${BASE}/${encodeURIComponent(session.id)}/items/${session.currentIndex}`,
      'PUT',
      { expectedVersion: session.version, answer, feedback },
    ),
  );
}
export async function completeSession(
  session: MockSession,
): Promise<MockSession> {
  return decodeSession(
    await call(`${BASE}/${encodeURIComponent(session.id)}/complete`, 'POST', {
      expectedVersion: session.version,
    }),
  );
}
export async function removeSession(session: MockSession): Promise<void> {
  await call(
    `${BASE}/${encodeURIComponent(session.id)}?expectedVersion=${session.version}`,
    'DELETE',
  );
}
