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
      url.endsWith('/cv/current') ? { fileName: 'synthetic.pdf' } : result,
    ),
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText(/Fit score: 75\/100/);
  expect(screen.getByText('Consider')).toBeVisible();
  const requirements = screen.getByRole('region', { name: 'Requirements' });
  expect(screen.queryByLabelText('CV evidence')).toBeNull();
  expect(screen.getByText('Matched: 1')).toBeVisible();
  expect(screen.getByText('Unknown: 1')).toBeVisible();
  expect(screen.getByText('Total: 2')).toBeVisible();
  const matched = within(requirements).getByRole('button', {
    name: 'Matched: Python',
  });
  const gaps = within(requirements).getByRole('button', {
    name: 'Unknown: Insurance',
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
        ? Response.json({ fileName: 'synthetic.pdf' })
        : Response.json({}, { status: 503 }),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Saved CV: synthetic.pdf')).toBeVisible();
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
        url.endsWith('/cv/current') ? { fileName: 'synthetic.pdf' } : preview,
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText('Fit score: Not enough evidence (heuristic)');
  expect(screen.getByText(/Preferred · Experience/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Matched: Python' }));
  expect(screen.getByLabelText('CV evidence').textContent).toBe(quote);
  expect(screen.getByLabelText('CV evidence')).toHaveAttribute('tabindex', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Unknown' }));
  expect(
    within(screen.getByRole('region', { name: 'Requirements' })).getByText(
      'No unknown requirements reported.',
    ),
  ).toBeVisible();
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
          return Response.json({ fileName: 'synthetic.pdf' });
        return ++attempts === 1
          ? Response.json(result)
          : Response.json(
              {
                errorCode,
                message: 'Local model returned an incomplete assessment.',
              },
              { status: 503 },
            );
      }),
    );
    render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
    await screen.findByText('Saved CV: synthetic.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
    await screen.findByLabelText(/Fit score: 75\/100/);
    fireEvent.click(screen.getByRole('button', { name: 'Reanalyze CV Match' }));
    await screen.findByText(/last successful result.*retained/i);
    expect(screen.getByLabelText(/Fit score: 75\/100/)).toBeVisible();
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
          ? { fileName: 'synthetic.pdf' }
          : { ...result, score: 0, requirements: [] },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
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
          ? { fileName: 'synthetic.pdf' }
          : { ...result, score, requirements: rows },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-axon" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText(`Fit score: ${score}/100 (heuristic)`);
  const matched = screen.getByRole('region', { name: 'Requirements' });
  expect(screen.queryByLabelText('CV evidence')).toBeNull();
  for (const label of labels) {
    expect(within(matched).getByText(label)).toBeVisible();
    fireEvent.click(
      within(matched).getByRole('button', { name: `Matched: ${label}` }),
    );
  }
  expect(within(matched).getAllByLabelText('CV evidence')).toHaveLength(4);
  expect(screen.queryByLabelText('Fit score: 0/100 (heuristic)')).toBeNull();
});

test('filters, stable priority/status ordering and keyboard disclosure use existing result data', async () => {
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
          ? { fileName: 'synthetic.pdf' }
          : { ...result, requirements },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  await user.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText('Total: 5');
  const list = screen.getByRole('region', { name: 'Requirements' });
  const rows = () =>
    within(list)
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-expanded'));
  expect(rows().map((button) => button.getAttribute('aria-label'))).toEqual([
    'Unknown: Required gap first',
    'Unknown: Required gap second',
    'Matched: Required matched',
    'Unknown: Preferred gap',
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
  await user.click(screen.getByRole('button', { name: 'Matched' }));
  expect(rows()).toHaveLength(2);
  expect(within(list).queryByText('Required gap first')).toBeNull();
  expect(screen.getByText('Preferred')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Unknown' }));
  expect(rows()).toHaveLength(3);
  expect(within(list).queryByText('Required matched')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'All' }));
  expect(rows()).toHaveLength(5);
  expect(screen.getByText('Matched: 2')).toBeVisible();
  expect(screen.getByText('Unknown: 3')).toBeVisible();
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

test('overview surfaces source labels for strengths and required gaps with a neutral Low Fit indicator', async () => {
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
          ? { fileName: 'synthetic.pdf' }
          : { ...result, score: 39, recommendation: 'Low Fit', requirements },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByLabelText('Fit score: 39/100 (heuristic)');
  const strengths = screen.getByRole('region', { name: 'Key strengths' });
  expect(
    within(strengths)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    'Verified qualification 0',
    'Verified qualification 1',
    'Verified qualification 2',
  ]);
  expect(
    within(strengths).getByText('First 3 of 4 · Full evidence below'),
  ).toBeVisible();
  const gaps = screen.getByRole('region', { name: 'Required gaps' });
  expect(within(gaps).getByText('Required source gap')).toBeVisible();
  expect(within(gaps).queryByText('Preferred source gap')).toBeNull();
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
      name: 'Unknown: Preferred source gap',
    }),
  ).toBeVisible();
});

test('preview links reveal the exact requirement across filters and support keyboard navigation', async () => {
  const user = userEvent.setup();
  const requirements = [
    {
      ...result.requirements[0]!,
      requirement: 'Same label',
      cvQuote: 'Exact verified source.',
    },
    {
      ...result.requirements[1]!,
      requirement: 'Same label',
      jdQuote: 'Different required source.',
    },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { fileName: 'synthetic.pdf' }
          : { ...result, requirements },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  await user.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  const strengths = await screen.findByRole('region', {
    name: 'Key strengths',
  });
  const gaps = screen.getByRole('region', { name: 'Required gaps' });
  await user.click(screen.getByRole('button', { name: 'Unknown' }));
  const preview = within(strengths).getByRole('button', {
    name: 'View evidence: Same label',
  });
  preview.focus();
  await user.keyboard('{Enter}');
  const matched = screen.getByRole('button', { name: 'Matched: Same label' });
  await waitFor(() => expect(matched).toHaveFocus());
  expect(matched).toHaveAttribute('aria-current', 'true');
  expect(matched).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('CV evidence').textContent).toBe(
    'Exact verified source.',
  );
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Matched' }));
  await user.click(
    within(gaps).getByRole('button', { name: 'View evidence: Same label' }),
  );
  const gap = screen.getByRole('button', { name: 'Unknown: Same label' });
  await waitFor(() => expect(gap).toHaveFocus());
  expect(gap).toHaveAttribute('aria-current', 'true');
  expect(
    screen.getByRole('button', { name: 'Matched: Same label' }),
  ).not.toHaveAttribute('aria-current');
  expect(gap).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Different required source.')).toBeVisible();
  expect(screen.getByText('Not evidenced in CV')).toBeVisible();
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Unknown' }));
  expect(
    screen.getByRole('button', { name: 'Unknown: Same label' }),
  ).toHaveAttribute('aria-current', 'true');
  await user.click(screen.getByRole('button', { name: 'All' }));
  expect(
    screen.getByRole('button', { name: 'Unknown: Same label' }),
  ).toHaveAttribute('aria-current', 'true');
  gap.focus();
  await user.keyboard(' ');
  expect(gap).toHaveAttribute('aria-expanded', 'false');
});

test('preferred gap previews retain their actual priority and disclose no required gaps', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { fileName: 'synthetic.pdf' }
          : {
              ...result,
              requirements: [
                result.requirements[0],
                { ...result.requirements[1], priority: 'preferred' },
              ],
            },
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  const gaps = await screen.findByRole('region', { name: 'Preferred gaps' });
  expect(within(gaps).getByText(/No required gaps reported/)).toBeVisible();
  expect(within(gaps).queryByText('Python')).toBeNull();
  fireEvent.click(
    within(gaps).getByRole('button', { name: 'View evidence: Insurance' }),
  );
  const row = screen.getByRole('button', { name: 'Unknown: Insurance' });
  expect(row).toHaveAttribute('aria-expanded', 'true');
  expect(within(row).getByText('Preferred · Domain')).toBeVisible();
});

test('preview aligns an expanded target at the top and focuses without a second scroll, including repeat navigation', async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current') ? { fileName: 'synthetic.pdf' } : result,
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  await user.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  const row = await screen.findByRole('button', { name: 'Matched: Python' });
  const scroll = vi.fn(() => {
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('CV evidence')).toBeVisible();
  });
  row.scrollIntoView = scroll;
  const focus = vi.spyOn(row, 'focus');
  const preview = screen.getByRole('button', { name: 'View evidence: Python' });
  await user.click(preview);
  await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
  expect(scroll).toHaveBeenLastCalledWith({
    block: 'start',
    inline: 'nearest',
    behavior: 'instant',
  });
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  expect(row).toHaveFocus();
  await user.click(preview);
  await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  expect(row).toHaveFocus();
  expect(row).toHaveAttribute('aria-current', 'true');
});

test('a result arriving after a saved-job revision change stays invalidated and permits a fresh analysis', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const fetch = vi.fn(async (url: string) =>
    url.endsWith('/cv/current')
      ? Response.json({ fileName: 'synthetic.pdf' })
      : pending,
  );
  vi.stubGlobal('fetch', fetch);
  const view = render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
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
  expect(await screen.findByLabelText(/Fit score: 75\/100/)).toBeVisible();
});

test('compound states, component evidence and conflict passages survive filtering and keyboard reveal', async () => {
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
          ? { fileName: 'synthetic.pdf' }
          : { ...result, score: 38, recommendation: 'Low Fit', requirements },
      ),
    ),
  );
  const view = render(<CvMatchPanel jobId="synthetic" revision="1" />);
  await screen.findByText('Saved CV: synthetic.pdf');
  await user.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText('Partial: 1');
  expect(screen.getByText('Unknown: 1')).toBeVisible();
  expect(screen.getByText('Conflict / Needs review: 1')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Partial' }));
  const partial = screen.getByRole('button', {
    name: 'Partial: APIs and integrations',
  });
  partial.focus();
  await user.keyboard('{Enter}');
  expect(partial).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('AND · 1/2 components supported')).toBeVisible();
  expect(screen.getByLabelText('CV evidence: APIs').textContent).toBe(
    'Designed APIs.',
  );
  expect(screen.getByLabelText('JD evidence: integrations').textContent).toBe(
    'integrations',
  );
  expect(screen.getByText('Not evidenced in CV')).toBeVisible();
  await user.click(
    screen.getByRole('button', {
      name: 'Conflict / Needs review',
    }),
  );
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
  await user.click(screen.getByRole('button', { name: 'Unknown' }));
  expect(
    screen.queryByRole('button', { name: 'Partial: APIs and integrations' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Unknown: RAG knowledge' }),
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
          ? { fileName: 'synthetic.pdf' }
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
  await screen.findByText('Saved CV: synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText(/API returned an invalid matching result/);
  expect(screen.queryByLabelText(/Fit score:/)).toBeNull();
});
