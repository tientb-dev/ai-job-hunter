import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, within } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Home } from '../src/features/home/Home';
import {
  continueItems,
  homeSections,
} from '../src/features/home/home-sections';
import type { JobProgress } from '../src/features/home/home-sections';
import { nextJobAction } from '../src/features/inbox/next-action';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import type { Opportunity } from '../src/features/inbox/opportunities-api';

const job = (n: number, patch: Partial<Opportunity> = {}): Opportunity => ({
  ...emptyOpportunity(),
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Synthetic job ${n}`,
  company: `Company ${n}`,
  jdText: '',
  documentName: null,
  documentType: null,
  ownerId: 'owner',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: `2026-11-0${n}T00:00:00Z`,
  ...patch,
});
const today = '2026-11-10';

afterEach(() => vi.unstubAllGlobals());

test('due follow-ups come oldest first; metrics count current statuses', () => {
  const rows = [
    job(1, { followUpDate: '2026-11-10', status: 'APPLIED' }),
    job(2, { followUpDate: '2026-11-03', status: 'APPLIED' }),
    job(3, { followUpDate: '2026-11-11', status: 'APPLIED' }), // future
    job(4, { followUpDate: '2026-11-01', status: 'CLOSED' }), // inactive
    job(5),
  ];
  const { due, counts } = homeSections(rows, today);
  expect(due.map(({ job, label }) => [job.title, label])).toEqual([
    ['Synthetic job 2', 'Overdue'],
    ['Synthetic job 1', 'Due today'],
  ]);
  // Every job counted exactly once, under its current status, in pipeline order.
  expect(homeSections(rows, today).metrics).toEqual({
    active: 4,
    inProgress: 3,
    interview: 0,
    overdue: 1,
  });
  // Every active status except Saved counts as in progress.
  expect(
    homeSections(
      [
        'SAVED',
        'CONTACTED',
        'JD_RECEIVED',
        'APPLIED',
        'INTERVIEW',
        'OFFER',
        'REJECTED',
        'CLOSED',
      ].map((status, n) => job(n, { status: status as Opportunity['status'] })),
      today,
    ).metrics.inProgress,
  ).toBe(5);
  expect(counts).toEqual([
    { status: 'SAVED', count: 1 },
    { status: 'APPLIED', count: 3 },
    { status: 'CLOSED', count: 1 },
  ]);
});

const reviewedCv: JobProgress['cv'] = {
  saved: true,
  sourceReason: 'CV_DRAFT_MATCH_REQUIRED',
};
const facts = (
  jobs: JobProgress['jobs'] = [],
  cv = reviewedCv,
): JobProgress => ({ cv, jobs });

function stub(
  jobs: () => Promise<Response>,
  progress: () => Promise<Response> = () =>
    Promise.resolve(Response.json({ contractVersion: '1', ...facts() })),
) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/tailored-cv/job-progress') ? progress() : jobs(),
    ),
  );
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

test('shows sections, CV guidance only without a CV, and links to the application', async () => {
  stub(
    () =>
      Promise.resolve(
        Response.json([
          job(1, { followUpDate: '2026-01-01', status: 'APPLIED' }),
          job(2),
        ]),
      ),
    () =>
      Promise.resolve(
        Response.json(facts([], { saved: false, sourceReason: null })),
      ),
  );
  const followUps = await screen.findByRole('region', { name: 'Follow-ups' });
  expect(
    within(followUps).getByRole('link', {
      name: 'Open application for Synthetic job 1',
    }),
  ).toHaveAttribute(
    'href',
    '/jobs/00000000-0000-4000-8000-000000000001/application',
  );
  const summary = screen.getByRole('region', { name: 'Job search summary' });
  expect(within(summary).getByText('Follow-ups due')).toBeVisible();
  expect(within(summary).getByText('1 overdue')).toBeVisible();
  expect(await screen.findByRole('link', { name: 'Open My CV' })).toBeVisible();
});

test('hides CV guidance when a reviewed CV exists and shows the empty state', async () => {
  stub(() => Promise.resolve(Response.json([])));
  expect(
    await screen.findByRole('heading', { name: 'No jobs yet' }),
  ).toBeVisible();
  await vi.waitFor(() =>
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/v1/tailored-cv/job-progress',
      expect.anything(),
    ),
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /My CV/ })).not.toBeInTheDocument();
});

test('load failure offers retry', async () => {
  let calls = 0;
  stub(() =>
    ++calls === 1
      ? Promise.resolve(new Response(null, { status: 503 }))
      : Promise.resolve(Response.json([job(1)])),
  );
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByRole('region', { name: 'Job search summary' }),
  ).toBeVisible();
});

test('every due follow-up is reachable through Show more', async () => {
  stub(() =>
    Promise.resolve(
      Response.json(
        [1, 2, 3, 4, 5].map((n) =>
          job(n, { followUpDate: `2026-01-0${n}`, status: 'APPLIED' }),
        ),
      ),
    ),
  );
  const followUps = await screen.findByRole('region', { name: 'Follow-ups' });
  const links = () =>
    within(followUps).getAllByRole('link', { name: /^Open application for/ });
  expect(links()).toHaveLength(3);
  const toggle = within(followUps).getByRole('button', { name: 'Show 2 more' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await userEvent.setup().click(toggle);
  expect(links()).toHaveLength(5);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveTextContent('Show fewer');
});

const draft = (
  patch: Partial<NonNullable<JobProgress['jobs'][0]['draft']>>,
) => ({
  pending: 0,
  approved: false,
  jobUpdatedAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...patch,
});

test('Continue rows equal nextJobAction for the same facts, newest activity first', () => {
  const rows = [
    job(1), // valid match, no draft
    job(2), // pending suggestions; draft edited after the job
    job(3), // approved, current
    job(4), // approved, job changed since the draft
    job(5, { status: 'APPLIED' }), // applied, approved: nothing to do
    job(6, { followUpDate: '2026-11-01', status: 'APPLIED' }), // due follow-up
    job(7), // malformed saved review
  ];
  const progress = facts([
    { id: rows[0]!.id, matchStatus: 'VALID', draft: null },
    {
      id: rows[1]!.id,
      matchStatus: 'VALID',
      draft: draft({
        pending: 2,
        jobUpdatedAt: rows[1]!.updatedAt,
        updatedAt: '2026-11-09T00:00:00Z',
      }),
    },
    {
      id: rows[2]!.id,
      matchStatus: 'STALE_CV',
      draft: draft({ approved: true, jobUpdatedAt: rows[2]!.updatedAt }),
    },
    {
      id: rows[3]!.id,
      matchStatus: 'VALID',
      draft: draft({ approved: true, jobUpdatedAt: '2026-10-01T00:00:00Z' }),
    },
    { id: rows[4]!.id, matchStatus: 'VALID', draft: draft({ approved: true }) },
    { id: rows[5]!.id, matchStatus: 'MISSING', draft: null },
    { id: rows[6]!.id, matchStatus: 'VALID', draft: draft({ pending: null }) },
  ]);
  const items = continueItems(rows, progress, today);
  // Job 2's draft activity (Nov 9) outranks job 4's update (Nov 4).
  expect(items.map(({ job }) => job.title)).toEqual([
    'Synthetic job 2',
    'Synthetic job 4',
    'Synthetic job 3',
  ]);
  for (const { job: row, action } of items) {
    const fact = progress.jobs.find((f) => f.id === row.id)!;
    expect(action).toEqual(
      nextJobAction({
        followUp: null,
        status: row.status,
        cvSaved: true,
        sourceReason: reviewedCv.sourceReason,
        matchStatus: fact.matchStatus,
        draft: fact.draft && {
          pending: fact.draft.pending!,
          approved: fact.draft.approved,
          outdated: fact.draft.jobUpdatedAt !== row.updatedAt,
        },
      }),
    );
  }
  expect(items[0]!.action.label).toBe('Continue tailoring');
  expect(items[1]!.action.text).toMatch(/earlier version of this job/);
  expect(items[2]!.action.label).toBe('Open Approve & Export');
});

test('CV-level steps appear once in the banner, never as Continue rows', async () => {
  stub(
    () => Promise.resolve(Response.json([job(1), job(2)])),
    () =>
      Promise.resolve(
        Response.json(
          facts(
            [1, 2].map((n) => ({
              id: job(n).id,
              matchStatus: 'MISSING',
              draft: null,
            })),
            { saved: true, sourceReason: 'CV_DRAFT_PROFILE_INCOMPLETE' },
          ),
        ),
      ),
  );
  expect(
    await screen.findByRole('link', { name: 'Review in My CV' }),
  ).toHaveAttribute('href', '/cv');
  const panel = screen.getByRole('region', {
    name: 'Continue where you left off',
  });
  expect(
    within(panel).getByText('Nothing to continue right now.'),
  ).toBeVisible();
});

test('Continue links to the job tab and recovers from a failed progress read', async () => {
  let calls = 0;
  stub(
    () => Promise.resolve(Response.json([job(1)])),
    () =>
      Promise.resolve(
        ++calls === 1
          ? new Response(null, { status: 503 })
          : Response.json(
              facts([{ id: job(1).id, matchStatus: 'STALE_JOB', draft: null }]),
            ),
      ),
  );
  const panel = await screen.findByRole('region', {
    name: 'Continue where you left off',
  });
  // The rest of the Dashboard stays usable while Continue reports its error.
  expect(
    screen.getByRole('region', { name: 'Job search summary' }),
  ).toBeVisible();
  await userEvent
    .setup()
    .click(await within(panel).findByRole('button', { name: 'Retry' }));
  expect(
    await within(panel).findByRole('link', {
      name: 'Go to Match: Synthetic job 1',
    }),
  ).toHaveAttribute('href', `/jobs/${job(1).id}/match`);
});
