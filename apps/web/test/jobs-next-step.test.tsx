import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from './render';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { JobInbox } from '../src/features/inbox/JobInbox';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import type { Opportunity } from '../src/features/inbox/opportunities-api';
import {
  progressAction,
  progressChips,
} from '../src/features/inbox/next-action';
import type {
  JobProgress,
  JobProgressFact,
} from '../src/features/inbox/next-action';
import { continueItems } from '../src/features/home/home-sections';

const UPDATED = '2026-11-20T10:00:00.000Z';
const job = (id: string, extra: Partial<Opportunity> = {}): Opportunity => ({
  ...emptyOpportunity(),
  id,
  title: id,
  company: 'Synthetic company',
  ownerId: 'local',
  jdText: '',
  documentName: null,
  documentType: null,
  createdAt: UPDATED,
  updatedAt: UPDATED,
  ...extra,
});
const fact = (
  id: string,
  matchStatus: string,
  draft: JobProgressFact['draft'] = null,
): JobProgressFact => ({ id, matchStatus, draft });
const draft = (pending: number | null, approved = false) => ({
  pending,
  approved,
  jobUpdatedAt: UPDATED,
  updatedAt: UPDATED,
});
const reviewed = { saved: true, sourceReason: 'CV_DRAFT_MATCH_REQUIRED' };
const unreviewed = { saved: true, sourceReason: 'CV_DRAFT_PROFILE_NOT_FOUND' };

test.each([
  ['MISSING', null, 'match', 'Go to Match'],
  ['VALID', null, 'tailored-cv', 'Start tailored CV'],
  ['STALE_JOB', null, 'match', 'Go to Match'],
  ['VALID', draft(2), 'tailored-cv', 'Continue tailoring'],
  ['VALID', draft(0), 'tailored-cv', 'Review and approve'],
  ['VALID', draft(0, true), 'tailored-cv', 'Open Approve & Export'],
] as const)(
  'match %s with draft %j leads to %s',
  (matchStatus, saved, to, label) => {
    expect(
      progressAction(job('j'), fact('j', matchStatus, saved), reviewed, null),
    ).toMatchObject({ to, label });
  },
);

test('a due follow-up outranks every progress step', () => {
  expect(
    progressAction(job('j'), fact('j', 'VALID', draft(3)), reviewed, 'Overdue'),
  ).toMatchObject({ to: 'application' });
});

test('malformed draft review infers no step', () => {
  expect(
    progressAction(job('j'), fact('j', 'VALID', draft(null)), reviewed, null),
  ).toBeNull();
});

test('account-CV advice applies only when the default CV is provably the job CV', () => {
  // No pinned CV and no saved match: the job resolves to the default CV.
  expect(
    progressAction(job('j'), fact('j', 'MISSING'), unreviewed, null),
  ).toMatchObject({ to: '/cv' });
  // Pinned CV: default-CV review state says nothing; the job's own match decides.
  expect(
    progressAction(
      job('j', { cvId: 'pinned' }),
      fact('j', 'VALID'),
      unreviewed,
      null,
    ),
  ).toMatchObject({ to: 'tailored-cv', label: 'Start tailored CV' });
  // A saved match may use another CV: same, never "Review in My CV".
  expect(
    progressAction(job('j'), fact('j', 'STALE_CV'), unreviewed, null),
  ).toMatchObject({ to: 'match' });
  // Job CV missing while a default exists: nothing reliable to suggest.
  expect(
    progressAction(job('j'), fact('j', 'CV_UNAVAILABLE'), unreviewed, null),
  ).toBeNull();
  // No CV at all and none pinned: saving one is correct.
  expect(
    progressAction(
      job('j'),
      fact('j', 'CV_UNAVAILABLE'),
      { saved: false, sourceReason: null },
      null,
    ),
  ).toMatchObject({ to: '/cv', label: 'Open My CV' });
});

test.each([
  ['VALID', null, 'COMPLETED', 'NOT_STARTED'],
  ['STALE_CV', draft(2), 'OUTDATED', 'IN_PROGRESS'],
  ['EXPIRED', draft(0), 'OUTDATED', 'IN_PROGRESS'],
  ['MISSING', draft(0, true), 'NOT_STARTED', 'APPROVED'],
  ['CV_REVIEW_REQUIRED', draft(null), null, null],
  ['CV_UNAVAILABLE', null, null, 'NOT_STARTED'],
] as const)(
  'chips for match %s and draft %j',
  (matchStatus, saved, match, tailored) => {
    expect(progressChips(fact('j', matchStatus, saved))).toEqual({
      match,
      tailored,
    });
  },
);

test.each([
  // [case, job, fact, default CV, preview label | null, on Dashboard]
  [
    'default CV, no match',
    job('j'),
    fact('j', 'MISSING'),
    reviewed,
    'Go to Match',
    true,
  ],
  [
    'default CV unreviewed',
    job('j'),
    fact('j', 'MISSING'),
    unreviewed,
    'Review in My CV',
    false,
  ],
  [
    'own reviewed CV, default unreviewed',
    job('j', { cvId: 'own' }),
    fact('j', 'VALID'),
    unreviewed,
    'Start tailored CV',
    true,
  ],
  [
    'own CV, no match yet',
    job('j', { cvId: 'own' }),
    fact('j', 'MISSING'),
    unreviewed,
    'Go to Match',
    true,
  ],
  [
    'own CV needs review',
    job('j', { cvId: 'own' }),
    fact('j', 'CV_REVIEW_REQUIRED'),
    reviewed,
    'Go to Match',
    true,
  ],
  [
    'stale match',
    job('j'),
    fact('j', 'STALE_CV'),
    reviewed,
    'Go to Match',
    true,
  ],
  [
    'pending suggestions',
    job('j'),
    fact('j', 'VALID', draft(2)),
    reviewed,
    'Continue tailoring',
    true,
  ],
  [
    'approved, not applied yet',
    job('j'),
    fact('j', 'VALID', draft(0, true)),
    reviewed,
    'Open Approve & Export',
    true,
  ],
  [
    'approved and applied',
    job('j', { status: 'APPLIED' }),
    fact('j', 'VALID', draft(0, true)),
    reviewed,
    null,
    false,
  ],
  [
    'applied without a draft',
    job('j', { status: 'APPLIED' }),
    fact('j', 'VALID'),
    unreviewed,
    null,
    false,
  ],
  [
    'closed with a stale match',
    job('j', { status: 'CLOSED' }),
    fact('j', 'STALE_JOB'),
    reviewed,
    null,
    false,
  ],
] as const)(
  'Dashboard and Jobs agree: %s',
  (_, row, jobFact, cv, label, onDashboard) => {
    const preview = progressAction(row, jobFact, cv, null);
    expect(preview?.label ?? null).toBe(label);
    const items = continueItems([row], { cv, jobs: [jobFact] }, '2026-11-23');
    expect(items).toEqual(onDashboard ? [{ job: row, action: preview }] : []);
  },
);

type ProgressReply = JobProgress | 'fail' | 'malformed' | 'never';
function mount(rows: Opportunity[], progress: ProgressReply, path = '/jobs') {
  const fetch = vi.fn(async (url: string) => {
    if (url === '/api/v1/opportunities') return Response.json(rows);
    if (url.endsWith('/job-progress')) {
      if (progress === 'never') return new Promise<Response>(() => undefined);
      if (progress === 'fail')
        return Response.json({ message: 'x' }, { status: 500 });
      return Response.json(progress === 'malformed' ? { jobs: 3 } : progress);
    }
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const router = createMemoryRouter(
    [
      { path: '/jobs', element: <JobInbox /> },
      { path: '/jobs/:id/*', element: <p>Job page</p> },
      { path: '/cv', element: <p>My CV</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  const calls = (end: string) =>
    fetch.mock.calls.filter(([url]) => url.endsWith(end)).length;
  return { router, calls };
}
const steps = () =>
  screen.getByRole('heading', { name: 'Next step' }).parentElement!
    .parentElement!;
const progressFor = (...jobs: JobProgressFact[]): JobProgress => ({
  cv: reviewed,
  jobs,
});

test('preview shows the job-specific step, its tab and progress chips', async () => {
  mount(
    [job('Tailoring job')],
    progressFor(fact('Tailoring job', 'VALID', draft(2))),
    '/jobs?job=Tailoring+job',
  );
  await screen.findByRole('heading', { level: 2, name: 'Tailoring job' });
  expect(
    await within(steps()).findByText(
      'Decide 2 remaining suggestions in your tailored CV.',
    ),
  ).toBeVisible();
  expect(
    within(steps()).getByRole('link', { name: 'Continue tailoring' }),
  ).toHaveAttribute('href', '/jobs/Tailoring job/tailored-cv');
  const match = screen.getByRole('link', { name: /^CV Match/ });
  expect(within(match).getByText('Completed')).toBeVisible();
  const tailored = screen.getByRole('link', { name: /^Tailored CV/ });
  expect(within(tailored).getByText('In progress')).toBeVisible();
  const interview = screen.getByRole('link', { name: /^Interview practice/ });
  expect(within(interview).queryByText(/started|progress/i)).toBeNull();
});

test('a due follow-up keeps priority in the preview', async () => {
  mount(
    [
      job('Due job', {
        status: 'APPLIED',
        followUpDate: '2020-01-01',
      }),
    ],
    progressFor(fact('Due job', 'VALID', draft(2))),
    '/jobs?job=Due+job',
  );
  await screen.findByRole('heading', { level: 2, name: 'Due job' });
  expect(
    await within(steps()).findByRole('link', {
      name: 'Overdue: open Application for Due job',
    }),
  ).toHaveAttribute('href', '/jobs/Due job/application');
  expect(within(steps()).queryByText(/remaining suggestion/)).toBeNull();
});

test('CV-level advice opens My CV only for a job on the default CV', async () => {
  mount(
    [job('Fresh job'), job('Pinned job', { cvId: 'pinned' })],
    {
      cv: unreviewed,
      jobs: [fact('Fresh job', 'MISSING'), fact('Pinned job', 'VALID')],
    },
    '/jobs?job=Fresh+job',
  );
  await screen.findByRole('heading', { level: 2, name: 'Fresh job' });
  expect(
    await within(steps()).findByRole('link', { name: 'Review in My CV' }),
  ).toHaveAttribute('href', '/cv');
  fireEvent.click(screen.getByRole('button', { name: 'Back to jobs' }));
  fireEvent.click(await screen.findByRole('button', { name: /^Pinned job/ }));
  expect(
    await within(steps()).findByRole('link', { name: 'Start tailored CV' }),
  ).toHaveAttribute('href', '/jobs/Pinned job/tailored-cv');
});

test.each(['fail', 'malformed', 'never'] as const)(
  'progress %s keeps the list, generic advice and no chips',
  async (reply) => {
    mount([job('Plain job')], reply, '/jobs?job=Plain+job');
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Plain job' }),
    ).toBeVisible();
    await act(async () => undefined);
    expect(
      within(steps()).getByText(
        'Continue working on this job in its workspace.',
      ),
    ).toBeVisible();
    expect(
      within(steps()).getByRole('link', { name: 'Open job' }),
    ).toHaveAttribute('href', '/jobs/Plain job');
    expect(screen.queryByText('Not started')).toBeNull();
  },
);

test('a job missing from progress keeps generic advice', async () => {
  mount([job('New job')], progressFor(), '/jobs?job=New+job');
  await screen.findByRole('heading', { level: 2, name: 'New job' });
  await act(async () => undefined);
  expect(within(steps()).getByRole('link', { name: 'Open job' })).toBeVisible();
});

test('progress is fetched once per visit, not per selected job, and Back still works', async () => {
  const { router, calls } = mount(
    [job('First job'), job('Second job'), job('Third job')],
    progressFor(
      fact('First job', 'MISSING'),
      fact('Second job', 'VALID'),
      fact('Third job', 'VALID', draft(0, true)),
    ),
  );
  for (const title of ['First job', 'Second job', 'Third job']) {
    fireEvent.click(
      await screen.findByRole('button', { name: new RegExp(`^${title}`) }),
    );
    await screen.findByRole('heading', { level: 2, name: title });
    await act(() => router.navigate(-1));
    expect(router.state.location.search).toBe('');
  }
  expect(calls('/opportunities')).toBe(1);
  expect(calls('/job-progress')).toBe(1);
});
