import { tr } from '../../app/i18n';
import {
  importFields,
  type ImportField,
  type OpportunityInput,
} from './opportunities-api';

// Mirrors the server's per-source job path rules; the server still decides
// whether a source is enabled.
const JOB_PAGES: Record<string, RegExp> = {
  'itviec.com': /^\/it-jobs\//u,
  'www.itviec.com': /^\/it-jobs\//u,
  'topcv.vn': /^\/viec-lam\/[^/]+\/\d+\.html$/u,
  'www.topcv.vn': /^\/viec-lam\/[^/]+\/\d+\.html$/u,
  'vietnamworks.com': /^\/[^/]+-\d+-jv$/u,
  'www.vietnamworks.com': /^\/[^/]+-\d+-jv$/u,
};
export function canFetchJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      Object.hasOwn(JOB_PAGES, url.hostname) &&
      JOB_PAGES[url.hostname]!.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export function urlImportHelp(sources: string[] = ['ITviec']): string {
  return tr(
    'Use the link of a single job posting on {sources}. If it cannot be loaded, use the page-import bookmark or paste the JD.',
    { sources: sources.join(', ') },
  );
}
/** Localised guidance when the server has link import turned off for a source. */
export function urlImportError(message: string): string {
  const platform = /^(TopCV|VietnamWorks) link import is turned off/.exec(
    message,
  )?.[1];
  return platform
    ? tr(
        '{platform} link import is turned off on this server. Use the page-import bookmark or paste the JD.',
        { platform },
      )
    : message;
}
// Transient failures where a manual retry can help; blocks are never retried.
const RETRYABLE = new Set([
  'URL_IMPORT_TIMEOUT',
  'URL_IMPORT_UNAVAILABLE',
  'URL_IMPORT_UNREACHABLE',
  'URL_IMPORT_BUSY',
]);
/** Localised, user-facing text for a failed Fetch JD request. */
export function urlFetchFailure(
  errorCode: string | undefined,
  platform: string,
): { text: string; retry: boolean } {
  const retry = RETRYABLE.has(errorCode ?? '');
  const values = { platform };
  switch (errorCode) {
    case 'URL_IMPORT_BLOCKED':
      return {
        retry,
        text: tr(
          'Could not load the job posting from {platform} automatically. You can still copy and paste its content to continue.',
          values,
        ),
      };
    case 'URL_IMPORT_NOT_FOUND':
      return {
        retry,
        text: tr(
          'This job posting is no longer available on {platform}. Paste the JD if you have it.',
          values,
        ),
      };
    case 'URL_IMPORT_TIMEOUT':
      return {
        retry,
        text: tr(
          '{platform} took too long to respond. Try again or paste the JD.',
          values,
        ),
      };
    case 'URL_IMPORT_UNAVAILABLE':
    case 'URL_IMPORT_UNREACHABLE':
      return {
        retry,
        text: tr(
          '{platform} is temporarily unavailable. Try again later or paste the JD.',
          values,
        ),
      };
    case 'URL_IMPORT_BUSY':
      return {
        retry,
        text: tr(
          'Another job link is still loading. Wait a moment, then try again.',
        ),
      };
    case 'URL_IMPORT_SOURCE_OFF':
      return {
        retry,
        text: tr(
          '{platform} link import is turned off on this server. Use the page-import bookmark or paste the JD.',
          values,
        ),
      };
    case 'URL_IMPORT_INVALID_URL':
      return {
        retry,
        text: tr(
          'This link is not a supported single job posting. Check the link or paste the JD.',
        ),
      };
    default:
      return {
        retry,
        text: tr(
          'Could not read the job content from {platform}. You can copy and paste the JD to continue.',
          values,
        ),
      };
  }
}
export interface UrlJobPreview {
  originalLink: string;
  platform: string;
  title: string;
  company: string;
  location: string;
  description: string;
  sourceText: string;
  validThrough: string | null;
  expired: boolean;
  domain?: string;
  sourceMetadata?: {
    skills: string[];
    jobExpertise: string[];
    jobDomains: string[];
  };
  salary?: string;
  experience?: string;
  workMode?: string;
  importWarnings?: string[];
  /** Deterministic (no-AI) suggestions parsed from sourceText by the server. */
  fields?: ImportField[];
  salaryDetails?: {
    originalText: string;
    currency: string | null;
    minimum: number | null;
    maximum: number | null;
    basis: 'net' | 'gross' | null;
    payPeriod: string | null;
  } | null;
}
// The link draft holds exactly one fetched job: its source text replaces the
// previous one (never concatenated) and every field the user did not edit is
// re-derived from it. No AI call and no save happens here.
export function applyUrlJobPreview(
  form: OpportunityInput,
  preview: UrlJobPreview,
  edited: ReadonlySet<keyof OpportunityInput>,
): OpportunityInput {
  const next = { ...form, postText: preview.sourceText, importReview: [] };
  for (const field of [...importFields, 'description'] as const)
    if (!edited.has(field)) next[field] = '';
  for (const field of [
    'title',
    'company',
    'location',
    'description',
    'originalLink',
    'salary',
    'experience',
    'workMode',
    'domain',
  ] as const)
    if (!edited.has(field)) next[field] = preview[field] ?? '';
  // Fill the remaining blanks from source-quoted parser suggestions. Domain is
  // left to AI/manual entry: its heuristic can pick up company-profile text.
  for (const row of preview.fields ?? []) {
    const field = row.field;
    if (
      row.status !== 'SUPPORTED' ||
      field === 'domain' ||
      field === 'originalLink' ||
      edited.has(field) ||
      next[field]
    )
      continue;
    next[field] = row.value;
  }
  return next;
}
