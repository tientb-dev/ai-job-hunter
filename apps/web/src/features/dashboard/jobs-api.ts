import { tr } from '../../app/i18n';
import type { AnalysisResponse } from './analysis.types';
import { decodeAnalysis } from './analysis-api';
import type { JobsResponse } from './jobs.types';
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string';
const date = (v: unknown) => string(v) && Number.isFinite(Date.parse(v));
function posting(value: unknown): boolean {
  if (!string(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      [
        'www.arbeitnow.com',
        'arbeitnow.com',
        'www.arbeitnow.co.uk',
        'arbeitnow.co.uk',
        'www.arbeitnow.fr',
        'arbeitnow.fr',
        'www.arbeitnow.ch',
        'arbeitnow.ch',
        'www.arbeitnow.nl',
        'arbeitnow.nl',
      ].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.startsWith('/jobs/')
    );
  } catch {
    return false;
  }
}
export function decodeJobs(value: unknown): JobsResponse {
  if (
    !record(value) ||
    value.source !== 'Arbeitnow' ||
    value.sourceUrl !== 'https://www.arbeitnow.com/api/job-board-api' ||
    !date(value.fetchedAt) ||
    !string(value.scope) ||
    !Number.isSafeInteger(value.omittedCount) ||
    Number(value.omittedCount) < 0 ||
    !Array.isArray(value.jobs) ||
    value.jobs.length > 1000
  )
    throw Error(tr('Invalid job response'));
  for (const job of value.jobs)
    if (
      !record(job) ||
      !string(job.id) ||
      !string(job.title) ||
      !job.title.trim() ||
      !string(job.company) ||
      !job.company.trim() ||
      !(job.location === null || string(job.location)) ||
      !(job.remote === null || typeof job.remote === 'boolean') ||
      job.source !== 'Arbeitnow' ||
      !posting(job.url) ||
      !(job.publishedAt === null || date(job.publishedAt)) ||
      !Array.isArray(job.tags) ||
      !job.tags.every(string) ||
      !string(job.description)
    )
      throw Error(tr('Invalid job'));
  return value as unknown as JobsResponse;
}
export async function loadJobs(signal: AbortSignal): Promise<JobsResponse> {
  const response = await fetch('/api/v1/jobs', {
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  if (!response.ok) throw Error(tr('Source unavailable'));
  return decodeJobs(await response.json());
}
export async function parseJobsCv(
  file: File,
  signal: AbortSignal,
): Promise<AnalysisResponse> {
  const form = new FormData();
  form.append('cv', file);
  const response = await fetch('/api/v1/analyses?mode=cv-only', {
    method: 'POST',
    body: form,
    signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  });
  return decodeAnalysis(await response.json(), response.ok);
}
