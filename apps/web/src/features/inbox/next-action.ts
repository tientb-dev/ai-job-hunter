import { tr } from '../../app/i18n';
/**
 * Advisory next step for a job, derived only from persisted state. It never
 * changes data; the caller renders it as a link to the relevant section.
 */
export interface NextActionInput {
  /** dueFollowUp() result for the saved application. */
  followUp: string | null;
  status: string;
  /** null while loading. */
  cvSaved: boolean | null;
  /** Read-only readiness reason without a match; undefined while loading. */
  sourceReason: string | null | undefined;
  matchStatus: string;
  /** undefined while loading; null when the job has no draft. */
  draft:
    | { pending: number; approved: boolean; outdated: boolean }
    | null
    | undefined;
}
export interface NextAction {
  text: string;
  label: string;
  /** A job section, or the shared My CV page. */
  to: 'match' | 'tailored-cv' | 'application' | '/cv';
}

const sourceReviewReasons = [
  'CV_DRAFT_PROFILE_NOT_FOUND',
  'CV_DRAFT_PROFILE_INCOMPLETE',
  'CV_DRAFT_STALE_PROFILE',
];
const applied = ['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'CLOSED'];

export function nextJobAction(input: NextActionInput): NextAction | null {
  if (input.followUp)
    return {
      text: tr(
        'Follow-up {v0}. Contact the recruiter, then update the application.',
        { v0: tr(input.followUp).toLowerCase() },
      ),
      label: tr('Open Application'),
      to: 'application',
    };
  if (input.draft === undefined) return null;
  // An existing draft stays usable even when the match is outdated.
  if (input.draft) {
    const { pending, approved, outdated } = input.draft;
    if (pending > 0)
      return {
        text: tr(
          'Decide {pending} remaining suggestion{v1} in your tailored CV.',
          { pending: pending, v1: pending === 1 ? '' : 's' },
        ),
        label: tr('Continue tailoring'),
        to: 'tailored-cv',
      };
    if (!approved)
      return {
        text: tr(
          'All suggestions are decided. Review and approve your tailored CV.',
        ),
        label: tr('Review and approve'),
        to: 'tailored-cv',
      };
    if (applied.includes(input.status)) return null;
    return {
      text: outdated
        ? tr(
            'Your approved CV was tailored for an earlier version of this job. Check it before applying.',
          )
        : tr('Your tailored CV is approved. Download it and apply.'),
      label: tr('Open Approve & Export'),
      to: 'tailored-cv',
    };
  }
  if (applied.includes(input.status)) return null;
  if (input.cvSaved === null) return null;
  if (!input.cvSaved)
    return {
      text: tr('Save your CV in My CV to start tailoring for this job.'),
      label: tr('Open My CV'),
      to: '/cv',
    };
  if (input.sourceReason === undefined) return null;
  if (input.sourceReason && sourceReviewReasons.includes(input.sourceReason))
    return {
      text: tr(
        'Review your CV once in My CV; every job then uses it for tailoring.',
      ),
      label: tr('Review in My CV'),
      to: '/cv',
    };
  // This job's CV (not necessarily the default) still needs its review.
  if (input.matchStatus === 'CV_REVIEW_REQUIRED')
    return {
      text: tr('Review the CV this job uses before CV Match.'),
      label: tr('Go to Match'),
      to: 'match',
    };
  if (input.matchStatus === 'MISSING')
    return {
      text: tr('Analyze how your CV matches this job.'),
      label: tr('Go to Match'),
      to: 'match',
    };
  if (['STALE_CV', 'STALE_JOB', 'EXPIRED'].includes(input.matchStatus))
    return {
      text: tr('Your CV Match is outdated. Reanalyze it before tailoring.'),
      label: tr('Go to Match'),
      to: 'match',
    };
  if (input.matchStatus === 'VALID')
    return {
      text: tr('Create a tailored CV for this job.'),
      label: tr('Start tailored CV'),
      to: 'tailored-cv',
    };
  return null;
}

/** POST /tailored-cv/job-progress: workflow facts only, never decisions. */
export interface JobProgress {
  /** The account default CV, not necessarily the CV a job uses. */
  cv: { saved: boolean; sourceReason: string | null };
  jobs: JobProgressFact[];
}
export interface JobProgressFact {
  id: string;
  /** Evaluated for the job's own CV. */
  matchStatus: string;
  draft: {
    pending: number | null;
    approved: boolean;
    jobUpdatedAt: string;
    updatedAt: string;
  } | null;
}
export const isJobProgress = (value: unknown): value is JobProgress =>
  !!value &&
  typeof value === 'object' &&
  'jobs' in value &&
  Array.isArray(value.jobs) &&
  'cv' in value &&
  !!value.cv &&
  typeof value.cv === 'object';

/**
 * nextJobAction() from job-progress facts, shared by Dashboard and Jobs.
 * CV-level advice describes the account default CV, so it is kept only when
 * that CV is provably this job's CV (none pinned, no saved match); otherwise
 * the job's own match status decides, or there is no reliable step.
 */
export function progressAction(
  job: { status: string; updatedAt: string; cvId?: string | null },
  fact: JobProgressFact,
  cv: JobProgress['cv'],
  followUp: string | null,
): NextAction | null {
  const { draft } = fact;
  const input: NextActionInput = {
    followUp,
    status: job.status,
    cvSaved: cv.saved,
    sourceReason: cv.sourceReason,
    matchStatus: fact.matchStatus,
    // A malformed saved review has no pending count: infer nothing from it.
    draft:
      draft &&
      (draft.pending === null
        ? undefined
        : {
            pending: draft.pending,
            approved: draft.approved,
            outdated: draft.jobUpdatedAt !== job.updatedAt,
          }),
  };
  const action = nextJobAction(input);
  // Server resolves the job CV as pinned ?? matched ?? default.
  const usesAccountCv =
    !job.cvId &&
    (fact.matchStatus === 'MISSING' ||
      (fact.matchStatus === 'CV_UNAVAILABLE' && !cv.saved));
  if (action?.to !== '/cv' || usesAccountCv) return action;
  return nextJobAction({ ...input, cvSaved: true, sourceReason: null });
}

/** Chip statuses for the Jobs preview; null when the facts do not say. */
export function progressChips(fact: JobProgressFact) {
  const match =
    fact.matchStatus === 'VALID'
      ? 'COMPLETED'
      : ['STALE_CV', 'STALE_JOB', 'EXPIRED'].includes(fact.matchStatus)
        ? 'OUTDATED'
        : fact.matchStatus === 'MISSING'
          ? 'NOT_STARTED'
          : null;
  const { draft } = fact;
  const tailored = !draft
    ? 'NOT_STARTED'
    : draft.approved
      ? 'APPROVED'
      : draft.pending === null
        ? null
        : 'IN_PROGRESS';
  return { match, tailored };
}
