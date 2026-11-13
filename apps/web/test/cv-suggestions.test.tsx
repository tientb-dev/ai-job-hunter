import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import {
  hasSuggestionContext,
  isSuggestionsResponse,
  type CvSuggestionsResponse,
} from '../src/features/inbox/cv-suggestions.contract';
import {
  syntheticMatch,
  syntheticSuggestions,
  syntheticCv,
  conflictMatch,
  conflictSuggestions,
} from './fixtures/cv-suggestions';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness({
  revision = '1',
  jobId = 'synthetic-job',
}: {
  revision?: string;
  jobId?: string;
}) {
  const [view, setView] = useState<'match' | 'improve'>('improve');
  return (
    <>
      <button onClick={() => setView('match')}>Open CV Match</button>
      <button onClick={() => setView('improve')}>Open Improve CV</button>
      <CvMatchPanel
        jobId={jobId}
        revision={revision}
        view={view}
        onGoToMatch={() => setView('match')}
      />
    </>
  );
}
function setup(
  response = syntheticSuggestions,
  match = syntheticMatch,
  saved = true,
) {
  const select = vi
    .fn<() => Promise<Response>>()
    .mockImplementation(async () => Response.json(response));
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/cv/current'))
      return Response.json(
        saved
          ? { fileName: 'synthetic.pdf', updatedAt: match.cvUpdatedAt }
          : null,
      );
    if (url.endsWith('/cv-improvement-suggestions')) return select();
    if (url.endsWith('/match'))
      return Response.json({ ...match, analyzedAt: new Date().toISOString() });
    throw new Error('Unexpected synthetic route');
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(<Harness />);
  async function analyze() {
    fireEvent.click(screen.getByRole('button', { name: 'Go to CV Match' }));
    await screen.findByText('Saved CV: synthetic.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
    await screen.findByRole('button', { name: 'Reanalyze CV Match' });
    fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
    expect(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    ).toBeEnabled();
  }
  async function suggest() {
    fireEvent.click(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    );
    await screen.findAllByRole('article');
  }
  return { ...view, fetch, select, analyze, suggest };
}
const section = () => screen.getByRole('region', { name: 'Improve your CV' });

test.each([true, false])(
  'Improve is accessible before analysis and disabled prerequisite is clear (saved=%s)',
  async (saved) => {
    const state = setup(syntheticSuggestions, syntheticMatch, saved);
    expect(
      await screen.findByRole('heading', { name: 'Improve your CV' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    ).toBeDisabled();
    if (saved)
      await screen.findByText(/Analyze your saved CV against this job first/);
    else
      expect(
        screen.getByText(/Save a CV in CV Match, then analyze/),
      ).toBeVisible();
    expect(state.select).not.toHaveBeenCalled();
    expect(state.fetch.mock.calls.some(([url]) => url.endsWith('/match'))).toBe(
      false,
    );
  },
);

test('explicit suggestions show four compact cards, a header count and preserve all/less', async () => {
  const match = structuredClone(syntheticMatch),
    response = structuredClone(syntheticSuggestions);
  for (const [index, label] of [
    [4, 'Docker'],
    [5, 'Terraform'],
  ] as const) {
    const row = structuredClone(syntheticMatch.requirements[1]!);
    row.parentId = `p${index}`;
    row.requirement = label;
    row.jdQuote = label;
    row.coverage!.components[0]!.label = label;
    row.coverage!.components[0]!.jdQuote = label;
    match.requirements.push(row);
    const card = structuredClone(syntheticSuggestions.suggestions[1]!);
    card.id = `candidate-${index}`;
    card.parentId = `p${index}`;
    card.rank = index;
    card.requirement = label;
    card.jdEvidence[0]!.parentId = `p${index}`;
    card.jdEvidence[0]!.quote = label;
    response.suggestions.push(card);
  }
  const state = setup(response, match);
  await state.analyze();
  expect(state.select).not.toHaveBeenCalled();
  await state.suggest();
  expect(state.fetch).toHaveBeenCalledWith(
    '/api/v1/opportunities/synthetic-job/cv-improvement-suggestions',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ matchId: syntheticMatch.matchId }),
    }),
  );
  expect(within(section()).getAllByRole('article')).toHaveLength(4);
  expect(within(section()).getByText('5 suggestions')).toBeVisible();
  expect(
    within(section()).getByText('5 suggestions ready for review.'),
  ).toHaveAttribute('aria-live', 'polite');
  expect(
    within(section()).getByText('5 suggestions ready for review.'),
  ).toHaveStyle({ width: '1px', height: '1px', position: 'absolute' });
  const card = within(section()).getAllByRole('article')[0]!;
  expect(within(card).getByText('Required · Partial')).toBeVisible();
  expect(
    within(card).queryByText('Canonical saved-job requirement evidence'),
  ).toBeNull();
  expect(
    within(card).getByRole('heading', { name: 'APIs + integrations' }),
  ).toBeVisible();
  expect(
    within(card).getByText('The CV does not yet establish: integrations.'),
  ).toBeVisible();
  expect(
    within(card).getByText(
      /If accurate, add supporting facts and dates; for work examples, state your role and what you did/,
    ),
  ).toBeVisible();
  expect(
    within(card).queryByRole('button', { name: 'Evidence and details' }),
  ).toBeNull();
  expect(
    within(card).getByRole('button', { name: 'Review evidence' }),
  ).toBeVisible();
  expect(
    within(section()).queryByText(/Can you verify an accurate example/),
  ).toBeNull();
  expect(within(section()).queryByText('Job evidence')).toBeNull();
  expect(within(section()).queryByText('Requirement components')).toBeNull();
  expect(
    within(card).getByLabelText('Supported original wording').textContent,
  ).toBe(syntheticCv);
  fireEvent.click(screen.getByRole('button', { name: 'Show all (5)' }));
  expect(within(section()).getAllByRole('article')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
  expect(within(section()).getAllByRole('article')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Open CV Match' }));
  // Workspace Match shows the assessment with its gaps-and-advice below.
  expect(screen.getByRole('region', { name: 'Improve your CV' })).toBeVisible();
  expect(screen.getByLabelText('Fit score: 50/100 (heuristic)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
  expect(within(section()).getAllByRole('article')).toHaveLength(4);
  expect(state.select).toHaveBeenCalledTimes(1);
});

test('analysis in progress disables Suggest across tab switching', async () => {
  const state = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Go to CV Match' }));
  await screen.findByText('Saved CV: synthetic.pdf');
  const pending = deferred<Response>();
  state.fetch.mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
  expect(
    screen.getByText(/CV analysis or upload is in progress/),
  ).toBeVisible();
  await act(async () =>
    pending.resolve(
      Response.json({
        ...syntheticMatch,
        analyzedAt: new Date().toISOString(),
      }),
    ),
  );
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeEnabled();
});

test('suggesting excludes duplicate and source-changing actions while retaining the match', async () => {
  const state = setup();
  await state.analyze();
  const pending = deferred<Response>();
  state.select.mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Suggest improvements' }));
  expect(
    screen.getByRole('button', { name: 'Requesting suggestions…' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Open CV Match' }));
  expect(
    screen.getByRole('button', { name: 'Reanalyze CV Match' }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Save CV for matching')).toBeDisabled();
  expect(screen.getByLabelText('Fit score: 50/100 (heuristic)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
  await act(async () => pending.resolve(Response.json(syntheticSuggestions)));
  expect(state.select).toHaveBeenCalledTimes(1);
});

test('empty/error/retry retain safe same-match cards and never display exception payloads', async () => {
  const state = setup();
  await state.analyze();
  state.select.mockRejectedValueOnce(new Error('PRIVATE_SYNTHETIC_PAYLOAD'));
  fireEvent.click(screen.getByRole('button', { name: 'Suggest improvements' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(/PRIVATE_SYNTHETIC/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry suggestions' }));
  await screen.findAllByRole('article');
  state.select.mockResolvedValueOnce(
    Response.json({ ...syntheticSuggestions, suggestions: [] }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Regenerate suggestions' }),
  );
  await screen.findByText(/No additional evidence-backed suggestions found/);
  expect(screen.queryByRole('article')).toBeNull();
});

test('expired/replaced backend snapshot clears cards and disables Suggest without automatic reanalysis', async () => {
  const state = setup();
  await state.analyze();
  await state.suggest();
  state.select.mockResolvedValueOnce(
    Response.json({ errorCode: 'CV_SUGGESTIONS_STALE_MATCH' }, { status: 409 }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Regenerate suggestions' }),
  );
  await screen.findByText(/This match is no longer current/);
  expect(screen.queryByRole('article')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
  expect(
    state.fetch.mock.calls.filter(([url]) => url.endsWith('/match')),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Go to CV Match' }));
  expect(
    screen.getByRole('button', { name: 'Reanalyze CV Match' }),
  ).toBeEnabled();
});

test.each(['matchId', 'cvUpdatedAt', 'jobUpdatedAt'] as const)(
  'mismatched %s rejects context',
  async (field) => {
    const state = setup({
      ...syntheticSuggestions,
      [field]: field === 'matchId' ? 'replaced' : '2026-11-06T00:00:00.000Z',
    });
    await state.analyze();
    fireEvent.click(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    );
    await screen.findByText(/no longer current/);
    expect(screen.queryByRole('article')).toBeNull();
  },
);

test.each(['job', 'edit'] as const)(
  'late response after %s invalidation cannot restore cards',
  async (kind) => {
    const state = setup();
    await state.analyze();
    const pending = deferred<Response>();
    state.select.mockReturnValue(pending.promise);
    fireEvent.click(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    );
    state.rerender(
      <Harness
        revision="2"
        jobId={kind === 'job' ? 'other-job' : 'synthetic-job'}
      />,
    );
    await act(async () => pending.resolve(Response.json(syntheticSuggestions)));
    expect(screen.queryByRole('article')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Suggest improvements' }),
    ).toBeDisabled();
  },
);

test('reanalysis failure invalidates the previous context, not just the cards', async () => {
  const state = setup();
  await state.analyze();
  await state.suggest();
  fireEvent.click(screen.getByRole('button', { name: 'Open CV Match' }));
  state.fetch.mockImplementationOnce(async () =>
    Response.json({ errorCode: 'CV_MATCH_TIMEOUT' }, { status: 504 }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reanalyze CV Match' }));
  await screen.findByText(/Matching timed out/);
  fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
  expect(screen.queryByRole('article')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
});

test('CV replacement invalidates the match and suggestions', async () => {
  const state = setup();
  await state.analyze();
  await state.suggest();
  fireEvent.click(screen.getByRole('button', { name: 'Open CV Match' }));
  fireEvent.change(screen.getByLabelText('Save CV for matching'), {
    target: {
      files: [
        new File(['Synthetic'], 'synthetic.pdf', { type: 'application/pdf' }),
      ],
    },
  });
  await screen.findByRole('button', { name: 'Reanalyze CV Match' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
  expect(screen.queryByRole('article')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Suggest improvements' }),
  ).toBeDisabled();
});

test('conflict offers a single action and opens contradictory evidence in CV Match', async () => {
  const state = setup(conflictSuggestions, conflictMatch);
  await state.analyze();
  await state.suggest();
  const card = screen.getByRole('article');
  expect(
    within(card).queryByRole('button', { name: 'Copy wording' }),
  ).toBeNull();
  expect(
    within(card).getByText(
      'The CV contains contradictory evidence for this requirement.',
    ),
  ).toBeVisible();
  expect(
    within(card).getByText(/Resolve the conflicting statements/),
  ).toBeVisible();
  expect(within(card).queryByText('I have never used Java.')).toBeNull();
  fireEvent.click(
    within(card).getByRole('button', { name: 'Review evidence' }),
  );
  expect(
    screen.getByLabelText('Conflicting CV evidence: Java').textContent,
  ).toBe('I have never used Java.');
});

test('keyboard copy writes only exact server wording and announces failure safely', async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const state = setup();
  await state.analyze();
  await state.suggest();
  const button = screen.getAllByRole('button', { name: 'Copy wording' })[0]!;
  button.focus();
  await user.keyboard('{Enter}');
  expect(write).toHaveBeenCalledWith(syntheticCv);
  await screen.findByText(/Wording copied/);
  write.mockRejectedValueOnce(new Error('denied'));
  await user.keyboard(' ');
  await screen.findByText(/Could not copy/);
});

test('Review evidence crosses tabs, resets filter and focuses the exact expanded row', async () => {
  const user = userEvent.setup();
  const state = setup();
  await state.analyze();
  await state.suggest();
  fireEvent.click(screen.getByRole('button', { name: 'Open CV Match' }));
  fireEvent.click(screen.getByRole('button', { name: 'Matched' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Improve CV' }));
  const button = within(screen.getAllByRole('article')[0]!).getByRole(
    'button',
    { name: 'Review evidence' },
  );
  button.focus();
  await user.keyboard('{Enter}');
  const target = screen.getByRole('button', {
    name: 'Partial: Experience designing APIs and integrations',
  });
  await waitFor(() => expect(target).toHaveFocus());
  expect(target).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('malformed or unreadable responses clear actionable cards', async () => {
  const state = setup();
  await state.analyze();
  await state.suggest();
  state.select.mockResolvedValueOnce(
    Response.json({
      ...syntheticSuggestions,
      suggestions: [
        { ...syntheticSuggestions.suggestions[0], wording: 'Invented claim' },
      ],
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Regenerate suggestions' }),
  );
  await screen.findByText(/API returned invalid suggestions/);
  expect(screen.queryByRole('article')).toBeNull();
  state.select.mockResolvedValueOnce(new Response('SYNTHETIC_PRIVATE_OUTPUT'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry suggestions' }));
  await screen.findByText(/API returned unreadable/);
  expect(screen.queryByText('SYNTHETIC_PRIVATE_OUTPUT')).toBeNull();
});

const validContext = () => {
  if (!hasSuggestionContext(syntheticMatch))
    throw new Error('Invalid synthetic context');
  return syntheticMatch;
};
const mutations: [string, (response: CvSuggestionsResponse) => void][] = [
  [
    'version',
    (v) => {
      (v as { contractVersion: string }).contractVersion = '2';
    },
  ],
  [
    'date',
    (v) => {
      v.generatedAt = 'bad';
    },
  ],
  [
    'count',
    (v) => {
      v.suggestions = Array(6).fill(v.suggestions[0]);
    },
  ],
  [
    'rank',
    (v) => {
      v.suggestions[0]!.rank = 2;
    },
  ],
  [
    'parent',
    (v) => {
      v.suggestions[0]!.parentId = 'missing';
    },
  ],
  [
    'duplicate parent',
    (v) => {
      v.suggestions[1] = { ...v.suggestions[0]!, id: 'other', rank: 2 };
    },
  ],
  [
    'duplicate id',
    (v) => {
      v.suggestions[1]!.id = v.suggestions[0]!.id;
    },
  ],
  [
    'status',
    (v) => {
      v.suggestions[0]!.status = 'EVIDENCED';
    },
  ],
  [
    'kind',
    (v) => {
      (v.suggestions[0] as unknown as { kind: string }).kind = 'rewrite';
    },
  ],
  [
    'exclusive wording',
    (v) => {
      v.suggestions[0]!.clarification = 'also clarify';
    },
  ],
  [
    'unbacked wording',
    (v) => {
      v.suggestions[0]!.wording = 'Led teams and doubled revenue.';
    },
  ],
  [
    'missing question',
    (v) => {
      v.suggestions[1]!.clarification = null;
    },
  ],
  [
    'JD source',
    (v) => {
      (
        v.suggestions[0]!.jdEvidence[0] as unknown as { source: string }
      ).source = 'original_pdf';
    },
  ],
  [
    'JD quote',
    (v) => {
      v.suggestions[0]!.jdEvidence[0]!.quote = 'Invented';
    },
  ],
  [
    'CV source',
    (v) => {
      (
        v.suggestions[0]!.cvEvidence[0] as unknown as { source: string }
      ).source = 'pdf_layout';
    },
  ],
  [
    'CV quote',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.quote = 'Invented';
    },
  ],
  [
    'CV component',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.componentId = 'missing';
    },
  ],
  [
    'CV revision',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.cvUpdatedAt = 'old';
    },
  ],
  [
    'CV role',
    (v) => {
      (v.suggestions[0]!.cvEvidence[0] as unknown as { role: string }).role =
        'context';
    },
  ],
  [
    'negative offset',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.span!.start = -1;
    },
  ],
  [
    'fractional offset',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.span!.start = 0.5;
    },
  ],
  [
    'quote length',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.span!.end++;
    },
  ],
  [
    'ambiguous wording',
    (v) => {
      v.suggestions[0]!.cvEvidence[0]!.span = null;
    },
  ],
];
test.each(mutations)(
  'contract rejects %s without rendering',
  (_label, mutate) => {
    const response = structuredClone(syntheticSuggestions);
    mutate(response);
    expect(isSuggestionsResponse(response, validContext())).toBe(false);
  },
);

test('contract accepts actual synthetic API cards and rejects wording on conflict', () => {
  expect(isSuggestionsResponse(syntheticSuggestions, validContext())).toBe(
    true,
  );
  expect(hasSuggestionContext(conflictMatch)).toBe(true);
  const invalid = structuredClone(conflictSuggestions);
  invalid.suggestions[0]!.kind = 'surface_evidence';
  invalid.suggestions[0]!.wording =
    invalid.suggestions[0]!.cvEvidence[0]!.quote;
  invalid.suggestions[0]!.clarification = null;
  if (!hasSuggestionContext(conflictMatch))
    throw new Error('Invalid conflict fixture');
  expect(isSuggestionsResponse(invalid, conflictMatch)).toBe(false);
});

test('database Partial stays unverified and cannot be copied as proficiency', async () => {
  const quote = 'Implemented enterprise features using SQL Server.';
  const requirement =
    'Proficiency in at least one database: MySQL, Oracle or SQL Server';
  const match = structuredClone(syntheticMatch);
  match.requirements = [
    {
      parentId: 'p1',
      requirement,
      priority: 'required',
      category: 'skill',
      jdQuote: requirement,
      cvQuote: quote,
      status: 'PARTIAL',
      credit: 0.5,
      coverage: {
        mode: 'OR',
        status: 'PARTIAL',
        credit: 0.5,
        reason:
          'SQL Server project experience is evidenced; proficiency remains unverified.',
        components: ['MySQL', 'Oracle', 'SQL Server'].map((label, index) => ({
          id: `c${index + 1}`,
          label,
          jdQuote: label,
          status: index === 2 ? 'PARTIAL' : 'NOT_EVIDENCED',
          cvQuote: index === 2 ? quote : '',
          conflictingQuotes: [],
          ...(index === 2
            ? {
                observations: [{ kind: 'experience', cvQuote: quote }],
                qualificationReason:
                  'Project experience is evidenced; proficiency remains unverified.',
              }
            : {}),
        })),
      },
    },
  ];
  const response = structuredClone(syntheticSuggestions);
  response.suggestions = [
    {
      ...response.suggestions[0]!,
      kind: 'clarify',
      wording: null,
      clarification: syntheticSuggestions.suggestions[1]!.clarification,
      requirement,
      componentIds: ['c1', 'c2', 'c3'],
      jdEvidence: match.requirements[0]!.coverage!.components.map((c) => ({
        ...syntheticSuggestions.suggestions[0]!.jdEvidence[0]!,
        componentId: c.id,
        quote: c.label,
      })),
      cvEvidence: [
        {
          ...syntheticSuggestions.suggestions[0]!.cvEvidence[0]!,
          componentId: 'c3',
          quote,
          span: { start: 0, end: quote.length },
        },
      ],
    },
  ];
  const state = setup(response, match);
  await state.analyze();
  await state.suggest();
  const card = screen.getByRole('article');
  expect(
    within(card).getByRole('heading', { name: 'Database proficiency' }),
  ).toBeVisible();
  expect(within(card).getByText('Required · Partial')).toBeVisible();
  expect(
    within(card).getByText(
      'Work with SQL Server is evidenced; proficiency remains unverified.',
    ),
  ).toBeVisible();
  expect(
    within(card).getByText(
      /If accurate, describe your own database design, tuning or troubleshooting responsibilities/,
    ),
  ).toBeVisible();
  expect(within(card).queryByText(quote)).toBeNull();
  expect(
    within(card).queryByRole('button', { name: 'Copy wording' }),
  ).toBeNull();
  expect(within(card).queryByText(/proficient in SQL Server/i)).toBeNull();
  fireEvent.click(
    within(card).getByRole('button', { name: 'Review evidence' }),
  );
  expect(
    screen.getByRole('button', { name: `Partial: ${requirement}` }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.getByLabelText('Professional experience: SQL Server').textContent,
  ).toBe(quote);
});

test('specific server clarification is retained instead of a generic replacement', async () => {
  const response = structuredClone(syntheticSuggestions);
  response.suggestions[1]!.clarification =
    'Which deployment responsibility can you substantiate for Kubernetes?';
  const state = setup(response);
  await state.analyze();
  await state.suggest();
  expect(
    screen.getByText(
      /Which deployment responsibility can you substantiate for Kubernetes/,
    ),
  ).toBeVisible();
});

test('a satisfied OR offers its verified wording without asking for every alternative', async () => {
  const match = structuredClone(syntheticMatch);
  const row = match.requirements[2]!;
  row.requirement = 'Java or Python';
  row.jdQuote = 'Java or Python';
  row.coverage!.mode = 'OR';
  row.coverage!.components.push({
    id: 'c2',
    label: 'Python',
    jdQuote: 'Python',
    status: 'NOT_EVIDENCED',
    cvQuote: '',
    conflictingQuotes: [],
  });
  match.requirements = [row];
  const response = structuredClone(syntheticSuggestions);
  const card = response.suggestions[2]!;
  card.requirement = row.requirement;
  card.rank = 1;
  card.jdEvidence.push({
    ...card.jdEvidence[0]!,
    componentId: 'c2',
    quote: 'Python',
  });
  response.suggestions = [card];
  const state = setup(response, match);
  await state.analyze();
  await state.suggest();
  expect(screen.getByRole('heading', { name: 'Java or Python' })).toBeVisible();
  expect(
    screen.getByText(/Make this verified passage easier to find/),
  ).toBeVisible();
  expect(screen.queryByText(/document one qualifying alternative/)).toBeNull();
  expect(screen.getByLabelText('Supported original wording').textContent).toBe(
    syntheticCv,
  );
});

test('Matched database OR stays satisfied when other alternatives have unverified mentions', async () => {
  const match = structuredClone(syntheticMatch),
    row = match.requirements[2]!;
  const quote = 'Designed SQL Server schemas for production services.';
  row.requirement = 'SQL Server or Oracle proficiency';
  row.jdQuote = row.requirement;
  row.cvQuote = quote;
  row.coverage!.mode = 'OR';
  const component = row.coverage!.components[0]!;
  component.label = 'SQL Server';
  component.jdQuote = 'SQL Server';
  component.cvQuote = quote;
  row.coverage!.components.push({
    id: 'c2',
    label: 'Oracle',
    jdQuote: 'Oracle',
    status: 'NOT_EVIDENCED',
    cvQuote: '',
    conflictingQuotes: [],
    observations: [{ kind: 'mention', cvQuote: 'Skills: Oracle' }],
    qualificationReason: 'Mentioned in the CV; proficiency remains unverified.',
  });
  match.requirements = [row];
  const response = structuredClone(syntheticSuggestions),
    card = response.suggestions[2]!;
  card.requirement = row.requirement;
  card.rank = 1;
  card.wording = quote;
  card.cvEvidence[0]!.quote = quote;
  card.cvEvidence[0]!.span = { start: 0, end: quote.length };
  card.jdEvidence[0]!.quote = 'SQL Server';
  card.jdEvidence.push({
    ...card.jdEvidence[0]!,
    componentId: 'c2',
    quote: 'Oracle',
  });
  response.suggestions = [card];
  const state = setup(response, match);
  await state.analyze();
  await state.suggest();
  expect(
    screen.getByRole('heading', { name: 'Database proficiency' }),
  ).toBeVisible();
  expect(
    screen.getByText('Verified CV evidence supports this requirement.'),
  ).toBeVisible();
  expect(
    screen.getByText(/Make this verified passage easier to find/),
  ).toBeVisible();
  expect(screen.queryByText(/proficiency remains unverified/)).toBeNull();
  expect(screen.queryByText(/describe your own database design/)).toBeNull();
});

function clarificationFixture(
  requirement: string,
  mode: 'OR' | 'AND' | 'SINGLE' | 'UNKNOWN',
  labels: string[],
) {
  const match = structuredClone(syntheticMatch);
  match.requirements = [
    {
      parentId: 'p2',
      requirement,
      priority: 'required',
      category: 'skill',
      jdQuote: requirement,
      cvQuote: '',
      status: 'NOT_EVIDENCED',
      credit: 0,
      coverage: {
        mode,
        status: 'NOT_EVIDENCED',
        credit: 0,
        reason: 'Synthetic evidence review.',
        components: labels.map((label, index) => ({
          id: `c${index + 1}`,
          label,
          jdQuote: label,
          status: 'NOT_EVIDENCED',
          cvQuote: '',
          conflictingQuotes: [],
        })),
      },
    },
  ];
  const response = structuredClone(syntheticSuggestions);
  response.suggestions = [
    {
      ...response.suggestions[1]!,
      id: 'candidate-1',
      rank: 1,
      requirement,
      componentIds: match.requirements[0]!.coverage!.components.map(
        (c) => c.id,
      ),
      jdEvidence: match.requirements[0]!.coverage!.components.map((c) => ({
        ...syntheticSuggestions.suggestions[1]!.jdEvidence[0]!,
        componentId: c.id,
        quote: c.jdQuote,
      })),
    },
  ];
  return { match, response };
}

test.each([false, true])(
  'education OR explains both truthful paths with a short title (reversed=%s)',
  async (reversed) => {
    const degree = "Bachelor's degree in Computer Science",
      experience = 'equivalent practical experience';
    const labels = reversed ? [experience, degree] : [degree, experience];
    const { match, response } = clarificationFixture(
      labels.join(' or '),
      'OR',
      labels,
    );
    const state = setup(response, match);
    await state.analyze();
    await state.suggest();
    const card = screen.getByRole('article');
    expect(
      within(card).getByRole('heading', {
        name: 'Education or equivalent experience',
      }),
    ).toBeVisible();
    expect(
      within(card).getByText(
        'Neither a qualifying degree nor equivalent experience is established by the CV.',
      ),
    ).toBeVisible();
    expect(
      within(card).getByText(
        /If accurate, state your degree, field and completion status, or describe relevant work with dates, responsibilities and scope/,
      ),
    ).toBeVisible();
    expect(
      within(card).queryByRole('button', { name: 'Copy wording' }),
    ).toBeNull();
    expect(within(card).queryByText(/you lack|you do not have/i)).toBeNull();
    expect(
      within(card).getByRole('button', { name: 'Review evidence' }),
    ).toBeVisible();
  },
);

test.each(['SINGLE', 'UNKNOWN'] as const)(
  'professional internship guidance asks for actual dates, responsibilities and contributions (%s)',
  async (mode) => {
    const requirement =
      'At least one professional internship in software engineering';
    const { match, response } = clarificationFixture(requirement, mode, [
      requirement,
    ]);
    const state = setup(response, match);
    await state.analyze();
    await state.suggest();
    const card = screen.getByRole('article');
    expect(
      within(card).getByRole('heading', {
        name: 'Professional internship experience',
      }),
    ).toBeVisible();
    expect(
      within(card).getByText(
        'The required professional internship experience is not established by the CV.',
      ),
    ).toBeVisible();
    expect(
      within(card).getByText(
        /If you completed a relevant internship, include its actual dates, responsibilities and contributions/,
      ),
    ).toBeVisible();
    expect(
      within(card).queryByRole('button', { name: 'Copy wording' }),
    ).toBeNull();
    expect(within(card).queryByText(requirement)).toBeNull();
  },
);

test('generic work guidance requests useful facts instead of repeating the JD', async () => {
  const state = setup();
  await state.analyze();
  await state.suggest();
  const card = screen.getAllByRole('article')[1]!;
  expect(
    within(card).getByText('This qualification is not established by the CV.'),
  ).toBeVisible();
  expect(
    within(card).getByText(
      /If accurate, add supporting facts and dates; for work examples, state your role and what you did/,
    ),
  ).toBeVisible();
  expect(
    within(card).queryByText(/add a concrete example covering Kubernetes/),
  ).toBeNull();
});

test('education AND and mixed internship requirements do not become alternative or internship-only guidance', async () => {
  const degree = "Bachelor's degree in Computer Science",
    experience = 'equivalent practical experience';
  const { match, response } = clarificationFixture(
    `${degree} and ${experience}`,
    'AND',
    [degree, experience],
  );
  const state = setup(response, match);
  await state.analyze();
  await state.suggest();
  expect(
    screen.queryByRole('heading', {
      name: 'Education or equivalent experience',
    }),
  ).toBeNull();
  expect(
    screen.queryByText(/state your degree, field and completion status, or/),
  ).toBeNull();
  state.unmount();
  const mixed = clarificationFixture(
    'Professional internships and API design',
    'AND',
    ['Professional internships', 'API design'],
  );
  const second = setup(mixed.response, mixed.match);
  await second.analyze();
  await second.suggest();
  expect(
    screen.queryByRole('heading', {
      name: 'Professional internship experience',
    }),
  ).toBeNull();
  expect(
    screen.queryByText(/If you completed a relevant internship/),
  ).toBeNull();
});

test('an established education alternative does not request both paths again', async () => {
  const degree = "Bachelor's degree in Computer Science",
    experience = 'equivalent practical experience';
  const { match, response } = clarificationFixture(
    `${degree} or ${experience}`,
    'OR',
    [degree, experience],
  );
  const row = match.requirements[0]!;
  row.status = 'EVIDENCED';
  row.credit = 1;
  row.cvQuote = syntheticCv;
  row.coverage!.status = 'EVIDENCED';
  row.coverage!.credit = 1;
  const component = row.coverage!.components[1]!;
  component.status = 'EVIDENCED';
  component.cvQuote = syntheticCv;
  const card = response.suggestions[0]!;
  card.status = 'EVIDENCED';
  card.cvEvidence = [
    {
      ...syntheticSuggestions.suggestions[0]!.cvEvidence[0]!,
      parentId: 'p2',
      componentId: 'c2',
    },
  ];
  const state = setup(response, match);
  await state.analyze();
  await state.suggest();
  expect(
    screen.getByRole('heading', { name: 'Education or equivalent experience' }),
  ).toBeVisible();
  expect(
    screen.getByText('Verified CV evidence supports this requirement.'),
  ).toBeVisible();
  expect(screen.queryByText(/Neither a qualifying degree/)).toBeNull();
  expect(
    screen.queryByText(/state your degree, field and completion status, or/),
  ).toBeNull();
});

test('education with several field choices and related experience keeps both paths visible', async () => {
  const labels = [
    "Bachelor's degree in information systems",
    'applied computing',
    'another technical field',
    'related experience',
  ];
  const { match, response } = clarificationFixture(
    labels.join(' or '),
    'OR',
    labels,
  );
  const state = setup(response, match);
  await state.analyze();
  await state.suggest();
  const card = screen.getByRole('article');
  expect(
    within(card).getByRole('heading', {
      name: 'Education or relevant experience',
    }),
  ).toBeVisible();
  expect(
    within(card).getByText(
      'Neither a qualifying degree nor relevant experience is established by the CV.',
    ),
  ).toBeVisible();
  expect(
    within(card).getByText(
      /state your degree, field and completion status, or describe relevant work with dates, responsibilities and scope/,
    ),
  ).toBeVisible();
  expect(
    within(card).queryByRole('button', { name: 'Copy wording' }),
  ).toBeNull();
});
