import { dueFollowUp } from '../inbox/follow-ups';
import { statuses } from '../inbox/opportunities-api';
import type { Opportunity } from '../inbox/opportunities-api';

const RECENT_LIMIT = 5;

export interface HomeSections {
  due: { job: Opportunity; label: string }[];
  recent: Opportunity[];
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
      const label = dueFollowUp(job.followUpDate, job.status, today);
      return label ? [{ job, label }] : [];
    })
    // Oldest follow-up first; dueFollowUp guarantees a date here.
    .sort((a, b) => a.job.followUpDate!.localeCompare(b.job.followUpDate!));
  const dueIds = new Set(due.map(({ job }) => job.id));
  const recent = [...rows]
    .filter((job) => !dueIds.has(job.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT);
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
  return { due, recent, counts, metrics };
}
