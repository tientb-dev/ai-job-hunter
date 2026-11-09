import type { DraftReview } from './tailored-draft-review.policy.js';
import { HttpException } from '@nestjs/common';
import type { Evidence, ProfileDocument } from './tailored-cv.contract.js';
import type { MatchSnapshot } from '../matching/match-context.js';
const failures = {
  CV_EXPORT_NOT_APPROVED: [
    409,
    'Save and approve this exact draft revision before downloading.',
  ],
  CV_EXPORT_EMPTY: [
    422,
    'Include at least one reviewed fact before downloading.',
  ],
  CV_EXPORT_UNSUPPORTED_TEXT: [
    422,
    'The CV contains text unsupported by the bundled export fonts. Review the wording before downloading.',
  ],
  CV_EXPORT_UNAVAILABLE: [
    503,
    'The CV could not be rendered. Your saved draft is unchanged. Retry later.',
  ],
  CV_DRAFT_REVIEW_INCOMPLETE: [
    422,
    'Decide every wording proposal, acknowledge review issues and explicitly review edited wording before approval.',
  ],
  CV_DRAFT_INVALID_REQUEST: [
    400,
    'Invalid tailored draft request. Check contract version and revisions.',
  ],
  CV_DRAFT_NOT_FOUND: [404, 'Tailored draft not found.'],
  CV_DRAFT_JOB_NOT_FOUND: [404, 'Saved job not found.'],
  CV_DRAFT_PROFILE_NOT_FOUND: [404, 'Reviewed source profile not found.'],
  CV_DRAFT_PROFILE_INCOMPLETE: [
    422,
    'Review all profile facts and resolve or explicitly exclude every source passage before generation.',
  ],
  CV_DRAFT_STALE_PROFILE: [
    409,
    'The source profile changed. Reload its latest reviewed revision.',
  ],
  CV_DRAFT_STALE_JOB: [
    409,
    'The saved job changed. Reload it and reanalyze CV Match.',
  ],
  CV_DRAFT_STALE_MATCH: [
    409,
    'CV Match is unavailable, expired or belongs to different source revisions. Reanalyze.',
  ],
  CV_DRAFT_BUSY: [
    409,
    'A tailored draft generation is already running. Retry after it finishes.',
  ],
  CV_DRAFT_SAVE_CONFLICT: [
    409,
    'The draft revision changed or requires the tailored review contract.',
  ],
  CV_DRAFT_TIMEOUT: [
    504,
    'Local draft generation timed out. Existing drafts are unchanged.',
  ],
  CV_DRAFT_CONTEXT_LIMIT: [
    422,
    'This profile or job exceeds the bounded local draft budget. Existing drafts are unchanged.',
  ],
  CV_DRAFT_INVALID_OUTPUT: [
    502,
    'The local model returned invalid draft proposals. Existing drafts are unchanged.',
  ],
  CV_DRAFT_UNSUPPORTED_REFERENCE: [
    502,
    'The local model referenced an ineligible fact or requirement. Existing drafts are unchanged.',
  ],
  CV_DRAFT_UNAVAILABLE: [
    503,
    'Local draft generation or storage is unavailable. Existing drafts are unchanged.',
  ],
} as const;
export class TailoredDraftError extends HttpException {
  constructor(readonly errorCode: keyof typeof failures) {
    super(failures[errorCode][1], failures[errorCode][0]);
  }
}
export type CvSectionKind = ProfileDocument['sections'][number]['kind'];
export interface DraftJobSnapshot {
  title: string;
  company: string;
  skills: string;
  preferredSkills: string;
  experience: string;
  domain: string;
  seniority: string;
  description: string;
  postText: string;
  jdText: string;
  hasDiscovery: boolean;
  discoveryRequirements: { required: string; preferred: string } | null;
}
export const CONFLICTING_SOURCE_REASON =
  'Conflicting source evidence requires review.';
/**
 * Only issues that can leave untrue content in the final CV block approval.
 * Semantic reminders are resolved by the proposal decision, blocked rewrites
 * never enter the CV, and requirement gaps or absent sections are
 * informational. Conflicting source evidence stays actionable. The rule reads
 * existing fields only, so saved drafts are evaluated without data changes.
 */
export function issueBlocksApproval(issue: {
  code: string;
  reason: string;
}): boolean {
  return (
    issue.code === 'CV_DRAFT_UNSAFE_REWRITE' &&
    issue.reason === CONFLICTING_SOURCE_REASON
  );
}
export interface DraftIssue {
  code:
    | 'CV_DRAFT_UNSAFE_REWRITE'
    | 'SEMANTIC_REVIEW_REQUIRED'
    | 'REQUIREMENT_PARTIAL'
    | 'REQUIREMENT_UNKNOWN'
    | 'REQUIREMENT_CONFLICT'
    | 'SECTION_NOT_IN_PROFILE';
  factId?: string;
  requirementId?: string;
  sectionKind?: CvSectionKind;
  reason: string;
}
export interface DraftFact {
  id: string;
  field: string;
  acceptedText: string;
  selected: boolean;
  provenance: {
    profileFactId: string;
    origin: 'source' | 'user_entered';
    confirmation: 'field' | 'section';
    evidence: Evidence[];
    replacesFactId?: string;
  };
  relevance: {
    requirementId: string;
    componentIds: string[];
    kind: 'source_passage_support' | 'ai_relevance_only';
  }[];
  proposedWording: {
    text: string;
    status: 'pending';
    requirementIds: string[];
    /** Why the change is relevant to the job; absent on older drafts. */
    explanation?: string;
  } | null;
  /**
   * D2.3: a stronger framing containing details the source does not establish.
   * Never exported or accepted; the user may adopt it only as their own edit.
   */
  verification?: {
    text: string;
    details: string[];
    requirementIds: string[];
    explanation: string;
  } | null;
}
export interface TailoredDraftDocument {
  contractVersion: '1';
  kind: 'tailored_cv';
  review?: DraftReview;
  pins: {
    sourceRevisionId: string;
    sourceHash: string;
    profileRevisionId: string;
    profileId: string;
    profileRevision: number;
    profileHash: string;
    jobId: string;
    jobUpdatedAt: string;
    jobHash: string;
    matchId: string;
  };
  jobSnapshot: DraftJobSnapshot;
  requirements: {
    id: string;
    text: string;
    priority: string;
    status: string;
    mode: string;
    credit: number;
    components: { id: string; label: string; status: string }[];
  }[];
  sections: {
    id: string;
    kind: CvSectionKind;
    entries: {
      id: string;
      originalOrder: number;
      facts: DraftFact[];
      priorityFactIds: string[];
    }[];
  }[];
  recoverable: {
    unselectedFactIds: string[];
    structuralFactIds: string[];
    supersededFactIds: string[];
    sourceCoverage: ProfileDocument['coverage'];
  };
  reviewIssues: DraftIssue[];
}
export interface EligibleFact {
  id: string;
  field: string;
  value: string;
  sectionId: string;
  sectionKind: CvSectionKind;
  entryId: string;
  confirmation: 'field' | 'section';
  origin: 'source' | 'user_entered';
  evidence: Evidence[];
  replacesFactId?: string;
}
export interface DraftPlan {
  profile: ProfileDocument;
  facts: EligibleFact[];
  candidates: EligibleFact[];
  structuralFactIds: string[];
  supersededFactIds: string[];
}
export interface BatchOutput {
  selectedFactIds: string[];
  proposals: {
    factId: string;
    text: string;
    requirementIds: string[];
    /** Optional stronger framing that needs user verification. */
    verify?: string;
  }[];
}
export interface DraftInput {
  plan: DraftPlan;
  match: MatchSnapshot;
  job: DraftJobSnapshot;
  pins: TailoredDraftDocument['pins'];
}
