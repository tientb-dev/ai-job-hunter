import type { MatchRequirement } from './cv-match.js';
import { resolveCvQuote } from './cv-match.evidence.js';
import { normalize } from './matching.policy.js';

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
        unlinked,
      })}\n`,
    );
  } catch {
    // Diagnostics must never replace or alter the original matching failure.
  }
}
