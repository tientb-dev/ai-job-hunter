import { beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen, within } from './render';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  useLocation,
} from 'react-router-dom';
import { App } from '../src/app/App';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../src/app/theme';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import type { DiscoverySummary } from '../src/features/inbox/discovery-api';

function Location() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

test.each(['/dashboard', '/jobs'])(
  'opens job details and returns from %s through the app shell',
  async (path) => {
    const job = {
      ...emptyOpportunity(),
      id: '00000000-0000-4000-8000-123456789012',
      title: 'Synthetic navigation job',
      jdText: '',
      documentName: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/health/ready'))
          return Response.json({ status: 'ok' });
        if (url.endsWith('/cv/current')) return Response.json(null);
        if (url.endsWith('/job-progress'))
          return Response.json({
            cv: { saved: true, sourceReason: 'CV_DRAFT_MATCH_REQUIRED' },
            jobs: [{ id: job.id, matchStatus: 'MISSING', draft: null }],
          });
        return Response.json(url.endsWith('/opportunities') ? [job] : job);
      }),
    );
    render(
      <ThemeProvider theme={theme}>
        <RouterProvider
          router={createMemoryRouter([{ path: '*', element: <App /> }], {
            initialEntries: [path],
          })}
        />
      </ThemeProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: job.title }));
    expect(
      await screen.findByRole('heading', { name: job.title }),
    ).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('link', { name: 'Back to Jobs' }));
    expect(await screen.findByRole('link', { name: job.title })).toBeVisible();
  },
);
function show(path: string) {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Location />
      </MemoryRouter>
    </ThemeProvider>,
  );
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url === '/api/v1/health/ready'
        ? Promise.resolve(new Response(JSON.stringify({ status: 'ok' })))
        : Promise.resolve(new Response(JSON.stringify([]))),
    ),
  );
});
test('root defaults to the Dashboard', async () => {
  show('/');
  expect(screen.getByLabelText('Current route')).toHaveTextContent(
    '/dashboard',
  );
  expect(
    screen.getByRole('heading', { name: 'Dashboard' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('API ready')).toBeInTheDocument();
});
test.each(['/candidates', '/matches', '/settings'])(
  'retired placeholder %s redirects to Jobs',
  (path) => {
    show(path);
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/jobs');
    const navigation = screen.getByRole('navigation', {
      name: 'Main navigation',
    });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dashboard', 'Jobs', 'Discover', 'My CV', 'Interview Prep']);
  },
);
test('unknown routes show not found and allow navigation home', async () => {
  show('/does-not-exist');
  expect(
    screen.getByRole('heading', { name: 'Page not found' }),
  ).toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole('link', { name: 'Back to Jobs' }));
  expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
});

test('keeps CV review accessible and discovery off the inbox', async () => {
  show('/jobs');
  await userEvent.setup().click(screen.getByRole('link', { name: 'My CV' }));
  expect(screen.getByRole('heading', { name: 'My CV' })).toBeInTheDocument();
  // The CV/JD analyzer is a secondary tool, not the main My CV view.
  expect(screen.queryByLabelText(/job description/i)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Use CV to find jobs' }),
  ).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole('link', { name: 'Quick CV and job analysis' }));
  expect(
    screen.getByRole('heading', { name: 'Quick CV and job analysis' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'My CV' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('Discover Jobs supports direct links, navigation, retained results and history', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/health/ready')) return Response.json({ status: 'ok' });
      if (url.endsWith('/runs')) {
        return Response.json({
          fetched: 1,
          normalized: 1,
          eligible: 1,
          sources: [
            {
              sourceKey: 'greenhouse:synthetic',
              sourceName: 'Synthetic board · Greenhouse',
              status: 'success',
              fetched: 1,
              normalized: 1,
              invalid: 0,
              cacheHit: false,
              fetchedAt: '2026-11-04T03:00:00Z',
              failure: null,
            },
          ],
          sourceFailures: 0,
          warnings: [],
          found: 1,
          added: 1,
          refreshed: 0,
          remaining: 0,
          errors: [],
          scannedAt: '2026-11-04T03:00:00Z',
          scope: 'Synthetic feeds',
        } satisfies DiscoverySummary);
      }
      if (url.includes('/discovery/candidates'))
        return Response.json({
          items: [],
          total: 0,
          totalPages: 0,
          page: 1,
          pageSize: 10,
        });
      return Response.json([
        {
          ...emptyOpportunity(),
          id: 'synthetic-job',
          title: 'Existing synthetic job',
        },
      ]);
    }),
  );
  const router = createMemoryRouter([{ path: '*', element: <App /> }], {
    initialEntries: ['/discover'],
  });
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  const navigation = screen.getByRole('navigation', {
    name: 'Main navigation',
  });
  expect(
    within(navigation).getByRole('link', { name: 'Discover' }),
  ).toHaveAttribute('aria-current', 'page');
  expect(
    screen.getByRole('button', { name: 'Edit preferences' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Run discovery' }));
  const notification = await screen.findByText(
    '1 eligible · 1 added · 0 known · 0 over limit',
  );
  expect(notification.closest('[role="status"]')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await user.click(screen.getByRole('button', { name: 'Run details' }));
  const viewInbox = await screen.findByRole('link', { name: 'View Jobs' });
  expect(router.state.location.pathname).toBe('/discover');

  await user.click(viewInbox);
  expect(router.state.location.pathname).toBe('/jobs');
  expect(
    await screen.findByRole('link', { name: 'Existing synthetic job' }),
  ).toBeVisible();
  expect(screen.queryByLabelText('Discovery location')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Toggle Discover Jobs' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate(-1);
  });
  expect(router.state.location.pathname).toBe('/discover');
  expect(
    screen.getByRole('button', { name: 'Edit preferences' }),
  ).toBeVisible();
  await user.click(within(navigation).getByRole('link', { name: 'Jobs' }));
  await user.click(within(navigation).getByRole('link', { name: 'Discover' }));
  expect(router.state.location.pathname).toBe('/discover');
  expect(screen.getByRole('heading', { name: 'Discover jobs' })).toBeVisible();
});

test('mobile drawer restores focus on Escape and closes after route selection', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  show('/cv');
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Open navigation' });
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  await user.click(trigger);
  const drawer = screen.getByRole('dialog', { name: 'Workspace navigation' });
  expect(within(drawer).getByRole('link', { name: 'My CV' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await user.keyboard('{Escape}');
  await vi.waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(
    within(screen.getByRole('dialog')).getByRole('link', {
      name: /^Jobs$/,
    }),
  );
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/jobs');
  await vi.waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});

test.each([
  [
    '/interview-prep/jobs/00000000-0000-4000-8000-0000000000aa/sets/00000000-0000-4000-8000-000000000001',
    'Jobs',
  ],
  ['/interview-prep', 'Interview Prep'],
])('sidebar context for %s highlights %s only', async (path, highlighted) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/health/ready')
        ? Response.json({ status: 'ok' })
        : Response.json(
            { statusCode: 503, errorCode: 'X', message: 'x' },
            { status: 503 },
          ),
    ),
  );
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider
        router={createMemoryRouter([{ path: '*', element: <App /> }], {
          initialEntries: [path],
        })}
      />
    </ThemeProvider>,
  );
  const navigation = screen.getByRole('navigation', {
    name: 'Main navigation',
  });
  const active = within(navigation)
    .getAllByRole('link')
    .filter((link) => link.classList.contains('active'))
    .map((link) => link.textContent);
  expect(active).toEqual([highlighted]);
});
