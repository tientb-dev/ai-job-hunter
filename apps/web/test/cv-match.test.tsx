import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
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
  await screen.findByLabelText(/Fit score: 75\/100/);
  expect(screen.getByText('Clarify key evidence in your CV')).toBeVisible();
  const requirements = screen.getByRole('region', { name: 'Requirements' });
  expect(screen.queryByLabelText('CV evidence')).toBeNull();
  expect(screen.getByText('Matched: 1')).toBeVisible();
  expect(screen.getByText('Not clearly shown in CV: 1')).toBeVisible();
  expect(screen.getByText('Total: 2')).toBeVisible();
  expect(screen.getByText('Strengths: 1')).toBeVisible();
  expect(screen.getByText('To clarify: 1')).toBeVisible();
  expect(
    screen.getByText('Reference score: 75/100 · see Technical details'),
  ).toBeVisible();
  // Matched is collapsed by default; the group to clarify is open.
  const matchedGroup = within(requirements).getByRole('button', {
    name: 'Already matched (1)',
  });
  expect(matchedGroup).toHaveAttribute('aria-expanded', 'false');
  expect(
    within(requirements).getByRole('button', { name: 'To clarify (1)' }),
  ).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(matchedGroup);
  expect(matchedGroup).toHaveAttribute('aria-expanded', 'true');
  const matched = within(requirements).getByRole('button', {
    name: 'Matched: Python',
  });
  const gaps = within(requirements).getByRole('button', {
    name: 'Not clearly shown in CV: Insurance',
  });
  expect(matched).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(matched);
  expect(matched).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('CV evidence').textContent).toBe(
    'Built Python services.',
  );
  expect(screen.getByLabelText('JD evidence').textContent).toBe(
    'Python required',
  );
  expect(within(matched).getByText('Required')).toBeVisible();
  expect(within(matched).queryByText('Skill')).toBeNull();
  expect(within(matched).getByRole('img', { name: 'Matched' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
  expect(
    screen.getByRole('progressbar', { name: 'Heuristic fit score' }),
  ).toHaveAttribute('aria-valuenow', '75');
  fireEvent.click(matched);
  await waitFor(() =>
    expect(screen.queryByLabelText('CV evidence')).toBeNull(),
  );
  fireEvent.click(gaps);
  expect(within(gaps).getByText(/Required · Domain/)).toBeVisible();
  expect(screen.getByText('Not evidenced in CV')).toBeVisible();
  expect(screen.getByText(/does not mean you do not possess/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Reanalyze CV Match' }),
  ).toBeEnabled();
  expect(fetch).toHaveBeenCalledWith(
    '/api/v1/opportunities/synthetic-job/match',
    expect.objectContaining({ method: 'POST' }),
  );
  view.rerender(<CvMatchPanel jobId="synthetic-job" revision="2" />);
  expect(screen.queryByLabelText(/Fit score:/)).toBeNull();
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

test('unknown score and long multiline evidence preserve exact source text', async () => {
  const quote = `Synthetic evidence with spacing.  Two spaces.\n${'Long source line. '.repeat(100)}`;
  const preview = {
    ...result,
    score: null,
    requirements: [
      {
        ...result.requirements[0],
        priority: 'preferred',
        category: 'experience',
        cvQuote: quote,
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : preview,
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText('Fit score: Not enough evidence (heuristic)');
  fireEvent.click(screen.getByRole('button', { name: 'Already matched (1)' }));
  expect(screen.getByText(/Preferred · Experience/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Matched: Python' }));
  expect(screen.getByLabelText('CV evidence').textContent).toBe(quote);
  expect(screen.getByLabelText('CV evidence')).toHaveAttribute('tabindex', '0');
  // Empty groups are not rendered.
  expect(screen.queryByRole('button', { name: /^To clarify/ })).toBeNull();
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
    await screen.findByLabelText(/Fit score: 75\/100/);
    fireEvent.click(screen.getByRole('button', { name: 'Reanalyze CV Match' }));
    await screen.findByText(/last successful result.*retained/i);
    expect(screen.getByLabelText(/Fit score: 75\/100/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Fit score: 0\/100/)).toBeNull();
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
  expect(screen.queryByLabelText(/Fit score:/)).toBeNull();
});

test('Axon-style API result preserves verified Java, experience, SQL and tooling in the UI', async () => {
  const labels = [
    'Java backend',
    '6+ years experience',
    'SQL databases',
    'AI-assisted development tooling',
  ];
  const verifiedRows = labels.map((label) => ({
    requirement: label,
    priority: 'required',
    category: 'skill',
    jdQuote: `Synthetic JD: ${label}`,
    cvQuote: `Synthetic CV: ${label}`,
    status: 'EVIDENCED',
  }));
  const rows = [
    ...verifiedRows,
    {
      requirement: 'Cloud systems',
      priority: 'required',
      category: 'skill',
      jdQuote: 'Synthetic JD: Cloud systems',
      cvQuote: '',
      status: 'NOT_EVIDENCED',
    },
  ];
  const score = Math.round((100 * verifiedRows.length) / rows.length);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : { ...result, score, requirements: rows },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-axon" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText(`Fit score: ${score}/100 (heuristic)`);
  const matched = screen.getByRole('region', { name: 'Requirements' });
  expect(screen.queryByLabelText('CV evidence')).toBeNull();
  fireEvent.click(
    within(matched).getByRole('button', { name: 'Already matched (4)' }),
  );
  for (const label of labels) {
    expect(within(matched).getByText(label)).toBeVisible();
    fireEvent.click(
      within(matched).getByRole('button', { name: `Matched: ${label}` }),
    );
  }
  expect(within(matched).getAllByLabelText('CV evidence')).toHaveLength(4);
  expect(screen.queryByLabelText('Fit score: 0/100 (heuristic)')).toBeNull();
});

test('status groups, stable priority ordering and keyboard disclosure use existing result data', async () => {
  const user = userEvent.setup();
  const requirements = [
    {
      ...result.requirements[0]!,
      requirement: 'Preferred matched',
      priority: 'preferred',
    },
    { ...result.requirements[0]!, requirement: 'Required matched' },
    { ...result.requirements[1]!, requirement: 'Required gap first' },
    {
      ...result.requirements[1]!,
      requirement: 'Preferred gap',
      priority: 'preferred',
    },
    { ...result.requirements[1]!, requirement: 'Required gap second' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : { ...result, requirements },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  await user.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText('Total: 5');
  const list = screen.getByRole('region', { name: 'Requirements' });
  const rows = () =>
    within(list)
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-label'));
  const clarify = within(list).getByRole('button', { name: 'To clarify (3)' });
  const matched = within(list).getByRole('button', {
    name: 'Already matched (2)',
  });
  expect(rows().map((button) => button.getAttribute('aria-label'))).toEqual([
    'Not clearly shown in CV: Required gap first',
    'Not clearly shown in CV: Required gap second',
    'Not clearly shown in CV: Preferred gap',
  ]);
  matched.focus();
  await user.keyboard('{Enter}');
  expect(matched).toHaveAttribute('aria-expanded', 'true');
  expect(rows().map((button) => button.getAttribute('aria-label'))).toEqual([
    'Not clearly shown in CV: Required gap first',
    'Not clearly shown in CV: Required gap second',
    'Not clearly shown in CV: Preferred gap',
    'Matched: Required matched',
    'Matched: Preferred matched',
  ]);
  expect(
    rows().every((button) => button.getAttribute('aria-expanded') === 'false'),
  ).toBe(true);
  const first = rows()[0]!;
  first.focus();
  await user.keyboard('{Enter}');
  expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Not evidenced in CV')).toBeVisible();
  await user.keyboard(' ');
  expect(first).toHaveAttribute('aria-expanded', 'false');
  await user.click(clarify);
  expect(clarify).toHaveAttribute('aria-expanded', 'false');
  expect(rows()).toHaveLength(2);
  expect(screen.getByText('Matched: 2')).toBeVisible();
  expect(screen.getByText('Not clearly shown in CV: 3')).toBeVisible();
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

test('overview summarizes strengths and items to clarify with a neutral Low Fit indicator', async () => {
  const requirements = [
    ...Array.from({ length: 4 }, (_, index) => ({
      ...result.requirements[0]!,
      requirement: `Verified qualification ${index}`,
    })),
    { ...result.requirements[1]!, requirement: 'Required source gap' },
    {
      ...result.requirements[1]!,
      requirement: 'Preferred source gap',
      priority: 'preferred',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : { ...result, score: 39, recommendation: 'Low Fit', requirements },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText('Fit score: 39/100 (heuristic)');
  expect(screen.getByText('Strengths: 4')).toBeVisible();
  expect(screen.getByText('To clarify: 2')).toBeVisible();
  // The two-column preview no longer repeats the requirement list.
  expect(screen.queryByRole('region', { name: 'Key strengths' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
  expect(
    screen.getByRole('progressbar', { name: 'Heuristic fit score' }),
  ).toHaveAttribute('aria-valuenow', '39');
  expect(screen.getByRole('progressbar')).toHaveClass(
    'MuiLinearProgress-colorInherit',
  );
  expect(screen.getByText(/Not a hiring probability/)).toBeVisible();
  expect(screen.queryByLabelText('CV evidence')).toBeNull();
  const all = screen.getByRole('region', { name: 'Requirements' });
  expect(
    within(all).getByRole('button', {
      name: 'Not clearly shown in CV: Preferred source gap',
    }),
  ).toBeVisible();
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
  expect(screen.queryByLabelText(/Fit score:/)).toBeNull();
  fetch.mockResolvedValueOnce(Response.json(result));
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  expect(
    await screen.findByLabelText(/Fit score: 75\/100/),
  ).toBeInTheDocument();
});

test('compound states, component evidence and conflict passages survive grouping and keyboard reveal', async () => {
  const user = userEvent.setup();
  const component = (
    label: string,
    status: string,
    cvQuote = '',
    conflictingQuotes: string[] = [],
  ) => ({
    id: label,
    label,
    status,
    jdQuote: label,
    cvQuote,
    conflictingQuotes,
  });
  const requirements = [
    {
      ...result.requirements[0],
      requirement: 'APIs and integrations',
      status: 'PARTIAL',
      cvQuote: 'Designed APIs.',
      coverage: {
        mode: 'AND',
        reason: 'Review the selected component evidence.',
        credit: 0.5,
        components: [
          component('APIs', 'EVIDENCED', 'Designed APIs.'),
          component('integrations', 'NOT_EVIDENCED'),
        ],
      },
    },
    {
      ...result.requirements[0],
      requirement: 'MCP or knowledge graphs',
      status: 'CONFLICT',
      cvQuote: 'Built MCP servers.',
      coverage: {
        mode: 'OR',
        reason: 'Contradictory CV statements need review.',
        credit: 0,
        components: [
          component('MCP', 'CONFLICT', 'Built MCP servers.', [
            'I have never used MCP.',
          ]),
          component('knowledge graphs', 'NOT_EVIDENCED'),
        ],
      },
    },
    {
      ...result.requirements[1],
      requirement: 'RAG knowledge',
      status: 'NOT_EVIDENCED',
    },
    result.requirements[0],
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : { ...result, score: 38, recommendation: 'Low Fit', requirements },
      ),
    ),
  );
  const view = render(<CvMatchPanel jobId="synthetic" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  await user.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText('Partial: 1');
  expect(screen.getByText('Not clearly shown in CV: 1')).toBeVisible();
  expect(screen.getByText('Conflict / Needs review: 1')).toBeVisible();
  const partial = screen.getByRole('button', {
    name: 'Partial: APIs and integrations',
  });
  partial.focus();
  await user.keyboard('{Enter}');
  expect(partial).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.getByText('All of these · 1/2 components supported'),
  ).toBeVisible();
  // No internal mode codes or generic English diagnostics reach the user.
  expect(screen.queryByText(/\b(?:SINGLE|UNKNOWN|AND|OR) ·/u)).toBeNull();
  expect(
    screen.queryByText('Review the selected component evidence.'),
  ).toBeNull();
  expect(screen.getByLabelText('CV evidence: APIs').textContent).toBe(
    'Designed APIs.',
  );
  expect(screen.getByLabelText('JD evidence: integrations').textContent).toBe(
    'integrations',
  );
  expect(screen.getByText('Not evidenced in CV')).toBeVisible();
  const conflict = screen.getByRole('button', {
    name: 'Conflict / Needs review: MCP or knowledge graphs',
  });
  conflict.focus();
  await user.keyboard(' ');
  expect(
    screen.getByLabelText('Conflicting CV evidence: MCP').textContent,
  ).toBe('I have never used MCP.');
  expect(screen.getByLabelText('Conflicting CV evidence: MCP')).toHaveAttribute(
    'tabindex',
    '0',
  );
  expect(
    screen.getByRole('button', {
      name: 'Not clearly shown in CV: RAG knowledge',
    }),
  ).toBeVisible();
  view.rerender(<CvMatchPanel jobId="synthetic" revision="2" />);
  expect(screen.queryByLabelText(/Fit score:/)).toBeNull();
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
  expect(screen.queryByLabelText(/Fit score:/)).toBeNull();
});

test('an unverified requirement set shows a review state, not a numeric Low Fit', async () => {
  const review = {
    ...result,
    score: null,
    recommendation: 'Review requirements',
    advice:
      'The saved JD has no recognizable requirements section, so these requirements may be incomplete and no fit score is given. Review the job requirements, then analyze again.',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : review,
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText(
    'Fit score: requirements may be incomplete (heuristic)',
  );
  expect(screen.getAllByText('Review requirements')[0]).toBeVisible();
  expect(screen.queryByText('Add missing evidence to your CV')).toBeNull();
  expect(screen.queryByText(/\/ 100/)).toBeNull();
});

test.each([
  [
    { evidenceUncertain: true },
    /may have missed CV evidence for some required/,
    false,
  ],
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
  await screen.findByLabelText(/Fit score: 75\/100/);
  expect(screen.getByText(notice)).toBeVisible();
  expect(screen.getByText('Evidence needs review')).toBeVisible();
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
    /could not be verified.*Your saved match is unchanged/,
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
    await screen.findByLabelText(/Fit score: 75\/100/);
    fireEvent.click(screen.getByRole('button', { name: /analyze CV Match/i }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByLabelText(/Fit score: 75\/100/)).toBeInTheDocument();
  },
);
