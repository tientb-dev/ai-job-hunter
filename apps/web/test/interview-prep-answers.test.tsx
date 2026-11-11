import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, render, screen, waitFor, within } from './render';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { InterviewPrep } from '../src/features/interview-prep/InterviewPrep';

const questions = [
  {
    id: 'hr-strengths-01',
    topic: 'hr',
    category: 'Strengths',
    kind: 'personal',
    variants: ['What is your biggest strength?'],
    hints: [],
  },
  {
    id: 'hr-goals-01',
    topic: 'hr',
    category: 'Career goals',
    kind: 'personal',
    variants: ['What are your career goals?'],
    hints: [],
  },
  {
    id: 'tech-async-01',
    topic: 'technical',
    category: 'Explaining a concept',
    kind: 'general',
    variants: ['Explain async messaging.'],
    hints: [],
  },
];
const saved = (questionId: string, answer: string, version = 1) => ({
  questionId,
  answer,
  version,
  updatedAt: '2026-11-11T00:00:00.000Z',
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
let answers: ReturnType<typeof saved>[];
let listResponder: () => Promise<Response>;
let writer: (url: string, init: RequestInit) => Promise<Response>;
let feedbackResponder: () => Promise<Response>;
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === '/api/v1/interview-prep/questions')
    return Promise.resolve(json({ contractVersion: '1', questions }));
  if (url === '/api/v1/interview-prep/answers/list') return listResponder();
  if (url.startsWith('/api/v1/interview-prep/answers/'))
    return writer(url, init ?? {});
  return feedbackResponder();
});
const feedback = {
  contractVersion: '1',
  mode: 'express',
  questionId: 'hr-goals-01',
  answersQuestion: null,
  mainIssue: null,
  corrections: [],
  suggestion: 'I want to grow as a technical lead.',
  suggestionWithheld: null,
  followUpQuestions: [],
  phrases: [],
  technicalNote: null,
  cvCheck: { status: 'unavailable', notices: [] },
};
const writes = () =>
  fetchMock.mock.calls
    .filter(([url]) => /\/answers\/(?!list)/u.test(url))
    .map(([url, init]) => ({
      url,
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    }));

beforeEach(() => {
  // 0.99 keeps catalog order in the shuffle: strengths first, then goals.
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  answers = [];
  listResponder = async () => json({ contractVersion: '1', answers });
  writer = async (url, init) => {
    const id = decodeURIComponent(url.split('/answers/')[1]!.split('?')[0]!);
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const body = JSON.parse(String(init.body));
    return json(saved(id, body.answer, (body.expectedVersion ?? 0) + 1));
  };
  feedbackResponder = async () => json(feedback);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/interview-prep', element: <InterviewPrep /> },
      { path: '/cv', element: <h1>My CV page</h1> },
    ],
    { initialEntries: ['/interview-prep'] },
  );
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}
async function startHr(prepared = false) {
  const page = renderPage();
  if (prepared)
    await page.user.click(
      await screen.findByRole('button', {
        name: /Practice prepared answers \(\d\)/u,
      }),
    );
  else
    await page.user.click(
      await screen.findByRole('button', { name: 'Practise HR communication' }),
    );
  return page;
}
const dialogGone = () =>
  waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
const questionText = () =>
  document.getElementById('practice-question')!.textContent;
const referenceArea = () =>
  screen.getByRole('region', {
    name: /Practice speaking/u,
  });

test('prepared state comes from saved answers: chips, prepared entry, filter, direct navigation', async () => {
  answers = [saved('hr-goals-01', 'I want to lead a team.')];
  const { user } = renderPage();
  expect(
    await screen.findByRole('button', {
      name: 'Practice prepared answers (1)',
    }),
  ).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Practice prepared answers (0)' }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Practice prepared answers (1)' }),
  );
  // Opens on a prepared question with the list filtered to Prepared.
  expect(questionText()).toBe('What are your career goals?');
  const list = screen.getByRole('list', { name: 'Questions in this topic' });
  expect(within(list).getAllByRole('button')).toHaveLength(1);
  expect(within(list).getByText('Prepared')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'All' }));
  expect(within(list).getAllByRole('button')).toHaveLength(2);
  expect(within(list).getByText('Not prepared')).toBeInTheDocument();
  await user.click(
    within(list).getByRole('button', { name: /biggest strength/u }),
  );
  expect(questionText()).toBe('What is your biggest strength?');
  // Next question walks the whole topic regardless of the filter.
  await user.click(screen.getByRole('button', { name: 'Prepared' }));
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(questionText()).toBe('What are your career goals?');
});

test('finalize → save opens Speaking practice in Read Along; Cancel without edits needs no confirmation', async () => {
  const { user } = await startHr();
  expect(
    screen.getByText(/Nothing is saved until you choose Save/u),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  const editor = screen.getByLabelText('Your English reference answer');
  expect(screen.getByRole('button', { name: 'Save answer' })).toBeDisabled();
  await user.type(editor, '  I solve problems step by step.  ');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
  expect(writes()).toEqual([
    {
      url: expect.stringMatching(/\/answers\/hr-strengths-01$/u),
      method: 'PUT',
      body: { answer: 'I solve problems step by step.', expectedVersion: null },
    },
  ]);
  expect(screen.getByRole('button', { name: 'Read Along' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(
    within(referenceArea()).getByText('I solve problems step by step.'),
  ).toBeInTheDocument();
});

test('pre-fill uses the displayed AI suggestion but never saves it automatically; opening is not dirty', async () => {
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Next question' })); // goals
  await user.type(
    screen.getByLabelText('Your ideas (Vietnamese, English or both)'),
    'muốn làm tech lead',
  );
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  // Express mode: the guarded suggestion can be used; Vietnamese notes are not "original English".
  expect(
    screen.queryByRole('button', { name: 'Keep my original' }),
  ).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole('button', { name: 'Use suggested answer' }),
  );
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'I want to grow as a technical lead.',
  );
  expect(writes()).toEqual([]);
  // Opened from a suggestion but not edited: navigation needs no confirmation.
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(questionText()).toBe('What is your biggest strength?');
});

test('withheld suggestion: no "Use suggested answer"; Keep my original uses the exact reviewed text', async () => {
  feedbackResponder = async () =>
    json({
      ...feedback,
      mode: 'review',
      suggestion: null,
      suggestionWithheld: 'CHANGED_MEANING',
      answersQuestion: 'yes',
    });
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Review my English' }));
  await user.type(
    screen.getByLabelText('Your answer in English'),
    'I am good at debugging.',
  );
  await user.keyboard('{Control>}{Enter}{/Control}');
  await user.click(
    await screen.findByRole('button', { name: 'Keep my original' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Use suggested answer' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/No safe rewrite is available/u)).toBeInTheDocument();
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'I am good at debugging.',
  );
});

test('dirty editor: Next, list selection, Change topic and route changes ask first; native beforeunload is armed', async () => {
  const { user, router } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    'Draft',
  );
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  for (const action of ['Next question', 'Change topic']) {
    await user.click(screen.getByRole('button', { name: action }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Discard your unsaved answer?',
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Stay and edit' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
      'Draft',
    );
  }
  await user.click(screen.getByRole('button', { name: /Browse questions/u }));
  await user.click(
    within(
      screen.getByRole('list', { name: 'Questions in this topic' }),
    ).getByRole('button', { name: /career goals/u }),
  );
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Stay and edit',
    }),
  );
  await act(async () => {
    await router.navigate('/cv');
  });
  const dialog = await screen.findByRole('dialog', {
    name: 'Discard your unsaved answer?',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Discard changes' }),
  );
  expect(
    await screen.findByRole('heading', { name: 'My CV page' }),
  ).toBeInTheDocument();
});

test('discard on Next moves on; clean editor arms no beforeunload', async () => {
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
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
  await dialogGone();
  expect(questionText()).toBe('What are your career goals?');
  expect(
    screen.getByRole('button', { name: 'Finalize answer' }),
  ).toBeInTheDocument();
});

test('Speak Freely hides and reveals; switching modes never changes the saved answer', async () => {
  answers = [saved('hr-strengths-01', 'My strength is patience.', 4)];
  const { user } = await startHr();
  expect(
    within(referenceArea()).getByText('My strength is patience.'),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Speak Freely' }));
  expect(
    within(referenceArea()).queryByText('My strength is patience.'),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show answer' }));
  expect(
    within(referenceArea()).getByText('My strength is patience.'),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hide answer' }));
  await user.click(screen.getByRole('button', { name: 'Read Along' }));
  expect(
    within(referenceArea()).getByText('My strength is patience.'),
  ).toBeInTheDocument();
  expect(writes()).toEqual([]);
});

test('Edit keeps the saved answer until Save succeeds; a failed save keeps the draft and offers Retry', async () => {
  answers = [saved('hr-strengths-01', 'Old answer.', 3)];
  writer = async () =>
    json(
      {
        statusCode: 503,
        errorCode: 'INTERVIEW_STORAGE_UNAVAILABLE',
        message: 'Saved answers are unavailable right now. Try again.',
      },
      503,
    );
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  const editor = screen.getByLabelText('Your English reference answer');
  expect(editor).toHaveValue('Old answer.');
  await user.clear(editor);
  await user.type(editor, 'New answer.');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByText(
      'Saved answers are unavailable right now. Try again.',
    ),
  ).toBeInTheDocument();
  expect(editor).toHaveValue('New answer.');
  expect(writes()[0]!.body).toEqual({
    answer: 'New answer.',
    expectedVersion: 3,
  });
  writer = async () => json(saved('hr-strengths-01', 'New answer.', 4));
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
  expect(within(referenceArea()).getByText('New answer.')).toBeInTheDocument();
});

test('409 conflict keeps the draft; Show saved, Use saved and Save mine instead are explicit', async () => {
  answers = [saved('hr-strengths-01', 'Version one.', 1)];
  let conflicts = 1;
  writer = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    if (conflicts-- > 0)
      return json(
        {
          statusCode: 409,
          errorCode: 'INTERVIEW_ANSWER_CONFLICT',
          message: 'This answer was changed in another tab.',
          current: saved('hr-strengths-01', 'Other tab text.', 2),
        },
        409,
      );
    return json(
      saved('hr-strengths-01', body.answer, body.expectedVersion + 1),
    );
  };
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  const editor = screen.getByLabelText('Your English reference answer');
  await user.clear(editor);
  await user.type(editor, 'My draft.');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByText(
      /changed in another tab\. Your text below is kept/u,
    ),
  ).toBeInTheDocument();
  expect(editor).toHaveValue('My draft.');
  expect(screen.getByRole('button', { name: 'Save answer' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Show saved version' }));
  expect(screen.getByText('Other tab text.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save mine instead' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
  expect(writes().map((w) => w.body)).toEqual([
    { answer: 'My draft.', expectedVersion: 1 },
    { answer: 'My draft.', expectedVersion: 2 },
  ]);
  expect(within(referenceArea()).getByText('My draft.')).toBeInTheDocument();
});

test('Use saved version replaces the draft only when chosen', async () => {
  answers = [saved('hr-strengths-01', 'Version one.', 1)];
  writer = async () =>
    json(
      {
        statusCode: 409,
        errorCode: 'INTERVIEW_ANSWER_CONFLICT',
        message: 'x',
        current: saved('hr-strengths-01', 'Other tab text.', 2),
      },
      409,
    );
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    ' more',
  );
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  await user.click(
    await screen.findByRole('button', { name: 'Use saved version' }),
  );
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'Other tab text.',
  );
  // Not dirty any more: navigating needs no confirmation.
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('deleted in another tab: an explicit create retry', async () => {
  answers = [saved('hr-strengths-01', 'Version one.', 1)];
  let first = true;
  writer = async (_u, init) => {
    const body = JSON.parse(String(init.body));
    if (first) {
      first = false;
      return json(
        {
          statusCode: 409,
          errorCode: 'INTERVIEW_ANSWER_CONFLICT',
          message: 'x',
          current: null,
        },
        409,
      );
    }
    return json(saved('hr-strengths-01', body.answer, 1));
  };
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  await user.type(screen.getByLabelText('Your English reference answer'), '!');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByText(/removed in another tab/u),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Save mine as a new answer' }),
  );
  await screen.findByRole('button', { name: 'Read Along' });
  expect(writes()[1]!.body).toEqual({
    answer: 'Version one.!',
    expectedVersion: null,
  });
});

test('remove needs confirmation; Keep does nothing; Remove makes the question Not prepared', async () => {
  answers = [saved('hr-strengths-01', 'Saved.', 5)];
  const { user } = await startHr();
  await user.click(
    screen.getByRole('button', { name: 'Remove prepared answer' }),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Keep answer',
    }),
  );
  await dialogGone();
  expect(writes()).toEqual([]);
  await user.click(
    screen.getByRole('button', { name: 'Remove prepared answer' }),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
  );
  await dialogGone();
  expect(
    await screen.findByText(/Nothing is saved until you choose Save/u),
  ).toBeInTheDocument();
  expect(writes()).toEqual([
    {
      url: expect.stringMatching(
        /\/answers\/hr-strengths-01\?expectedVersion=5$/u,
      ),
      method: 'DELETE',
      body: null,
    },
  ]);
});

test('a remove conflict deletes nothing and shows the latest saved state', async () => {
  answers = [saved('hr-strengths-01', 'Saved.', 1)];
  writer = async () =>
    json(
      {
        statusCode: 409,
        errorCode: 'INTERVIEW_ANSWER_CONFLICT',
        message: 'x',
        current: saved('hr-strengths-01', 'Changed elsewhere.', 2),
      },
      409,
    );
  const { user } = await startHr();
  await user.click(
    screen.getByRole('button', { name: 'Remove prepared answer' }),
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
  );
  await dialogGone();
  expect(await screen.findByText(/nothing was removed/u)).toBeInTheDocument();
  expect(
    within(referenceArea()).getByText('Changed elsewhere.'),
  ).toBeInTheDocument();
});

test('answers load failure: Unknown status, writes and practice disabled, AI help still works, Retry recovers', async () => {
  let fail = true;
  listResponder = async () =>
    fail
      ? json({}, 503)
      : json({
          contractVersion: '1',
          answers: [saved('hr-strengths-01', 'Saved.', 1)],
        });
  const { user } = renderPage();
  expect(
    (
      await screen.findAllByRole('button', {
        name: 'Practice prepared answers (unavailable)',
      })
    )[0],
  ).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Practise HR communication' }),
  );
  expect(
    screen.getByText(/saved answers couldn't be loaded/u),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Finalize answer' }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Browse questions/u }));
  expect(
    within(
      screen.getByRole('list', { name: 'Questions in this topic' }),
    ).getAllByText('Unknown'),
  ).toHaveLength(2);
  expect(screen.queryByText('Not prepared')).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText('Your ideas (Vietnamese, English or both)'),
    'notes',
  );
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(
    await screen.findByText('I want to grow as a technical lead.'),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Finalize this answer' }),
  ).not.toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
});

class FakeRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}
test('the recording survives mode switches and is cleared on question change', async () => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:local/9'),
      revokeObjectURL: revoke,
    }),
  );
  answers = [saved('hr-strengths-01', 'Saved.', 1)];
  const { user } = await startHr();
  await user.click(
    within(referenceArea()).getByRole('button', { name: 'Record' }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Stop recording' }),
  );
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/9',
  );
  await user.click(screen.getByRole('button', { name: 'Speak Freely' }));
  await user.click(screen.getByRole('button', { name: 'Read Along' }));
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/9',
  );
  expect(revoke).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:local/9'));
  expect(document.querySelector('audio')).toBeNull();
});

test('unsaved dialog: Stay is primary and focused; Escape keeps the draft; Discard is never the default', async () => {
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    'Draft',
  );
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  const dialog = await screen.findByRole('dialog');
  const stay = within(dialog).getByRole('button', { name: 'Stay and edit' });
  const discard = within(dialog).getByRole('button', {
    name: 'Discard changes',
  });
  expect(stay).toHaveFocus();
  expect(stay).toHaveClass('MuiButton-contained');
  expect(discard).not.toHaveClass('MuiButton-contained');
  await user.keyboard('{Escape}');
  await dialogGone();
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'Draft',
  );
  expect(questionText()).toBe('What is your biggest strength?');
  // The close icon also means Stay.
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Close dialog',
    }),
  );
  await dialogGone();
  expect(questionText()).toBe('What is your biggest strength?');
});

test('Browse questions: collapsed after Start, a keyboard disclosure with a count', async () => {
  answers = [saved('hr-goals-01', 'Goal.')];
  const { user } = await startHr();
  const toggle = screen.getByRole('button', { name: /Browse questions/u });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveTextContent('1 prepared · 2 questions');
  const panel = document.getElementById(toggle.getAttribute('aria-controls')!);
  expect(panel).not.toBeNull();
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(
    screen.getByRole('list', { name: 'Questions in this topic' }),
  ).toBeVisible();
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('early recorder: collapsed by default, records before Save, recording kept when collapsed', async () => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })),
    },
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:local/early'),
      revokeObjectURL: vi.fn(),
    }),
  );
  const { user } = await startHr();
  const step1 = screen.getByRole('region', { name: /Prepare your answer/u });
  const toggle = within(step1).getByRole('button', {
    name: 'Want to try speaking first?',
  });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(step1).queryByRole('button', { name: 'Record' })).toBeNull();
  await user.click(toggle);
  await user.click(within(step1).getByRole('button', { name: 'Record' }));
  await user.click(
    await within(step1).findByRole('button', { name: 'Stop recording' }),
  );
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/early',
  );
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/early',
  );
  expect(writes()).toEqual([]);
  expect(
    within(
      screen.getByRole('region', { name: /Practice speaking/u }),
    ).getByText(/unlocks Read Along and Speak Freely/u),
  ).toBeInTheDocument();
});

const reviewAnswer = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Review my English' }));
  await user.type(
    screen.getByLabelText('Your answer in English'),
    "I'm friendly and easy to work with.",
  );
  await user.keyboard('{Control>}{Enter}{/Control}');
};
const reviewed = (suggestion: string | null) =>
  json({
    ...feedback,
    mode: 'review',
    suggestion,
    suggestionWithheld: suggestion ? null : 'CHANGED_MEANING',
  });

test('Use suggested answer opens the one editor right below Feedback; nothing saves until Save; Start practice is there too', async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  feedbackResponder = async () =>
    reviewed("I'm friendly, and I'm easy to work with.");
  const { user } = await startHr();
  await reviewAnswer(user);
  await user.click(
    await screen.findByRole('button', { name: 'Use suggested answer' }),
  );
  const editors = screen.getAllByLabelText('Your English reference answer');
  expect(editors).toHaveLength(1);
  const panel = screen.getByRole('region', {
    name: 'Edit your reference answer',
  });
  // Directly after the Feedback section in document order.
  expect(
    screen
      .getByRole('region', { name: 'Feedback' })
      .compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(panel).getByRole('textbox')).toHaveValue(
    "I'm friendly, and I'm easy to work with.",
  );
  expect(
    within(
      screen.getByRole('region', { name: /Save your reference/u }),
    ).getByText(/editing your answer under Feedback/u),
  ).toBeInTheDocument();
  expect(writes()).toEqual([]);
  await user.type(within(panel).getByRole('textbox'), ' Really.');
  await user.click(within(panel).getByRole('button', { name: 'Save answer' }));
  const start = await screen.findByRole('button', {
    name: 'Start speaking practice',
  });
  expect(start).toHaveFocus();
  expect(scroll).not.toHaveBeenCalled();
  expect(writes()[0]!.body).toEqual({
    answer: "I'm friendly, and I'm easy to work with. Really.",
    expectedVersion: null,
  });
  // Only one prompt, and it sits below Feedback (not in Step 2).
  expect(
    screen.getAllByRole('button', { name: 'Start speaking practice' }),
  ).toHaveLength(1);
  await user.click(start);
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('heading', { name: /Practice speaking/u }),
  ).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Read Along' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('a dirty draft is never silently replaced: switching entry point asks first; late AI and mode change keep it', async () => {
  let release: () => void = () => {};
  feedbackResponder = async () => reviewed('Suggested text.');
  const { user } = await startHr();
  await reviewAnswer(user);
  await user.click(
    await screen.findByRole('button', { name: 'Keep my original' }),
  );
  const box = screen.getByLabelText('Your English reference answer');
  await user.type(box, ' Edited.');
  // Switching to the suggestion asks first; Stay keeps the draft.
  await user.click(
    screen.getByRole('button', { name: 'Use suggested answer' }),
  );
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Stay and edit',
    }),
  );
  await dialogGone();
  expect(box).toHaveValue("I'm friendly and easy to work with. Edited.");
  // A late AI response and an AI mode change leave the draft alone.
  feedbackResponder = () =>
    new Promise((resolve) => {
      release = () => resolve(reviewed('Late text.'));
    });
  await user.click(screen.getByLabelText('Your answer in English'));
  await user.keyboard('{Control>}{Enter}{/Control}');
  await act(async () => release());
  await screen.findByRole('button', { name: 'Use suggested answer' });
  await user.click(screen.getByRole('button', { name: 'Help me express it' }));
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    "I'm friendly and easy to work with. Edited.",
  );
  expect(
    screen.getAllByLabelText('Your English reference answer'),
  ).toHaveLength(1);
  expect(writes()).toEqual([]);
});

test('editor under Feedback: Cancel keeps the saved answer; a failed save and a 409 keep the draft', async () => {
  answers = [saved('hr-strengths-01', 'Saved one.', 2)];
  feedbackResponder = async () => reviewed('Suggested.');
  let mode: 'fail' | 'conflict' = 'fail';
  writer = async () =>
    mode === 'fail'
      ? json({ statusCode: 503, message: 'Down.' }, 503)
      : json(
          {
            statusCode: 409,
            errorCode: 'INTERVIEW_ANSWER_CONFLICT',
            message: 'x',
            current: saved('hr-strengths-01', 'Other tab.', 3),
          },
          409,
        );
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await reviewAnswer(user);
  await user.click(
    await screen.findByRole('button', { name: 'Use suggested answer' }),
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(writes()).toEqual([]);
  expect(
    screen.getByRole('button', { name: 'Edit answer' }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Use suggested answer' }),
  );
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByRole('button', { name: 'Retry' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'Suggested.',
  );
  expect(writes()[0]!.body.expectedVersion).toBe(2); // overwrite is version-guarded
  mode = 'conflict';
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByRole('button', { name: 'Save mine instead' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'Suggested.',
  );
  expect(screen.queryByText('Answer saved. Ready to practise?')).toBeNull();
  // Failure and conflict keep the choices.
  expect(screen.getByText('Choose your reference answer')).toBeInTheDocument();
});

test('after saving from Feedback only Start speaking practice remains; Edit, new feedback and question change behave', async () => {
  feedbackResponder = async () => reviewed('Suggested.');
  const { user } = await startHr();
  await reviewAnswer(user);
  await user.click(
    await screen.findByRole('button', { name: 'Use suggested answer' }),
  );
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByRole('button', { name: 'Start speaking practice' }),
  ).toHaveFocus();
  expect(screen.queryByText('Choose your reference answer')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Use suggested answer' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Keep my original' })).toBeNull();
  // Edit answer in Step 2 still works, pre-filled with the saved answer.
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  expect(screen.getByLabelText('Your English reference answer')).toHaveValue(
    'Suggested.',
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  // A new feedback result offers the choices again.
  await user.click(screen.getByLabelText('Your answer in English'));
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(
    await screen.findByRole('button', { name: 'Use suggested answer' }),
  ).toBeInTheDocument();
  await user.click(
    screen.getByRole('button', { name: 'Use suggested answer' }),
  );
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  await screen.findByRole('button', { name: 'Start speaking practice' });
  // Question change leaves no stale prompt or choices.
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(
    screen.queryByRole('button', { name: 'Start speaking practice' }),
  ).toBeNull();
  expect(screen.queryByText('Choose your reference answer')).toBeNull();
});

test('Save shows "Start speaking practice" without scrolling; the button scrolls, focuses Step 3 and selects Read Along', async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  await user.type(
    screen.getByLabelText('Your English reference answer'),
    'Patience.',
  );
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(
    await screen.findByText('Answer saved. Ready to practise?'),
  ).toBeInTheDocument();
  expect(scroll).not.toHaveBeenCalled();
  const heading = screen.getByRole('heading', { name: /Practice speaking/u });
  expect(heading).not.toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Speak Freely' }));
  expect(scroll).not.toHaveBeenCalled(); // mode switches never scroll
  await user.click(
    screen.getByRole('button', { name: 'Start speaking practice' }),
  );
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(heading).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Read Along' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(within(referenceArea()).getByText('Patience.')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Start speaking practice' }),
  ).not.toBeInTheDocument();
  expect(writes()).toHaveLength(1); // no AI or extra requests
  expect(
    fetchMock.mock.calls.filter(([u]) => !String(u).includes('/answers')),
  ).toHaveLength(1); // only the questions load
});

test('the post-save prompt is cleared on question change and never shown after a failed save', async () => {
  const { user } = await startHr();
  await user.click(screen.getByRole('button', { name: 'Finalize answer' }));
  await user.type(screen.getByLabelText('Your English reference answer'), 'A.');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  await screen.findByText('Answer saved. Ready to practise?');
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(questionText()).toBe('What is your biggest strength?');
  expect(
    screen.queryByRole('button', { name: 'Start speaking practice' }),
  ).not.toBeInTheDocument();
  writer = async () => json({ statusCode: 503, message: 'Down.' }, 503);
  await user.click(screen.getByRole('button', { name: 'Edit answer' }));
  await user.type(screen.getByLabelText('Your English reference answer'), '!');
  await user.click(screen.getByRole('button', { name: 'Save answer' }));
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible();
  expect(
    screen.queryByText('Answer saved. Ready to practise?'),
  ).not.toBeInTheDocument();
});
