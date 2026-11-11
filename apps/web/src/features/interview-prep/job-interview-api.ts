import { PracticeError } from './interview-prep-api';

export type JobQuestionCategory =
  'skill' | 'architecture' | 'troubleshooting' | 'experience';
export interface JobQuestion {
  id: string;
  position: number;
  category: JobQuestionCategory;
  kind: 'general' | 'hypothetical' | 'personal';
  question: string;
  why: string;
  evidence: string;
}
export interface JobQuestionSet {
  id: string;
  createdAt: string;
  active: boolean;
  partial: boolean;
  questions: JobQuestion[];
}
export interface JobQuestionSets {
  job: { id: string; title: string; company: string };
  jdEmpty: boolean;
  jdChanged: boolean;
  /** Newest first; the first is the active set. */
  sets: JobQuestionSet[];
}

export const CATEGORY_LABELS: Record<JobQuestionCategory, string> = {
  skill: 'Technical skill',
  architecture: 'Architecture and design',
  troubleshooting: 'Troubleshooting',
  experience: 'Technical experience',
};

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const invalid = () =>
  new PracticeError(
    'INVALID_RESPONSE',
    'The app received an unexpected response. Try again.',
  );
const question = (q: unknown): q is JobQuestion =>
  record(q) &&
  str(q.id) &&
  /^jd-[0-9a-f-]{36}$/u.test(q.id) &&
  Number.isInteger(q.position) &&
  str(q.category) &&
  q.category in CATEGORY_LABELS &&
  ['general', 'hypothetical', 'personal'].includes(q.kind as string) &&
  str(q.question) &&
  str(q.why) &&
  str(q.evidence);
const set = (s: unknown): s is JobQuestionSet =>
  record(s) &&
  str(s.id) &&
  str(s.createdAt) &&
  Number.isFinite(Date.parse(s.createdAt)) &&
  typeof s.active === 'boolean' &&
  typeof s.partial === 'boolean' &&
  Array.isArray(s.questions) &&
  s.questions.every(question);

export function decodeJobQuestionSets(value: unknown): JobQuestionSets {
  if (
    !record(value) ||
    value.contractVersion !== '1' ||
    !record(value.job) ||
    !str(value.job.id) ||
    !str(value.job.title) ||
    !str(value.job.company) ||
    typeof value.jdEmpty !== 'boolean' ||
    typeof value.jdChanged !== 'boolean' ||
    !Array.isArray(value.sets) ||
    !value.sets.every(set)
  )
    throw invalid();
  const sets = value.sets as JobQuestionSet[];
  return {
    job: value.job as JobQuestionSets['job'],
    jdEmpty: value.jdEmpty,
    jdChanged: value.jdChanged,
    sets: sets.map((s) => ({
      ...s,
      questions: [...s.questions].sort((a, b) => a.position - b.position),
    })),
  };
}

// POST everywhere: the local-only guard needs an Origin header (see PR14 answers).
async function post(url: string, body: unknown, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PracticeError(
      'NETWORK',
      'The app could not reach the API. Try again.',
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload;
  if (record(payload) && str(payload.errorCode) && str(payload.message))
    throw new PracticeError(payload.errorCode, payload.message);
  throw new PracticeError(
    'UNAVAILABLE',
    'Interview questions are unavailable right now. Try again.',
  );
}
const base = (jobId: string) =>
  `/api/v1/interview-prep/jobs/${encodeURIComponent(jobId)}/sets`;

export async function listJobQuestionSets(
  jobId: string,
  signal: AbortSignal,
): Promise<JobQuestionSets> {
  return decodeJobQuestionSets(
    await post(`${base(jobId)}/list`, { contractVersion: '1' }, signal),
  );
}
export async function generateJobQuestionSet(
  jobId: string,
  basedOnSetId: string | null,
): Promise<JobQuestionSet> {
  const payload = await post(base(jobId), {
    contractVersion: '1',
    basedOnSetId,
  });
  if (!record(payload) || !set(payload.set)) throw invalid();
  return payload.set;
}
