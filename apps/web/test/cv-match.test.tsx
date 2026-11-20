import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
const result = {
  score: 75,
  recommendation: 'Consider',
  explanation: 'Synthetic heuristic',
  advice: 'Verify accurate experience.',
  requirements: [
    {
      requirement: 'Python',
      priority: 'required',
      category: 'skill',
      jdQuote: 'Python required',
      cvQuote: 'Built Python services.',
      status: 'EVIDENCED',
    },
    {
      requirement: 'Insurance',
      priority: 'required',
      category: 'domain',
      jdQuote: 'Insurance experience',
      cvQuote: '',
      status: 'NOT_EVIDENCED',
    },
  ],
};
test('loads saved CV, displays local analysis and clears stale results after job edits', async () => {
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/cv/current')
        ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
        : result,
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  // The selector is the only place the job's CV is named.
  expect(screen.queryByText(/Saved CV:/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText(
    /JD–CV Skill Match is unavailable for this saved assessment/,
  );
  expect(screen.queryByLabelText(/Technical Evidence Coverage/)).toBeNull();
  view.rerender(<CvMatchPanel jobId="synthetic-job" revision="2" />);
  expect(screen.queryByLabelText(/Technical Evidence Coverage:/)).toBeNull();
});
test('failed analysis leaves saved CV available for manual retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/cv/current')
        ? Response.json({ id: 'synthetic-cv', fileName: 'synthetic.pdf' })
        : Response.json({}, { status: 503 }),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByRole('alert');
  expect(
    screen.getByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  expect(
    screen.getByRole('button', { name: 'Analyze CV Match' }),
  ).toBeEnabled();
});

test.each([
  'CV_MATCH_INCOMPLETE',
  'CV_MATCH_EVIDENCE_REJECTED',
  'CV_MATCH_INVALID_OUTPUT',
])(
  'failed reanalysis (%s) retains the last successful result rather than replacing it with zero',
  async (errorCode) => {
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/cv/current'))
          return Response.json({
            id: 'synthetic-cv',
            fileName: 'synthetic.pdf',
          });
        if (url.endsWith('/opportunities/cv')) return Response.json([]);
        return ++attempts === 1
          ? Response.json(result)
          : Response.json(
              {
                errorCode,
                message: 'The AI model returned an incomplete assessment.',
              },
              { status: 503 },
            );
      }),
    );
    render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
    expect(
      await screen.findByRole('combobox', { name: 'CV for this job' }),
    ).toHaveTextContent('synthetic.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
    await screen.findByText(
      /JD–CV Skill Match is unavailable for this saved assessment/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reanalyze CV Match' }));
    await screen.findByText(/last successful result.*retained/i);
    expect(
      screen.getByText(
        /JD–CV Skill Match is unavailable for this saved assessment/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Technical Evidence Coverage: 0\/100/),
    ).toBeNull();
    expect(screen.getByText(/last successful result.*retained/i)).toBeVisible();
  },
);

test('a malformed success response cannot masquerade as a legitimate zero result', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : { ...result, score: 0, requirements: [] },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText(/API returned an invalid matching result/);
  expect(screen.queryByLabelText(/Technical Evidence Coverage:/)).toBeNull();
});

test('no saved CV keeps the initial empty state and analyze disabled', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(null)),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  expect(await screen.findByText('No saved CV yet.')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Analyze CV Match' }),
  ).toBeDisabled();
  expect(screen.queryByRole('region', { name: 'Requirements' })).toBeNull();
});

test('a result arriving after a saved-job revision change stays invalidated and permits a fresh analysis', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.fn(async (url: string) =>
    url.endsWith('/cv/current')
      ? Response.json({ id: 'synthetic-cv', fileName: 'synthetic.pdf' })
      : pending,
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(<CvMatchPanel jobId="synthetic" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  expect(screen.getByText('Processing locally…')).toBeVisible();
  view.rerender(<CvMatchPanel jobId="synthetic" revision="2" />);
  finish(Response.json(result));
  await waitFor(() =>
    expect(screen.queryByText('Processing locally…')).toBeNull(),
  );
  expect(screen.queryByLabelText(/Technical Evidence Coverage:/)).toBeNull();
  fetch.mockResolvedValueOnce(Response.json(result));
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  expect(
    await screen.findByText(
      /JD–CV Skill Match is unavailable for this saved assessment/,
    ),
  ).toBeInTheDocument();
});

test('partial response with malformed component evidence is rejected rather than rendered', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : {
              ...result,
              requirements: [
                {
                  ...result.requirements[0],
                  status: 'PARTIAL',
                  coverage: { mode: 'AND', components: [null] },
                },
              ],
            },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText(/API returned an invalid matching result/);
  expect(screen.queryByLabelText(/Technical Evidence Coverage:/)).toBeNull();
});

test.each([
  [{ evidenceUncertain: true }, /may have missed some CV passages/, false],
  [
    { evidenceUncertain: false, keptPrevious: true },
    /previous saved match was kept/,
    true,
  ],
])('reliability notice %j', async (extra, notice, upToDate) => {
  const flagged = {
    ...result,
    ...extra,
    requirements: [
      result.requirements[0],
      {
        ...result.requirements[1],
        evidence: { modelQuote: 'EMPTY', review: true },
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : flagged,
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  await screen.findByRole('combobox', { name: 'CV for this job' });
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText(
    /JD–CV Skill Match is unavailable for this saved assessment/,
  );
  expect(screen.getByText(notice)).toBeVisible();
  // An unreliable result must not claim that no new analysis is needed.
  expect(screen.getByText(/^Saved match/)).toBeVisible();
  expect(screen.queryAllByText(/No new analysis is needed/).length > 0).toBe(
    upToDate,
  );
});

test.each([
  [
    'CV_MATCH_PROVIDER_BUSY',
    /temporarily busy\. Your saved match is unchanged\. Try again in a few minutes/,
  ],
  [
    'CV_MATCH_EVIDENCE_REJECTED',
    /could not be verified.*saved assessment is unchanged/,
  ],
])(
  '%s keeps the previous result and explains how to retry',
  async (errorCode, message) => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/cv/current'))
          return Response.json({
            id: 'synthetic-cv',
            fileName: 'synthetic.pdf',
          });
        if (init?.method === 'POST' && posts++ > 0)
          return Response.json({ errorCode, message: 'x' }, { status: 503 });
        return Response.json(result);
      }),
    );
    render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
    await screen.findByRole('combobox', { name: 'CV for this job' });
    fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
    await screen.findByText(
      /JD–CV Skill Match is unavailable for this saved assessment/,
    );
    fireEvent.click(screen.getByRole('button', { name: /analyze CV Match/i }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(
      screen.getByText(
        /JD–CV Skill Match is unavailable for this saved assessment/,
      ),
    ).toBeInTheDocument();
  },
);
