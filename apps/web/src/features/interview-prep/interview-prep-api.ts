export type PracticeTopic = 'hr' | 'technical';
export type PracticeMode = 'express' | 'review';
export interface PracticeQuestion {
  id: string;
  topic: PracticeTopic;
  category: string;
  kind: 'general' | 'personal' | 'hypothetical';
  variants: string[];
  hints: string[];
}
export type Withheld =
  | 'CHANGED_FACTS'
  | 'CHANGED_MEANING'
  | 'TOO_LONG'
  | 'OFF_TOPIC'
  | 'NOT_ENOUGH_DETAIL'
  | 'UNCLEAR';
export interface PracticeFeedback {
  mode: PracticeMode;
  questionId: string;
  answersQuestion: 'yes' | 'partly' | 'no' | null;
  mainIssue: string | null;
  corrections: { original: string; better: string }[];
  suggestion: string | null;
  suggestionWithheld: Withheld | null;
  followUpQuestions: string[];
  phrases: { text: string; noteVi: string }[];
  technicalNote: string | null;
  cvCheck: {
    status: 'checked' | 'unavailable' | 'not_applicable';
    notices: string[];
  };
}
export class PracticeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const MAX_ANSWER_CHARS = 1500;

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(str);
const nullable = (v: unknown) => v === null || str(v);
const invalid = () =>
  new PracticeError(
    'INVALID_RESPONSE',
    'The app received an unexpected response. Try again.',
  );

export function decodeQuestions(value: unknown): PracticeQuestion[] {
  if (!record(value) || !Array.isArray(value.questions)) throw invalid();
  for (const q of value.questions)
    if (
      !record(q) ||
      !str(q.id) ||
      !['hr', 'technical'].includes(q.topic as string) ||
      !str(q.category) ||
      !['general', 'personal', 'hypothetical'].includes(q.kind as string) ||
      !strs(q.variants) ||
      !q.variants.length ||
      !strs(q.hints)
    )
      throw invalid();
  return value.questions as PracticeQuestion[];
}
export function decodeFeedback(value: unknown): PracticeFeedback {
  if (
    !record(value) ||
    !['express', 'review'].includes(value.mode as string) ||
    !str(value.questionId) ||
    !(
      value.answersQuestion === null ||
      ['yes', 'partly', 'no'].includes(value.answersQuestion as string)
    ) ||
    !nullable(value.mainIssue) ||
    !nullable(value.suggestion) ||
    !nullable(value.technicalNote) ||
    !(value.suggestionWithheld === null || str(value.suggestionWithheld)) ||
    !Array.isArray(value.corrections) ||
    !value.corrections.every(
      (c) => record(c) && str(c.original) && str(c.better),
    ) ||
    !strs(value.followUpQuestions) ||
    !Array.isArray(value.phrases) ||
    !value.phrases.every((p) => record(p) && str(p.text) && str(p.noteVi)) ||
    !record(value.cvCheck) ||
    !['checked', 'unavailable', 'not_applicable'].includes(
      value.cvCheck.status as string,
    ) ||
    !strs(value.cvCheck.notices)
  )
    throw invalid();
  return value as unknown as PracticeFeedback;
}

export async function fetchQuestions(
  signal: AbortSignal,
): Promise<PracticeQuestion[]> {
  const response = await fetch('/api/v1/interview-prep/questions', {
    cache: 'no-store',
    signal,
  });
  if (!response.ok)
    throw new PracticeError('UNAVAILABLE', 'Questions could not be loaded.');
  return decodeQuestions(await response.json());
}
export async function requestFeedback(
  body: {
    questionId: string;
    mode: PracticeMode;
    answer: string;
    variant: number;
  },
  signal: AbortSignal,
): Promise<PracticeFeedback> {
  let response: Response;
  try {
    response = await fetch('/api/v1/interview-prep/feedback', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new PracticeError(
      'NETWORK',
      'The app could not reach the API. Your text is kept — try again.',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (record(payload) && str(payload.errorCode) && str(payload.message))
      throw new PracticeError(payload.errorCode, payload.message);
    throw new PracticeError(
      'UNAVAILABLE',
      'Feedback is unavailable right now. Your text is kept — try again.',
    );
  }
  return decodeFeedback(payload);
}

// ------------------------------------------------- PR14 saved reference answers
export const MAX_REFERENCE_ANSWER = 2000;
export interface SavedAnswer {
  questionId: string;
  answer: string;
  version: number;
  updatedAt: string;
}
/** 409: the saved answer changed elsewhere; `current` is null if it was deleted. */
export class AnswerConflictError extends PracticeError {
  constructor(
    message: string,
    readonly current: SavedAnswer | null,
  ) {
    super('INTERVIEW_ANSWER_CONFLICT', message);
  }
}
const savedAnswer = (v: unknown): v is SavedAnswer =>
  record(v) &&
  str(v.questionId) &&
  str(v.answer) &&
  Number.isSafeInteger(v.version) &&
  Number(v.version) >= 1 &&
  str(v.updatedAt);
/** Same rule as the API and database: trimmed, 1–2000 Unicode code points. */
export const answerLength = (text: string) => [...text.trim()].length;

async function answerRequest(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new PracticeError(
      'NETWORK',
      'The app could not reach the API. Your text is kept — try again.',
    );
  }
  if (response.status === 204) return null;
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload;
  if (
    response.status === 409 &&
    record(payload) &&
    payload.errorCode === 'INTERVIEW_ANSWER_CONFLICT' &&
    (payload.current === null || savedAnswer(payload.current))
  )
    throw new AnswerConflictError(
      str(payload.message)
        ? payload.message
        : 'This answer was changed in another tab.',
      payload.current as SavedAnswer | null,
    );
  if (record(payload) && str(payload.errorCode) && str(payload.message))
    throw new PracticeError(payload.errorCode, payload.message);
  throw new PracticeError(
    'UNAVAILABLE',
    'Saved answers are unavailable right now. Try again.',
  );
}
export async function listAnswers(signal: AbortSignal): Promise<SavedAnswer[]> {
  // A POST read: the local-only guard needs an Origin header, which browsers omit on GET.
  const payload = await answerRequest('/api/v1/interview-prep/answers/list', {
    method: 'POST',
    body: JSON.stringify({ contractVersion: '1' }),
    signal,
  });
  if (
    !record(payload) ||
    !Array.isArray(payload.answers) ||
    !payload.answers.every(savedAnswer)
  )
    throw invalid();
  return payload.answers;
}
export async function saveAnswer(
  questionId: string,
  answer: string,
  expectedVersion: number | null,
): Promise<SavedAnswer> {
  const payload = await answerRequest(
    `/api/v1/interview-prep/answers/${encodeURIComponent(questionId)}`,
    { method: 'PUT', body: JSON.stringify({ answer, expectedVersion }) },
  );
  if (!savedAnswer(payload) || payload.questionId !== questionId)
    throw invalid();
  return payload;
}
export async function removeAnswer(
  questionId: string,
  expectedVersion: number,
): Promise<void> {
  await answerRequest(
    `/api/v1/interview-prep/answers/${encodeURIComponent(questionId)}?expectedVersion=${expectedVersion}`,
    { method: 'DELETE' },
  );
}
