import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within, waitFor } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DiscoverJobs } from '../src/features/inbox/DiscoverJobs';

const sources = ['Axon', 'Backbase', 'Temus', 'Go1 Vietnam'].map(
  (name, index) => ({
    sourceKey: `greenhouse:test${index}`,
    sourceName: `${name} · Greenhouse`,
    status: 'success',
    fetched: 10,
    normalized: 9,
    invalid: 1,
    cacheHit: index % 2 === 0,
    fetchedAt: '2026-11-04T03:00:00Z',
    failure: null,
  }),
);
const summary = {
  fetched: 40,
  normalized: 36,
  eligible: 5,
  sourceFailures: 0,
  sources,
  warnings: ['Synthetic invalid listings omitted.'],
  found: 5,
  added: 3,
  refreshed: 2,
  remaining: 0,
  errors: [],
  scope: 'Synthetic verified feeds',
};
function mount() {
  render(
    <MemoryRouter>
      <DiscoverJobs onDiscovered={() => {}} />
    </MemoryRouter>,
  );
}
test('preferences expand while discovery remains accessible and sends unchanged defaults', async () => {
  let complete!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Run discovery' })).toHaveClass(
    'MuiButton-contained',
  );
  expect(screen.getByRole('button', { name: 'Edit preferences' })).toHaveClass(
    'MuiButton-outlined',
  );
  expect(screen.getByRole('button', { name: 'Run details' })).toHaveClass(
    'MuiButton-outlined',
  );
  expect(screen.getByText(/Up to 50 new candidates per run/)).toBeVisible();
  expect(screen.queryByLabelText('Preferred location')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run discovery' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Edit preferences' }));
  expect(screen.getByLabelText('Preferred location')).toBeVisible();
  expect(screen.getByLabelText('Preferred location')).toHaveTextContent(
    'Ho Chi Minh City',
  );
  expect(
    screen.getByLabelText('Must mention any selected stack'),
  ).toHaveTextContent('Java, Spring Boot, Node.js, React');
  fireEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Discovering public jobs',
  );
  expect(screen.getByRole('button', { name: 'Run discovery' })).toBeDisabled();
  for (const field of screen.getAllByRole('combobox'))
    expect(field).toHaveAttribute('aria-disabled', 'true');
  await act(async () => complete(Response.json(summary)));
  const completion = screen.getByText(
    /5 eligible · 3 added · 2 known · 0 over limit/,
  );
  expect(completion.closest('.MuiSnackbar-root')).toHaveStyle({
    position: 'fixed',
  });
  expect(completion.closest('section')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
  expect(screen.getByRole('link', { name: 'View Jobs' })).toHaveAttribute(
    'href',
    '/jobs',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close run details' }));
  expect(
    await screen.findByRole('button', { name: 'Run discovery' }),
  ).toBeEnabled();
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/discovery/runs',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        location: 'Ho Chi Minh City',
        stacks: ['Java', 'Spring Boot', 'Node.js', 'React'],
        workMode: 'All',
        seniority: 'Senior',
      }),
    }),
  );
});
test('partial-source errors retain success counts, remaining guidance and cache disclosure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...summary,
        remaining: 4,
        eligible: 9,
        sourceFailures: 1,
        sources: sources.map((source, index) =>
          index === 0
            ? {
                ...source,
                status: 'failed',
                fetched: null,
                normalized: null,
                invalid: null,
                failure: {
                  code: 'SOURCE_UNAVAILABLE',
                  message: 'Synthetic source unavailable',
                },
              }
            : source,
        ),
        errors: ['Synthetic source unavailable'],
      }),
    ),
  );
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  await screen.findByText(/9 eligible · 3 added · 2 known · 4 over limit/);
  expect(screen.getByRole('alert')).toHaveTextContent('1 source unavailable');

  fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
  await screen.findByText('Synthetic source unavailable');
  const failed = screen.getByRole('region', { name: sources[0]!.sourceName });
  expect(failed).toHaveTextContent('Unavailable · listing counts unavailable');
  expect(failed).not.toHaveTextContent('0 fetched');
  expect(
    screen.getByText(/Run again to discover the remaining candidates/),
  ).toBeVisible();
  expect(screen.getByText(/cached for five minutes/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'View Jobs' })).toHaveClass(
    'MuiButton-outlined',
  );
});
test('zero results offer preference guidance, Add Job and Inbox links', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...summary,
        found: 0,
        eligible: 0,
        added: 0,
        refreshed: 0,
      }),
    ),
  );
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  await screen.findByText(/0 eligible · 0 added/);
  fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
  expect(
    await screen.findByText(/No eligible candidates in this run/),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Add job' })).toHaveClass(
    'MuiButton-outlined',
  );
  expect(screen.getByRole('link', { name: 'Add job' })).toHaveAttribute(
    'href',
    '/jobs/new',
  );
  expect(screen.getByRole('link', { name: 'View Jobs' })).toHaveClass(
    'MuiButton-outlined',
  );
});
test('request failure preserves edited preferences and supports a manual retry', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { message: 'Discovery is already running. Wait for it to finish.' },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(Response.json(summary));
  vi.stubGlobal('fetch', fetch);
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit preferences' }));
  await user.click(screen.getByLabelText('Preferred location'));
  await user.click(screen.getByRole('option', { name: 'Vietnam' }));
  await user.click(screen.getByRole('button', { name: 'Hide preferences' }));
  expect(screen.getByText(/Vietnam · Java/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Run discovery' }));
  await user.click(screen.getByRole('button', { name: 'Edit preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Discovery is already running',
  );
  expect(screen.getByLabelText('Preferred location')).toHaveTextContent(
    'Vietnam',
  );
  expect(
    screen.queryByRole('link', { name: 'View Jobs' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Run discovery' }));
  await screen.findByText(/5 eligible · 3 added/);
  fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
  expect(await screen.findByRole('link', { name: 'View Jobs' })).toBeVisible();
  expect(
    screen.queryByText(/Discovery is already running/),
  ).not.toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls[1]![1].body).location).toBe('Vietnam');
});

test('run details displays four source outcomes, null counts, warnings and known semantics with keyboard dismissal', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(summary)),
  );
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run discovery' }));
  await screen.findByText(/5 eligible · 3 added · 2 known/);
  const trigger = screen.getByRole('button', { name: 'Run details' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'Discovery run details' });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  for (const source of sources) {
    const region = within(dialog).getByRole('region', {
      name: source.sourceName,
    });
    expect(region).toHaveTextContent('10 fetched · 9 valid · 1 invalid');
    expect(region).toHaveTextContent(
      source.cacheHit ? 'Cached data' : 'Live fetch',
    );
  }
  expect(dialog).toHaveTextContent('Fetched listings40');
  expect(dialog).toHaveTextContent('Valid / normalized listings36');
  expect(dialog).toHaveTextContent('Eligible candidates (unique)5');
  expect(dialog).toHaveTextContent('Known candidates2');
  expect(dialog).toHaveTextContent('snapshots and review states are unchanged');
  expect(dialog).toHaveTextContent('Synthetic invalid listings omitted.');
  expect(dialog).not.toHaveTextContent('Refreshed');
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
});

test('all-source failure is a warning, never a no-match result or zero-job feed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...summary,
        eligible: 0,
        found: 0,
        added: 0,
        refreshed: 0,
        fetched: 0,
        normalized: 0,
        sourceFailures: 4,
        warnings: [],
        sources: sources.map((source) => ({
          ...source,
          status: 'failed',
          fetched: null,
          normalized: null,
          invalid: null,
          cacheHit: false,
          fetchedAt: null,
          failure: { code: 'SOURCE_UNAVAILABLE', message: 'Retry later.' },
        })),
      }),
    ),
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No sources available',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Run details' }));
  const dialog = screen.getByRole('dialog', { name: 'Discovery run details' });
  expect(dialog).not.toHaveTextContent('No eligible candidates');
  for (const source of sources) {
    const region = within(dialog).getByRole('region', {
      name: source.sourceName,
    });
    expect(region).toHaveTextContent(
      'Unavailable · listing counts unavailable',
    );
    expect(region).not.toHaveTextContent('0 fetched');
  }
});

test('successful run uses a success notification and consumes the additive response without changing it', async () => {
  const result = { ...summary, warnings: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(result)),
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  const completion = await screen.findByText(
    '5 eligible · 3 added · 2 known · 0 over limit',
  );
  expect(completion.closest('.MuiAlert-root')).toHaveClass(
    'MuiAlert-colorSuccess',
  );
  expect(completion.closest('section')).toBeNull();
});

test('edited preference labels preserve backend enum values and match-any stacks', async () => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => Response.json({ ...summary, warnings: [] }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Edit preferences' }));
  expect(
    screen.getByText(
      /Greenhouse searches Axon, Backbase, Temus, and Go1 Vietnam/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/do not filter or reorder the Queue/)).toBeVisible();
  expect(screen.getByText(/not necessarily required skills/)).toBeVisible();
  await user.click(screen.getByLabelText('Preferred work mode'));
  await user.click(screen.getByRole('option', { name: 'Remote' }));
  await user.click(screen.getByLabelText('Preferred level'));
  await user.click(screen.getByRole('option', { name: 'Technical Lead' }));
  await user.click(screen.getByLabelText('Must mention any selected stack'));
  await user.click(screen.getByRole('option', { name: 'Java' }));
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Run discovery' }));
  await screen.findByText(/5 eligible · 3 added/);
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
    location: 'Ho Chi Minh City',
    stacks: ['Spring Boot', 'Node.js', 'React'],
    workMode: 'Remote',
    seniority: 'Technical Lead',
  });
});
