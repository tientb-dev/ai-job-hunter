import type { MatchRequirement } from './cv-match.js';
import { resolveCvQuote } from './cv-match.evidence.js';
import { normalize } from './matching.policy.js';
import { HttpException } from '@nestjs/common';
import { CvMatchError } from './cv-match.error.js';

export type MatchEvidenceReason =
  | 'JD_QUOTE_EMPTY'
  | 'JD_QUOTE_NOT_VERBATIM'
  | 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT'
  | 'NO_VERIFIABLE_CV_QUOTES';

// One structured server-side event per rejected or downgraded assessment. Never serialize a
// proposal, error, source, label, or quote; copy only fixed tokens and counts.
export function emitMatchEvidenceRejection(
  reason: MatchEvidenceReason,
  requirementIndex: number,
  proposals: MatchRequirement[],
  cv: string,
  jd: string,
  outcome: 'REJECTED' | 'DOWNGRADED' = 'REJECTED',
): void {
  // Rejections are reported once by CV_MATCH_FAILURE; this detail is opt-in.
  if (outcome === 'REJECTED' && !incompleteDiagnostics) return;
  try {
    const category = proposals[requirementIndex]?.category;
    const cvAccepted = proposals.filter(
      (item) =>
        item.cvQuote.trim() && resolveCvQuote(cv, item.cvQuote) !== null,
    ).length;
    const cvEmpty = proposals.filter((item) => !item.cvQuote.trim()).length;
    const jdAccepted = proposals.filter(
      (item) => item.jdQuote.trim() && jd.includes(item.jdQuote),
    ).length;
    process.stderr.write(
      `${JSON.stringify({
        event: `CV_MATCH_EVIDENCE_${outcome}`,
        reason,
        requirementIndex,
        ...(['skill', 'experience', 'domain'].includes(category ?? '')
          ? { category }
          : {}),
        counts: {
          requirements: proposals.length,
          cvAccepted,
          cvRejected: proposals.length - cvAccepted - cvEmpty,
          cvEmpty,
          jdAccepted,
          jdRejected: proposals.length - jdAccepted,
        },
      })}\n`,
    );
  } catch {
    // Diagnostics must never replace or alter the original matching failure.
  }
}

let incompleteDiagnostics = false;
// Opt-in via CV_MATCH_DIAGNOSTICS=1 (default off); configured once at bootstrap.
export function configureCvMatchDiagnostics(enabled: boolean): void {
  incompleteDiagnostics = enabled;
}
const loose = (text: string) =>
  normalize(text)
    .replace(/^[-*•–]\s+/u, '')
    .replace(/[.;:,!]+$/u, '')
    .trim();
// Emitted only before CV_MATCH_INCOMPLETE. Logs counts, booleans and server-generated
// canonical ids (p1, p2, …); never labels, quotes, model-supplied ids or source text.
export function emitMatchIncomplete(
  proposals: readonly MatchRequirement[],
  canonical: readonly MatchRequirement[],
  linked: (candidate: MatchRequirement, seed: MatchRequirement) => boolean,
): void {
  if (!incompleteDiagnostics) return;
  try {
    const ids = new Set(canonical.map((seed) => seed.parentId));
    const parentIds = { missing: 0, matching: 0, mismatched: 0 };
    for (const item of proposals)
      if (item.parentId === undefined) parentIds.missing++;
      else if (ids.has(item.parentId)) parentIds.matching++;
      else parentIds.mismatched++;
    // Returned items linking to no requirement (ignored by scoring) or to several.
    const returnedLinks = { none: 0, one: 0, multiple: 0 };
    for (const item of proposals) {
      const n = canonical.filter((seed) => linked(item, seed)).length;
      returnedLinks[n === 0 ? 'none' : n === 1 ? 'one' : 'multiple']++;
    }
    const unlinked = canonical.flatMap((seed, index) =>
      proposals.some((item) => linked(item, seed))
        ? []
        : [
            {
              // Only the server-generated form is logged; anything else becomes an index.
              id: /^p\d{1,4}$/u.test(seed.parentId ?? '')
                ? seed.parentId
                : `#${index}`,
              parentIdReturned: proposals.some(
                (item) => item.parentId === seed.parentId,
              ),
              labelLooseMatch: proposals.some(
                (item) => loose(item.requirement) === loose(seed.requirement),
              ),
              jdQuoteLooseMatch: proposals.some(
                (item) => loose(item.jdQuote) === loose(seed.jdQuote),
              ),
            },
          ],
    );
    process.stderr.write(
      `${JSON.stringify({
        event: 'CV_MATCH_INCOMPLETE',
        counts: {
          canonical: canonical.length,
          returned: proposals.length,
          unlinked: unlinked.length,
        },
        parentIds,
        returnedLinks,
        unlinked,
      })}\n`,
    );
  } catch {
    // Diagnostics must never replace or alter the original matching failure.
  }
}

// Outcome of the single completion call. Fixed tokens and counts only.
export function emitMatchCompletion(
  outcome: string,
  missing: number,
  returned: number,
): void {
  if (!incompleteDiagnostics) return;
  try {
    process.stderr.write(
      `${JSON.stringify({
        event: 'CV_MATCH_COMPLETION',
        outcome: /^[A-Z_]{1,40}$/u.test(outcome) ? outcome : 'OTHER',
        counts: { missing, returned },
      })}\n`,
    );
  } catch {
    // Diagnostics must never replace or alter the original matching failure.
  }
}

export type MatchFailureStage =
  | 'SETUP'
  | 'INITIAL'
  | 'COMPLETION'
  | 'VALIDATION'
  | 'SOURCE_VERIFICATION'
  | 'SCORING'
  | 'PERSISTENCE';
// Mutable per-request progress; holds fixed tokens and integers only.
export interface MatchFailureTrace {
  stage: MatchFailureStage;
  reason?: string;
  aiCode?: string;
  upstreamHttpStatus?: number;
}
const token = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,59}$/u.test(value)
    ? value
    : fallback;
// Always on: exactly one structured line per failed CV Match operation. Only
// allowlisted tokens and integers; never an error object, message or source text.
export function emitMatchFailure(
  error: unknown,
  trace: MatchFailureTrace,
  provider: string | undefined,
  durationMs: number,
): void {
  try {
    const matchError = error instanceof CvMatchError ? error : undefined;
    const responseStatus =
      error instanceof HttpException ? error.getStatus() : 503;
    const stage =
      trace.stage === 'VALIDATION'
        ? matchError?.errorCode === 'CV_MATCH_EVIDENCE_REJECTED'
          ? 'EVIDENCE_VALIDATION'
          : 'OUTPUT_VALIDATION'
        : trace.stage;
    const reasonCode = token(
      matchError?.reasonCode ??
        trace.aiCode ??
        trace.reason ??
        (responseStatus === 404 ? 'NOT_FOUND' : undefined),
      'UNKNOWN',
    );
    const counts = Object.fromEntries(
      Object.entries(matchError?.counts ?? {}).filter(
        ([key, value]) =>
          /^[a-zA-Z]{1,30}$/u.test(key) &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 100_000,
      ),
    );
    const upstream = trace.upstreamHttpStatus;
    process.stderr.write(
      `${JSON.stringify({
        event: 'CV_MATCH_FAILURE',
        stage,
        errorCode: token(matchError?.errorCode, 'NONE'),
        reasonCode,
        provider:
          provider === 'gemini' || provider === 'ollama' ? provider : 'unknown',
        ...(Number.isInteger(upstream) && upstream! >= 100 && upstream! <= 599
          ? { upstreamHttpStatus: upstream }
          : {}),
        responseStatus: Number.isInteger(responseStatus) ? responseStatus : 503,
        durationMs: Math.max(0, Math.round(durationMs)),
        ...(Object.keys(counts).length ? { counts } : {}),
      })}\n`,
    );
  } catch {
    // Logging must never replace or alter the original failure.
  }
}

// Opt-in (CV_MATCH_DIAGNOSTICS=1) summary after a completed analysis. The
// payload holds fixed codes and integers only (see evidenceSummary).
export function emitMatchEvidenceSummary(build: () => unknown): void {
  if (!incompleteDiagnostics) return;
  try {
    process.stderr.write(
      `${JSON.stringify({ event: 'CV_MATCH_EVIDENCE_SUMMARY', ...(build() as object) })}\n`,
    );
  } catch {
    // Diagnostics must never alter a completed analysis.
  }
}
