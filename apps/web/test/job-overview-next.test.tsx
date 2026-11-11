import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  Route,
  RouterProvider,
  Routes,
} from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';

const id = '00000000-0000-4000-8000-123456789012';
const draftId = '00000000-0000-4000-8000-0000000000d1';

// Synthetic job with one saved draft; review state is configurable.
function mount(review: { pending: number; approved: boolean }) {
  const job = {
    ...emptyOpportunity(),
    id,
    title: 'Synthetic engineer',
    description: 'Synthetic JD',
    jdText: '',
    documentName: null,
    status: 'SAVED',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const factReviews = Object.fromEntries(
    Array.from({ length: 3 }, (_, i) => [
      `f${i}`,
      { proposal: i < review.pending ? 'pending' : 'accepted' },
    ]),
  );
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/drafts/list'))
      return Response.json({
        items: [{ id: draftId, revision: 2, jobUpdatedAt: job.updatedAt }],
        nextCursor: null,
      });
    if (url.endsWith(`/drafts/${draftId}`))
      return Response.json({
        revision: 2,
        document: {
          review: {
            factReviews,
            approval: review.approved ? { revision: 2 } : null,
          },
        },
      });
    if (url.endsWith('/cv/current')) return Response.json(null);
    if (url.endsWith('/match')) return Response.json({ status: 'MISSING' });
    if (init?.method && init.method !== 'GET')
      throw Error(`Unexpected write: ${init.method} ${url}`);
    return Response.json(job);
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '*',
              element: (
                <Routes>
                  <Route path="/jobs/:id/*" element={<JobEditor />} />
                </Routes>
              ),
            },
          ],
          { initialEntries: [`/jobs/${id}`] },
        )}
      />
    </ThemeProvider>,
  );
  return fetch;
}

test('Overview suggests the next step from the saved draft and links to it without writing', async () => {
  const fetch = mount({ pending: 2, approved: false });
  const card = await screen.findByRole('region', {
    name: 'Next suggested action',
  });
  expect(card).toHaveTextContent('Decide 2 remaining suggestions');
  expect(
    within(card).getByRole('link', { name: 'Continue tailoring' }),
  ).toHaveAttribute('href', `/jobs/${id}/tailored-cv`);
  // Only reads: the drafts list, draft and readiness lookups are POST reads.
  const writes = fetch.mock.calls.filter(
    ([url, init]) =>
      init?.method &&
      init.method !== 'GET' &&
      !/\/drafts\/(list|readiness)$|\/drafts\/[0-9a-f-]+$/.test(String(url)),
  );
  expect(writes).toEqual([]);
});

test('an approved draft for a saved job points to export', async () => {
  mount({ pending: 0, approved: true });
  const card = await screen.findByRole('region', {
    name: 'Next suggested action',
  });
  expect(
    within(card).getByRole('link', { name: 'Open Approve & Export' }),
  ).toBeVisible();
});

test('on phones all four job tabs are visible in a grid with keyboard selection', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  mount({ pending: 1, approved: false });
  const list = await screen.findByRole('tablist', { name: 'Job sections' });
  await waitFor(() =>
    expect(
      list.closest('.MuiTabs-root')!.querySelector('.MuiTabs-list'),
    ).toHaveStyle({
      display: 'grid',
    }),
  );
  expect(
    list.closest('.MuiTabs-root')!.querySelector('.MuiTabs-scrollButtons'),
  ).toBeNull();
  const tabs = within(list).getAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual([
    'Overview',
    'Match',
    'Tailored CV',
    'Application',
    'Interview',
  ]);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  const user = userEvent.setup();
  await user.click(tabs[0]!);
  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{Enter}');
  expect(screen.getByRole('tab', { name: /^Application/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('link', { name: 'Edit JD' })).toBeVisible();
});
