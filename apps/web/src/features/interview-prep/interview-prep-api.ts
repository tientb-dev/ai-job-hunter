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
