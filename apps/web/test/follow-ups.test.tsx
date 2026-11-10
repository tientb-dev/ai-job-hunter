import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from './render';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobInbox } from '../src/features/inbox/JobInbox';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import {
  dueFollowUp,
  localCalendarDate,
} from '../src/features/inbox/follow-ups';

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
  expect(dueFollowUp(date, 'APPLIED', today)).toBe(expected);
});

test.each(['REJECTED', 'CLOSED'])(
  'excludes %s even with overdue or today dates',
  (status) => {
    expect(dueFollowUp('2026-12-31', status, '2027-01-01')).toBeNull();
    expect(dueFollowUp('2027-01-01', status, '2027-01-01')).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Due follow-ups' }));
  expect(screen.queryByText('Future job')).not.toBeInTheDocument();
  expect(screen.queryByText('Missing job')).not.toBeInTheDocument();
  expect(screen.queryByText('Rejected job')).not.toBeInTheDocument();
  expect(screen.queryByText('Closed job')).not.toBeInTheDocument();
  const table = screen.getByRole('table');
  expect(
    within(table)
      .getAllByRole('row')
      .map((row) => within(row).getAllByRole('link')[0]!.textContent),
  ).toEqual(['Today job', 'Overdue job']);
  fireEvent.click(screen.getByRole('button', { name: 'All jobs' }));
  expect(screen.getByText('Rejected job')).toBeVisible();
  expect(screen.getByText('2026-12-30')).toBeVisible();
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
      // The workspace tab badge reads the draft list through a read-only POST.
      ([url, init]) =>
        !init?.method ||
        init.method === 'GET' ||
        String(url).endsWith('/drafts/list'),
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
  fireEvent.click(screen.getByRole('button', { name: 'Due follow-ups' }));
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
  const titles = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .map((row) => within(row).getAllByRole('link')[0]!.textContent);
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
  fireEvent.click(screen.getByRole('button', { name: 'Due follow-ups' }));
  const due = rows.filter((_, index) => index % 2 === 0);
  expect(screen.getByText('1–10 of 13 jobs')).toBeVisible();
  expect(titles()).toEqual(due.slice(0, 10).map((row) => row.title));
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  expect(screen.getByText('11–13 of 13 jobs')).toBeVisible();
  expect(titles()).toEqual(due.slice(10).map((row) => row.title));
  fireEvent.click(screen.getByRole('button', { name: 'All jobs' }));
  expect(screen.getByText('1–10 of 25 jobs')).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
  expect(screen.getByRole('link', { name: 'Job 11' })).toHaveAttribute(
    'href',
    '/jobs/Job 11',
  );
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

test('keeps the table and filter focus when filtering to no results', async () => {
  const { fetch } = mount([makeJob('No date', null)]);
  await screen.findByText('No date');
  const table = screen.getByRole('table');
  const filterButton = screen.getByRole('button', { name: 'Due follow-ups' });
  filterButton.focus();
  fireEvent.click(filterButton);
  expect(screen.getByText('0–0 of 0 jobs')).toBeVisible();
  expect(screen.getByText('No due follow-ups')).toBeVisible();
  expect(screen.getByRole('table')).toBe(table);
  expect(filterButton).toHaveFocus();
  expect(
    screen.getByRole('button', { name: 'Go to next page' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Go to previous page' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'All jobs' }));
  expect(screen.getByText('1–1 of 1 jobs')).toBeVisible();
  expect(screen.getByRole('table')).toBe(table);
  expect(fetch).toHaveBeenCalledTimes(1);
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
    within(section).getByRole('button', { name: 'All jobs' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const table = within(section).getByRole('table');
  const pagination = within(section).getByLabelText('Jobs pagination');
  expect(
    table.compareDocumentPosition(pagination) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('keeps original links accessible for manual jobs and clears an empty filter locally', async () => {
  const job = {
    ...makeJob('Manual job', null),
    originalLink: 'https://example.com/jobs/1',
  };
  const { fetch } = mount([job]);
  await screen.findByText('Manual job');
  expect(
    screen.getByRole('link', { name: 'Original job / apply for Manual job' }),
  ).toHaveAttribute('href', job.originalLink);
  fireEvent.click(screen.getByRole('button', { name: 'Due follow-ups' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(screen.getByRole('link', { name: 'Manual job' })).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);
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
  const title = await screen.findByRole('link', { name: 'Compact job' });
  const row = title.closest('tr')!;
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
    screen.getByRole('button', { name: 'Due follow-ups' }),
  );
});
