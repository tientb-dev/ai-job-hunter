import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { render, screen, waitFor, within } from './render';
import { MockInterview } from '../src/features/interview-prep/MockInterview';

const JOB = '3f1c1a52-6d0e-4a7b-9c1d-2e3f4a5b6c7d';
const SET = '3f1c1a52-6d0e-4a7b-9c1d-2e3f4a5b6c7e';
const SID = '11111111-1111-4111-8111-111111111111';
const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });
const feedback = (questionId: string) => ({
  contractVersion: '1',
  mode: 'review',
  questionId,
  answersQuestion: 'partly',
  mainIssue: 'Add one concrete example.',
  corrections: [],
  suggestion: null,
  suggestionWithheld: null,
  followUpQuestions: [],
  phrases: [],
  technicalNote: null,
  cvCheck: { status: 'unavailable', notices: [] },
});

// Minimal in-memory session server mirroring the API contract.
type Item = {
  questionId: string;
  questionText: string;
  answer: string | null;
  feedback: unknown;
  skipped: boolean;
};
let session: {
  id: string;
  source: string;
  jobId: string | null;
  status: 'active' | 'completed';
  currentIndex: number;
  version: number;
  items: Item[];
} | null;
let conflictNext = false;
let listFails = false;
let answerExists = false;
const calls: { url: string; method: string; body: unknown }[] = [];
const dto = () => {
  const items = session!.items;
  return {
    contractVersion: '1',
    ...session!,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    summary: {
      total: items.length,
      answered: items.filter((i) => i.answer !== null).length,
      skipped: items.filter((i) => i.skipped).length,
      unanswered: items.filter((i) => i.answer === null && !i.skipped).length,
      withFeedback: items.filter((i) => i.feedback).length,
      answersQuestion: { yes: 0, partly: 0, no: 0 },
    },
  };
};
const make = (n: number, currentIndex = 0) => ({
  id: SID,
  source: 'curated',
  jobId: null,
  status: 'active' as const,
  currentIndex,
  version: 1 + currentIndex,
  items: Array.from({ length: n }, (_, i) => ({
    questionId: `hr-q-${i}`,
    questionText: `Question text ${i + 1}?`,
    answer: i < currentIndex ? 'Earlier.' : null,
    feedback: null,
    skipped: false,
  })),
});
const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body as string) : undefined;
  calls.push({ url, method, body });
  const base = '/api/v1/interview-prep/sessions';
  if (url === `${base}/active`)
    return Promise.resolve(
      json({
        contractVersion: '1',
        session: session?.status === 'active' ? dto() : null,
      }),
    );
  if (url === `${base}/list`) {
    if (listFails)
      return Promise.resolve(
        json({ errorCode: 'X', message: 'History unavailable.' }, 503),
      );
    const d = session?.status === 'completed' ? dto() : null;
    return Promise.resolve(
      json({
        contractVersion: '1',
        items: d ? [{ ...d, jobTitle: d.jobId ? 'Synthetic job' : null }] : [],
      }),
    );
  }
  if (url === base && method === 'POST') {
    session = {
      ...make(body.count),
      source: body.source,
      jobId: body.jobId ?? null,
    };
    return Promise.resolve(json(dto(), 201));
  }
  if (url.startsWith(`${base}/${SID}/items/`)) {
    if (conflictNext) {
      conflictNext = false;
      session!.version += 1; // another tab wrote first
      return Promise.resolve(
        json(
          { errorCode: 'INTERVIEW_SESSION_CONFLICT', message: 'Changed.' },
          409,
        ),
      );
    }
    const i = session!.currentIndex;
    session!.items[i] = {
      ...session!.items[i]!,
      answer: body.answer,
      feedback: body.feedback,
      skipped: body.answer === null,
    };
    session!.currentIndex += 1;
    session!.version += 1;
    return Promise.resolve(json(dto()));
  }
  if (url === `${base}/${SID}/read`)
    return Promise.resolve(
      session
        ? json(dto())
        : json(
            { errorCode: 'INTERVIEW_SESSION_NOT_FOUND', message: 'Gone.' },
            404,
          ),
    );
  if (url.startsWith('/api/v1/interview-prep/answers/') && method === 'PUT') {
    if (body.expectedVersion === null && answerExists)
      return Promise.resolve(
        json(
          {
            errorCode: 'INTERVIEW_ANSWER_CONFLICT',
            message: 'Changed.',
            current: {
              questionId: 'hr-q-0',
              answer: 'Old.',
              version: 3,
              updatedAt: '2026-11-11T00:00:00.000Z',
            },
          },
          409,
        ),
      );
    return Promise.resolve(
      json({
        questionId: 'hr-q-0',
        answer: body.answer,
        version: 4,
        updatedAt: '2026-11-11T00:00:00.000Z',
      }),
    );
  }
  if (url === `${base}/${SID}/complete`) {
    session!.status = 'completed';
    session!.version += 1;
    return Promise.resolve(json(dto()));
  }
  if (
    url.startsWith(`${base}/${SID}?expectedVersion=`) &&
    method === 'DELETE'
  ) {
    session = null;
    return Promise.resolve(json(null, 204));
  }
  if (url === '/api/v1/interview-prep/feedback')
    return Promise.resolve(json(feedback(body.questionId)));
  return Promise.reject(new Error(`unexpected ${method} ${url}`));
});

beforeEach(() => {
  session = null;
  conflictNext = false;
  listFails = false;
  answerExists = false;
  calls.length = 0;
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});
const show = (entry = '/interview-prep/mock') =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: '/interview-prep/mock', element: <MockInterview /> }],
        { initialEntries: [entry] },
      )}
    />,
  );
const answerBox = () =>
  screen.getByRole('textbox', {
    name: /transcript \(edit it, or type your answer\)/i,
  });
const put = () => calls.filter((c) => c.method === 'PUT').map((c) => c.body);

test('start, answer without feedback, skip, then End interview keeps unanswered separate', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    await screen.findByRole('button', { name: 'Start interview' }),
  );
  expect(calls.find((c) => c.url.endsWith('/sessions'))?.body).toEqual({
    contractVersion: '1',
    source: 'curated',
    count: 5,
  });
  expect(await screen.findByText('Question 1 of 5')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Question text 1?' }),
  ).toBeInTheDocument();
  const next = screen.getByRole('button', { name: 'Next' });
  expect(next).toBeDisabled();
  await user.type(answerBox(), '  My typed answer.  ');
  await user.click(next);
  expect(await screen.findByText('Question 2 of 5')).toBeInTheDocument();
  // Fresh answer box for the new question.
  expect(answerBox()).toHaveValue('');
  await user.click(screen.getByRole('button', { name: 'Skip question' }));
  expect(await screen.findByText('Question 3 of 5')).toBeInTheDocument();
  expect(put()).toEqual([
    { expectedVersion: 1, answer: 'My typed answer.', feedback: null },
    { expectedVersion: 2, answer: null, feedback: null },
  ]);

  await user.click(screen.getByRole('button', { name: 'End interview' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('button', { name: 'Keep practising' }),
  ).toHaveFocus();
  await user.click(
    within(dialog).getByRole('button', { name: 'End interview' }),
  );
  expect(
    await screen.findByText(/1 of 5 answered · 1 skipped · 3 unanswered/u),
  ).toBeInTheDocument();
  expect(screen.getByText('Skipped')).toBeInTheDocument();
  expect(
    screen.getAllByText('Not answered (interview ended early)'),
  ).toHaveLength(3);
  await user.click(
    screen.getByRole('button', { name: 'Start another interview' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Start interview' }),
  ).toBeInTheDocument();
});

test('refresh resumes at the saved question', async () => {
  session = make(6, 2);
  show();
  expect(await screen.findByText('Question 3 of 6')).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Question text 3?' }),
  ).toBeInTheDocument();
});

test('optional AI feedback is saved with the answer; the last Next finishes', async () => {
  const user = userEvent.setup();
  session = make(5, 4);
  show();
  await user.type(
    await screen.findByRole('textbox', { name: /transcript/i }),
    'Final answer.',
  );
  await user.click(screen.getByRole('button', { name: 'Get AI feedback' }));
  expect(
    await screen.findByText('Next saves your answer with this feedback.'),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save and finish' }));
  expect(await screen.findByText(/5 of 5 answered/u)).toBeInTheDocument();
  expect(
    screen.getByText('Add one concrete example.', { exact: false }),
  ).toBeInTheDocument();
  expect(put()[0]).toEqual({
    expectedVersion: 5,
    answer: 'Final answer.',
    feedback: feedback('hr-q-4'),
  });
});

test('feedback for older text is not saved', async () => {
  const user = userEvent.setup();
  session = make(5);
  show();
  await user.type(
    await screen.findByRole('textbox', { name: /transcript/i }),
    'First.',
  );
  await user.click(screen.getByRole('button', { name: 'Get AI feedback' }));
  await screen.findByText('Next saves your answer with this feedback.');
  await user.type(answerBox(), ' More.');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Question 2 of 5');
  expect(put()[0]).toMatchObject({ answer: 'First. More.', feedback: null });
});

test('a version conflict reloads the server state and keeps typed text', async () => {
  const user = userEvent.setup();
  session = make(5);
  show();
  await user.type(
    await screen.findByRole('textbox', { name: /transcript/i }),
    'Keep me.',
  );
  conflictNext = true;
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(
    await screen.findByText(/changed in another tab/u),
  ).toBeInTheDocument();
  expect(answerBox()).toHaveValue('Keep me.');
  // Retrying uses the reloaded version.
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Question 2 of 5');
  expect(put().at(-1)).toMatchObject({
    expectedVersion: 2,
    answer: 'Keep me.',
  });
});

test('job entry creates a job session; discard asks first and deletes', async () => {
  const user = userEvent.setup();
  show(`/interview-prep/mock?jobId=${JOB}&setId=${SET}`);
  await user.click(
    await screen.findByRole('button', { name: 'Start interview' }),
  );
  expect(calls.find((c) => c.url.endsWith('/sessions'))?.body).toEqual({
    contractVersion: '1',
    source: 'job',
    count: 5,
    jobId: JOB,
    setId: SET,
  });
  await screen.findByText('Question 1 of 5');
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'Close dialog' }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(session).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Discard',
    }),
  );
  expect(
    await screen.findByRole('button', { name: 'Start interview' }),
  ).toBeInTheDocument();
  expect(session).toBeNull();
});

test('load and save errors are shown with a way forward', async () => {
  const user = userEvent.setup();
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      json(
        {
          errorCode: 'INTERVIEW_STORAGE_UNAVAILABLE',
          message: 'Storage down.',
        },
        503,
      ),
    ),
  );
  show();
  expect(await screen.findByText('Storage down.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await user.click(
    await screen.findByRole('button', { name: 'Start interview' }),
  );
  await screen.findByText('Question 1 of 5');
  await user.type(answerBox(), 'Answer.');
  fetchMock.mockImplementationOnce(() =>
    Promise.resolve(
      json(
        { errorCode: 'INTERVIEW_STORAGE_UNAVAILABLE', message: 'Save failed.' },
        503,
      ),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Save failed.')).toBeInTheDocument();
  expect(screen.getByText('Question 1 of 5')).toBeInTheDocument();
  expect(answerBox()).toHaveValue('Answer.');
});

const finished = () => {
  session = { ...make(5, 1), status: 'completed' };
  return `/interview-prep/mock?session=${SID}`;
};

test('a finished interview summary survives refresh; save as reference answer with replace on conflict', async () => {
  const user = userEvent.setup();
  answerExists = true;
  show(finished());
  expect(
    await screen.findByRole('heading', { name: 'Interview summary' }),
  ).toBeInTheDocument();
  expect(calls[0]!.url).toBe(`/api/v1/interview-prep/sessions/${SID}/read`);
  // Only answered questions can be saved.
  expect(
    screen.getAllByRole('button', { name: 'Save as reference answer' }),
  ).toHaveLength(1);
  await user.click(
    screen.getByRole('button', { name: 'Save as reference answer' }),
  );
  expect(
    await screen.findByText(/already have a reference answer/u),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Replace' }));
  expect(
    await screen.findByText('Saved as your reference answer.'),
  ).toBeInTheDocument();
  const saves = calls.filter((c) =>
    c.url.startsWith('/api/v1/interview-prep/answers/'),
  );
  expect(saves.map((c) => c.body)).toEqual([
    { answer: 'Earlier.', expectedVersion: null },
    { answer: 'Earlier.', expectedVersion: 3 },
  ]);
});

test('delete interview asks first, then removes it and returns to start', async () => {
  const user = userEvent.setup();
  show(finished());
  await user.click(
    await screen.findByRole('button', { name: 'Delete interview' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('button', { name: 'Keep interview' }),
  ).toHaveFocus();
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(
    await screen.findByRole('button', { name: 'Start interview' }),
  ).toBeInTheDocument();
  expect(session).toBeNull();
  expect(
    calls.some(
      (c) => c.method === 'DELETE' && c.url.endsWith('?expectedVersion=2'),
    ),
  ).toBe(true);
});

test('a deleted or unknown summary link shows a safe error', async () => {
  show(`/interview-prep/mock?session=${SID}`);
  expect(await screen.findByText('Gone.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Start page' }));
  expect(
    await screen.findByRole('button', { name: 'Start interview' }),
  ).toBeInTheDocument();
});

test('past interviews: a completed one opens its summary; delete returns to an empty history', async () => {
  const user = userEvent.setup();
  session = { ...make(5, 5), status: 'completed' };
  show();
  const row = await screen.findByRole('link', {
    name: /Interview Prep questions.*5 of 5 answered · 0 with AI feedback/,
  });
  await user.click(row);
  expect(
    await screen.findByRole('heading', { name: 'Interview summary' }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete interview' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Delete',
    }),
  );
  expect(
    await screen.findByText('No finished interviews yet.'),
  ).toBeInTheDocument();
});

test('past interviews: load error offers Retry; start still works', async () => {
  listFails = true;
  show();
  expect(await screen.findByText('History unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start interview' })).toBeEnabled();
  listFails = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByText('No finished interviews yet.'),
  ).toBeInTheDocument();
});

test('an active interview still resumes and hides the history', async () => {
  session = make(5, 2);
  show();
  expect(await screen.findByText('Question 3 of 5')).toBeInTheDocument();
  expect(screen.queryByText('Past interviews')).not.toBeInTheDocument();
});
