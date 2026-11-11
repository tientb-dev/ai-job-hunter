import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor, within } from './render';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JobPractice } from '../src/features/interview-prep/JobPractice';
import { InterviewPrep } from '../src/features/interview-prep/InterviewPrep';

// Synthetic data only.
const jobId = '00000000-0000-4000-8000-0000000000aa';
const otherJob = '00000000-0000-4000-8000-0000000000bb';
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const question = (s: number, p: number) => ({
  id: `jd-${uuid(s * 100 + p)}`,
  position: p,
  category: 'skill',
  kind: p === 3 ? 'personal' : 'hypothetical',
  question: `Set ${s} question ${p}: how would you approach it?`,
  why: `Requirement ${p}.`,
  evidence: `Synthetic JD requirement ${p}`,
});
const set = (s: number, active: boolean, createdAt: string) => ({
  id: uuid(s),
  createdAt,
  active,
  partial: false,
  // Stored out of order: the UI must follow position, never shuffle.
  questions: [5, 3, 1, 4, 2].map((p) => question(s, p)),
});
const current = set(2, true, '2026-11-10T09:00:00.000Z');
const previous = set(1, false, '2026-11-09T09:00:00.000Z');
const q = (s: typeof current, p: number) =>
  s.questions.find((x) => x.position === p)!.id;
const saved = (questionId: string, answer: string, version = 1) => ({
  questionId,
  answer,
  version,
  updatedAt: '2026-11-11T00:00:00.000Z',
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
let answers: ReturnType<typeof saved>[];
let writer: (url: string, init: RequestInit) => Promise<Response>;
let listing: (url: string) => Promise<Response>;
const feedbackBodies: unknown[] = [];
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url.endsWith('/sets/list')) return listing(url);
  if (url === '/api/v1/interview-prep/answers/list')
    return Promise.resolve(json({ contractVersion: '1', answers }));
  if (url.startsWith('/api/v1/interview-prep/answers/'))
    return writer(url, init ?? {});
  if (url === '/api/v1/interview-prep/feedback') {
    const body = JSON.parse(String(init!.body));
    feedbackBodies.push(body);
    return Promise.resolve(
      json({
        contractVersion: '1',
        mode: 'express',
        questionId: body.questionId,
        answersQuestion: null,
        mainIssue: null,
        corrections: [],
        suggestion: 'I would add an index on the filtered column.',
        suggestionWithheld: null,
        followUpQuestions: [],
        phrases: [],
        technicalNote: null,
        cvCheck: { status: 'unavailable', notices: [] },
      }),
    );
  }
  if (url === '/api/v1/interview-prep/questions')
    return Promise.resolve(
      json({
        contractVersion: '1',
        questions: [
          {
            id: 'tech-api-02',
            topic: 'technical',
            category: 'Explaining a concept',
            kind: 'general',
            variants: ['What is a REST API?'],
            hints: [],
          },
        ],
      }),
    );
  throw new Error(`unexpected ${url}`);
});
const writes = () =>
  fetchMock.mock.calls
    .filter(([url]) => /\/answers\/(?!list)/u.test(url))
    .map(([url, init]) => ({
      url: decodeURIComponent(url),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    }));

beforeEach(() => {
  answers = [];
  feedbackBodies.length = 0;
  listing = async (url) =>
    url.includes(jobId)
      ? json({
          contractVersion: '1',
          job: { id: jobId, title: 'Synthetic Backend Engineer', company: 'X' },
          jdEmpty: false,
          jdChanged: false,
          sets: [current, previous],
        })
      : json(
          {
            statusCode: 404,
            errorCode: 'INTERVIEW_JOB_NOT_FOUND',
            message: 'This job is no longer available.',
          },
          404,
        );
  writer = async (url, init) => {
    const id = decodeURIComponent(url.split('/answers/')[1]!.split('?')[0]!);
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const body = JSON.parse(String(init.body));
    return json(saved(id, body.answer, (body.expectedVersion ?? 0) + 1));
  };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const practice = (setId: string, query = '') =>
  `/interview-prep/jobs/${jobId}/sets/${setId}${query}`;
function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/interview-prep', element: <InterviewPrep /> },
      {
        path: '/interview-prep/jobs/:jobId/sets/:setId',
        element: <JobPractice />,
      },
      { path: '/jobs/:id/interview', element: <h1>Job interview tab</h1> },
      { path: '/jobs', element: <h1>Jobs list</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}
const questionText = () =>
  document.getElementById('practice-question')?.textContent;
const search = (router: ReturnType<typeof renderAt>['router']) =>
  new URLSearchParams(router.state.location.search).get('q');

test('a deep link opens that generated question with a job heading and position order', async () => {
  const { user } = renderAt(practice(current.id, `?q=${q(current, 3)}`));
  expect(
    await screen.findByRole('heading', { name: 'Interview practice' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Synthetic Backend Engineer · Current question set'),
  ).toBeInTheDocument();
  expect(questionText()).toBe('Set 2 question 3: how would you approach it?');
  expect(
    screen.getByText('Technical skill · Question 3 of 5'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Change topic' })).toBeNull();
  expect(
    screen.getByRole('link', {
      name: 'Back to Synthetic Backend Engineer interview',
    }),
  ).toHaveAttribute('href', `/jobs/${jobId}/interview`);
  await user.click(screen.getByRole('button', { name: /Browse questions/u }));
  const rows = within(
    screen.getByRole('list', { name: 'Questions in this topic' }),
  ).getAllByRole('button');
  expect(rows.map((r) => r.textContent?.slice(0, 16))).toEqual(
    [1, 2, 3, 4, 5].map((p) => `Set 2 question ${p}`),
  );
  // No curated catalog request in job mode.
  expect(
    fetchMock.mock.calls.some(
      ([u]) => u === '/api/v1/interview-prep/questions',
    ),
  ).toBe(false);
});

test('changing questions updates ?q=, and Back/Forward restore the right question', async () => {
  const { user, router } = renderAt(
    practice(current.id, `?q=${q(current, 1)}`),
  );
  await screen.findByRole('heading', { name: 'Interview practice' });
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await waitFor(() => expect(search(router)).toBe(q(current, 2)));
  expect(questionText()).toMatch(/^Set 2 question 2/u);
  await user.click(screen.getByRole('button', { name: /Browse questions/u }));
  await user.click(
    within(
      screen.getByRole('list', { name: 'Questions in this topic' }),
    ).getByRole('button', { name: /question 5/u }),
  );
  await waitFor(() => expect(questionText()).toMatch(/^Set 2 question 5/u));
  expect(search(router)).toBe(q(current, 5));
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() => expect(questionText()).toMatch(/^Set 2 question 2/u));
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() => expect(questionText()).toMatch(/^Set 2 question 1/u));
  await act(async () => {
    await router.navigate(1);
  });
  await waitFor(() => expect(questionText()).toMatch(/^Set 2 question 2/u));
});

test('missing or foreign q opens the first question without adding history', async () => {
  for (const query of [
    '',
    '?q=jd-not-a-uuid',
    `?q=${q(previous, 2)}`,
    '?q=hr-goals-01',
  ]) {
    const { router } = renderAt(practice(current.id, query));
    await waitFor(() => expect(search(router)).toBe(q(current, 1)));
    expect(questionText()).toMatch(/^Set 2 question 1/u);
    expect(router.state.historyAction).toBe('REPLACE');
    router.dispose();
    document.body.innerHTML = '';
  }
});

test('wrong job/set combinations and malformed links never show questions', async () => {
  // Set from another job (not in this job's list).
  renderAt(practice(uuid(99), `?q=${q(current, 1)}`));
  expect(
    await screen.findByText("This question set isn't available for this job."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'Back to job interview questions' }),
  ).toHaveAttribute('href', `/jobs/${jobId}/interview`);
  document.body.innerHTML = '';
  // Unknown or other-owner job: the API answers 404.
  renderAt(
    `/interview-prep/jobs/${otherJob}/sets/${current.id}?q=${q(current, 1)}`,
  );
  expect(await screen.findByText(/could not be loaded/u)).toBeInTheDocument();
  expect(questionText()).toBeUndefined();
  document.body.innerHTML = '';
  renderAt('/interview-prep/jobs/not-a-uuid/sets/also-bad');
  expect(
    await screen.findByText('This question set link is not valid.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to Jobs' })).toHaveAttribute(
    'href',
    '/jobs',
  );
});

test('a previous set is practicable after regeneration and shows its saved answer', async () => {
  answers = [saved(q(previous, 4), 'Previous-set answer.', 3)];
  renderAt(practice(previous.id, `?q=${q(previous, 4)}`));
  expect(
    await screen.findByText(
      /Synthetic Backend Engineer · Previous question set ·/u,
    ),
  ).toBeInTheDocument();
  expect(questionText()).toMatch(/^Set 1 question 4/u);
  expect(await screen.findByText('Previous-set answer.')).toBeInTheDocument();
});

test('save, edit, conflict and remove use the generated ID with PR14 versioning', async () => {
  const id = q(current, 2);
  let conflict = false;
  writer = async (url, init) => {
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const body = JSON.parse(String(init.body));
    if (conflict) {
      conflict = false;
      return json(
        {
          statusCode: 409,
          errorCode: 'INTERVIEW_ANSWER_CONFLICT',
          message: 'This answer was changed in another tab.',
          current: saved(id, 'Other tab text.', 2),
        },
        409,
      );
    }
    return json(saved(id, body.answer, (body.expectedVersion ?? 0) + 1));
  };
  const { user } = renderAt(practice(current.id, `?q=${id}`));
  await screen.findByRole('heading', { name: 'Interview practice' });
  await user.click(
    await screen.findByRole('button', { name: 'Finalize answer' }),
  );
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    'I would profile first.',
  );
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
  // Edit → conflict keeps the draft.
  conflict = true;
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  const editor = screen.getByLabelText('Your English reference answer');
  await user.clear(editor);
  await user.type(editor, 'Edited draft.');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByText(
      /changed in another tab\. Your text below is kept/u,
    ),
  ).toBeInTheDocument();
  expect(editor).toHaveValue('Edited draft.');
  await user.click(screen.getByRole('button', { name: 'Save mine instead' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Remove prepared answer' }),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes()).toEqual([
    {
      url: `/api/v1/interview-prep/answers/${id}`,
      method: 'PUT',
      body: { answer: 'I would profile first.', expectedVersion: null },
    },
    {
      url: `/api/v1/interview-prep/answers/${id}`,
      method: 'PUT',
      body: { answer: 'Edited draft.', expectedVersion: 1 },
    },
    {
      url: `/api/v1/interview-prep/answers/${id}`,
      method: 'PUT',
      body: { answer: 'Edited draft.', expectedVersion: 2 },
    },
    {
      url: `/api/v1/interview-prep/answers/${id}?expectedVersion=3`,
      method: 'DELETE',
      body: null,
    },
  ]);
});

test('AI feedback is requested for the generated question shown', async () => {
  const { user } = renderAt(practice(current.id, `?q=${q(current, 4)}`));
  await screen.findByRole('heading', { name: 'Interview practice' });
  await user.type(
    screen.getByLabelText('Your ideas (Vietnamese, English or both)'),
    'Thêm index.',
  );
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(
    await screen.findByText('I would add an index on the filtered column.'),
  ).toBeInTheDocument();
  expect(feedbackBodies).toEqual([
    {
      questionId: q(current, 4),
      mode: 'express',
      answer: 'Thêm index.',
      variant: 0,
    },
  ]);
});

test('unsaved answer: Back to job, question change and browser Back ask first', async () => {
  const { user, router } = renderAt(
    practice(current.id, `?q=${q(current, 1)}`),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Finalize answer' }),
  );
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    'Draft',
  );
  const stay = async () => {
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard your unsaved answer?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay and edit' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
      'Draft',
    );
    expect(search(router)).toBe(q(current, 1));
  };
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await stay();
  await user.click(
    screen.getByRole('link', {
      name: 'Back to Synthetic Backend Engineer interview',
    }),
  );
  await stay();
  // Discard on Back to job leaves to the job's Interview tab.
  await user.click(
    screen.getByRole('link', {
      name: 'Back to Synthetic Backend Engineer interview',
    }),
  );
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Discard changes',
    }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Job interview tab' }),
  ).toBeInTheDocument();
  // Browser Back returns to the same question, freshly loaded.
  await act(async () => {
    await router.navigate(-1);
  });
  await waitFor(() => expect(questionText()).toMatch(/^Set 2 question 1/u));
});

test('a discarded question change moves on in one confirmation', async () => {
  const { user, router } = renderAt(
    practice(current.id, `?q=${q(current, 1)}`),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Finalize answer' }),
  );
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    'Draft',
  );
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Discard changes',
    }),
  );
  await waitFor(() => expect(search(router)).toBe(q(current, 2)));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(questionText()).toMatch(/^Set 2 question 2/u);
});

test('curated /interview-prep is unchanged: topic picker, catalog fetch, no job UI', async () => {
  const { user } = renderAt('/interview-prep');
  await user.click(
    await screen.findByRole('button', {
      name: 'Practise Technical communication',
    }),
  );
  expect(
    screen.getByRole('heading', { name: 'Interview Prep' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Change topic' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /^Back to/u })).toBeNull();
  expect(
    fetchMock.mock.calls.some(([u]) => String(u).endsWith('/sets/list')),
  ).toBe(false);
});

test('"Why was this asked?" is collapsed, keyboard-operable and shows the why and JD excerpt', async () => {
  const { user } = renderAt(practice(current.id, `?q=${q(current, 2)}`));
  const toggle = await screen.findByRole('button', {
    name: 'Why was this asked?',
  });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const region = document.getElementById('practice-why')!;
  expect(region).toHaveTextContent('Requirement 2.');
  expect(region).toHaveTextContent('“Synthetic JD requirement 2”');
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('the curated flow has no "Why was this asked?" disclosure', async () => {
  const { user } = renderAt('/interview-prep');
  await user.click(
    await screen.findByRole('button', {
      name: 'Practise Technical communication',
    }),
  );
  expect(
    screen.queryByRole('button', { name: 'Why was this asked?' }),
  ).toBeNull();
});
