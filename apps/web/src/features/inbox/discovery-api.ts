import { tr } from '../../app/i18n';
export const queueFilters = [
  ['to-review', 'To review'],
  ['new', 'New'],
  ['seen', 'Seen'],
  ['saved', 'Saved'],
  ['dismissed', 'Dismissed'],
  ['all', 'All'],
] as const;
export type QueueFilter = (typeof queueFilters)[number][0];
export interface Candidate {
  id: string;
  status: 'NEW' | 'SEEN' | 'SAVED' | 'DISMISSED';
  title: string;
  company: string;
  location: string;
  workMode: string;
  seniority: string;
  originalLink: string;
  sourceName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  opportunityId: string | null;
}
export interface CandidateDetail extends Candidate {
  description: string;
  skills: string;
  preferredSkills: string;
}
export interface QueuePage {
  items: Candidate[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: 10;
}
export interface SaveResult {
  candidateId: string;
  status: 'SAVED';
  opportunityId: string;
  outcome: 'created' | 'linked_existing' | 'already_saved';
}
export interface DiscoverySourceOutcome {
  sourceKey: string;
  sourceName: string;
  status: 'success' | 'failed';
  fetched: number | null;
  normalized: number | null;
  invalid: number | null;
  cacheHit: boolean;
  fetchedAt: string | null;
  failure: {
    code: 'SOURCE_UNAVAILABLE' | 'INVALID_FEED';
    message: string;
  } | null;
}
export interface DiscoverySummary {
  fetched: number;
  normalized: number;
  eligible: number;
  sources: DiscoverySourceOutcome[];
  sourceFailures: number;
  warnings: string[];
  found: number;
  added: number;
  refreshed: number;
  remaining: number;
  errors: string[];
  scannedAt: string;
  scope: string;
}
export interface DuplicateMatch {
  id: string;
  title: string;
  company: string;
  location: string;
}
export class DiscoveryRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly matches: DuplicateMatch[] = [],
  ) {
    super(message);
  }
}
export async function discoveryRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/discovery${path}`, {
      ...init,
      headers: {
        ...(typeof init?.body === 'string'
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new DiscoveryRequestError(
      tr('Could not reach the local API. Check it is running, then retry.'),
    );
  }
  if (!response.ok) {
    let message = tr(
      'Could not load or update the discovery queue. Retry shortly.',
    );
    let code: string | undefined;
    let matches: DuplicateMatch[] = [];
    if (response.status < 500) {
      const body = (await response.json().catch(() => null)) as {
        message?: unknown;
        errorCode?: unknown;
        matches?: unknown;
      } | null;
      if (typeof body?.message === 'string') message = body.message;
      if (
        response.status === 409 &&
        ['POSSIBLE_DUPLICATE', 'AMBIGUOUS_INBOX_MATCH'].includes(
          String(body?.errorCode),
        )
      ) {
        code = body!.errorCode as string;
        if (Array.isArray(body?.matches))
          matches = body.matches
            .filter(
              (row): row is DuplicateMatch =>
                row &&
                typeof row.id === 'string' &&
                /^[0-9a-f-]{36}$/i.test(row.id) &&
                typeof row.title === 'string' &&
                typeof row.company === 'string' &&
                typeof row.location === 'string',
            )
            .slice(0, 20);
      }
    }
    throw new DiscoveryRequestError(message, code, matches);
  }
  return response.json() as Promise<T>;
}
export function sourceLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
