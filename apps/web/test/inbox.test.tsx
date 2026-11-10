import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor } from './render';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobInbox } from '../src/features/inbox/JobInbox';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
const id = '00000000-0000-4000-8000-123456789012';
const row = {
  ...emptyOpportunity(),
  id,
  ownerId: 'local',
  title: 'Synthetic engineer',
  company: 'Example Company',
  source: 'Email',
  followUpDate: '2026-11-02',
  createdAt: '2026-10-30',
  updatedAt: '2026-10-30',
};
function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs" element={<JobInbox />} />
        <Route path="/jobs/new" element={<JobEditor />} />
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}
test('lists persisted jobs again after remount (refresh)', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([row])));
  vi.stubGlobal('fetch', fetch);
  const first = mount('/jobs');
  expect(await screen.findByText('Synthetic engineer')).toBeVisible();
  expect(
    screen.queryByText('2026-11-02') ?? screen.getByTitle('2026-11-02'),
  ).toBeVisible();
  first.unmount();
  fetch.mockResolvedValue(new Response(JSON.stringify([row])));
  mount('/jobs');
  expect(await screen.findByText('Synthetic engineer')).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});
test('adds a job, sends persistent fields, then loads its detail', async () => {
  const fetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === 'POST' ? row : row)),
  );
  vi.stubGlobal('fetch', fetch);
  mount('/jobs/new');
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: row.title },
  });
  fireEvent.change(screen.getByLabelText(/^Company/), {
    target: { value: row.company },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  await screen.findByRole('heading', { name: 'Job overview' });
  const sent = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(sent).toMatchObject({
    title: row.title,
    company: row.company,
    contactDates: [],
    followUpDate: null,
    status: 'SAVED',
  });
});
test('edits notes and follow-up date and keeps input on save failure', async () => {
  const fetch = vi.fn(
    async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'PUT' ? { message: 'Invalid opportunity' } : row,
        ),
        { status: init?.method === 'PUT' ? 400 : 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue('Synthetic engineer');
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Synthetic call notes' },
  });
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-03' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/Invalid opportunity/);
  expect(screen.getByLabelText('Application notes')).toHaveValue(
    'Synthetic call notes',
  );
  const save = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(save[1]!.body as string)).toMatchObject({
    notes: 'Synthetic call notes',
    followUpDate: '2026-11-03',
  });
});

test('changes status freely and sends the selected status to the API', async () => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => Response.json(row),
  );
  vi.stubGlobal('fetch', fetch);
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue('Synthetic engineer');
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Application status' }),
  );
  await userEvent.click(screen.getByRole('option', { name: 'OFFER' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(
    JSON.parse(
      fetch.mock.calls.find(([, init]) => init?.method === 'PUT')![1]!
        .body as string,
    ).status,
  ).toBe('OFFER');
});

test('last HR contact survives create, save, reopen and replacement without changing follow-up', async () => {
  let saved = {
    ...row,
    contactDates: [] as string[],
    notes: '',
    status: 'SAVED',
  };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PUT')
      saved = { ...saved, ...JSON.parse(init.body as string) };
    return Response.json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  let view = mount('/jobs/new');
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Synthetic date job' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  await screen.findByRole('heading', { name: 'Job overview' });
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  fireEvent.change(screen.getByLabelText('Last HR contact date'), {
    target: { value: '2026-10-30' },
  });
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-02' },
  });
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Synthetic tracking notes' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved.contactDates).toEqual(['2026-10-30']);
  view.unmount();
  view = mount(`/jobs/${id}`);
  await waitFor(() =>
    expect(screen.getByLabelText('Last HR contact date')).toHaveValue(
      '2026-10-30',
    ),
  );
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  // Correct the current entry, rather than append another contact date.
  fireEvent.change(screen.getByLabelText('Last HR contact date'), {
    target: { value: '2026-10-29' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved.contactDates).toEqual(['2026-10-29']);
  expect(saved).toMatchObject({
    title: 'Synthetic date job',
    notes: 'Synthetic tracking notes',
    followUpDate: '2026-11-02',
    status: 'SAVED',
  });
  view.unmount();
  mount(`/jobs/${id}`);
  await waitFor(() =>
    expect(screen.getByLabelText('Last HR contact date')).toHaveValue(
      '2026-10-29',
    ),
  );
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  expect(screen.getByLabelText('Application notes')).toHaveValue(
    'Synthetic tracking notes',
  );
  expect(screen.getByLabelText('Next follow-up date')).toHaveValue(
    '2026-11-02',
  );
});

test.each([
  {
    name: 'edits latest from unsorted history',
    dates: ['2026-10-20', '2026-10-30', '2026-10-10'],
    value: '2026-10-29',
    expected: ['2026-10-20', '2026-10-10', '2026-10-29'],
    latest: '2026-10-29',
  },
  {
    name: 'clears only latest from unsorted history',
    dates: ['2026-10-20', '2026-10-30', '2026-10-10'],
    value: '',
    expected: ['2026-10-20', '2026-10-10'],
    latest: '2026-10-20',
  },
  {
    name: 'deduplicates when replacing with an earlier stored date',
    dates: ['2026-10-20', '2026-10-30', '2026-10-10'],
    value: '2026-10-20',
    expected: ['2026-10-20', '2026-10-10'],
    latest: '2026-10-20',
  },
  {
    name: 'corrects latest to before earlier history',
    dates: ['2026-10-20', '2026-10-30', '2026-10-10'],
    value: '2026-10-05',
    expected: ['2026-10-20', '2026-10-10', '2026-10-05'],
    latest: '2026-10-20',
  },
  {
    name: 'adds the first date',
    dates: [],
    value: '2026-10-25',
    expected: ['2026-10-25'],
    latest: '2026-10-25',
  },
])(
  '$name and preserves unrelated fields after save/reload',
  async ({ dates, value, expected, latest }) => {
    let saved = {
      ...row,
      contactDates: dates,
      appliedDate: '2026-10-01',
      status: 'APPLIED',
      notes: 'Private synthetic notes',
      contactNotes: 'Separate recruiter notes',
    };
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          if (fail)
            return Response.json({ message: 'Save failed' }, { status: 503 });
          saved = { ...saved, ...JSON.parse(init.body as string) };
        }
        return Response.json(saved);
      }),
    );
    const view = mount(`/jobs/${id}`);
    await screen.findByDisplayValue(row.title);
    fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
    expect(screen.getByLabelText('Last HR contact date')).toHaveValue(
      [...dates].sort().at(-1) ?? '',
    );
    fireEvent.change(screen.getByLabelText('Last HR contact date'), {
      target: { value },
    });
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
    expect(screen.getByLabelText('Last HR contact date')).toHaveValue(value);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Could not save or load opportunities/);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(saved.contactDates).toEqual(dates);
    expect(screen.getByLabelText('Last HR contact date')).toHaveValue(value);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved');
    expect(saved.contactDates).toEqual(expected);
    expect(saved).toMatchObject({
      status: 'APPLIED',
      appliedDate: '2026-10-01',
      followUpDate: row.followUpDate,
      notes: 'Private synthetic notes',
      contactNotes: 'Separate recruiter notes',
      source: row.source,
    });
    expect(screen.getByText('Unsaved changes')).not.toBeVisible();
    view.unmount();
    mount(`/jobs/${id}`);
    await screen.findByDisplayValue(row.title);
    fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
    expect(screen.getByLabelText('Last HR contact date')).toHaveValue(latest);
  },
);

test('application details set, reopen, edit, survive failure and clear independently', async () => {
  let saved = { ...row };
  let fail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        if (fail)
          return Response.json({ message: 'Save failed' }, { status: 503 });
        saved = { ...saved, ...JSON.parse(init.body as string) };
      }
      return Response.json(saved);
    }),
  );
  let view = mount(`/jobs/${id}`);
  await screen.findByDisplayValue(row.title);
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-05' },
  });
  fireEvent.change(screen.getByLabelText('Applied date'), {
    target: { value: '2024-02-29' },
  });
  fireEvent.change(screen.getByLabelText('Application channel'), {
    target: { value: 'Referral' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved).toMatchObject({
    appliedDate: '2024-02-29',
    applicationChannel: 'Referral',
    source: 'Email',
    status: 'SAVED',
    contactDates: [],
    followUpDate: '2026-11-05',
  });
  view.unmount();
  view = mount(`/jobs/${id}`);
  await screen.findByDisplayValue('Referral');
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  expect(screen.getByLabelText('Applied date')).toHaveValue('2024-02-29');
  fail = true;
  fireEvent.change(screen.getByLabelText('Applied date'), {
    target: { value: '2026-10-30' },
  });
  fireEvent.change(screen.getByLabelText('Application channel'), {
    target: { value: 'TopCV' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/Could not save or load opportunities/);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByLabelText('Applied date')).toHaveValue('2026-10-30');
  expect(screen.getByLabelText('Application channel')).toHaveValue('TopCV');
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved).toMatchObject({
    appliedDate: '2026-10-30',
    applicationChannel: 'TopCV',
  });
  fireEvent.change(screen.getByLabelText('Applied date'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Application channel'), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText('Last HR contact date'), {
    target: { value: '2026-10-31' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved).toMatchObject({
    appliedDate: null,
    applicationChannel: null,
    followUpDate: '2026-11-05',
    status: 'SAVED',
    contactDates: ['2026-10-31'],
  });
  view.unmount();
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue(row.title);
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  expect(screen.getByLabelText('Applied date')).toHaveValue('');
  expect(screen.getByLabelText('Application channel')).toHaveValue('');
});

test('preserves full contact history on unrelated saves and replaces within the 100-date limit', async () => {
  const dates = Array.from({ length: 100 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  ).reverse();
  let saved = { ...row, contactDates: dates };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT')
        saved = { ...saved, ...JSON.parse(init.body as string) };
      return Response.json(saved);
    }),
  );
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue(row.title);
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Synthetic note' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved.contactDates).toEqual(dates);
  fireEvent.change(screen.getByLabelText('Last HR contact date'), {
    target: { value: '2026-10-25' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(saved.contactDates).toHaveLength(100);
  expect(new Set(saved.contactDates).size).toBe(100);
  expect(saved.contactDates).toEqual([...dates.slice(1), '2026-10-25']);
});

test('dirty chip stays in metadata and save success is a dismissible notification that auto-hides', async () => {
  let saved = { ...row };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT')
        saved = { ...saved, ...JSON.parse(init.body as string) };
      return Response.json(saved);
    }),
  );
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue(row.title);
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  const chip = screen.getByText('Unsaved changes').closest('.MuiChip-root')!;
  const metadata = chip.parentElement;
  const tabs = screen.getByRole('tablist');
  expect(chip).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Updated notes' },
  });
  expect(chip).toBeVisible();
  expect(chip.parentElement).toBe(metadata);
  expect(metadata).not.toHaveTextContent('Unknown seniority');
  expect(screen.getByRole('tablist')).toBe(tabs);
  vi.useFakeTimers();
  try {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Changes saved');
    expect(screen.getByRole('status').closest('.MuiSnackbar-root')).toHaveStyle(
      {
        position: 'fixed',
      },
    );
    expect(screen.getByRole('status').closest('#job-editor-form')).toBeNull();
    expect(chip).not.toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Second edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() =>
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument(),
  );
});

test('save failure persists until dismissed, preserves edits and blocks duplicate submissions', async () => {
  let rejectSave!: () => void;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT')
      return new Promise<Response>((resolve) => {
        rejectSave = () =>
          resolve(
            Response.json(
              { message: 'Synthetic validation details' },
              { status: 400 },
            ),
          );
      });
    return Response.json(row);
  });
  vi.stubGlobal('fetch', fetch);
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue(row.title);
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  const notes = screen.getByLabelText('Application notes');
  fireEvent.change(notes, { target: { value: 'Keep this edit' } });
  const form = notes.closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === 'PUT'),
  ).toHaveLength(1);
  await act(async () => rejectSave());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Synthetic validation details');
  expect(alert).toHaveTextContent('Your inputs are retained');
  expect(alert.closest('.MuiSnackbar-root')).not.toBeNull();
  vi.useFakeTimers();
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(alert).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(
    screen.queryByText(/Synthetic validation details/),
  ).not.toBeInTheDocument();
  expect(notes).toHaveValue('Keep this edit');
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('empty Inbox keeps primary Add and outlined task navigation alternatives', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
  mount('/jobs');
  await screen.findByText('No saved opportunities yet');
  expect(screen.getByRole('link', { name: 'Discover Jobs' })).toHaveClass(
    'MuiButton-outlined',
  );
  const add = screen.getAllByRole('link', { name: 'Add Job' });
  expect(add).toHaveLength(2);
  expect(add[0]).toHaveClass('MuiButton-contained');
  expect(add[1]).toHaveClass('MuiButton-outlined');
});
