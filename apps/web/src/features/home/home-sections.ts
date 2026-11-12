import { dueFollowUp } from '../inbox/follow-ups';
import { statuses } from '../inbox/opportunities-api';
import type { Opportunity } from '../inbox/opportunities-api';
import { nextJobAction } from '../inbox/next-action';
import type { NextAction } from '../inbox/next-action';

const CONTINUE_LIMIT = 3;

/** POST /tailored-cv/job-progress: workflow facts only, never decisions. */
export interface JobProgress {
  cv: { saved: boolean; sourceReason: string | null };
  jobs: {
    id: string;
    matchStatus: string;
    draft: {
      pending: number | null;
      approved: boolean;
      jobUpdatedAt: string;
      updatedAt: string;
    } | null;
  }[];
}

export interface HomeSections {
  due: { job: Opportunity; label: string }[];
  counts: { status: string; count: number }[];
  metrics: {
    active: number;
    inProgress: number;
    interview: number;
    overdue: number;
  };
}

/** Pure selection so the semantics are testable without rendering. */
export function homeSections(rows: Opportunity[], today: string): HomeSections {
  const due = rows
    .flatMap((job) => {
      const label = dueFollowUp(
        job.followUpDate,
        job.status,
        today,
        job.followUpStatus,
      );
      return label ? [{ job, label }] : [];
    })
    // Oldest follow-up first; dueFollowUp guarantees a date here.
    .sort((a, b) => a.job.followUpDate!.localeCompare(b.job.followUpDate!));
  const counts = statuses
    .map((status) => ({
      status,
      count: rows.filter((job) => job.status === status).length,
    }))
    .filter(({ count }) => count > 0);
  const count = (status: string) =>
    rows.filter((job) => job.status === status).length;
  const metrics = {
    // Same "active" rule as dueFollowUp: every status except the two closed ones.
    active: rows.length - count('REJECTED') - count('CLOSED'),
    // Every active job past Saved: Contacted, JD received, Applied, Interview, Offer.
    inProgress:
      rows.length - count('REJECTED') - count('CLOSED') - count('SAVED'),
    interview: count('INTERVIEW'),
    overdue: due.filter(({ label }) => label === 'Overdue').length,
  };
  return { due, counts, metrics };
}

/**
 * Up to three jobs with a next step from nextJobAction(), the same rules as
 * the job Overview. Due follow-ups have their own panel, and CV-level steps
 * are shown once in the CV banner, so neither appears here.
 */
export function continueItems(
  rows: Opportunity[],
  progress: JobProgress,
  today: string,
): { job: Opportunity; action: NextAction }[] {
  const facts = new Map(progress.jobs.map((fact) => [fact.id, fact]));
  return rows
    .flatMap((job) => {
      const fact = facts.get(job.id);
      if (
        !fact ||
        dueFollowUp(job.followUpDate, job.status, today, job.followUpStatus)
      )
        return [];
      const { draft } = fact;
      const action = nextJobAction({
        followUp: null,
        status: job.status,
        cvSaved: progress.cv.saved,
        sourceReason: progress.cv.sourceReason,
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
      });
      if (!action || action.to === '/cv') return [];
      const activity =
        draft && draft.updatedAt > job.updatedAt
          ? draft.updatedAt
          : job.updatedAt;
      return [{ job, action, activity }];
    })
    .sort((a, b) => b.activity.localeCompare(a.activity))
    .slice(0, CONTINUE_LIMIT)
    .map(({ job, action }) => ({ job, action }));
}

/** The CV-level step every job without a draft would show, or null. */
export const cvStep = (progress: JobProgress) => {
  const action = nextJobAction({
    followUp: null,
    status: 'SAVED',
    cvSaved: progress.cv.saved,
    sourceReason: progress.cv.sourceReason,
    matchStatus: 'MISSING',
    draft: null,
  });
  return action?.to === '/cv' ? action : null;
};
