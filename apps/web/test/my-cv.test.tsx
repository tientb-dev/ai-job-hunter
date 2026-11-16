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
    if (url.endsWith('/sources') || url.endsWith('/content'))
      return Response.json(sourceCvFixture);
    if (url.endsWith('/profile'))
      return profileResponse ? profileResponse() : Response.json(profile);
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const router = createMemoryRouter(
    [
      { path: '/cv', element: <MyCv /> },
      { path: '/cv/analyze', element: <h1>Analyzer destination</h1> },
    ],
    { initialEntries: ['/cv'] },
  );
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
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
  // One review entry point: the details header. The review opens on demand.
  expect(screen.getAllByRole('button', { name: /review/i })).toEqual([
    within(summary).getByRole('button', { name: 'Review CV' }),
  ]);
  expect(
    screen.queryByRole('heading', { name: 'Source CV review' }),
  ).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole('link', { name: 'Quick CV and job analysis' }));
  expect(
    screen.getByRole('heading', { name: 'Analyzer destination' }),
  ).toBeVisible();
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

test('Review CV opens the shared review below the library and refreshes progress', async () => {
  const { fetch } = mount(savedCv);
  await screen.findByText(/sections reviewed/);
  const before = calls(fetch, '/profile');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Review CV' }));
  const section = (
    await screen.findByRole('heading', { name: 'Source CV review' })
  ).parentElement!;
  // Full width: the review is outside the library/details grid.
  expect(section.closest('[aria-labelledby="cv-details-title"]')).toBeNull();
  expect(
    within(section).getByText(
      'Check and correct your CV details before using them to tailor applications. Your review is shared across jobs.',
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(calls(fetch, '/profile')).toBeGreaterThan(before + 1),
  );
  expect(
    await screen.findByText(
      /Confirmation records your review, not independent verification/,
    ),
  ).toBeVisible();
  // No second entry button inside the review.
  expect(
    within(section).queryByRole('button', {
      name: /Review source CV|View \/ Edit review|Open review/,
    }),
  ).toBeNull();
});

test('adding a CV shows it without replacing the default and never touches tailored drafts', async () => {
  const { fetch } = mount(savedCv);
  await screen.findByText(/sections reviewed/);
  await userEvent.setup().upload(
    screen.getByLabelText('Add CV'),
    new File(['synthetic'], 'added-cv.pdf', {
      type: 'application/pdf',
    }),
  );
  expect(await screen.findAllByText('added-cv.pdf')).not.toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Make default' })).toBeVisible();
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

test('a reviewed CV that loads slowly never shows a guessed status', async () => {
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
  expect(await screen.findByText(savedCv.fileName)).toBeVisible();
  await waitFor(() => expect(release).toBeDefined());
  expect(screen.getByLabelText('Loading review status')).toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Review CV' })).toBeEnabled();
  fail = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
});

test('Review CV after a status failure never creates or resets a review', async () => {
  let fail = true;
  const { fetch, total } = mount(savedCv, Infinity, async () => {
    if (fail) return new Response(null, { status: 503 });
    const profile = cvProfileFixture();
    profile.document.sections.forEach((s) => (s.review = 'confirmed'));
    return Response.json(profile);
  });
  const creates = () =>
    fetch.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/profiles') &&
        (init as RequestInit | undefined)?.method === 'POST',
    ).length;
  const user = userEvent.setup();
  const open = await screen.findByRole('button', { name: 'Review CV' });
  // Still failing: the error is reported, nothing is created.
  await user.click(open);
  await screen.findByRole('heading', { name: 'Source CV review' });
  await waitFor(() => expect(open).toBeEnabled());
  expect(creates()).toBe(0);
  // Recovered: the existing reviewed profile opens unchanged.
  fail = false;
  await user.click(open);
  expect(
    await screen.findByText(
      /Confirmation records your review, not independent verification/,
    ),
  ).toBeVisible();
  expect(creates()).toBe(0);
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
});

test('a non-default CV can become the default; a CV still used by a job is not deleted', async () => {
  const user = userEvent.setup();
  const { fetch } = mount([savedCv, otherCv]);
  await screen.findByRole('region', { name: 'Main CV' });
  // The default CV offers neither Make default nor Delete.
  expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull(),
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
