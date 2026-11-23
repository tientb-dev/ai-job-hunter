import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from './render';
import {
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
} from 'react-router-dom';
import { JobInbox } from '../src/features/inbox/JobInbox';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import {
  dueFollowUp,
  localCalendarDate,
} from '../src/features/inbox/follow-ups';
import { previewRequirements } from '../src/features/inbox/job-display';

// Synthetic JD text reproducing wrapped lines and headings from real imports.
const SAMPLE_SKILLS = [
  'EDUCATION & KNOWLEDGE',
  "- Bachelor's degree in Business, Marketing or a related field",
  'RESPONSIBILITIES:',
  '- Build long-term relationships with luxury fashion and lifestyle',
  'brands',
  '- Reconnect with the existing customer base,',
  'including past clients who could re-sign',
  '- Negotiate and close partnership agreements',
  '- Fluent English communication',
].join('\n');
const SAMPLE_PREVIEW = [
  "Bachelor's degree in Business, Marketing or a related field",
  'Build long-term relationships with luxury fashion and lifestyle brands',
  'Reconnect with the existing customer base, including past clients who could re-sign',
  'Negotiate and close partnership agreements',
  'Fluent English communication',
];

const makeJob = (
  title: string,
  followUpDate: string | null,
  status = 'APPLIED',
) => ({
  ...emptyOpportunity(),
  id: title,
  title,
  status,
  followUpDate,
  company: 'Synthetic company',
  ownerId: 'local',
  jdText: '',
  documentName: null,
  documentType: null,
  createdAt: '',
  updatedAt: '',
});
const titles = () =>
  within(screen.getByRole('list', { name: 'Saved opportunities' }))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('p')!.textContent);
const openCard = (title: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^${title}`) }),
  );
// The job list itself is fetched once; job-progress is a separate single call.
const listCalls = (fetch: { mock: { calls: unknown[][] } }) =>
  fetch.mock.calls.filter(([url]) => url === '/api/v1/opportunities').length;
function mount(rows: ReturnType<typeof makeJob>[], path = '/jobs') {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async (url) => {
      if (url.endsWith('/cv/current')) return Response.json(null);
      return Response.json(
        url === '/api/v1/opportunities'
          ? rows
          : rows.find((row) => url.endsWith(`/${row.id}`)),
      );
    },
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs" element={<JobInbox />} />
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, fetch };
}

test.each([
  ['2026-12-31', '2027-01-01', 'Overdue'],
  ['2027-01-01', '2027-01-01', 'Due today'],
  ['2027-01-02', '2027-01-01', null],
  [null, '2027-01-01', null],
  ['2024-02-29', '2024-03-01', 'Overdue'],
  ['2024-03-01', '2024-02-29', null],
])('classifies %s relative to local day %s', (date, today, expected) => {
  expect(dueFollowUp(date, 'APPLIED', today, 'PENDING')).toBe(expected);
});

test.each(['REJECTED', 'CLOSED'])(
  'excludes %s even with overdue or today dates',
  (status) => {
    expect(
      dueFollowUp('2026-12-31', status, '2027-01-01', 'PENDING'),
    ).toBeNull();
    expect(
      dueFollowUp('2027-01-01', status, '2027-01-01', 'PENDING'),
    ).toBeNull();
  },
);

test.each(['DONE', 'DISMISSED'])(
  'excludes %s follow-ups even when overdue',
  (followUpStatus) => {
    expect(
      dueFollowUp('2026-12-31', 'APPLIED', '2027-01-01', followUpStatus),
    ).toBeNull();
  },
);

test('uses local calendar components near midnight rather than UTC ISO date', () => {
  expect(localCalendarDate(new Date(2027, 0, 1, 0, 1))).toBe('2027-01-01');
  expect(localCalendarDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  expect(localCalendarDate(new Date(2024, 1, 29, 0, 1))).toBe('2024-02-29');
});

test('filters due items in existing order, preserves excluded dates and opens Application directly', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2027, 0, 1, 12));
  const rows = [
    makeJob('Today job', '2027-01-01'),
    makeJob('Future job', '2027-01-02'),
    makeJob('Overdue job', '2026-12-31'),
    makeJob('Missing job', null),
    makeJob('Rejected job', '2026-12-30', 'REJECTED'),
    makeJob('Closed job', '2027-01-01', 'CLOSED'),
  ];
  const snapshot = JSON.stringify(rows);
  const { fetch } = mount(rows);
  await screen.findByText('Today job');
  expect(screen.getByText('Overdue')).toBeVisible();
  expect(screen.getByText('Due today')).toBeVisible();
  expect(screen.getByText('2027-01-02')).toBeVisible();
  expect(screen.queryByText('—')).not.toBeInTheDocument();
  expect(screen.getByText('2026-12-30')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /^Due follow-ups/ }));
  expect(screen.queryByText('Future job')).not.toBeInTheDocument();
  expect(screen.queryByText('Missing job')).not.toBeInTheDocument();
  expect(screen.queryByText('Rejected job')).not.toBeInTheDocument();
  expect(screen.queryByText('Closed job')).not.toBeInTheDocument();
  expect(titles()).toEqual(['Today job', 'Overdue job']);
  fireEvent.click(screen.getByRole('button', { name: /^All jobs/ }));
  expect(screen.getByText('Rejected job')).toBeVisible();
  expect(screen.getByText('2026-12-30')).toBeVisible();
  openCard('Today job');
  fireEvent.click(
    screen.getByRole('link', {
      name: 'Due today: open Application for Today job',
    }),
  );
  await screen.findByRole('tab', { name: /^Application/ });
  expect(screen.getByRole('tab', { name: /^Application/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByLabelText('Next follow-up date')).toHaveValue(
    '2027-01-01',
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(JSON.stringify(rows)).toBe(snapshot);
  expect(
    fetch.mock.calls.every(
      // Draft list (tab badge) and job-progress are read-only POSTs.
      ([url, init]) =>
        !init?.method ||
        init.method === 'GET' ||
        String(url).endsWith('/drafts/list') ||
        String(url).endsWith('/job-progress'),
    ),
  ).toBe(true);
});

test('refreshes filtered results across local midnight and after a suspended page resumes', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
  const view = mount([makeJob('Tomorrow job', '2027-01-01')]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  fireEvent.click(screen.getByRole('button', { name: /^Due follow-ups/ }));
  expect(screen.getByText('No due follow-ups')).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(screen.getByText('Tomorrow job')).toBeVisible();
  expect(screen.getByText('Due today')).toBeVisible();
  vi.setSystemTime(new Date(2027, 0, 2, 9));
  fireEvent(window, new Event('focus'));
  expect(screen.getByText('Overdue')).toBeVisible();
  vi.setSystemTime(new Date(2027, 0, 1, 12));
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByText('Due today')).toBeVisible();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('paginates ten jobs, filters before slicing, resets pages, and keeps navigation without refetching', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2027, 0, 1, 12));
  const rows = Array.from({ length: 25 }, (_, index) =>
    makeJob(
      `Job ${String(index + 1).padStart(2, '0')}`,
      index % 2 ? '2027-01-02' : '2027-01-01',
    ),
  );
  const { fetch } = mount(rows);
  await screen.findByText('Job 01');
  expect(titles()).toEqual(rows.slice(0, 10).map((row) => row.title));
  expect(screen.getByText('1–10 of 25 jobs')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Go to previous page' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  expect(titles()).toEqual(rows.slice(10, 20).map((row) => row.title));
  expect(screen.getByText('11–20 of 25 jobs')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  expect(titles()).toEqual(rows.slice(20).map((row) => row.title));
  expect(screen.getByText('21–25 of 25 jobs')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Go to next page' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Go to previous page' }));
  fireEvent.click(screen.getByRole('button', { name: /^Due follow-ups/ }));
  const due = rows.filter((_, index) => index % 2 === 0);
  expect(screen.getByText('1–10 of 13 jobs')).toBeVisible();
  expect(titles()).toEqual(due.slice(0, 10).map((row) => row.title));
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  expect(screen.getByText('11–13 of 13 jobs')).toBeVisible();
  expect(titles()).toEqual(due.slice(10).map((row) => row.title));
  fireEvent.click(screen.getByRole('button', { name: /^All jobs/ }));
  expect(screen.getByText('1–10 of 25 jobs')).toBeVisible();
  expect(listCalls(fetch)).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  openCard('Job 11');
  expect(screen.getByRole('heading', { name: 'Job 11' })).toBeVisible();
  fireEvent.click(
    screen.getByRole('link', {
      name: 'Due today: open Application for Job 11',
    }),
  );
  await screen.findByRole('tab', { name: /^Application/ });
  expect(screen.getByRole('tab', { name: /^Application/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('keeps the list and filter focus when filtering to no results', async () => {
  const { fetch } = mount([makeJob('No date', null)]);
  await screen.findByText('No date');
  const list = screen.getByRole('list', { name: 'Saved opportunities' });
  const filterButton = screen.getByRole('button', { name: /^Due follow-ups/ });
  filterButton.focus();
  fireEvent.click(filterButton);
  expect(screen.getByText('0–0 of 0 jobs')).toBeVisible();
  expect(screen.getByText('No due follow-ups')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Saved opportunities' })).toBe(list);
  expect(filterButton).toHaveFocus();
  expect(
    screen.getByRole('button', { name: 'Go to next page' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Go to previous page' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /^All jobs/ }));
  expect(screen.getByText('1–1 of 1 jobs')).toBeVisible();
  expect(screen.getByRole('list', { name: 'Saved opportunities' })).toBe(list);
  expect(listCalls(fetch)).toBe(1);
});

test('Inbox has no discovery panel and keeps grouped controls and bottom pagination', async () => {
  const { fetch } = mount([]);
  await screen.findByText('No saved opportunities yet');
  expect(
    screen.queryByRole('button', { name: 'Toggle Discover Jobs' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Discovery location')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Discover jobs' })).toHaveAttribute(
    'href',
    '/discover',
  );
  const section = screen.getByRole('region', { name: 'Saved jobs (0)' });
  expect(
    within(section).getByRole('link', { name: 'Add job' }),
  ).toHaveAttribute('href', '/jobs/new');
  expect(
    within(section).getByRole('button', { name: /^All jobs/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  const list = within(section).getByRole('list');
  const pagination = within(section).getByLabelText('Jobs pagination');
  expect(
    list.compareDocumentPosition(pagination) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(listCalls(fetch)).toBe(1);
});

test('keeps original links accessible for manual jobs and clears an empty filter locally', async () => {
  const job = {
    ...makeJob('Manual job', null),
    originalLink: 'https://example.com/jobs/1',
  };
  const { fetch } = mount([job]);
  await screen.findByText('Manual job');
  openCard('Manual job');
  expect(
    screen.getByRole('link', { name: 'Original job / apply for Manual job' }),
  ).toHaveAttribute('href', job.originalLink);
  fireEvent.click(screen.getByRole('button', { name: 'Back to jobs' }));
  fireEvent.click(screen.getByRole('button', { name: /^Due follow-ups/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(screen.getByText('Manual job')).toBeVisible();
  expect(listCalls(fetch)).toBe(1);
});

test('compact rows omit missing follow-ups and discovery detail controls', async () => {
  const job = {
    ...makeJob('Compact job', null),
    discovery: {
      sourceName: 'Synthetic feed',
      discoveredAt: '2026-11-01T00:00:00Z',
      techStack: ['Synthetic technology'],
    },
  };
  mount([job]);
  const row = await screen.findByRole('button', { name: /^Compact job/ });
  expect(within(row).getByText('Synthetic company')).toBeVisible();
  expect(within(row).getByText('Synthetic feed')).toBeVisible();
  expect(
    within(row).queryByText(
      /Follow-up|Source details|Synthetic technology|Discovered/,
    ),
  ).not.toBeInTheDocument();
  expect(row.querySelector('details')).toBeNull();
  const region = screen.getByRole('region', { name: 'Scrollable saved jobs' });
  expect(region).toContainElement(row);
  expect(region).not.toContainElement(screen.getByLabelText('Jobs pagination'));
  expect(region).not.toContainElement(
    screen.getByRole('button', { name: /^Due follow-ups/ }),
  );
});

test('search covers every saved job, ignores accents, and keeps the filter', async () => {
  const rows = Array.from({ length: 15 }, (_, index) =>
    makeJob(`Job ${String(index + 1).padStart(2, '0')}`, null),
  );
  rows[13] = { ...rows[13]!, title: 'Kỹ sư dữ liệu', company: 'Công ty Đông' };
  const { fetch } = mount(rows);
  await screen.findByText('Job 01');
  const search = screen.getByRole('searchbox', { name: 'Search jobs' });
  fireEvent.change(search, { target: { value: 'ky su' } });
  expect(titles()).toEqual(['Kỹ sư dữ liệu']);
  fireEvent.change(search, { target: { value: 'dong' } });
  expect(titles()).toEqual(['Kỹ sư dữ liệu']);
  fireEvent.click(screen.getByRole('button', { name: /^Due follow-ups/ }));
  expect(screen.getByText('No jobs match your search')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('No due follow-ups')).toBeVisible();
  expect(listCalls(fetch)).toBe(1);
});

test('preview shows complete requirements and links to the full overview', async () => {
  const job = { ...makeJob('Skilled job', null), skills: SAMPLE_SKILLS };
  mount([job]);
  await screen.findByText('Skilled job');
  openCard('Skilled job');
  const section = screen.getByRole('heading', { name: 'Requirements & skills' })
    .parentElement!.parentElement!;
  expect(
    within(section)
      .getAllByRole('listitem')
      .map((li) => li.textContent),
  ).toEqual(SAMPLE_PREVIEW);
  expect(within(section).queryByText('More in Job Overview')).toBeNull();
  expect(
    within(section).getByRole('link', { name: 'View full requirements' }),
  ).toHaveAttribute('href', '/jobs/Skilled job');
});

test('preview drops headings and fragments instead of filling slots', () => {
  expect(previewRequirements([SAMPLE_SKILLS])).toEqual(SAMPLE_PREVIEW);
  expect(
    previewRequirements([
      'EDUCATION & KNOWLEDGE\nbrands\nincluding past clients who could re-sign',
    ]),
  ).toEqual([]);
  expect(previewRequirements(['SQL\nExcel'])).toEqual(['SQL', 'Excel']);
});

test('preview handles jobs without requirements', async () => {
  mount([makeJob('Bare job', null)]);
  await screen.findByText('Bare job');
  openCard('Bare job');
  expect(screen.getByText('No requirements found yet.')).toBeVisible();
});

function mountRouter(rows: ReturnType<typeof makeJob>[], path = '/jobs') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(url === '/api/v1/opportunities' ? rows : null),
    ),
  );
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Previous page</p> },
      { path: '/jobs', element: <JobInbox /> },
      { path: '/jobs/:id/*', element: <p>Job page</p> },
    ],
    { initialEntries: ['/', path], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  const at = () =>
    router.state.location.pathname + router.state.location.search;
  return { router, at };
}
const twoJobs = () => [makeJob('First job', null), makeJob('Second job', null)];

test('mobile selection lives in ?job so Back and Forward switch list and detail without leaving Jobs', async () => {
  const { router, at } = mountRouter(twoJobs());
  await screen.findByText('Second job');
  openCard('Second job');
  expect(at()).toBe('/jobs?job=Second+job');
  expect(
    await screen.findByRole('heading', { level: 2, name: 'Second job' }),
  ).toHaveFocus();
  await act(() => router.navigate(-1));
  expect(at()).toBe('/jobs');
  expect(
    screen.getByRole('list', { name: 'Saved opportunities' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: /^Second job/ })).toHaveFocus();
  await act(() => router.navigate(1));
  expect(
    screen.getByRole('heading', { level: 2, name: 'Second job' }),
  ).toBeVisible();
  // In-page Back pops our own entry instead of stacking a new one.
  fireEvent.click(screen.getByRole('button', { name: 'Back to jobs' }));
  await screen.findByRole('list', { name: 'Saved opportunities' });
  expect(at()).toBe('/jobs');
  await act(() => router.navigate(-1));
  expect(at()).toBe('/');
});

test('a direct ?job link opens that job and in-page Back stays on Jobs', async () => {
  const { at } = mountRouter(twoJobs(), '/jobs?job=First+job');
  expect(
    await screen.findByRole('heading', { level: 2, name: 'First job' }),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open job' })).toHaveAttribute(
    'href',
    '/jobs/First job',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Back to jobs' }));
  await screen.findByRole('list', { name: 'Saved opportunities' });
  expect(at()).toBe('/jobs');
});

test.each(['Deleted job', ''])(
  'an unknown or empty ?job (%j) shows the list and is dropped from the URL',
  async (job) => {
    const { at } = mountRouter(twoJobs(), `/jobs?job=${job}`);
    await screen.findByRole('list', { name: 'Saved opportunities' });
    expect(screen.queryByRole('button', { name: 'Back to jobs' })).toBeNull();
    await vi.waitFor(() => expect(at()).toBe('/jobs'));
  },
);

test('desktop selection replaces the URL entry instead of adding history', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const { router, at } = mountRouter(twoJobs());
  await screen.findByRole('heading', { level: 2, name: 'First job' });
  openCard('Second job');
  expect(at()).toBe('/jobs?job=Second+job');
  expect(
    screen.getByRole('heading', { level: 2, name: 'Second job' }),
  ).toBeVisible();
  await act(() => router.navigate(-1));
  expect(at()).toBe('/');
});
