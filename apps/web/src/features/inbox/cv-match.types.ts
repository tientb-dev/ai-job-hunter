import { tr } from '../../app/i18n';
export interface MatchResult {
  matchId?: string;
  cvUpdatedAt?: string;
  jobUpdatedAt?: string;
  score: number | null;
  recommendation: string;
  explanation: string;
  advice: string;
  analyzedAt: string;
  requirements: {
    parentId?: string;
    requirement: string;
    priority: string;
    category: string;
    jdQuote: string;
    cvQuote: string;
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
