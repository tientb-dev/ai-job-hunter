import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import {
  syntheticMatch,
  syntheticSuggestions,
} from './fixtures/cv-suggestions';
const id = '00000000-0000-4000-8000-123456789012';
function setup() {
  let identity = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/cv/current'))
      return Response.json({
        fileName: 'synthetic.pdf',
        updatedAt: syntheticMatch.cvUpdatedAt,
      });
    if (url.endsWith('/cv-improvement-suggestions'))
      return Response.json({
        ...syntheticSuggestions,
        matchId: `synthetic-${identity}`,
      });
    if (url.endsWith('/match'))
      return Response.json({
        ...syntheticMatch,
        matchId: `synthetic-${++identity}`,
        analyzedAt: new Date().toISOString(),
      });
    if (init?.method === 'PUT')
      return Response.json({
        ...emptyOpportunity(),
        id,
        ...JSON.parse(init.body as string),
      });
    return Response.json({
      ...emptyOpportunity(),
      id,
      title: 'Synthetic engineer',
      company: 'Example',
      description: 'Synthetic saved JD',
      status: 'SAVED',
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[`/jobs/${id}`]}>
        <Routes>
          <Route path="/jobs/:id" element={<JobEditor />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { fetch };
}
const tab = (name: string) =>
  fireEvent.click(screen.getByRole('tab', { name }));

test('real Job Details shares one match across five tabs, compact cards and cross-tab evidence', async () => {
  const { fetch } = setup();
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual([
    'Overview',
    'CV Match',
    'Improve CV',
    'Application',
    'Edit JD',
  ]);
  tab('Improve CV');
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/match')),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Go to CV Match' }));
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText('Fit score: 50/100 (heuristic)');
  tab('Improve CV');
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeEnabled();
  tab('Application');
  tab('CV Match');
  expect(screen.getByLabelText('Fit score: 50/100 (heuristic)')).toBeVisible();
  tab('Improve CV');
  fireEvent.click(screen.getByRole('button', { name: 'Suggest improvements' }));
  await screen.findAllByRole('article');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(
    fetch.mock.calls.filter(([url]) =>
      url.endsWith('/cv-improvement-suggestions'),
    )[0]?.[1]?.body,
  ).toBe(JSON.stringify({ matchId: 'synthetic-1' }));
  const first = screen.getAllByRole('article')[0]!;
  fireEvent.click(
    within(first).getByRole('button', { name: 'Review evidence' }),
  );
  const target = screen.getByRole('button', {
    name: 'Partial: Experience designing APIs and integrations',
  });
  await waitFor(() => expect(target).toHaveFocus());
  expect(screen.getByRole('tab', { name: 'CV Match' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.queryByRole('heading', { name: 'Improve your CV' })).toBeNull();
  tab('Improve CV');
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/match')),
  ).toHaveLength(1);
  tab('CV Match');
  fireEvent.click(screen.getByRole('button', { name: 'Reanalyze CV Match' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Reanalyze CV Match' }),
    ).toBeEnabled(),
  );
  tab('Improve CV');
  expect(screen.queryByRole('article')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Suggest improvements' }));
  await screen.findAllByRole('article');
  expect(
    fetch.mock.calls
      .filter(([url]) => url.endsWith('/cv-improvement-suggestions'))
      .at(-1)?.[1]?.body,
  ).toBe(JSON.stringify({ matchId: 'synthetic-2' }));
});

test('unsaved JD edits and save invalidate context and cannot be bypassed by analyzing unsaved edits', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('CV Match');
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText(/Fit score: 50/);
  tab('Edit JD');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Synthetic changed JD' },
  });
  tab('Improve CV');
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
  expect(screen.getByText(/Save your job edits, then reanalyze/)).toBeVisible();
  tab('CV Match');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText(/Fit score: 50/);
  tab('Improve CV');
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
  tab('Edit JD');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled(),
  );
  tab('Improve CV');
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
});

test('a saved CV Match does not expire on the client after 15 minutes', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('CV Match');
  await screen.findByText('Saved CV: synthetic.pdf');
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    tab('Improve CV');
    fireEvent.click(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getAllByRole('article')).toHaveLength(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    });
    // Saved matches persist; validity is decided by the server on reload.
    expect(screen.getAllByRole('article')).toHaveLength(3);
  } finally {
    vi.useRealTimers();
  }
});
