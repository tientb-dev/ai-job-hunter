import {
  capabilityOf,
  declarationLine,
  simpleLabel,
  workEvidence,
  type CoverageStatus,
  type RequirementGroup,
} from './cv-match.coverage.js';

/**
 * Stable API codes for how clearly the current CV documents the JD, used to
 * frame application preparation — never permission to apply or a prediction:
 * - WORTH_APPLYING: the CV already shows strong, relevant evidence.
 * - CONSIDER_CAREFULLY: some important evidence should be clarified.
 * - STRETCH_OPPORTUNITY: much important evidence is not yet shown in the CV.
 */
export type ApplicationRecommendation =
  'WORTH_APPLYING' | 'CONSIDER_CAREFULLY' | 'STRETCH_OPPORTUNITY';
export type GuidanceActionCode =
  | 'CLARIFY_CAPABILITY'
  | 'STATE_DURATION'
  | 'SHOW_IN_WORK'
  | 'ADD_EXAMPLE'
  | 'REVIEW_REQUIREMENT';
export interface GuidanceAction {
  code: GuidanceActionCode;
  /** JD wording the action is about (component or whole requirement). */
  label: string;
  capability?: string;
  years?: number;
}
export interface Evaluability {
  total: number;
  evaluated: number;
  /** Required items count 3×, preferred 1×, as in the score. */
  weightedFraction: number;
  low: boolean;
}
export interface ApplicationGuidance {
  recommendation: ApplicationRecommendation;
  confidence: 'NORMAL' | 'LOW';
  /** supported: summed credit; withEvidence: rows with any credit. */
  core: {
    total: number;
    evaluated: number;
    supported: number;
    withEvidence: number;
  };
  demonstratedWork: boolean;
  strengths: string[];
  gaps: string[];
  actions: GuidanceAction[];
}
interface Component {
  label: string;
  status: CoverageStatus;
  cvQuote: string;
  observations?: { kind: 'mention' | 'experience'; cvQuote: string }[];
}
export interface GuidanceRow {
  requirement: string;
  priority: 'required' | 'preferred';
  status: CoverageStatus;
  credit: number;
  cvQuote: string;
  group: RequirementGroup;
  components: Component[];
  /** The model may have missed CV evidence for this row. */
  evidence?: { review: boolean };
}

const weight = (row: GuidanceRow) => (row.priority === 'required' ? 3 : 1);
/**
 * Evaluability policy (weights as in the score):
 * - Below MIN_EVALUATED of the weighted JD evaluated (or none): `low`; the
 *   numeric score is withheld and confidence is LOW.
 * - A quarter or more of the core (required) rows uninterpreted: confidence
 *   LOW even when the weighted share passes, since key items are unread.
 *   One uninterpreted row among many stays NORMAL.
 */
const MIN_EVALUATED = 0.6;
const MAX_UNREAD_CORE = 0.25;

export function evaluability(rows: readonly GuidanceRow[]): Evaluability {
  const evaluatedRows = rows.filter((row) => row.status !== 'UNDECOMPOSED');
  const total = rows.reduce((sum, row) => sum + weight(row), 0);
  const done = evaluatedRows.reduce((sum, row) => sum + weight(row), 0);
  const weightedFraction = total ? done / total : 0;
  return {
    total: rows.length,
    evaluated: evaluatedRows.length,
    weightedFraction: Math.round(weightedFraction * 100) / 100,
    low: weightedFraction < MIN_EVALUATED,
  };
}

function action(row: GuidanceRow, component?: Component): GuidanceAction {
  const label = component?.label ?? simpleLabel(row.requirement);
  if (row.status === 'UNDECOMPOSED')
    return { code: 'REVIEW_REQUIREMENT', label: row.requirement };
  const capability = capabilityOf(label)?.id;
  if (capability) return { code: 'CLARIFY_CAPABILITY', label, capability };
  const seen = component?.observations ?? [];
  if (row.group.minimumYears !== undefined && seen.length)
    return { code: 'STATE_DURATION', label, years: row.group.minimumYears };
  // A whole-row duration ("Có từ 02 năm kinh nghiệm … với Java") unmet: the
  // CV needs dated work for it, not a generic example.
  const years =
    row.group.mode === 'SINGLE' &&
    /(?<![\p{L}\p{N}])(\d+)\+?\s*(?:years?|năm)(?!\p{L})/iu.exec(
      row.requirement,
    )?.[1];
  if (years) return { code: 'STATE_DURATION', label, years: Number(years) };
  if (seen.some((item) => item.kind === 'mention'))
    return { code: 'SHOW_IN_WORK', label };
  return { code: 'ADD_EXAMPLE', label };
}

/**
 * Decision support, not a hiring prediction. Core = required JD items (all
 * items when the JD marks none). No score threshold is used:
 * - LOW confidence (Consider carefully) when much of the JD, or a quarter of
 *   the core, is uninterpreted (see evaluability policy above).
 * - Worth applying: core evidence includes described work (or every core row
 *   is fully evidenced beyond skills lists), at least half of the evaluated
 *   core rows have some evidence, and at least a third of their credit.
 * - Stretch: even counting uninterpreted core rows as met, under a third of
 *   the core is documented, and no core row may hold missed evidence.
 * - Otherwise Consider carefully.
 */
export function applicationGuidance(
  rows: readonly GuidanceRow[],
): ApplicationGuidance & { evaluability: Evaluability } {
  const coverage = evaluability(rows);
  const required = rows.filter((row) => row.priority === 'required');
  const core = required.length ? required : [...rows];
  const evaluated = core.filter((row) => row.status !== 'UNDECOMPOSED');
  const undecomposed = core.length - evaluated.length;
  const supported = evaluated.reduce((sum, row) => sum + row.credit, 0);
  const evidenceQuotes = (row: GuidanceRow) => [
    row.cvQuote,
    ...row.components.map((component) => component.cvQuote),
  ];
  const demonstratedWork = evaluated.some(
    (row) => row.credit > 0 && evidenceQuotes(row).some(workEvidence),
  );
  // Without work passages, a fully evidenced core still counts when that
  // evidence is more than skills lists (e.g. a completed degree line).
  const listedOnly = (row: GuidanceRow) =>
    evidenceQuotes(row)
      .filter((quote) => quote.trim())
      .every((quote) =>
        quote
          .split(/\r?\n/u)
          .filter((line) => line.trim())
          .every(declarationLine),
      );
  const withEvidence = evaluated.filter((row) => row.credit > 0).length;
  const allEvidenced = evaluated.every(
    (row) => row.status === 'EVIDENCED' && !listedOnly(row),
  );
  // Unread core items could still be met: only call it a stretch when even
  // counting them the documented core stays mostly unsupported.
  const stretch = (supported + undecomposed) * 3 < core.length;
  const missedEvidence = core.some((row) => row.evidence?.review);
  const uncertain =
    coverage.low ||
    !evaluated.length ||
    undecomposed >= core.length * MAX_UNREAD_CORE ||
    (stretch && missedEvidence);
  const recommendation: ApplicationRecommendation = uncertain
    ? 'CONSIDER_CAREFULLY'
    : (demonstratedWork || allEvidenced) &&
        withEvidence * 2 >= evaluated.length &&
        supported * 3 >= evaluated.length
      ? 'WORTH_APPLYING'
      : stretch
        ? 'STRETCH_OPPORTUNITY'
        : 'CONSIDER_CAREFULLY';
  const unsupported = (item: { status: CoverageStatus }) =>
    item.status !== 'EVIDENCED' && item.status !== 'CONFLICT';
  const order = [
    ...core.filter((row) => unsupported(row) && row.status !== 'UNDECOMPOSED'),
    ...core.filter((row) => row.status === 'UNDECOMPOSED'),
    ...rows.filter((row) => !core.includes(row) && unsupported(row)),
  ];
  const actions: GuidanceAction[] = [];
  const keys = new Set<string>();
  for (const row of order) {
    const gaps =
      row.group.mode === 'SINGLE' || row.status === 'UNDECOMPOSED'
        ? [undefined]
        : row.components.filter(unsupported);
    for (const component of row.group.mode === 'OR' ? gaps.slice(0, 1) : gaps) {
      const next = action(row, component);
      const key = next.capability ?? next.label.toLocaleLowerCase();
      if (keys.has(key)) continue;
      keys.add(key);
      actions.push(next);
      if (actions.length === 3) break;
    }
    if (actions.length === 3) break;
  }
  return {
    recommendation,
    confidence: uncertain ? 'LOW' : 'NORMAL',
    core: {
      total: core.length,
      evaluated: evaluated.length,
      supported: Math.round(supported * 10) / 10,
      withEvidence,
    },
    demonstratedWork,
    strengths: evaluated
      .filter((row) => row.status === 'EVIDENCED')
      .slice(0, 3)
      .map((row) => row.requirement),
    gaps: evaluated
      .filter((row) => row.credit < 1 && row.status !== 'CONFLICT')
      .slice(0, 3)
      .map((row) => row.requirement),
    actions,
    evaluability: coverage,
  };
}
