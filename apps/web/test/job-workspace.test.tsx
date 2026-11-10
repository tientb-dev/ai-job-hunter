import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { render, screen, waitFor } from './render';
import { theme } from '../src/app/theme';
import { App } from '../src/app/App';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';

const id = '00000000-0000-4000-8000-0000000000aa';

function mount(entry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/health/')
        ? Response.json({ status: 'ok' })
        : url.endsWith(`/opportunities/${id}`)
          ? Response.json({
              ...emptyOpportunity(),
              id,
              title: 'Synthetic workspace job',
              jdText: '',
              documentName: null,
            })
          : Response.json(null),
    ),
  );
  const router = createMemoryRouter([{ path: '*', element: <App /> }], {
    initialEntries: [entry],
  });
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}

test.each([
  [`/jobs/${id}/application`, `/jobs/${id}/application`, /^Application/],
  [`/jobs/${id}?tab=improve`, `/jobs/${id}/match`, /^Match/],
  [`/jobs/${id}?tab=application`, `/jobs/${id}/application`, /^Application/],
])('deep link %s opens %s', async (entry, path, tab) => {
  const router = mount(entry);
  await screen.findByRole('heading', { name: 'Synthetic workspace job' });
  expect(router.state.location.pathname).toBe(path);
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: tab })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
});

test('switching sections keeps unsaved job edits without a prompt; leaving the job prompts', async () => {
  const router = mount(`/jobs/${id}/edit`);
  const user = userEvent.setup();
  const notes = await screen.findByRole('textbox', {
    name: /Recruiter \/ contact notes/,
  });
  await user.type(notes, 'Unsaved synthetic note');
  await user.click(screen.getByRole('tab', { name: /^Application/ }));
  expect(router.state.location.pathname).toBe(`/jobs/${id}/application`);
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getByRole('link', { name: 'Edit JD' }));
  expect(
    screen.getByRole('textbox', { name: /Recruiter \/ contact notes/ }),
  ).toHaveValue('Unsaved synthetic note');
  await router.navigate(-1);
  expect(screen.queryByRole('dialog')).toBeNull();
  await user.click(screen.getAllByRole('link', { name: 'Jobs' })[0]!);
  expect(
    await screen.findByRole('dialog', { name: 'Leave unsaved changes?' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe(`/jobs/${id}/application`);
});

test.each([
  ['MISSING', 'Not analyzed yet.'],
  ['STALE_CV', 'Outdated.'],
])(
  'Match panel and advice agree when the saved match is %s',
  async (status, prefix) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/cv/current')
          ? Response.json({
              fileName: 'synthetic.pdf',
              updatedAt: '2026-01-01T00:00:00.000Z',
            })
          : url.endsWith('/match')
            ? Response.json({ status })
            : Response.json(null),
      ),
    );
    render(
      <ThemeProvider theme={theme}>
        <CvMatchPanel
          jobId={id}
          revision="1"
          jobUpdatedAt="2026-01-01T00:00:00.000Z"
          view="match"
        />
      </ThemeProvider>,
    );
    const count = (text: string) =>
      document.body.textContent!.split(text).length - 1;
    // One message in the assessment and one in the advice prerequisite.
    await waitFor(() => expect(count(prefix)).toBe(2));
    expect(
      count(prefix === 'Outdated.' ? 'Not analyzed yet.' : 'Outdated.'),
    ).toBe(0);
  },
);
