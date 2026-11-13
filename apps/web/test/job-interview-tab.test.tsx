import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { theme } from '../src/app/theme';
import { JobInterviewTab } from '../src/features/inbox/JobInterviewTab';
import { fireEvent, render, screen, waitFor, within } from './render';

// Synthetic data only.
const jobId = '00000000-0000-4000-8000-0000000000aa';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const question = (setN: number, position: number, category = 'skill') => ({
  id: `jd-${uuid(setN * 100 + position)}`,
  position,
  category,
  kind: 'hypothetical',
  question: `Set ${setN} question ${position}: how would you design it?`,
  why: `Checks requirement ${position}.`,
  evidence: `Synthetic JD requirement ${position}`,
});
const set = (n: number, count: number, active: boolean, createdAt: string) => ({
  id: uuid(n),
  createdAt,
  active,
  partial: count < 5,
  // Out of order on purpose: the UI must show stored position order.
  questions: Array.from({ length: count }, (_, i) => question(n, count - i)),
});
const listing = (over: Record<string, unknown> = {}) => ({
  contractVersion: '1',
  job: { id: jobId, title: 'Synthetic engineer', company: 'Example' },
  jdEmpty: false,
  jdChanged: false,
  sets: [] as unknown[],
  ...over,
});
type Reply = { status?: number; body: unknown } | Promise<never>;
let lists: Reply[];
let generates: (Reply | (() => Reply | Promise<Reply>))[];
let answersReply: Reply;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const pick = async (r: Reply | (() => Reply | Promise<Reply>)) => {
    const reply = await (typeof r === 'function' ? r() : r);
    return Response.json(reply.body, { status: reply.status ?? 200 });
  };
  if (url.endsWith('/answers/list')) return pick(answersReply);
  if (url.endsWith('/sets/list')) return pick(lists.shift() ?? lists[0]!);
  if (url.endsWith('/sets') && init?.method === 'POST')
    return pick(generates.shift()!);
  throw new Error(`unexpected ${url}`);
});
const generateCalls = () =>
  fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/sets'));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  lists = [{ body: listing() }];
  generates = [];
  answersReply = { body: { contractVersion: '1', answers: [] } };
});
function mount(jobDirty = false) {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <JobInterviewTab jobId={jobId} jobDirty={jobDirty} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}
const saved = (questionId: string) => ({
  questionId,
  answer: 'Synthetic answer.',
  version: 1,
  updatedAt: '2026-11-10T10:00:00.000Z',
});
const error = (status: number, errorCode: string, message: string) => ({
  status,
  body: { statusCode: status, errorCode, message },
});

test('shows loading, then a load error with Retry that recovers', async () => {
  lists = [
    error(503, 'INTERVIEW_STORAGE_UNAVAILABLE', 'x'),
    { body: listing() },
  ];
  mount();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Loading interview questions…',
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByRole('button', { name: 'Generate interview questions' }),
  ).toBeEnabled();
});

test('missing JD explains the problem, links to Edit JD and blocks generation', async () => {
  lists = [{ body: listing({ jdEmpty: true }) }];
  mount();
  expect(
    await screen.findByText(/doesn't have enough job description/u),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Edit JD' })).toHaveAttribute(
    'href',
    `/jobs/${jobId}/edit`,
  );
  expect(
    screen.getByRole('button', { name: 'Generate interview questions' }),
  ).toBeDisabled();
});

test('unsaved job edits block generation', async () => {
  mount(true);
  expect(
    await screen.findByText(/Save job changes in Edit JD/u),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Generate interview questions' }),
  ).toBeDisabled();
});

test('initial generation needs no confirmation, shows progress, ignores double clicks and renders position order', async () => {
  let release!: (r: Reply) => void;
  generates = [() => new Promise<Reply>((r) => (release = r))];
  const created = set(1, 6, true, '2026-11-10T09:00:00.000Z');
  lists = [{ body: listing() }, { body: listing({ sets: [created] }) }];
  answersReply = {
    body: {
      contractVersion: '1',
      answers: [saved(created.questions[5]!.id)], // position 1
    },
  };
  mount();
  const button = await screen.findByRole('button', {
    name: 'Generate interview questions',
  });
  // Two synchronous clicks: the second must not start another generation.
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(
    screen.getByRole('progressbar', { name: 'Generating interview questions' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  release({ body: { contractVersion: '1', set: created, partial: false } });
  const list = await screen.findByRole('list', {
    name: 'Current interview questions',
  });
  expect(generateCalls()).toHaveLength(1);
  expect(JSON.parse(generateCalls()[0]![1]!.body as string)).toEqual({
    contractVersion: '1',
    basedOnSetId: null,
  });
  const cards = within(list).getAllByRole('listitem');
  expect(
    cards.map((c) => within(c).getByRole('heading', { level: 4 }).textContent),
  ).toEqual(
    [1, 2, 3, 4, 5, 6].map(
      (p) => `Set 1 question ${p}: how would you design it?`,
    ),
  );
  const first = within(cards[0]!);
  expect(first.getByText('Question 1 · Technical skill')).toBeInTheDocument();
  expect(first.getByText('Why this question?')).toBeInTheDocument();
  expect(first.getByText('Checks requirement 1.')).toBeInTheDocument();
  expect(first.getByText('“Synthetic JD requirement 1”')).toBeInTheDocument();
  expect(first.getByText('Prepared')).toBeInTheDocument();
  expect(within(cards[1]!).getByText('Not prepared')).toBeInTheDocument();
  expect(screen.getByText(/1 of 6 prepared/u)).toBeInTheDocument();
  expect(
    await screen.findByText('Generated 6 interview questions.'),
  ).toBeInTheDocument();
  // Each card deep-links to the job-specific practice route.
  expect(
    first.getByRole('link', { name: 'Practise this question, question 1' }),
  ).toHaveAttribute(
    'href',
    `/interview-prep/jobs/${jobId}/sets/${created.id}?q=${created.questions[5]!.id}`,
  );
  expect(screen.queryByText(/later update/u)).toBeNull();
});

test('regeneration requires confirmation, sends the active set, and keeps previous sets', async () => {
  const older = set(1, 5, true, '2026-11-09T09:00:00.000Z');
  const newer = set(2, 5, true, '2026-11-10T09:00:00.000Z');
  lists = [
    { body: listing({ sets: [older] }) },
    { body: listing({ sets: [newer, { ...older, active: false }] }) },
  ];
  generates = [{ body: { contractVersion: '1', set: newer, partial: false } }];
  answersReply = {
    body: { contractVersion: '1', answers: [saved(older.questions[0]!.id)] },
  };
  mount();
  const user = userEvent.setup();
  // The trigger explains that new sets may revisit the same requirements.
  expect(
    await screen.findByRole('button', { name: 'Generate new set' }),
  ).toHaveAccessibleDescription(
    'New question sets may revisit the same job requirements from different angles.',
  );
  await user.click(
    await screen.findByRole('button', { name: 'Generate new set' }),
  );
  const dialog = screen.getByRole('dialog', {
    name: 'Generate a new question set?',
  });
  expect(dialog).toHaveTextContent(/saved answers stay available/u);
  expect(dialog).toHaveTextContent(/nothing is deleted/u);
  // Escape (like X) changes nothing.
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(generateCalls()).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Generate new set' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Generate new set',
    }),
  );
  await screen.findByText('Set 2 question 1: how would you design it?');
  expect(JSON.parse(generateCalls()[0]![1]!.body as string)).toEqual({
    contractVersion: '1',
    basedOnSetId: older.id,
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // Previous sets are collapsed, keyboard-expandable, and keep prepared counts.
  const summary = screen.getByRole('button', {
    name: 'Previous question sets (1)',
  });
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  summary.focus();
  await user.keyboard('{Enter}');
  expect(summary).toHaveAttribute('aria-expanded', 'true');
  const previous = screen.getByRole('button', { name: /1 of 5 prepared/u });
  await user.click(previous);
  const list = screen.getByRole('list', { name: /^Questions from/u });
  expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  expect(within(list).getByText('Prepared')).toBeInTheDocument();
});

test('JD changed since generation offers a new set but never regenerates automatically', async () => {
  lists = [
    {
      body: listing({
        jdChanged: true,
        sets: [set(1, 5, true, '2026-11-10T09:00:00.000Z')],
      }),
    },
  ];
  mount();
  const alert = await screen.findByText(/changed after these questions/u);
  expect(alert).toBeInTheDocument();
  expect(generateCalls()).toHaveLength(0);
  expect(
    screen.getAllByRole('button', { name: 'Generate new set' }),
  ).toHaveLength(2);
});

test('stale tab and JD changed during generation refresh the list with an explanation', async () => {
  const current = set(1, 5, true, '2026-11-10T09:00:00.000Z');
  const other = set(2, 5, true, '2026-11-10T10:00:00.000Z');
  for (const [code, message] of [
    [
      'INTERVIEW_SET_OUTDATED',
      'New questions were generated in another tab. Reload to see the latest set.',
    ],
    [
      'INTERVIEW_JD_CHANGED',
      'The job description changed while questions were being generated. Nothing was saved — try again.',
    ],
  ] as const) {
    fetchMock.mockClear();
    lists = [
      { body: listing({ sets: [current] }) },
      { body: listing({ sets: [other, { ...current, active: false }] }) },
    ];
    generates = [error(409, code, message)];
    const { unmount } = renderTab();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Generate new set' }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Generate new set',
      }),
    );
    expect(
      await screen.findByText(`${message} The list was refreshed.`),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Set 2 question 1: how would you design it?'),
    ).toBeInTheDocument();
    unmount();
  }
});

test('a generation failure keeps existing sets and allows a retry', async () => {
  const current = set(1, 5, true, '2026-11-10T09:00:00.000Z');
  lists = [{ body: listing({ sets: [current] }) }];
  generates = [
    error(
      504,
      'INTERVIEW_TIMEOUT',
      'The AI took too long. Your text is kept — try again.',
    ),
  ];
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Generate new set' }),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Generate new set',
    }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The AI took too long.',
  );
  expect(
    screen.getByText('Set 1 question 1: how would you design it?'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Generate new set' }),
  ).toBeEnabled();
});

test('partial sets of 3–4 questions are labelled', async () => {
  lists = [
    { body: listing({ sets: [set(1, 3, true, '2026-11-10T09:00:00.000Z')] }) },
  ];
  mount();
  expect(
    await screen.findByText(/Fewer questions than usual \(3\)/u),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

test('unknown preparation status when saved answers fail to load', async () => {
  lists = [
    { body: listing({ sets: [set(1, 5, true, '2026-11-10T09:00:00.000Z')] }) },
  ];
  answersReply = error(503, 'INTERVIEW_STORAGE_UNAVAILABLE', 'x');
  mount();
  expect(
    await screen.findByText(/preparation status is unknown/u),
  ).toBeInTheDocument();
  expect(screen.getAllByText('Unknown')).toHaveLength(5);
  expect(screen.getByText(/5 questions$/u)).toBeInTheDocument();
});

function renderTab() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <JobInterviewTab jobId={jobId} jobDirty={false} />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test('Mock interview links to the current set only when one exists', async () => {
  mount();
  await screen.findByRole('button', { name: 'Generate interview questions' });
  expect(screen.queryByRole('link', { name: 'Mock interview' })).toBeNull();
});

test('Mock interview opens the mock route for this job and its current set', async () => {
  const current = set(2, 5, true, '2026-11-11T09:00:00.000Z');
  const older = set(1, 5, false, '2026-11-10T09:00:00.000Z');
  lists = [{ body: listing({ sets: [current, older] }) }];
  mount(true); // unsaved edits don't block: it uses the saved set
  expect(
    await screen.findByRole('link', { name: 'Mock interview' }),
  ).toHaveAttribute(
    'href',
    `/interview-prep/mock?jobId=${jobId}&setId=${current.id}`,
  );
});
