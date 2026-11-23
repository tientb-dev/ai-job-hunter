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
  [`/jobs/${id}?tab=improve`, `/jobs/${id}/tailored-cv`, /^Tailored CV/],
  [`/jobs/${id}/improve`, `/jobs/${id}/tailored-cv`, /^Tailored CV/],
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

test.each(['MISSING', 'STALE_CV'] as const)(
  'Match panel explains when the saved match is %s',
  async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/cv/current')
          ? Response.json({
              id: 'synthetic-cv',
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
    expect(
      screen.getByRole('heading', {
        name: 'Your CV Match assessment is not ready yet',
      }),
    ).toBeVisible();
    if (status === 'STALE_CV') {
      expect(await screen.findByText(/Outdated.*different CV/)).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Reanalyze CV Match' }),
      ).toBeEnabled();
    } else {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Analyze CV Match' }),
        ).toBeEnabled(),
      );
      expect(screen.queryByText(/Outdated\./)).toBeNull();
    }
  },
);

test('changing the CV in CV Match restarts an already-mounted Tailored CV from fresh data', async () => {
  // Synthetic CVs; the server's current CV flips on PUT.
  const cv = (n: string) => ({
    id: `synthetic-cv-${n}`,
    name: `Synthetic CV ${n}`,
    fileName: `synthetic-${n}.pdf`,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  let current = cv('a');
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/health/')) return Response.json({ status: 'ok' });
    if (url.endsWith(`/opportunities/${id}`))
      return Response.json({
        ...emptyOpportunity(),
        id,
        title: 'Synthetic workspace job',
        jdText: '',
        documentName: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    if (url.endsWith('/cv/current')) {
      if (init?.method === 'PUT') current = cv('b');
      return Response.json(current);
    }
    if (url.endsWith('/opportunities/cv'))
      return Response.json([cv('a'), cv('b')]);
    return Response.json(null);
  });
  vi.stubGlobal('fetch', fetch);
  const router = createMemoryRouter([{ path: '*', element: <App /> }], {
    initialEntries: [`/jobs/${id}/tailored-cv`],
  });
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Synthetic workspace job' });
  const currentReads = () =>
    fetch.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/cv/current') && !i?.method,
    ).length;
  // CV Match and Tailored CV each read the job's CV once.
  await waitFor(() => expect(currentReads()).toBe(2));
  await user.click(screen.getByRole('tab', { name: /^Overview/ }));
  await user.click(screen.getByRole('tab', { name: /^Tailored CV/ }));
  expect(currentReads()).toBe(2);
  await user.click(screen.getByRole('tab', { name: /^CV Match/ }));
  await user.click(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  );
  await user.click(
    await screen.findByRole('option', { name: 'Synthetic CV b' }),
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([u, i]) => String(u).endsWith('/cv/current') && i?.method === 'PUT',
      ),
    ).toBe(true),
  );
  // The restarted workflow rereads the server instead of keeping CV a.
  await waitFor(() => expect(currentReads()).toBe(3));
  await user.click(screen.getByRole('tab', { name: /^Tailored CV/ }));
  expect(
    screen.getByRole('tabpanel', { name: /^Tailored CV/ }),
  ).not.toHaveTextContent('Synthetic CV a');
});
