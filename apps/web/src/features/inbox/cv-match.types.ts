import { tr } from '../../app/i18n';
/** user_entered: added by the user in review, not text from the uploaded file. */
export type CvOrigin = 'source' | 'user_entered';
/** UNDECOMPOSED: the requirement could not be interpreted ("Could not interpret requirement"). */
export type MatchStatus =
  'EVIDENCED' | 'PARTIAL' | 'NOT_EVIDENCED' | 'CONFLICT' | 'UNDECOMPOSED';
export type GuidanceAction = {
  code:
    | 'CLARIFY_CAPABILITY'
    | 'STATE_DURATION'
    | 'SHOW_IN_WORK'
    | 'ADD_EXAMPLE'
    | 'REVIEW_REQUIREMENT';
  label: string;
  capability?: string;
  years?: number;
};
/** Advisory decision support; absent on matches saved before it existed. */
export interface ApplicationGuidance {
  recommendation:
    'WORTH_APPLYING' | 'CONSIDER_CAREFULLY' | 'STRETCH_OPPORTUNITY';
  confidence: 'NORMAL' | 'LOW';
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
export interface MatchResult {
  matchId?: string;
  cvUpdatedAt?: string;
  jobUpdatedAt?: string;
  score: number | null;
  recommendation: string;
  explanation: string;
  advice: string;
  analyzedAt: string;
  // Absent on assessments saved before PR #107.
  evidenceUncertain?: boolean;
  evaluability?: {
    total: number;
    evaluated: number;
    weightedFraction: number;
    low: boolean;
  };
  guidance?: ApplicationGuidance | null;
  /** This analysis was not saved; the previous reliable match is returned. */
  keptPrevious?: boolean;
  requirements: {
    evidence?: { modelQuote: string; review: boolean };
    parentId?: string;
    requirement: string;
    priority: string;
    category: string;
    jdQuote: string;
    cvQuote: string;
    /** Absent on matches saved before Source CV Review was required. */
    cvOrigin?: CvOrigin;
    status: MatchStatus;
    credit?: number;
    coverage?: {
      status?: MatchStatus;
      mode: 'SINGLE' | 'AND' | 'OR' | 'UNKNOWN';
      reason: string;
      credit: number;
      components: {
        id: string;
        label: string;
        jdQuote: string;
        cvQuote: string;
        cvOrigin?: CvOrigin;
        status: MatchStatus;
        observations?: { kind: 'mention' | 'experience'; cvQuote: string }[];
        qualificationReason?: string;
        conflictingQuotes: string[];
      }[];
    };
  }[];
}
export const statusLabel = (status: MatchStatus) =>
  ({
    EVIDENCED: tr('Matched'),
    PARTIAL: tr('Partial'),
    // "Not shown in this CV" is not "lacks the skill"; UNDECOMPOSED is the
    // system's own limit, never the applicant's.
    NOT_EVIDENCED: tr('Not clearly shown in CV'),
    CONFLICT: tr('Conflict / Needs review'),
    UNDECOMPOSED: tr('System could not analyze'),
  })[status];
// Preparation framing of the stable API codes: how clearly the CV documents
// the JD, never permission to apply or a hiring prediction.
const GUIDANCE_LABEL = {
  WORTH_APPLYING: 'Your CV shows strong relevant evidence',
  CONSIDER_CAREFULLY: 'Clarify key evidence in your CV',
  STRETCH_OPPORTUNITY: 'Add missing evidence to your CV',
} as const;
export const guidanceLabel = (
  recommendation: ApplicationGuidance['recommendation'],
): string => tr(GUIDANCE_LABEL[recommendation]);
// Same framing for the legacy label of matches saved without guidance.
const LEGACY_LABEL: Record<string, string> = {
  Apply: GUIDANCE_LABEL.WORTH_APPLYING,
  Consider: GUIDANCE_LABEL.CONSIDER_CAREFULLY,
  'Low Fit': GUIDANCE_LABEL.STRETCH_OPPORTUNITY,
};
export const recommendationLabel = (recommendation: string): string =>
  tr(LEGACY_LABEL[recommendation] ?? recommendation);
/** Requirement shape in the UI language; SINGLE/UNKNOWN show no label. */
export const coverageModeLabel = (mode: string): string =>
  mode === 'OR'
    ? tr('Any one of these')
    : mode === 'AND'
      ? tr('All of these')
      : '';
