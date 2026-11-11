import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from './render';
import { InterviewPrep } from '../src/features/interview-prep/InterviewPrep';

const questions = [
  {
    id: 'hr-strengths-01',
    topic: 'hr',
    category: 'Strengths',
    kind: 'personal',
    variants: ['What is your biggest strength?', 'What are you good at?'],
    hints: ['Name one strength.'],
  },
  {
    id: 'hr-goals-01',
    topic: 'hr',
    category: 'Career goals',
    kind: 'personal',
    variants: ['What are your career goals?'],
    hints: ['One short-term goal.'],
  },
  {
    id: 'tech-async-01',
    topic: 'technical',
    category: 'Explaining a concept',
    kind: 'general',
    variants: ['Can you explain asynchronous messaging in simple terms?'],
    hints: [],
  },
];
const feedback = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: '1',
  mode: 'express',
  questionId: 'hr-strengths-01',
  answersQuestion: null,
  mainIssue: null,
  corrections: [],
  suggestion: 'One of my strengths is problem-solving.',
  suggestionWithheld: null,
  followUpQuestions: ['What was the result?'],
  phrases: [
    {
      text: 'One of my strengths is...',
      noteVi: 'Một điểm mạnh của tôi là...',
    },
  ],
  technicalNote: null,
  cvCheck: { status: 'unavailable', notices: [] },
  ...overrides,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
let feedbackResponder: (body: Record<string, unknown>) => Promise<Response>;
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === '/api/v1/interview-prep/questions')
    return Promise.resolve(json({ contractVersion: '1', questions }));
  return feedbackResponder(JSON.parse(String(init?.body)));
});
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  feedbackResponder = async () => json(feedback());
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const feedbackCalls = () =>
  fetchMock.mock.calls.filter(
    ([url]) => url !== '/api/v1/interview-prep/questions',
  );

async function startHr() {
  const user = userEvent.setup();
  render(<InterviewPrep />);
  await user.click(
    await screen.findByRole('button', { name: 'Practise HR communication' }),
  );
  return user;
}

test('choose a topic, see one question with optional ideas, change topic', async () => {
  const user = await startHr();
  expect(
    screen.getByRole('heading', { level: 2, name: /strength|career goals/iu }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Explaining a concept')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ideas to mention' }));
  expect(
    screen.getByText(/Name one strength\.|One short-term goal\./u),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Change topic' }));
  await user.click(
    screen.getByRole('button', { name: 'Practise Technical communication' }),
  );
  expect(
    screen.getByRole('heading', { level: 2, name: /asynchronous messaging/u }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Explain the idea in general terms/u),
  ).toBeInTheDocument();
});

test('next question moves through the topic and picks a wording variant', async () => {
  const random = vi.spyOn(Math, 'random');
  const user = await startHr();
  const first = screen.getByRole('heading', { level: 2 }).textContent;
  expect(screen.getByText(/Question 1 of 2/u)).toBeInTheDocument();
  random.mockReturnValue(0.99);
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(screen.getByText(/Question 2 of 2/u)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(first);
});

test('express mode: Vietnamese notes get a suggestion that can be hidden; sends the right request', async () => {
  const user = await startHr();
  await user.type(
    screen.getByLabelText('Your ideas (Vietnamese, English or both)'),
    'Mình giỏi phân tích vấn đề',
  );
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(
    await screen.findByText('One of my strengths is problem-solving.'),
  ).toBeVisible();
  expect(JSON.parse(String(feedbackCalls()[0]![1]!.body))).toEqual({
    questionId: expect.any(String),
    mode: 'express',
    answer: 'Mình giỏi phân tích vấn đề',
    variant: 0, // the wording actually displayed (Math.random is mocked to 0)
  });
  expect(screen.getByText('Một điểm mạnh của tôi là...')).toBeInTheDocument();
  expect(screen.getByText(/CV fact check is off/u)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Hide suggestion' }));
  await waitFor(() =>
    expect(
      screen.queryByText('One of my strengths is problem-solving.'),
    ).not.toBeInTheDocument(),
  );
});

test('review mode shows answer status, corrections, neutral CV notices and a separate technical note', async () => {
  feedbackResponder = async () =>
    json(
      feedback({
        mode: 'review',
        answersQuestion: 'partly',
        mainIssue: 'Use the past tense.',
        corrections: [{ original: 'I has lead', better: 'I have led' }],
        technicalNote: 'RabbitMQ is a message broker, not a database.',
        cvCheck: {
          status: 'checked',
          notices: [
            "“70%” isn't in your reviewed CV. That doesn't mean it's wrong — make sure you can explain and support it.",
          ],
        },
      }),
    );
  const user = await startHr();
  await user.click(screen.getByRole('button', { name: 'Review my English' }));
  await user.type(
    screen.getByLabelText('Your answer in English'),
    'I has lead a team.',
  );
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(
    await screen.findByText('Partly answers the question'),
  ).toBeInTheDocument();
  expect(screen.getByText('I has lead')).toBeInTheDocument();
  expect(screen.getByText('I have led')).toBeInTheDocument();
  expect(
    screen.getByText(/Technical learning hint \(AI, not verified\)/u),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /isn't in your reviewed CV\. That doesn't mean it's wrong/u,
    ),
  ).toBeInTheDocument();
});

test('withheld suggestions explain why instead of showing changed facts', async () => {
  feedbackResponder = async () =>
    json(feedback({ suggestion: null, suggestionWithheld: 'CHANGED_FACTS' }));
  const user = await startHr();
  await user.type(screen.getByRole('textbox'), 'notes');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(
    await screen.findByText(/couldn't safely rewrite your full answer/u),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/doesn't mean your answer is wrong/u),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /suggestion/u }),
  ).not.toBeInTheDocument();
});

test('a withheld rewrite still shows safe corrections and points to them', async () => {
  feedbackResponder = async () =>
    json(
      feedback({
        mode: 'review',
        answersQuestion: 'yes',
        suggestion: null,
        suggestionWithheld: 'CHANGED_MEANING',
        corrections: [{ original: 'it send', better: 'it sends' }],
      }),
    );
  const user = await startHr();
  await user.click(screen.getByRole('button', { name: 'Review my English' }));
  await user.type(screen.getByRole('textbox'), 'it send messages');
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(await screen.findByText('it sends')).toBeInTheDocument();
  expect(
    screen.getByText(/You can still use the corrections above and try again/u),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('loading, error with kept text, and retry', async () => {
  let fail = true;
  feedbackResponder = async () =>
    fail
      ? json(
          {
            statusCode: 504,
            errorCode: 'INTERVIEW_TIMEOUT',
            message:
              'The local AI took too long. Your text is kept — try again.',
          },
          504,
        )
      : json(feedback());
  const user = await startHr();
  await user.type(screen.getByRole('textbox'), 'Mình học nhanh');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(await screen.findByText(/took too long/u)).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('Mình học nhanh');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByText('One of my strengths is problem-solving.'),
  ).toBeInTheDocument();
});

test('cancel stops waiting honestly and keeps the text', async () => {
  feedbackResponder = () => new Promise(() => {});
  const user = await startHr();
  await user.type(screen.getByRole('textbox'), 'notes');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(screen.getByText(/Checking with the local AI/u)).toBeInTheDocument();
  const signal = feedbackCalls()[0]![1]!.signal!;
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(signal.aborted).toBe(true);
  expect(
    screen.getByText(/may still finish in the background/u),
  ).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('notes');
});

test('a response that arrives after changing question or mode is ignored', async () => {
  const pending: ((r: Response) => void)[] = [];
  feedbackResponder = () => new Promise((resolve) => pending.push(resolve));
  const user = await startHr();
  await user.type(screen.getByRole('textbox'), 'notes');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  pending[0]!(json(feedback()));
  await user.type(screen.getByRole('textbox'), 'more notes');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  await user.click(screen.getByRole('button', { name: 'Review my English' }));
  pending[1]!(json(feedback()));
  await new Promise((r) => setTimeout(r, 20));
  expect(
    screen.queryByRole('heading', { name: 'Feedback' }),
  ).not.toBeInTheDocument();
  // Switching mode keeps the text for a predictable flow.
  expect(screen.getByRole('textbox')).toHaveValue('more notes');
});

test('try again clears the input, hides the suggestion and keeps the previous attempt collapsed', async () => {
  const user = await startHr();
  await user.type(screen.getByRole('textbox'), 'Mình giỏi phân tích');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  await screen.findByText('One of my strengths is problem-solving.');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByRole('textbox')).toHaveValue('');
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
  expect(
    screen.queryByText('One of my strengths is problem-solving.'),
  ).not.toBeInTheDocument();
  const previous = screen.getByRole('button', {
    name: 'Your previous attempt',
  });
  expect(previous).toHaveAttribute('aria-expanded', 'false');
  await user.click(previous);
  const region = screen.getByRole('region', { name: 'Your previous attempt' });
  expect(within(region).getByText('Mình giỏi phân tích')).toBeInTheDocument();
  expect(
    within(region).queryByText('One of my strengths is problem-solving.'),
  ).not.toBeInTheDocument();
  await user.click(
    within(region).getByRole('button', { name: 'Show suggestion' }),
  );
  expect(
    within(region).getByText('One of my strengths is problem-solving.'),
  ).toBeInTheDocument();
});

// ------------------------------------------------------------- recording
class FakeRecorder {
  static last: FakeRecorder | null = null;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}
function mockMedia(getUserMedia: () => Promise<unknown>) {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:local/1'),
      revokeObjectURL: revoke,
    }),
  );
  return revoke;
}

test('record, stop releases the microphone, playback appears, next question cleans up', async () => {
  const track = { stop: vi.fn() };
  const revoke = mockMedia(async () => ({ getTracks: () => [track] }));
  const user = await startHr();
  await user.click(screen.getByRole('button', { name: 'Record' }));
  expect(
    screen.queryByText(/Audio is not analysed by AI/u),
  ).toBeInTheDocument();
  expect(await screen.findByText('Recording… speak now.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Stop recording' }));
  expect(
    screen.getByText(
      /Listen to your recording, then record again to practise/u,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Record again' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Audio is not analysed by AI/u),
  ).not.toBeInTheDocument();
  expect(track.stop).toHaveBeenCalled();
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/1',
  );
  expect(
    fetchMock.mock.calls.every(([, init]) => !(init?.body instanceof Blob)),
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(revoke).toHaveBeenCalledWith('blob:local/1');
  expect(document.querySelector('audio')).toBeNull();
});

test('permission denial (any error name) keeps text practice working', async () => {
  mockMedia(async () => {
    throw new DOMException('denied', 'NotSupportedError');
  });
  const user = await startHr();
  await user.click(screen.getByRole('button', { name: 'Record' }));
  expect(
    await screen.findByText(/Recording isn't available/u),
  ).toBeInTheDocument();
  await user.type(screen.getByRole('textbox'), 'notes');
  await user.click(screen.getByRole('button', { name: 'Help me say it' }));
  expect(
    await screen.findByText('One of my strengths is problem-solving.'),
  ).toBeInTheDocument();
});

test('unmounting while recording releases the microphone', async () => {
  const track = { stop: vi.fn() };
  mockMedia(async () => ({ getTracks: () => [track] }));
  const user = userEvent.setup();
  const view = render(<InterviewPrep />);
  await user.click(
    await screen.findByRole('button', { name: 'Practise HR communication' }),
  );
  await user.click(screen.getByRole('button', { name: 'Record' }));
  await screen.findByText('Recording… speak now.');
  view.unmount();
  expect(track.stop).toHaveBeenCalled();
});
