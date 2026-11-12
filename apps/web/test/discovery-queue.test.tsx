import { act, fireEvent, render, screen, waitFor, within } from './render';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { DiscoverJobsPage } from '../src/features/inbox/DiscoverJobsPage';
import type { CandidateDetail } from '../src/features/inbox/discovery-api';
import { ThemeProvider } from '@mui/material';
import { theme } from '../src/app/theme';

const candidate = (
  n: number,
  status: CandidateDetail['status'] = 'NEW',
): CandidateDetail => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: `Synthetic role ${n}`,
  status,
  company: 'Synthetic company',
  location: 'Vietnam',
  workMode: '',
  seniority: '',
  originalLink: 'https://example.com/job',
  sourceName: 'Synthetic feed',
  firstSeenAt: '2026-11-03T00:00:00Z',
  lastSeenAt: '2026-11-04T00:00:00Z',
  opportunityId:
    status === 'SAVED' ? '00000000-0000-4000-8000-000000000099' : null,
  description: 'Synthetic description',
  skills: 'Java',
  preferredSkills: 'React',
});
function backend(initial = [candidate(1)]) {
  const rows = initial.map((row) => ({ ...row }));
  const fetch = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const route = new URL(url, 'http://localhost');
      if (route.pathname.endsWith('/runs'))
        return Response.json({
          found: rows.length,
          eligible: rows.length,
          fetched: rows.length,
          normalized: rows.length,
          sources: [],
          sourceFailures: 0,
          warnings: [],
          added: 0,
          refreshed: rows.length,
          remaining: 0,
          errors: [],
          scope: 'Synthetic feeds',
        });
      if (route.pathname.endsWith('/candidates')) {
        const filter = route.searchParams.get('filter') ?? 'to-review';
        const visible = rows.filter(
          (row) =>
            filter === 'all' ||
            (filter === 'to-review'
              ? ['NEW', 'SEEN'].includes(row.status)
              : row.status.toLowerCase() === filter),
        );
        const page = Math.min(
          Number(route.searchParams.get('page') ?? 1),
          Math.max(1, Math.ceil(visible.length / 10)),
        );
        return Response.json({
          items: visible.slice((page - 1) * 10, page * 10),
          page,
          pageSize: 10,
          total: visible.length,
          totalPages: Math.ceil(visible.length / 10),
        });
      }
      const row = rows.find((value) => route.pathname.includes(value.id));
      if (!row) throw new Error(`Unexpected request: ${url}`);
      if (route.pathname.endsWith('/status')) {
        row.status = JSON.parse(init!.body as string).status;
        return Response.json(row);
      }
      if (route.pathname.endsWith('/save')) {
        row.status = 'SAVED';
        row.opportunityId = '00000000-0000-4000-8000-000000000099';
        return Response.json({
          candidateId: row.id,
          status: 'SAVED',
          opportunityId: row.opportunityId,
          outcome: 'linked_existing',
        });
      }
      return Response.json(row);
    },
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch, rows };
}
function mount(path = '/discover') {
  const router = createMemoryRouter(
    [{ path: '*', element: <DiscoverJobsPage /> }],
    { initialEntries: [path] },
  );
  const view = render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return { router, ...view };
}
const writes = (fetch: ReturnType<typeof backend>['fetch']) =>
  fetch.mock.calls.filter(([, init]) => init?.method);

test('loads persistent NEW then SEEN candidates, opening details does not mark seen, explicit actions persist on reload', async () => {
  const { fetch, rows } = backend([candidate(1), candidate(2, 'SEEN')]);
  let view = mount();
  await screen.findByRole('button', { name: 'Review Synthetic role 1' });
  expect(
    screen
      .getAllByRole('heading', { level: 3 })
      .map((node) => node.textContent),
  ).toEqual(['Synthetic role 1', 'Synthetic role 2']);
  expect(screen.getByRole('button', { name: 'To review' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Review Synthetic role 1' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Synthetic role 1',
  });
  expect(
    await within(dialog).findByText('Synthetic description'),
  ).toBeVisible();
  expect(writes(fetch)).toHaveLength(0);
  expect(
    within(dialog).getByRole('link', { name: 'Original source job' }),
  ).toHaveAttribute('href', 'https://example.com/job');
  const content = dialog.querySelector('.MuiDialogContent-root')!;
  content.scrollTop = 120;
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Mark as seen' }),
  );
  const notice = await screen.findByText('Marked as seen.');
  expect(dialog.contains(notice)).toBe(false);
  expect(notice.closest('.MuiSnackbar-root')).toHaveStyle({
    position: 'fixed',
  });
  expect(dialog.querySelectorAll('.MuiDialogContent-root')).toHaveLength(1);
  expect(content.scrollTop).toBe(120);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(rows[0]!.status).toBe('SEEN');
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Dismiss' }),
  );
  await screen.findByText(/Candidate dismissed/);
  expect(rows[0]!.status).toBe('DISMISSED');
  view.unmount();
  view = mount('/discover?filter=dismissed&page=1');
  expect(
    await screen.findByRole('button', { name: 'Review Synthetic role 1' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Review Synthetic role 2' }),
  ).not.toBeInTheDocument();
  view.unmount();
});
test('server pagination and filters use URL parameters and browser history', async () => {
  const { fetch } = backend([
    ...Array.from({ length: 11 }, (_, n) => candidate(n + 1)),
    candidate(20, 'SAVED'),
  ]);
  const { router } = mount();
  await screen.findByText('1–10 of 11');
  await userEvent.click(
    screen.getByRole('button', { name: 'Go to next page' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Review Synthetic role 11' }),
  ).toBeVisible();
  expect(router.state.location.search).toBe('?filter=to-review&page=2');
  await userEvent.click(screen.getByRole('button', { name: 'Saved' }));
  expect(
    await screen.findByRole('button', { name: 'Review Synthetic role 20' }),
  ).toBeVisible();
  expect(router.state.location.search).toBe('?filter=saved&page=1');
  expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Saved' })).toHaveClass(
    'MuiButton-outlined',
    'MuiButton-colorInherit',
  );
  await act(async () => {
    await router.navigate(-1);
  });
  await screen.findByRole('button', { name: 'Review Synthetic role 11' });
  expect(screen.getByRole('button', { name: 'To review' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    fetch.mock.calls.some(([url]) => url.endsWith('filter=to-review&page=2')),
  ).toBe(true);
});
test('explicit Save links existing Inbox job, retains review feedback and refreshes the queue', async () => {
  const { fetch } = backend();
  mount();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Review Synthetic role 1' }),
  );
  await screen.findByText('Synthetic description');
  await userEvent.click(
    await screen.findByRole('button', { name: 'Save to Jobs' }),
  );
  expect(await screen.findByText(/Linked to the existing job/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open in Jobs' })).toHaveAttribute(
    'href',
    '/jobs/00000000-0000-4000-8000-000000000099',
  );
  expect(writes(fetch).map(([url]) => url)).toEqual([
    `/api/v1/discovery/candidates/${candidate(1).id}/save`,
  ]);
  await userEvent.click(screen.getByRole('button', { name: 'Close review' }));
  expect(await screen.findByText(/No candidates to review/)).toBeVisible();
});

test.each(['POSSIBLE_DUPLICATE', 'AMBIGUOUS_INBOX_MATCH'])(
  '%s requires safe user action and never auto-confirms',
  async (code) => {
    const { fetch } = backend();
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => {
      if (
        url.endsWith('/save') &&
        !JSON.parse(init!.body as string).confirmSeparate
      )
        return Response.json(
          {
            errorCode: code,
            message: 'Review existing matches.',
            matches: [
              {
                id: candidate(99).id,
                title: 'Existing opening',
                company: 'Synthetic',
                location: 'Vietnam',
              },
            ],
          },
          { status: 409 },
        );
      return original(url, init);
    });
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Review Synthetic role 1' }),
    );
    await screen.findByText('Synthetic description');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Save to Jobs' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name:
        code === 'POSSIBLE_DUPLICATE'
          ? 'Possible duplicate job'
          : 'Multiple exact matches in Jobs',
    });
    expect(
      within(dialog).getByRole('link', { name: 'Existing opening' }),
    ).toHaveAttribute('href', `/jobs/${candidate(99).id}`);
    expect(writes(fetch)).toHaveLength(1);
    expect(JSON.parse(writes(fetch)[0]![1]!.body as string)).toEqual({});
    if (code === 'AMBIGUOUS_INBOX_MATCH') {
      expect(
        within(dialog).queryByRole('button', {
          name: 'Save as separate job',
        }),
      ).not.toBeInTheDocument();
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Close' }),
      );
      expect(writes(fetch)).toHaveLength(1);
    } else {
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      );
      expect(writes(fetch)).toHaveLength(1);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Save to Jobs' }),
      );
      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Save as separate job',
        }),
      );
      await screen.findByRole('link', { name: 'Open in Jobs' });
      expect(JSON.parse(writes(fetch)[2]![1]!.body as string)).toEqual({
        confirmSeparate: true,
      });
    }
  },
);
test('failed Save retains detail, blocks duplicate submissions and permits retry', async () => {
  const { fetch } = backend();
  const original = fetch.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetch.mockImplementation((url, init) =>
    url.endsWith('/save')
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : original(url, init),
  );
  mount();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Review Synthetic role 1' }),
  );
  await screen.findByText('Synthetic description');
  const save = screen.getByRole('button', { name: 'Save to Jobs' });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(save).toBeDisabled();
  expect(writes(fetch)).toHaveLength(1);
  await act(async () => finish(Response.json({}, { status: 503 })));
  expect(
    await screen.findByText(/Could not load or update the discovery queue/),
  ).toBeVisible();
  expect(screen.getByText('Synthetic description')).toBeVisible();
  expect(save).toBeEnabled();
});
test('discovery refreshes persistent queue and uses new summary wording', async () => {
  const { fetch } = backend();
  mount();
  await screen.findByText('Synthetic role 1');
  await userEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  expect(
    await screen.findByText(/1 eligible · 0 added · 1 known · 0 over limit/),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/candidates?')).length,
    ).toBe(2),
  );
  expect(writes(fetch)[0]![0]).toBe('/api/v1/discovery/runs');
  expect(
    screen.queryByText(/Imported|Duplicates skipped/),
  ).not.toBeInTheDocument();
});

test('queue errors can retry and server-clamped pages replace the URL', async () => {
  const { fetch } = backend();
  fetch.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  const { router } = mount('/discover?filter=new&page=99');
  await userEvent.click(
    await screen.findByRole('button', { name: 'Retry queue' }),
  );
  await waitFor(() =>
    expect(router.state.location.search).toBe('?filter=new&page=1'),
  );
  // Clamping starts another request; query the current DOM on each retry.
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Review Synthetic role 1' }),
    ).toBeVisible(),
  );
  expect(screen.getByText('1–1 of 1')).toBeVisible();
});

test('late responses cannot replace a newer filter', async () => {
  const { fetch } = backend([candidate(1), candidate(2, 'SAVED')]);
  let finish!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { router } = mount();
  await act(async () => {
    await router.navigate('/discover?filter=saved&page=1');
  });
  await screen.findByRole('button', { name: 'Review Synthetic role 2' });
  await act(async () =>
    finish(
      Response.json({
        items: [candidate(1)],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }),
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'Review Synthetic role 1' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Review Synthetic role 2' }),
  ).toBeVisible();
});

test('returning to a loaded filter still shows loading until its new request completes', async () => {
  const { fetch } = backend([candidate(1)]);
  const { router } = mount();
  await screen.findByRole('button', { name: 'Review Synthetic role 1' });
  let finishSaved!: (response: Response) => void;
  let finishReview!: (response: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishSaved = resolve;
      }),
  );
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishReview = resolve;
      }),
  );
  await act(async () => {
    await router.navigate('/discover?filter=saved&page=1');
  });
  await act(async () => {
    await router.navigate('/discover?filter=to-review&page=1');
  });
  expect(screen.getByText('Loading queue…')).toBeVisible();
  await act(async () =>
    finishSaved(
      Response.json({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      }),
    ),
  );
  expect(screen.getByText('Loading queue…')).toBeVisible();
  await act(async () =>
    finishReview(
      Response.json({
        items: [candidate(1)],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      }),
    ),
  );
  expect(await screen.findByText('1 candidates')).toBeVisible();
});

test('all queue filters remain accessible and reviewing identifies the active row', async () => {
  backend();
  const { container } = mount();
  const group = screen.getByRole('group', { name: 'Queue filter' });
  for (const name of [
    'To review',
    'New',
    'Seen',
    'Saved',
    'Dismissed',
    'All',
  ]) {
    expect(within(group).getByRole('button', { name })).toBeVisible();
  }
  await userEvent.click(
    await screen.findByRole('button', { name: 'Review Synthetic role 1' }),
  );
  await screen.findByText('Synthetic description');
  expect(container.querySelector('li[aria-current="true"]')).toHaveTextContent(
    'Synthetic role 1',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Close review' }));
  await waitFor(() =>
    expect(container.querySelector('li[aria-current="true"]')).toBeNull(),
  );
});

test('zero eligible run retains existing Queue history and selected filter', async () => {
  const { fetch, rows } = backend([candidate(1, 'SEEN')]);
  const original = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) =>
    url.endsWith('/runs')
      ? Response.json({
          found: 0,
          eligible: 0,
          fetched: 40,
          normalized: 40,
          added: 0,
          refreshed: 0,
          remaining: 0,
          sources: [],
          sourceFailures: 0,
          warnings: [],
          errors: [],
          scope: 'Synthetic feeds',
        })
      : original(url, init),
  );
  const { router } = mount('/discover?filter=seen&page=1');
  await screen.findByText('Synthetic role 1');
  const before = structuredClone(rows);
  await userEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
  await screen.findByText(/0 eligible · 0 added · 0 known/);
  await waitFor(() =>
    expect(
      fetch.mock.calls.filter(([url]) => url.includes('/candidates?')),
    ).toHaveLength(2),
  );
  expect(screen.getByText('Synthetic role 1')).toBeVisible();
  expect(rows).toEqual(before);
  expect(router.state.location.search).toBe('?filter=seen&page=1');
});

test.each(['NEW', 'SEEN', 'SAVED', 'DISMISSED'] as const)(
  'review action hierarchy preserves conditional behavior for %s',
  async (status) => {
    const { fetch } = backend([candidate(1, status)]);
    mount('/discover?filter=all&page=1');
    const review = await screen.findByRole('button', {
      name: 'Review Synthetic role 1',
    });
    // Row actions are tertiary; Run discovery is the page's primary action.
    expect(review).toHaveClass('MuiButton-text');
    const filters = screen.getByRole('group', { name: 'Queue filter' });
    for (const button of within(filters).getAllByRole('button')) {
      expect(button).toHaveClass(
        'MuiButton-outlined',
        'MuiButton-colorInherit',
      );
      expect(button).not.toHaveClass('MuiButton-contained');
    }
    expect(within(filters).getByRole('button', { name: 'All' })).toHaveStyle({
      backgroundColor: 'rgba(47, 91, 211, 0.08)',
    });
    await userEvent.click(review);
    const dialog = await screen.findByRole('dialog', {
      name: 'Synthetic role 1',
    });
    await within(dialog).findByText('Synthetic description');
    expect(
      within(dialog).getByRole('button', { name: 'Close review' }),
    ).toHaveClass('MuiButton-text');
    const seen = within(dialog).queryByRole('button', { name: 'Mark as seen' });
    if (status === 'NEW') expect(seen).toHaveClass('MuiButton-outlined');
    else expect(seen).toBeNull();
    const dismiss = within(dialog).queryByRole('button', { name: 'Dismiss' });
    if (status === 'NEW' || status === 'SEEN') {
      expect(dismiss).toHaveClass('MuiButton-outlined', 'MuiButton-colorError');
      // Neutral at rest; the theme adds red only on hover and focus.
      expect(dismiss).toHaveStyle({ color: 'rgb(22, 24, 29)' });
    } else expect(dismiss).toBeNull();
    if (status === 'SAVED') {
      expect(
        within(dialog).getByRole('link', { name: 'Open in Jobs' }),
      ).toHaveClass('MuiButton-outlined');
      expect(
        within(dialog).queryByRole('button', { name: 'Save to Jobs' }),
      ).toBeNull();
    } else
      expect(
        within(dialog).getByRole('button', { name: 'Save to Jobs' }),
      ).toHaveClass('MuiButton-contained');
    expect(
      within(dialog).getByRole('link', { name: 'Original source job' }),
    ).toHaveClass('MuiLink-root');
    expect(
      within(dialog).getByRole('link', { name: 'Original source job' }),
    ).not.toHaveClass('MuiButton-root');
    expect(writes(fetch)).toHaveLength(0);
  },
);
