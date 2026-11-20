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
export const COVERAGE_HIDDEN_REASONS = [
  'TOO_FEW_ASSESSABLE_SKILLS',
  'TOO_MUCH_UNASSESSABLE',
  'EVIDENCE_VERIFICATION_FAILED',
  'UNVERIFIED_JD',
] as const;

export interface MatchCondition {
  reason?: 'DATED_PROGRAMMING' | 'IT_QUALIFICATION';
  unknownExperience?: {
    evidence: 'NONE' | 'UNDATED' | 'DATED';
    years: number;
    javaFullStack?: boolean;
  };
  parentId?: string;
  componentId?: string;
  mode: 'SINGLE' | 'AND' | 'OR' | 'UNKNOWN';
  kind:
    | 'LANGUAGE'
    | 'LANGUAGE_CERTIFICATE'
    | 'EXPERIENCE'
    | 'EDUCATION'
    | 'CERTIFICATION';
  jdQuote: string;
  status: 'MET' | 'UNKNOWN' | 'NOT_MET';
  evidence: {
    cvQuote: string;
    start: number;
    end: number;
    cvOrigin?: CvOrigin;
  }[];
}

type JobSourceField = 'jdText' | 'description' | 'postText';

export interface EvidenceReview {
  version: 1;
  jobRevision: string;
  profileRevisionId: string;
  sources: { field: JobSourceField; text: string }[];
  rows: {
    field:
      JobSourceField | 'skills' | 'preferredSkills' | 'experience' | 'domain';
    start: number;
    end: number;
    quote: string;
    status:
      | 'VERIFIED_EVIDENCE'
      | 'PARTIAL_EVIDENCE'
      | 'NO_DOCUMENTED_EVIDENCE'
      | 'NEEDS_REVIEW';
    reason:
      | 'DECLARED'
      | 'MISSING'
      | 'LIMITED'
      | 'SCOPE'
      | 'WORK_CONTEXT'
      | 'TEAM_DEPLOYMENT'
      | 'PRODUCTION_SCOPE'
      | 'PROFICIENCY'
      | 'SOURCE'
      | 'SAVED_FIELD'
      | 'VERIFY';
    missing: string[];
    evidence: {
      quote: string;
      start: number;
      end: number;
      entryId: string;
      origin: CvOrigin;
      kind: 'declaration' | 'review' | 'context';
    }[];
  }[];
}

export interface SkillMatch {
  findings?: {
    kind: 'skill' | 'related' | 'clause' | 'requirement';
    label: string;
    sources: { field: string; quote: string; start: number; end: number }[];
    evidence: SkillMatch['rows'][number]['skills'][number]['evidence'];
  }[];
  partialScore?: number | null;
  fieldConflict?: boolean;
  version: 1;
  score: number | null;
  limitation: 'INCOMPLETE_INVENTORY' | 'NO_SKILLS' | null;
  matchedCount: number;
  totalCount: number;
  unresolved?: string[];
  mixedGroups?: string[];
  unresolvedTechnicalGroupCount?: number;
  unclassifiedRequirementCount?: number;
  inventoryStatus?: 'MISSING' | 'STALE' | 'FAILED' | 'COMPLETE' | 'INCOMPLETE';
  fallbackReview?: { source: { quote: string }; skills: { name: string }[] }[];
  rows: {
    priority: 'required' | 'preferred';
    source: { quote: string };
    skills: {
      name: string;
      evidence: {
        quote: string;
        origin: CvOrigin;
        factId?: string;
        sectionKind?: 'skills' | 'experience' | 'projects';
        relationship?: {
          from: string;
          reason: 'DIRECTIONAL_SKILL' | 'EXPLICIT_SQL_WORK';
        };
      } | null;
    }[];
  }[];
}

export interface MatchResult {
  skillMatch?: SkillMatch;
  evidenceReview?: EvidenceReview;
  matchId?: string;
  cvUpdatedAt?: string;
  jobUpdatedAt?: string;
  score: number | null;
  coverageHidden?: (typeof COVERAGE_HIDDEN_REASONS)[number] | null;
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
  conditions?: MatchCondition[];
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
    notAssessed?: 'HEADING' | 'SUBJECTIVE';
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
        strength?: {
          quotes: {
            quote: string;
            level: 'LISTED' | 'MENTIONED' | 'APPLIED' | 'APPLIED_PLUS';
          }[];
        };
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

export function matchVerdictLabel(result: MatchResult): string {
  if (result.score === null) return tr('Review requirements');
  return result.guidance
    ? guidanceLabel(result.guidance.recommendation)
    : recommendationLabel(result.recommendation);
}
/** Requirement shape in the UI language; SINGLE/UNKNOWN show no label. */
export const coverageModeLabel = (mode: string): string =>
  mode === 'OR'
    ? tr('Any one of these')
    : mode === 'AND'
      ? tr('All of these')
      : '';
