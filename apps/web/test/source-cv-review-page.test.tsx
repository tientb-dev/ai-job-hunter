import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { SourceCvReviewPage } from '../src/features/inbox/SourceCvReviewPage';
import { cvProfileFixture, sourceCvFixture } from './fixtures/source-cv-review';

const cv = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Main CV',
  isDefault: true,
  fileName: sourceCvFixture.fileName,
  updatedAt: sourceCvFixture.savedCvUpdatedAt,
};

// Synthetic API; the app runs in StrictMode, so the page does too.
function mount({
  cvId = cv.id,
  profile = async () => Response.json(cvProfileFixture()),
}: { cvId?: string; profile?: () => Promise<Response> } = {}) {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/opportunities/cv')) return Response.json([cv]);
    if (url.endsWith('/sources') || url.endsWith('/content'))
      return Response.json(sourceCvFixture);
    if (url.endsWith('/profile')) return profile();
    // Saving a revision fails: a mutation error.
    if (url.endsWith('/revisions'))
      return Response.json(
        { message: 'Synthetic save failure.' },
        { status: 503 },
      );
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const router = createMemoryRouter(
    [
      { path: '/cv', element: <h1>My CV destination</h1> },
      { path: '/cv/:cvId/review', element: <SourceCvReviewPage /> },
    ],
    { initialEntries: [`/cv/${cvId}/review`] },
  );
  render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <RouterProvider router={router} />
      </ThemeProvider>
    </StrictMode>,
  );
  return { router };
}
// jsdom ignores media queries: the desktop nav is display:none, the mobile picker shows.
const picker = () => screen.findByRole('combobox', { name: 'Section' });
async function goTo(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await picker());
  await user.click(screen.getByRole('option', { name }));
}

test('opens the review for the CV in the URL, one section at a time', async () => {
  mount();
  expect(
    await screen.findByRole('heading', { name: 'Review: Main CV', level: 1 }),
  ).toBeVisible();
  await picker();
  expect(screen.queryByText('Preparing source review…')).toBeNull();
  // Desktop navigation lists every section with its status.
  const nav = screen.getByRole('navigation', {
    name: 'Review sections',
    hidden: true,
  });
  expect(
    within(nav).getByRole('button', { name: /Experience/, hidden: true }),
  ).toBeInTheDocument();
  // Only the active section renders; the first unchecked one opens first.
  expect(
    screen.getByRole('region', { name: 'Personal details section' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Experience section' }),
  ).toBeNull();
  // The full checklist stays collapsed; the action bar names the next step.
  expect(
    screen.queryByRole('region', {
      name: 'Before you can complete the review',
    }),
  ).toBeNull();
  expect(
    screen.getByText(/items left before you can complete the review/),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Complete review' }),
  ).toBeDisabled();
  // The bar holds the count, one link to the blocker list, Save draft and Complete.
  expect(screen.queryByRole('button', { name: /^Next: / })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'View items to resolve' }),
  ).toBeVisible();
});

test('Next step, section navigation and Previous/Next switch the active panel', async () => {
  const user = userEvent.setup();
  mount();
  await goTo(user, /^Experience/);
  expect(
    within(
      screen.getByRole('navigation', { name: 'Review sections', hidden: true }),
    ).getByRole('button', { name: /Experience/, hidden: true }),
  ).toHaveAttribute('aria-current', 'step');
  expect(
    screen.getByRole('region', { name: 'Experience section' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Previous' }));
  expect(
    screen.getByRole('region', { name: 'Personal details section' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^Next$/ }));
  expect(
    screen.getByRole('region', { name: 'Experience section' }),
  ).toBeVisible();
  // The compact link opens the blocker list; an item jumps to its section.
  await user.click(
    screen.getByRole('button', { name: 'View items to resolve' }),
  );
  const list = screen.getByRole('region', {
    name: 'Before you can complete the review',
  });
  await user.click(within(list).getAllByRole('button')[1]!);
  expect(
    screen.getByRole('region', { name: 'Personal details section' }),
  ).toBeVisible();
});

test('a load failure is shown inline with Retry instead of loading forever', async () => {
  let fail = true;
  const user = userEvent.setup();
  mount({
    profile: async () =>
      fail
        ? new Response(null, { status: 503 })
        : Response.json(cvProfileFixture()),
  });
  const retry = await screen.findByRole('button', { name: 'Retry' });
  expect(screen.queryByText('Preparing source review…')).toBeNull();
  fail = false;
  await user.click(retry);
  await picker();
});

test('a failed save shows a persistent error popup and keeps the edits', async () => {
  const user = userEvent.setup();
  mount();
  await goTo(user, /^Add missing details/);
  await user.type(screen.getByRole('textbox', { name: 'New detail' }), 'Rust');
  await user.click(
    screen.getByRole('button', { name: 'Add detail for review' }),
  );
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  const popup = await screen.findByRole('alert');
  expect(within(popup).getByText('Review action failed')).toBeVisible();
  expect(
    within(popup).getByText(/Could not load or save the source review/),
  ).toBeVisible();
  // Errors stay until dismissed; nothing on the page is locked.
  await new Promise((resolve) => setTimeout(resolve, 2700));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});

test('leaving with unsaved edits asks to stay or discard', async () => {
  const user = userEvent.setup();
  const { router } = mount();
  await goTo(user, /^Add missing details/);
  await user.type(screen.getByRole('textbox', { name: 'New detail' }), 'Rust');
  await user.click(screen.getByRole('link', { name: 'Back to My CV' }));
  const dialog = await screen.findByRole('dialog', {
    name: 'Leave unsaved changes?',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Stay and edit' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(router.state.location.pathname).toBe(`/cv/${cv.id}/review`);
  expect(screen.getByRole('textbox', { name: 'New detail' })).toHaveValue(
    'Rust',
  );
  await user.click(screen.getByRole('link', { name: 'Back to My CV' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Discard and leave',
    }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe('/cv'));
});

test('an unknown CV explains itself and links back', async () => {
  mount({ cvId: '00000000-0000-4000-8000-0000000000ff' });
  expect(await screen.findByText(/This CV no longer exists/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to My CV' })).toHaveAttribute(
    'href',
    '/cv',
  );
});

test('the contact-symbol warning starts as a one-line summary and expands on demand', async () => {
  const profile = cvProfileFixture();
  profile.document.coverage.find(
    (row) => row.disposition === 'unresolved',
  )!.reason = 'Unrecognized contact fragment';
  const user = userEvent.setup();
  mount({ profile: async () => Response.json(profile) });
  const summary = await screen.findByText('Contact text needs review (1)');
  const warning = summary.closest('.MuiAlert-root') as HTMLElement;
  expect(within(warning).queryByText('Unclassified award.')).toBeNull();
  await user.click(
    within(warning).getByRole('button', { name: 'Show details' }),
  );
  expect(within(warning).getByText('Unclassified award.')).toBeVisible();
  expect(
    within(warning).getByRole('button', { name: 'Hide details' }),
  ).toHaveAttribute('aria-expanded', 'true');
});
