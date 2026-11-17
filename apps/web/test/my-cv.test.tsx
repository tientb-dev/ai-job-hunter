import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { MyCv } from '../src/features/inbox/MyCv';
import { cvProfileFixture, sourceCvFixture } from './fixtures/source-cv-review';

const savedCv = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Main CV',
  isDefault: true,
  fileName: sourceCvFixture.fileName,
  updatedAt: sourceCvFixture.savedCvUpdatedAt,
  fileSize: 274_432 as number | null,
  originalAvailable: true,
};
const otherCv = {
  ...savedCv,
  id: '00000000-0000-4000-8000-0000000000c2',
  name: 'Data CV',
  isDefault: false,
  fileName: 'data-cv.pdf',
};
const inUse =
  'This CV is still used by one or more jobs. Choose another CV for those jobs before deleting it.';

// Synthetic API: the saved CVs (or none) and their review profile.
function mount(
  cv: typeof savedCv | (typeof savedCv)[] | null,
  confirmed = 0,
  profileResponse?: () => Promise<Response>,
  currentResponse?: () => Promise<Response>,
  reviewsFor?: ('none' | 'saved')[],
) {
  const profile = cvProfileFixture();
  profile.document.sections.forEach((section, index) => {
    if (index < confirmed) section.review = 'confirmed';
  });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const list = cv === null ? [] : Array.isArray(cv) ? cv : [cv];
    if (url.endsWith('/opportunities/cv')) {
      if (init?.method === 'POST')
        return Response.json({
          id: '00000000-0000-4000-8000-0000000000c3',
          name: 'added-cv.pdf',
          isDefault: false,
          fileName: 'added-cv.pdf',
          updatedAt: '2026-02-01T00:00:00.000Z',
        });
      if (currentResponse) return currentResponse();
      return Response.json(list);
    }
    if (url.includes('/opportunities/cv/')) {
      // Every non-default CV is used by a job in this fixture.
      if (init?.method === 'DELETE')
        return Response.json({ message: inUse }, { status: 409 });
      const id = url.split('/').at(-1);
      return Response.json(
        list.map((row) => ({ ...row, isDefault: row.id === id })),
      );
    }
    // Review summaries for every CV, derived from the synthetic profile.
    if (url.endsWith('/saved-cv-reviews/list')) {
      const response = profileResponse
        ? await profileResponse()
        : Response.json(profile);
      if (!response.ok) return response;
      const { document } = (await response.json()) as typeof profile;
      const review = {
        reviewed: document.sections.filter((s) => s.review === 'confirmed')
          .length,
        total: document.sections.length,
      };
      return Response.json({
        contractVersion: '1',
        items: list.map((row, i) => ({
          cvId: row.id,
          review: reviewsFor?.[i] === 'none' ? null : review,
        })),
      });
    }
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const router = createMemoryRouter(
    [
      { path: '/cv', element: <MyCv /> },
      { path: '/cv/:cvId/review', element: <p>Synthetic review page</p> },
    ],
    { initialEntries: ['/cv'] },
  );
  const app = (
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
  render(app);
  return { fetch, router, total: profile.document.sections.length };
}
const calls = (fetch: ReturnType<typeof vi.fn>, suffix: string) =>
  fetch.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;

test('empty state offers one primary save action and no job description fields', async () => {
  const { fetch } = mount(null);
  expect(await screen.findByText(/No CV saved yet/)).toBeVisible();
  const save = screen.getByText('Save source CV', { selector: 'label' });
  expect(save).toHaveClass('MuiButton-contained');
  expect(document.querySelectorAll('.MuiButton-contained')).toHaveLength(1);
  expect(screen.queryByLabelText(/job description/i)).toBeNull();
  expect(
    screen.queryByRole('heading', { name: 'Source CV review' }),
  ).not.toBeInTheDocument();
  expect(calls(fetch, '/sources')).toBe(0);
  expect(calls(fetch, '/saved-cv-reviews/list')).toBe(1);
});

const loadError = /Could not load your saved CV/;

test('empty state never reports a load error', async () => {
  mount(null);
  expect(await screen.findByText(/No CV saved yet/)).toBeVisible();
  expect(screen.queryByText(loadError)).toBeNull();
});

test('loading state shows neither empty state, error nor save action', async () => {
  mount(null, 0, undefined, () => new Promise<Response>(() => {}));
  await waitFor(() => expect(screen.queryByText(/No CV saved yet/)).toBeNull());
  expect(screen.queryByText(loadError)).toBeNull();
  expect(screen.queryByText('Save source CV')).toBeNull();
});

test.each([
  ['a server error', async () => new Response('', { status: 500 })],
  ['a network failure', () => Promise.reject(new TypeError('offline'))],
])('%s shows the load error', async (_, response) => {
  mount(null, 0, undefined, response);
  expect(await screen.findByText(loadError)).toBeVisible();
});

test('saved state shows the library, details, file facts and review progress', async () => {
  const { total } = mount(savedCv, 1);
  const library = await screen.findByRole('region', { name: 'Your CVs' });
  expect(within(library).getByLabelText('1 of 5 CVs saved')).toBeVisible();
  const summary = screen.getByRole('region', { name: 'Main CV' });
  // The original file name appears once, only because the CV was renamed.
  expect(within(summary).getByText(savedCv.fileName)).toBeVisible();
  expect(within(summary).getByText('Updated')).toBeVisible();
  expect(within(summary).getByText('268 KB')).toBeVisible();
  expect(
    await within(summary).findByText(`1 of ${total} sections reviewed`),
  ).toBeVisible();
  expect(screen.getByText('Add CV', { selector: 'label' })).toHaveClass(
    'MuiButton-contained',
  );
  // My CV keeps status and navigation only; the review has its own page.
  expect(
    within(summary).getByRole('link', { name: 'Review CV' }),
  ).toHaveAttribute('href', `/cv/${savedCv.id}/review`);
  expect(
    screen.queryByRole('heading', { name: 'Source CV review' }),
  ).not.toBeInTheDocument();
  // The quick analysis stays at /cv/analyze but is no longer linked here.
  expect(
    screen.queryByRole('link', { name: 'Quick CV and job analysis' }),
  ).toBeNull();
});

test('a fully reviewed CV reads as reviewed', async () => {
  const { total } = mount(savedCv, Infinity);
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', {
      name: /Review source CV|View \/ Edit review/,
    }),
  ).not.toBeInTheDocument();
});

test('adding a CV opens its mandatory review without replacing the default or touching drafts', async () => {
  const { fetch } = mount(savedCv);
  await screen.findByText(/sections reviewed/);
  await userEvent.setup().upload(
    screen.getByLabelText('Add CV'),
    new File(['synthetic'], 'added-cv.pdf', {
      type: 'application/pdf',
    }),
  );
  // Source CV Review is the next step for every new CV.
  expect(await screen.findByText('Synthetic review page')).toBeVisible();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).includes('/cv/') &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ),
  ).toBe(false);
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith('/opportunities/cv') &&
        (init as RequestInit | undefined)?.method === 'POST',
    ),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(([url]) => String(url).includes('/drafts')),
  ).toBe(false);
});

test('a slow review status keeps the page loading and never shows a guessed status', async () => {
  let release!: () => void;
  const { total } = mount(
    savedCv,
    Infinity,
    () =>
      new Promise<Response>((resolve) => {
        const profile = cvProfileFixture();
        profile.document.sections.forEach((s) => (s.review = 'confirmed'));
        release = () => resolve(Response.json(profile));
      }),
  );
  await waitFor(() => expect(release).toBeDefined());
  // The panel waits for its status instead of rendering and resizing later.
  expect(screen.getByLabelText('Loading your CV')).toBeInTheDocument();
  expect(screen.queryByText(savedCv.fileName)).toBeNull();
  expect(screen.queryByText('Not reviewed yet')).not.toBeInTheDocument();
  release();
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
});

test('a failed profile request reads as unavailable and can be retried', async () => {
  let fail = true;
  const { total } = mount(savedCv, Infinity, async () => {
    if (fail) return new Response(null, { status: 503 });
    const profile = cvProfileFixture();
    profile.document.sections.forEach((s) => (s.review = 'confirmed'));
    return Response.json(profile);
  });
  expect(await screen.findByText('Review status unavailable.')).toBeVisible();
  expect(screen.queryByText('Not reviewed yet')).not.toBeInTheDocument();
  // The review stays reachable from the header without guessing its state.
  expect(screen.getByRole('link', { name: 'Review CV' })).toBeVisible();
  fail = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
});

test("switching CVs shows each CV's own status without another request", async () => {
  const user = userEvent.setup();
  const { fetch, total } = mount(
    [savedCv, otherCv],
    Infinity,
    undefined,
    undefined,
    ['saved', 'none'],
  );
  const reviewed = `Reviewed · ${total} of ${total} sections`;
  expect(await screen.findByText(reviewed)).toBeVisible();
  const requests = fetch.mock.calls.length;
  const library = screen.getByRole('region', { name: 'Your CVs' });
  await user.click(within(library).getByRole('button', { name: /^Data CV/ }));
  expect(screen.getByText('Not reviewed yet')).toBeVisible();
  expect(screen.queryByText(reviewed)).toBeNull();
  expect(screen.queryByLabelText('Loading review status')).toBeNull();
  await user.click(within(library).getByRole('button', { name: /^Main CV/ }));
  expect(screen.getByText(reviewed)).toBeVisible();
  // Selection never captures a source or reads a profile.
  expect(fetch.mock.calls.length).toBe(requests);
  expect(calls(fetch, '/sources')).toBe(0);
});

test('a non-default CV can become the default; a CV still used by a job is not deleted', async () => {
  const user = userEvent.setup();
  const { fetch } = mount([savedCv, otherCv]);
  await screen.findByRole('region', { name: 'Main CV' });
  // The default CV can neither become default again nor be deleted.
  expect(screen.getByRole('button', { name: 'Make default' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /^Data CV/ }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  );
  expect(await screen.findByText(inUse)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('region', { name: 'Data CV' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Make default' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Make default' })).toBeDisabled(),
  );
  expect(screen.getByText('Default CV')).toBeVisible();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(`/opportunities/cv/${otherCv.id}`) &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ),
  ).toBe(true);
});

test('the default CV and the CV being viewed are labelled separately', async () => {
  const user = userEvent.setup();
  mount([savedCv, otherCv]);
  const library = await screen.findByRole('region', { name: 'Your CVs' });
  const main = within(library).getByRole('button', { name: /^Main CV/ });
  expect(main).toHaveAttribute('aria-current', 'true');
  expect(within(main).getByText('Viewing')).toBeVisible();
  expect(within(main).getByText('Default')).toBeVisible();
  await user.click(within(library).getByRole('button', { name: /^Data CV/ }));
  const data = within(library).getByRole('button', { name: /^Data CV/ });
  expect(data).toHaveAttribute('aria-current', 'true');
  expect(within(data).getByText('Viewing')).toBeVisible();
  expect(within(data).queryByText('Default')).toBeNull();
  expect(within(main).queryByText('Viewing')).toBeNull();
  expect(within(main).getByText('Default')).toBeVisible();
  expect(
    screen.getByText(/not the default\. New jobs use Main CV\./),
  ).toBeVisible();
});

test('download links to the exact original file, or explains why it is unavailable', async () => {
  const user = userEvent.setup();
  mount([savedCv, { ...otherCv, originalAvailable: false, fileSize: null }]);
  const download = await screen.findByRole('link', {
    name: 'Download original',
  });
  expect(download).toHaveAttribute(
    'href',
    `/api/v1/opportunities/cv/${savedCv.id}/file`,
  );
  expect(download).toHaveAttribute('download', savedCv.fileName);
  await user.click(screen.getByRole('button', { name: /^Data CV/ }));
  const summary = screen.getByRole('region', { name: 'Data CV' });
  expect(
    within(summary).getByRole('button', { name: 'Download original' }),
  ).toBeDisabled();
  expect(within(summary).getByText(/original file was not kept/)).toBeVisible();
  expect(within(summary).getByText('—')).toBeVisible();
});

test('at 5 CVs adding is disabled with a clear message', async () => {
  const five = Array.from({ length: 5 }, (_, i) => ({
    ...otherCv,
    id: `00000000-0000-4000-8000-0000000000d${i}`,
    name: `CV ${i}`,
    isDefault: i === 0,
  }));
  mount(five);
  const library = await screen.findByRole('region', { name: 'Your CVs' });
  expect(within(library).getByLabelText('5 of 5 CVs saved')).toBeVisible();
  expect(within(library).getByText(/up to 5 CVs/)).toBeVisible();
  expect(screen.getByLabelText('Add CV')).toBeDisabled();
});

test('the row menu opens that CV and offers its actions', async () => {
  const user = userEvent.setup();
  mount([savedCv, otherCv]);
  await user.click(
    await screen.findByRole('button', { name: 'More actions for Data CV' }),
  );
  const menu = screen.getByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Make default', 'Rename', 'Download original', 'Delete']);
  await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
  expect(screen.getByRole('textbox', { name: 'CV name' })).toHaveValue(
    'Data CV',
  );
});
