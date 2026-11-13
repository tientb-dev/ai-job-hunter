import {
  evaluateCoverage,
  recoverSimpleQuote,
  requirementGroup,
} from './cv-match.coverage.js';
import {
  alignToPassage,
  cvQuoteOccurrences,
  recoveredCvQuote,
  resolveCvQuote,
} from './cv-match.evidence.js';
import {
  linksCanonicalRequirement,
  type MatchRequirement,
  type scoreCvMatch,
} from './cv-match.js';

type QuoteClass = 'allowed' | 'widened' | 'ambiguous' | 'dropped';
const STATUSES = ['EVIDENCED', 'PARTIAL', 'NOT_EVIDENCED', 'CONFLICT'];
const MODES = ['SINGLE', 'AND', 'OR', 'UNKNOWN'];

// Success-path evidence summary: fixed codes and counts only. It is computed
// after scoring and never feeds back into acceptance or scoring.
export function evidenceSummary(
  proposals: readonly MatchRequirement[],
  verified: readonly MatchRequirement[],
  result: ReturnType<typeof scoreCvMatch>,
  cv: string,
  canonical: readonly MatchRequirement[],
  allowed?: ReadonlySet<string>,
) {
  const quotes: Record<QuoteClass, number> = {
    allowed: 0,
    widened: 0,
    ambiguous: 0,
    dropped: 0,
  };
  const classify = (quote: string): QuoteClass =>
    allowed
      ? allowed.has(quote)
        ? 'allowed'
        : alignToPassage(cv, quote, allowed) !== null
          ? 'widened'
          : cvQuoteOccurrences(cv, quote) === 2
            ? 'ambiguous'
            : 'dropped'
      : resolveCvQuote(cv, quote) !== null
        ? 'allowed'
        : 'dropped';
  for (const item of proposals)
    for (const quote of [
      item.cvQuote,
      ...(item.components ?? []).map((c) => c.cvQuote),
    ])
      if (quote.trim()) quotes[classify(quote)]++;
  const requirements = canonical.map((seed, index) => {
    const group = requirementGroup(seed.requirement, seed.category);
    const blocked = verified.some(
      (item) =>
        linksCanonicalRequirement(item, seed) &&
        (item.cvEvidenceUnverified || item.componentEvidenceUnverified),
    );
    // Would deterministic recovery have found evidence had it not been blocked?
    const candidate =
      blocked &&
      (group.mode === 'SINGLE'
        ? !!(
            recoveredCvQuote(seed, cv) ||
            recoverSimpleQuote(seed.requirement, seed.category, cv)
          )
        : evaluateCoverage(group, [], cv, true).credit > 0);
    const status = result.requirements.find(
      (row) => row.parentId === seed.parentId,
    )?.status;
    return {
      index,
      mode: MODES.includes(group.mode) ? group.mode : 'UNKNOWN',
      status: status && STATUSES.includes(status) ? status : 'OMITTED',
      recovery: !blocked
        ? 'ALLOWED'
        : candidate
          ? 'BLOCKED_WITH_CANDIDATE'
          : 'BLOCKED_NO_CANDIDATE',
    };
  });
  return {
    quotes,
    recoveryBlocked: requirements.filter((row) => row.recovery !== 'ALLOWED')
      .length,
    requirements,
  };
}
