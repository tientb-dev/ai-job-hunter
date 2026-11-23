import { ThemeProvider } from '@mui/material';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { within } from '@testing-library/react';
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
import { syntheticMatch } from './fixtures/cv-suggestions';
const id = '00000000-0000-4000-8000-123456789012';
function setup(
  saved = false,
  initialMatchRead?: Promise<void>,
  withFindings = false,
) {
  const result = {
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
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/cv/current'))
      return Response.json({
        id: 'synthetic-cv',
        fileName: 'synthetic.pdf',
        updatedAt: syntheticMatch.cvUpdatedAt,
      });
    if (url.endsWith('/drafts/list'))
      return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/drafts/readiness'))
      return Response.json({
        contractVersion: '1',
        ready: false,
        reason: 'CV_DRAFT_MATCH_REQUIRED',
        pins: null,
        matchValidForMs: 0,
      });
    if (url.endsWith('/match')) {
      if (init?.method !== 'POST') {
        await initialMatchRead;
        return Response.json(
          saved
            ? { status: 'VALID', result, matchValidForMs: 900000 }
            : {
                status: 'MISSING',
                ...(withFindings && {
                  cvUpdatedAt: syntheticMatch.cvUpdatedAt,
                  skillMatch: {
                    ...result.skillMatch,
                    findings: [
                      {
                        kind: 'skill',
                        label: 'Java',
                        sources: [
                          { field: 'jdText', start: 0, end: 4, quote: 'Java' },
                        ],
                        evidence: {
                          quote: 'Designed Java APIs.',
                          origin: 'source',
                        },
                      },
                    ],
                  },
                }),
              },
        );
      }
      saved = true;
      return Response.json(result);
    }
    if (init?.method === 'PUT') {
      saved = false;
      return Response.json({
        ...emptyOpportunity(),
        id,
        ...JSON.parse(init.body as string),
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    }
    return Response.json({
      ...emptyOpportunity(),
      id,
      title: 'Synthetic engineer',
      company: 'Example',
      description: 'Synthetic saved JD',
      status: 'SAVED',
      updatedAt: syntheticMatch.jobUpdatedAt,
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

const analyzeButton = () =>
  waitFor(() => {
    const button = screen.getByRole('button', { name: 'Analyze CV Match' });
    expect(button).toBeEnabled();
    return button;
  });

test.each([false, true])(
  'pre-analysis preserves the Tailored CV handoff (findings: %s)',
  async (withFindings) => {
    const { fetch } = setup(false, undefined, withFindings);
    await screen.findByRole('heading', { name: 'Synthetic engineer' });
    tab('CV Match');
    const analyze = await analyzeButton();
    const intro = screen.getByRole('region', {
      name: 'Your CV Match assessment is not ready yet',
    });
    expect(intro).toContainElement(analyze);
    expect(intro).not.toContainElement(screen.getByText('About this analysis'));
    expect(analyze).toHaveClass('MuiButton-contained');

    const preview = screen.getByRole('button', { name: 'Quick skill preview' });
    if (withFindings) {
      expect(
        screen.queryByRole('button', { name: 'Open Tailored CV' }),
      ).toBeNull();
      fireEvent.click(preview);
      expect(
        within(
          screen.getByRole('region', { name: 'Quick skill preview' }),
        ).getByRole('button', { name: 'Open Tailored CV' }),
      ).toBeVisible();
    }
    const handoff = screen.getByRole('button', { name: 'Open Tailored CV' });
    expect(handoff).toHaveClass('MuiButton-outlined');
    if (!withFindings) {
      expect(
        handoff.compareDocumentPosition(preview) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Mobile: the tab bar has scrolled above the viewport.
    const tailoredTab = screen.getByRole('tab', { name: 'Tailored CV' });
    const scroll = vi.fn();
    tailoredTab.scrollIntoView = scroll;
    vi.spyOn(tailoredTab, 'getBoundingClientRect').mockReturnValue({
      top: -151,
    } as DOMRect);
    fireEvent.click(handoff);
    const tailored = screen.getByRole('tab', { name: 'Tailored CV' });
    expect(tailored).toHaveAttribute('aria-selected', 'true');
    expect(tailored).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant',
    });
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.filter((v, i) => ids.indexOf(v) !== i)).toEqual([]);
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url.endsWith('/match') && init?.method === 'POST',
      ),
    ).toBe(false);
  },
);

test('CV Match opens Tailored CV for the same job and selected CV with no additional AI call', async () => {
  const { fetch } = setup(true);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('CV Match');
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  await screen.findByText('100% weighted match across assessed requirements');
  const before = fetch.mock.calls.length;
  const handoff = screen.getByRole('button', { name: 'Open Tailored CV' });
  expect(handoff).toHaveClass('MuiButton-contained');
  expect(handoff.closest('.MuiPaper-root')).toHaveTextContent(
    'Saved CV Match result',
  );
  expect(
    screen.queryByRole('button', { name: 'Quick skill preview' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Reanalyze CV Match' }),
  ).toHaveClass('MuiButton-outlined');
  fireEvent.click(handoff);
  expect(screen.getByRole('tab', { name: 'Tailored CV' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.queryByRole('tab', { name: 'Review & Improve CV' })).toBeNull();
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  const calls = fetch.mock.calls.slice(before);
  expect(calls.some(([url]) => url.endsWith(`/${id}/cv/current`))).toBe(true);
  expect(
    calls.some(
      ([url, init]) =>
        url.endsWith(`/${id}/drafts/readiness`) &&
        JSON.parse(init!.body as string).expectedSavedCvUpdatedAt ===
          syntheticMatch.cvUpdatedAt,
    ),
  ).toBe(true);
  expect(
    calls.filter(
      ([url, init]) =>
        init?.method === 'POST' && !/\/drafts\/(readiness|list)$/.test(url),
    ),
  ).toEqual([]);
});

test('unsaved JD text does not become the Skill Match source', async () => {
  let finishMatchRead!: () => void;
  const matchRead = new Promise<void>((resolve) => {
    finishMatchRead = resolve;
  });
  const { fetch } = setup(false, matchRead);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url.endsWith('/match') && init?.method !== 'POST',
      ),
    ).toBe(true),
  );
  tab('Edit JD');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Synthetic changed JD' },
  });
  tab('CV Match');
  expect(
    screen.getByRole('button', { name: 'Analyze CV Match' }),
  ).toBeDisabled();
  await act(async () => finishMatchRead());
  fireEvent.click(await analyzeButton());
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
  const analyze = await analyzeButton();
  vi.useFakeTimers();
  try {
    fireEvent.click(analyze);
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
