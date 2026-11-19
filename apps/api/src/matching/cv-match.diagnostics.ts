import { GEMINI_MODEL, OPENAI_MODEL, type AiConfig } from '../ai/ai.config.js';
import type { ProviderTiming } from '../ai/ai-provider.js';
import type { DecompositionRejection } from './cv-match.decomposition.js';
import type { MatchRequirement } from './cv-match.js';
import { cvQuoteOccurrences, resolveCvQuote } from './cv-match.evidence.js';
import { normalize } from './matching.policy.js';
import { HttpException } from '@nestjs/common';
import { CvMatchError } from './cv-match.error.js';
import { AsyncLocalStorage } from 'node:async_hooks';

// Random per-analysis id so events from one attempt can be correlated. Never a
// job, owner or CV identifier.
export const matchAttempt = new AsyncLocalStorage<string>();
const attempt = () => {
  const id = matchAttempt.getStore();
  return id ? { attempt: id } : {};
};

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
        ...attempt(),
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
        ...attempt(),
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
        ...attempt(),
        outcome: /^[A-Z_]{1,40}$/u.test(outcome) ? outcome : 'OTHER',
        counts: { missing, returned },
      })}\n`,
    );
  } catch {
    // Diagnostics must never replace or alter the original matching failure.
  }
}

export interface MatchDecompositionTarget {
  index: number;
  reason:
    | DecompositionRejection
    | 'ACCEPTED'
    | 'OMITTED'
    | 'DUPLICATE_PARENT'
    | 'BATCH_ERROR'
    | 'CACHED'
    | 'DEFERRED_LIMIT';
}

export function emitMatchDecomposition(
  outcome: string,
  requested: number,
  accepted: number,
  targets: readonly MatchDecompositionTarget[],
): void {
  try {
    process.stderr.write(
      `${JSON.stringify({
        event: 'CV_MATCH_DECOMPOSITION',
        ...attempt(),
        outcome: /^[A-Z_]{1,40}$/u.test(outcome) ? outcome : 'OTHER',
        counts: { targets: targets.length, requested, accepted },
        targets: targets.map(({ index, reason }) => ({ index, reason })),
      })}\n`,
    );
  } catch {
    // Diagnostics never change matching.
  }
}

export function emitMatchPersistence(
  outcome: 'PERSISTED_FRESH' | 'RETAINED_PREVIOUS',
): void {
  try {
    process.stderr.write(
      `${JSON.stringify({ event: 'CV_MATCH_PERSISTENCE', ...attempt(), outcome })}\n`,
    );
  } catch {
    // Diagnostics never change matching.
  }
}

export type MatchFailureStage =
  | 'SETUP'
  | 'DECOMPOSITION'
  | 'INITIAL'
  | 'COMPLETION'
  | 'VALIDATION'
  | 'SOURCE_VERIFICATION'
  | 'SCORING'
  | 'PERSISTENCE';
// Mutable per-request progress; holds fixed tokens and integers only.
export interface MatchFailureTrace {
  stage: MatchFailureStage;
  decompositionTargets?: true;
  reason?: string;
  aiCode?: string;
  upstreamHttpStatus?: number;
  upstreamAttempts?: number;
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
    const attempts = trace.upstreamAttempts;
    process.stderr.write(
      `${JSON.stringify({
        event: 'CV_MATCH_FAILURE',
        ...attempt(),
        stage,
        errorCode: token(matchError?.errorCode, 'NONE'),
        reasonCode,
        provider:
          provider === 'gemini' ||
          provider === 'ollama' ||
          provider === 'openai'
            ? provider
            : 'unknown',
        ...(Number.isInteger(upstream) && upstream! >= 100 && upstream! <= 599
          ? { upstreamHttpStatus: upstream }
          : {}),
        ...(Number.isInteger(attempts) && attempts! >= 1 && attempts! <= 10
          ? { upstreamAttempts: attempts }
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

export function emitMatchProviderTiming(
  config: AiConfig | undefined,
  stage: 'DECOMPOSITION' | 'INITIAL' | 'COMPLETION' | 'ANALYSIS',
  timing: Partial<ProviderTiming> & Pick<ProviderTiming, 'elapsedMs'>,
): void {
  if (
    (config?.provider !== 'gemini' || config.model !== GEMINI_MODEL) &&
    (config?.provider !== 'openai' || config.model !== OPENAI_MODEL)
  )
    return;
  try {
    process.stderr.write(
      `${JSON.stringify({
        event: 'CV_MATCH_PROVIDER_TIMING',
        ...attempt(),
        provider: config.provider,
        model: config.model,
        stage,
        elapsedMs: timing.elapsedMs,
        attempts: timing.attempts,
        retries: timing.retries,
        timeout: timing.timeout,
        usage: timing.usage,
      })}\n`,
    );
  } catch {
    // Diagnostics must not change request behavior.
  }
}

// Opt-in (CV_MATCH_DIAGNOSTICS=1) summary after a completed analysis. The
// payload holds fixed codes and integers only (see evidenceSummary).
export function emitMatchEvidenceSummary(build: () => unknown): void {
  if (!incompleteDiagnostics) return;
  try {
    process.stderr.write(
      `${JSON.stringify({ event: 'CV_MATCH_EVIDENCE_SUMMARY', ...attempt(), ...(build() as object) })}\n`,
    );
  } catch {
    // Diagnostics must never alter a completed analysis.
  }
}

export type QuoteRejectionCategory =
  'AMBIGUOUS' | 'NOT_ALLOWED_PASSAGE' | 'PUNCTUATION_OR_CASE_DRIFT' | 'ABSENT';
// Diagnostic folding only: list markers, dash/quote variants, case, spacing.
// Never used to accept evidence.
const fold = (text: string) =>
  ` ${text.normalize('NFKC')} `
    .replace(/[‐-―−]/gu, '-')
    .replace(/[‘’‛′`]/gu, "'")
    .replace(/[“”„″]/gu, '"')
    .replace(/[•▪●◦‣]/gu, ' ')
    .replace(/(?<=\s)[-*](?=\s)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
/** Why an unaccepted CV quote failed; the quote itself is never reported. */
export function quoteRejectionCategory(
  cv: string,
  quote: string,
): QuoteRejectionCategory {
  if (cvQuoteOccurrences(cv, quote) === 2) return 'AMBIGUOUS';
  if (resolveCvQuote(cv, quote) !== null) return 'NOT_ALLOWED_PASSAGE';
  const target = fold(quote).trim();
  return target && fold(cv).includes(target)
    ? 'PUNCTUATION_OR_CASE_DRIFT'
    : 'ABSENT';
}
// Always on (Gemini path): counts of rejected CV quotes per category. Fixed
// tokens and integers only; never quotes, labels or source text.
export function emitMatchQuoteRejections(
  quotes: readonly string[],
  cv: string,
): void {
  if (!quotes.length) return;
  try {
    const counts: Record<QuoteRejectionCategory, number> = {
      AMBIGUOUS: 0,
      NOT_ALLOWED_PASSAGE: 0,
      PUNCTUATION_OR_CASE_DRIFT: 0,
      ABSENT: 0,
    };
    for (const quote of quotes) counts[quoteRejectionCategory(cv, quote)]++;
    // Non-zero categories only, to keep the always-on line short.
    const nonZero = Object.fromEntries(
      Object.entries(counts).filter(([, n]) => n > 0),
    );
    process.stderr.write(
      `${JSON.stringify({ event: 'CV_MATCH_QUOTES_REJECTED', ...attempt(), counts: nonZero })}\n`,
    );
  } catch {
    // Diagnostics must never alter matching.
  }
}
// A component JD span mismatch isolated to one unevaluable requirement. Index
// and attempt only; never text.
export function emitMatchSpanIsolated(requirementIndex: number): void {
  try {
    process.stderr.write(
      `${JSON.stringify({ event: 'CV_MATCH_REQUIREMENT_ISOLATED', ...attempt(), reasonCode: 'COMPONENT_JD_SPAN_MISMATCH', requirementIndex })}\n`,
    );
  } catch {
    // Diagnostics must never alter matching.
  }
}
