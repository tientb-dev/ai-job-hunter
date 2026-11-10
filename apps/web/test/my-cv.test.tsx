import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { MyCv } from '../src/features/inbox/MyCv';
import { cvProfileFixture, sourceCvFixture } from './fixtures/source-cv-review';

const savedCv = {
  fileName: sourceCvFixture.fileName,
  updatedAt: sourceCvFixture.savedCvUpdatedAt,
};

// Synthetic API: one saved CV (or none) and its review profile.
function mount(
  cv: typeof savedCv | null,
  confirmed = 0,
  profileResponse?: () => Promise<Response>,
) {
  const profile = cvProfileFixture();
  profile.document.sections.forEach((section, index) => {
    if (index < confirmed) section.review = 'confirmed';
  });
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/opportunities/cv/current')) {
      if (init?.method === 'POST')
        return Response.json({
          fileName: 'replacement-cv.pdf',
          updatedAt: '2026-02-01T00:00:00.000Z',
        });
      return Response.json(cv);
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

test('saved state shows file, date and review progress with Replace as secondary', async () => {
  const { total } = mount(savedCv, 1);
  const summary = await screen.findByRole('region', { name: 'Source CV' });
  expect(within(summary).getByText(savedCv.fileName)).toBeVisible();
  expect(within(summary).getByText(/^Saved /)).toBeVisible();
  expect(
    await within(summary).findByText(`1 of ${total} sections reviewed`),
  ).toBeVisible();
  expect(
    within(summary).getByText('Replace source CV', { selector: 'label' }),
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

test('replacing the CV updates the summary and never touches tailored drafts', async () => {
  const { fetch } = mount(savedCv);
  await screen.findByText(/sections reviewed/);
  await userEvent.setup().upload(
    screen.getByLabelText('Replace source CV'),
    new File(['synthetic'], 'replacement-cv.pdf', {
      type: 'application/pdf',
    }),
  );
  expect(await screen.findByText('replacement-cv.pdf')).toBeVisible();
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
