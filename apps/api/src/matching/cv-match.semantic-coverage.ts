import type { ConditionAssessment } from './cv-match.conditions.js';
import {
  evidenceRules,
  simpleContradictions,
  simpleEvidenceStatus,
  type ComponentCoverage,
  type Correspondence,
  type CoverageStatus,
  type evaluateCoverage,
  type RequirementGroup,
} from './cv-match.coverage.js';
import type { MatchRequirement } from './cv-match.js';

// Semantic relevance comes from the provider. Code checks grounding, known
// conditions and group composition without requiring the JD label in CV text.
export function semanticCoverage(
  row: MatchRequirement,
  group: RequirementGroup,
  cv: string,
  legacy: ReturnType<typeof evaluateCoverage> | null,
  conditions: readonly ConditionAssessment[],
) {
  const applicable = conditions.filter(
    (condition) => condition.parentId === row.parentId,
  );
  const conditionsMet = (componentId?: string) =>
    applicable
      .filter((condition) => condition.componentId === componentId)
      .every((condition) => condition.status === 'MET');
  const scoped =
    group.minimumYears !== undefined ||
    group.personalDelivery ||
    group.demonstratedUse ||
    group.languageProficiency ||
    group.managedLanguage ||
    group.aiFamiliarityOrInterest ||
    group.context === 'proficiency' ||
    group.context === 'education' ||
    row.category === 'experience';
  const single = group.mode === 'SINGLE' || group.mode === 'UNKNOWN';
  const passage = (decision: Correspondence | undefined, quote: string) => {
    if (decision !== 'SUPPORTED' && decision !== 'RELATED') {
      return { quote: '', invalid: !!decision && !!quote.trim() };
    }
    if (!quote.trim() || !cv.includes(quote)) {
      return { quote: '', invalid: true };
    }
    if (
      !group.aiFamiliarityOrInterest &&
      (evidenceRules.negative(quote) ||
        evidenceRules.uncertain(quote) ||
        evidenceRules.aspiration(quote))
    )
      return { quote: '', invalid: false };
    return { quote, invalid: false };
  };
  const parent =
    !single && !row.cvQuote.trim()
      ? { quote: '', invalid: false }
      : passage(row.correspondence, row.cvQuote);
  const rejectedComponents = new Set(row.rejectedComponentIds);
  const components: ComponentCoverage[] = group.components.map(
    (component, index) => {
      const selected = row.components?.find(
        (item) => item.componentId === component.id,
      );
      const existing = legacy?.components[index];
      const judge = single ? row.correspondence : selected?.correspondence;
      const evidence = single
        ? parent
        : passage(judge, selected?.cvQuote ?? '');
      if (
        !single &&
        (evidence.invalid || rejectedComponents.has(component.id))
      ) {
        rejectedComponents.add(component.id);
        return {
          ...component,
          status: 'UNDECOMPOSED',
          cvQuote: '',
          conflictingQuotes: [],
          qualificationReason:
            'This component’s evidence could not be verified.',
        };
      }
      const { quote } = evidence;
      const conflict =
        existing?.status === 'CONFLICT'
          ? existing.conflictingQuotes
          : quote
            ? simpleContradictions(component.label, cv)
            : [];
      const demonstrated =
        !scoped ||
        (single
          ? simpleEvidenceStatus(row.requirement, quote, cv, row.category) ===
            'EVIDENCED'
          : existing?.status === 'EVIDENCED' &&
            !!existing.cvQuote &&
            quote.includes(existing.cvQuote));
      const full =
        judge === 'SUPPORTED' &&
        group.mode !== 'UNKNOWN' &&
        demonstrated &&
        conditionsMet() &&
        conditionsMet(component.id);
      const status: CoverageStatus = conflict.length
        ? 'CONFLICT'
        : quote
          ? full
            ? 'EVIDENCED'
            : 'PARTIAL'
          : judge === 'UNASSESSABLE'
            ? 'UNDECOMPOSED'
            : 'NOT_EVIDENCED';
      return {
        ...component,
        status,
        cvQuote: quote,
        conflictingQuotes: conflict,
      };
    },
  );
  const componentQuote =
    components.find((component) => component.cvQuote)?.cvQuote || '';
  const quote = parent.quote || componentQuote;
  const hasGap =
    row.correspondence === 'NOT_FOUND' || row.correspondence === 'UNASSESSABLE';
  const isolatedComponentFailure =
    !single &&
    rejectedComponents.size > 0 &&
    components.some(
      (component) =>
        component.status === 'EVIDENCED' || component.status === 'PARTIAL',
    );
  const invalidEvidence =
    parent.invalid ||
    hasGap === Boolean(quote) ||
    (rejectedComponents.size > 0 && !isolatedComponentFailure);
  const supported =
    group.mode === 'OR'
      ? components.some((component) => component.status === 'EVIDENCED')
      : components.every((component) => component.status === 'EVIDENCED');
  const status: CoverageStatus =
    legacy?.status === 'CONFLICT' ||
    components.some((component) => component.status === 'CONFLICT')
      ? 'CONFLICT'
      : invalidEvidence ||
          row.cvEvidenceUnverified ||
          row.correspondence === 'UNASSESSABLE'
        ? 'UNDECOMPOSED'
        : row.correspondence === 'NOT_FOUND' || !quote
          ? 'NOT_EVIDENCED'
          : row.correspondence === 'SUPPORTED' && supported
            ? 'EVIDENCED'
            : 'PARTIAL';
  const retain = status !== 'UNDECOMPOSED' && status !== 'NOT_EVIDENCED';
  const reason =
    status === 'PARTIAL'
      ? row.missingQualifier?.trim() ||
        'Related CV evidence leaves part of the requirement unverified.'
      : status === 'UNDECOMPOSED' &&
          (invalidEvidence || row.cvEvidenceUnverified)
        ? 'Review the selected evidence.'
        : (legacy?.reason ?? 'Review the selected evidence.');
  return {
    invalidEvidence,
    isolatedComponentFailure,
    cvQuote: retain ? (isolatedComponentFailure ? componentQuote : quote) : '',
    coverage: {
      mode: group.mode,
      credit: status === 'EVIDENCED' ? 1 : status === 'PARTIAL' ? 0.5 : 0,
      status,
      reason,
      components: retain
        ? components
        : components.map((component) => ({
            ...component,
            status,
            cvQuote: '',
            conflictingQuotes: [],
          })),
    },
  };
}
