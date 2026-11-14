import {
  declarationLine,
  demonstratedUseReason,
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
// Fixed codes for the model's component quote (diagnostics only):
// MISSING            no quote supplied;
// ALLOWED            an allowed CV passage (Ollama path: exact CV text);
// WIDENED            a unique fragment widened to its allowed line(s);
// SKILLS_DECLARATION resolves to CV text that is a skills/technology declaration;
// AMBIGUOUS          a fragment found in several places (dropped, PR #65);
// NOT_ALLOWED_PASSAGE exact CV text that is no allowed passage (e.g. > 3 lines);
// NOT_IN_CV          not present in the CV.
export type ComponentQuoteClass =
  | 'MISSING'
  | 'ALLOWED'
  | 'WIDENED'
  | 'SKILLS_DECLARATION'
  | 'AMBIGUOUS'
  | 'NOT_ALLOWED_PASSAGE'
  | 'NOT_IN_CV';
function componentQuoteClass(
  quote: string,
  cv: string,
  allowed?: ReadonlySet<string>,
): ComponentQuoteClass {
  if (!quote.trim()) return 'MISSING';
  const found = cvQuoteOccurrences(cv, quote);
  const source = allowed
    ? allowed.has(quote)
      ? quote
      : alignToPassage(cv, quote, allowed)
    : found === 1 || cv.includes(quote)
      ? resolveCvQuote(cv, quote)
      : null;
  if (source === null || source === undefined)
    return found === 0
      ? 'NOT_IN_CV'
      : found === 2
        ? 'AMBIGUOUS'
        : 'NOT_ALLOWED_PASSAGE';
  if (
    source
      .split(/\r\n|[\r\n\u2028\u2029]/u)
      .filter((line) => line.trim())
      .every((line) => declarationLine(line))
  )
    return 'SKILLS_DECLARATION';
  return allowed && !allowed.has(quote) ? 'WIDENED' : 'ALLOWED';
}
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
    const scored = result.requirements.find(
      (row) => row.parentId === seed.parentId,
    );
    const status = scored?.status;
    // AND/OR groups: per-component outcome. Broker OR rows add a fixed reason.
    const components =
      group.mode === 'AND' || group.mode === 'OR'
        ? group.components.map((component, position) => {
            const status =
              scored?.coverage.components.find((c) => c.id === component.id)
                ?.status ?? 'NOT_EVIDENCED';
            const quote =
              proposals
                .filter((item) => linksCanonicalRequirement(item, seed))
                .flatMap((item) => item.components ?? [])
                .find((c) => c.componentId === component.id && c.cvQuote.trim())
                ?.cvQuote ?? '';
            return {
              position,
              status: STATUSES.includes(status) ? status : 'NOT_EVIDENCED',
              accepted: status === 'EVIDENCED' || status === 'PARTIAL',
              quote: componentQuoteClass(quote, cv, allowed),
              ...(group.demonstratedUse
                ? {
                    reason: demonstratedUseReason(
                      component.label,
                      cv,
                      group,
                      status,
                    ),
                  }
                : {}),
            };
          })
        : undefined;
    return {
      index,
      mode: MODES.includes(group.mode) ? group.mode : 'UNKNOWN',
      status: status && STATUSES.includes(status) ? status : 'OMITTED',
      recovery: !blocked
        ? 'ALLOWED'
        : candidate
          ? 'BLOCKED_WITH_CANDIDATE'
          : 'BLOCKED_NO_CANDIDATE',
      ...(components ? { components } : {}),
    };
  });
  return {
    quotes,
    recoveryBlocked: requirements.filter((row) => row.recovery !== 'ALLOWED')
      .length,
    requirements,
  };
}
