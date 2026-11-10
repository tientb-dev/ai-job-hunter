import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, within } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Home } from '../src/features/home/Home';
import { homeSections } from '../src/features/home/home-sections';
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

test('due follow-ups come oldest first and never repeat in Recently updated', () => {
  const rows = [
    job(1, { followUpDate: '2026-11-10', status: 'APPLIED' }),
    job(2, { followUpDate: '2026-11-03', status: 'APPLIED' }),
    job(3, { followUpDate: '2026-11-11', status: 'APPLIED' }), // future
    job(4, { followUpDate: '2026-11-01', status: 'CLOSED' }), // inactive
    job(5),
  ];
  const { due, recent, counts } = homeSections(rows, today);
  expect(due.map(({ job, label }) => [job.title, label])).toEqual([
    ['Synthetic job 2', 'Overdue'],
    ['Synthetic job 1', 'Due today'],
  ]);
  expect(recent.map((row) => row.title)).toEqual([
    'Synthetic job 5',
    'Synthetic job 4',
    'Synthetic job 3',
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

function stub(jobs: () => Promise<Response>, cv: unknown = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/cv/current') ? Promise.resolve(Response.json(cv)) : jobs(),
    ),
  );
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

test('shows sections, CV guidance only without a CV, and links to the application', async () => {
  stub(() =>
    Promise.resolve(
      Response.json([
        job(1, { followUpDate: '2026-01-01', status: 'APPLIED' }),
        job(2),
      ]),
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
  expect(
    within(
      screen.getByRole('region', { name: 'Recently updated' }),
    ).getAllByRole('listitem'),
  ).toHaveLength(1);
  const summary = screen.getByRole('region', { name: 'Job search summary' });
  expect(within(summary).getByText('Follow-ups due')).toBeVisible();
  expect(within(summary).getByText('1 overdue')).toBeVisible();
  expect(await screen.findByRole('link', { name: 'Open My CV' })).toBeVisible();
});

test('hides CV guidance when a CV exists and shows the empty state', async () => {
  stub(() => Promise.resolve(Response.json([])), { id: 'cv' });
  expect(
    await screen.findByRole('heading', { name: 'No jobs yet' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Open My CV' }),
  ).not.toBeInTheDocument();
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
    await screen.findByRole('link', { name: 'Synthetic job 1' }),
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
