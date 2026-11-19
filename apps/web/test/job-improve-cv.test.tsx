import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import {
  closeSuccess,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from './render';
import { theme } from '../src/app/theme';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import {
  syntheticMatch,
  syntheticSuggestions,
} from './fixtures/cv-suggestions';
const id = '00000000-0000-4000-8000-123456789012';
function setup() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/cv/current'))
      return Response.json({
        id: 'synthetic-cv',
        fileName: 'synthetic.pdf',
        updatedAt: syntheticMatch.cvUpdatedAt,
      });

    if (url.endsWith('/cv-improvement-suggestions'))
      return Response.json(syntheticSuggestions);
    if (url.endsWith('/match'))
      return Response.json({
        ...syntheticMatch,
        analyzedAt: new Date().toISOString(),
        skillMatch: {
          version: 1,
          score: 100,
          limitation: null,
          totalCount: 1,
          matchedCount: 1,
          rows: [
            {
              priority: 'required',
              source: { quote: 'Synthetic saved JD' },
              skills: [
                {
                  name: 'Java',
                  evidence: { quote: 'Designed Java APIs.', origin: 'source' },
                },
              ],
            },
          ],
        },
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
          <Route path="/jobs/:id/*" element={<JobEditor />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
  return { fetch };
}
const tab = (name: string) =>
  fireEvent.click(
    name === 'Edit JD'
      ? screen.getByRole('link', { name })
      : screen.getByRole('tab', {
          name: new RegExp(`^${name}`),
        }),
  );

test('CV Match links to the existing reviewed CV and revision-bound suggestions', async () => {
  const { fetch } = setup();
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('CV Match');
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  expect(
    await screen.findByText('100% weighted match across assessed requirements'),
  ).toBeVisible();
  expect(screen.queryByText('Needs review')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Review & Improve CV' }));
  expect(
    screen.getByRole('tab', { name: 'Review & Improve CV' }),
  ).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('link', { name: 'Review CV' })).toHaveAttribute(
    'href',
    `/cv/synthetic-cv/review?returnTo=${encodeURIComponent(`/jobs/${id}/match`)}`,
  );
  expect(
    fetch.mock.calls.filter(([url]) =>
      url.endsWith('/cv-improvement-suggestions'),
    ),
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole('button', { name: /suggest improvements/i }),
  );
  const evidence = await screen.findAllByRole('button', {
    name: 'Review evidence',
  });
  fireEvent.click(evidence[0]!);
  expect(
    screen.getByRole('dialog', { name: 'Requirement evidence' }),
  ).toHaveTextContent('Designed Java APIs.');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    fetch.mock.calls.find(([url]) =>
      url.endsWith('/cv-improvement-suggestions'),
    )?.[1]?.body,
  ).toBe(JSON.stringify({ matchId: syntheticMatch.matchId }));
  tab('CV Match');
  expect(
    screen.getByText('100% weighted match across assessed requirements'),
  ).toBeVisible();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/match')),
  ).toHaveLength(1);
});

test('unsaved JD text does not become the Skill Match source', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('Edit JD');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Synthetic changed JD' },
  });
  tab('CV Match');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'View skill sources' }),
  );
  expect(
    screen.getByText('Synthetic saved JD', { selector: 'blockquote' }),
  ).toBeVisible();
  expect(
    screen.queryByText('Synthetic changed JD', { selector: 'blockquote' }),
  ).toBeNull();
  tab('Edit JD');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await closeSuccess();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled(),
  );
  tab('CV Match');
  expect(
    screen.queryByRole('heading', { name: 'JD–CV Skill Match' }),
  ).toBeNull();
});

test('a saved Skill Match remains visible after 15 minutes', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('CV Match');
  await screen.findByRole('combobox', { name: 'CV for this job' });
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      screen.getByText('100% weighted match across assessed requirements'),
    ).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    });
    expect(
      screen.getByText('100% weighted match across assessed requirements'),
    ).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
