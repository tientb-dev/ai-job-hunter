import { tr } from '../../app/i18n';
/** user_entered: added by the user in review, not text from the uploaded file. */
export type CvOrigin = 'source' | 'user_entered';
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
    status: 'EVIDENCED' | 'PARTIAL' | 'NOT_EVIDENCED' | 'CONFLICT';
    credit?: number;
    coverage?: {
      status?: 'EVIDENCED' | 'PARTIAL' | 'NOT_EVIDENCED' | 'CONFLICT';
      mode: 'SINGLE' | 'AND' | 'OR' | 'UNKNOWN';
      reason: string;
      credit: number;
      components: {
        id: string;
        label: string;
        jdQuote: string;
        cvQuote: string;
        cvOrigin?: CvOrigin;
        status: 'EVIDENCED' | 'PARTIAL' | 'NOT_EVIDENCED' | 'CONFLICT';
        observations?: { kind: 'mention' | 'experience'; cvQuote: string }[];
        qualificationReason?: string;
        conflictingQuotes: string[];
      }[];
    };
  }[];
}
export const statusLabel = (
  status: MatchResult['requirements'][number]['status'],
) =>
  ({
    EVIDENCED: tr('Matched'),
    PARTIAL: tr('Partial'),
    NOT_EVIDENCED: tr('Unknown'),
    CONFLICT: tr('Conflict / Needs review'),
  })[status];
