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
      text: `Follow-up ${input.followUp.toLowerCase()}. Contact the recruiter, then update the application.`,
      label: 'Open Application',
      to: 'application',
    };
  if (input.draft === undefined) return null;
  // An existing draft stays usable even when the match is outdated.
  if (input.draft) {
    const { pending, approved, outdated } = input.draft;
    if (pending > 0)
      return {
        text: `Decide ${pending} remaining suggestion${pending === 1 ? '' : 's'} in your tailored CV.`,
        label: 'Continue tailoring',
        to: 'tailored-cv',
      };
    if (!approved)
      return {
        text: 'All suggestions are decided. Review and approve your tailored CV.',
        label: 'Review and approve',
        to: 'tailored-cv',
      };
    if (applied.includes(input.status)) return null;
    return {
      text: outdated
        ? 'Your approved CV was tailored for an earlier version of this job. Check it before applying.'
        : 'Your tailored CV is approved. Download it and apply.',
      label: 'Open Approve & Export',
      to: 'tailored-cv',
    };
  }
  if (applied.includes(input.status)) return null;
  if (input.cvSaved === null) return null;
  if (!input.cvSaved)
    return {
      text: 'Save your CV in My CV to start tailoring for this job.',
      label: 'Open My CV',
      to: '/cv',
    };
  if (input.sourceReason === undefined) return null;
  if (input.sourceReason && sourceReviewReasons.includes(input.sourceReason))
    return {
      text: 'Review your CV once in My CV; every job then uses it for tailoring.',
      label: 'Review in My CV',
      to: '/cv',
    };
  if (input.matchStatus === 'MISSING')
    return {
      text: 'Analyze how your CV matches this job.',
      label: 'Go to Match',
      to: 'match',
    };
  if (['STALE_CV', 'STALE_JOB', 'EXPIRED'].includes(input.matchStatus))
    return {
      text: 'Your CV Match is outdated. Reanalyze it before tailoring.',
      label: 'Go to Match',
      to: 'match',
    };
  if (input.matchStatus === 'VALID')
    return {
      text: 'Create a tailored CV for this job.',
      label: 'Start tailored CV',
      to: 'tailored-cv',
    };
  return null;
}
