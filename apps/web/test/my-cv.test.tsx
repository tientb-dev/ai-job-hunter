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
    screen.queryByRole('region', { name: 'Source CV review' }),
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

test('saved state shows name, file, date and review progress with Upload another as secondary', async () => {
  const { total } = mount(savedCv, 1);
  const summary = await screen.findByRole('region', { name: 'Source CV' });
  expect(within(summary).getByText(savedCv.fileName)).toBeVisible();
  expect(within(summary).getByText(/^Main CV/)).toBeVisible();
  expect(within(summary).getByText(/^Saved /)).toBeVisible();
  expect(
    await within(summary).findByText(`1 of ${total} sections reviewed`),
  ).toBeVisible();
  expect(
    within(summary).getByText('Upload another CV', { selector: 'label' }),
  ).toHaveClass('MuiButton-outlined');
  // The shared review stays primary until it is complete.
  expect(screen.getByRole('button', { name: 'Review source CV' })).toHaveClass(
    'MuiButton-contained',
  );
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
    screen.getByRole('button', { name: 'View / Edit review' }),
  ).toHaveClass('MuiButton-outlined');
  expect(
    screen.queryByRole('button', { name: 'Review source CV' }),
  ).not.toBeInTheDocument();
});

test('opening the shared review refreshes progress from the same saved profile', async () => {
  const { fetch } = mount(savedCv);
  await screen.findByText(/sections reviewed/);
  expect(
    screen.getByText(
      'Check and correct your CV details before using them to tailor applications. Your review is shared across jobs.',
    ),
  ).toBeVisible();
  // The verification safeguard lives inside the opened review.
  expect(screen.queryByText(/not independent verification/)).toBeNull();
  const before = calls(fetch, '/profile');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Review source CV' }));
  await waitFor(() =>
    expect(calls(fetch, '/profile')).toBeGreaterThan(before + 1),
  );
  expect(
    await screen.findByText(
      /Confirmation records your review, not independent verification/,
    ),
  ).toBeVisible();
});

test('adding a CV shows it without replacing the default and never touches tailored drafts', async () => {
  const { fetch } = mount(savedCv);
  await screen.findByText(/sections reviewed/);
  await userEvent.setup().upload(
    screen.getByLabelText('Upload another CV'),
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

test('a reviewed CV that loads slowly never shows a guessed status or action', async () => {
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
  expect(
    screen.queryByRole('button', {
      name: /Review source CV|View \/ Edit review/,
    }),
  ).not.toBeInTheDocument();
  release();
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'View / Edit review' }),
  ).toHaveClass('MuiButton-outlined');
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
  // The review stays reachable without guessing its entry point.
  expect(screen.getByRole('button', { name: 'Open review' })).toHaveClass(
    'MuiButton-outlined',
  );
  fail = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByText(`Reviewed · ${total} of ${total} sections`),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open review' })).toBeNull();
});

test('Open review after a status failure never creates or resets a review', async () => {
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
  const open = await screen.findByRole('button', { name: 'Open review' });
  // Still failing: the error is reported, nothing is created.
  await user.click(open);
  await waitFor(() => expect(open).toBeEnabled());
  expect(creates()).toBe(0);
  // Recovered: the existing reviewed profile opens unchanged.
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Open review' }));
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
  await screen.findByText('Main CV · Default');
  // The default CV offers neither Make default nor Delete.
  expect(screen.queryByRole('button', { name: 'Make default' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  await user.click(screen.getByRole('combobox', { name: 'CV' }));
  await user.click(screen.getByRole('option', { name: 'Data CV' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
  );
  expect(await screen.findByText(inUse)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('combobox', { name: 'CV' })).toHaveTextContent(
    'Data CV',
  );
  await user.click(screen.getByRole('button', { name: 'Make default' }));
  expect(await screen.findByText('Data CV · Default')).toBeVisible();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(`/opportunities/cv/${otherCv.id}`) &&
        (init as RequestInit | undefined)?.method === 'PATCH',
    ),
  ).toBe(true);
});
