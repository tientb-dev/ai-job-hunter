import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, within } from './render';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { InterviewPrep } from '../src/features/interview-prep/InterviewPrep';
import { WavError, toWav } from '../src/features/interview-prep/wav';

vi.mock('../src/features/interview-prep/wav', async (original) => ({
  ...(await original<typeof import('../src/features/interview-prep/wav')>()),
  toWav: vi.fn(),
}));
const toWavMock = vi.mocked(toWav);

const q = (id: string, text: string) => ({
  id,
  topic: 'hr',
  category: 'Strengths',
  kind: 'personal',
  variants: [text],
  hints: [],
});
const questions = [
  q('hr-strengths-01', 'What is your biggest strength?'),
  q('hr-goals-01', 'What are your career goals?'),
];
const JD = 'jd-3f1c1a52-6d0e-4a7b-9c1d-2e3f4a5b6c7d';
const saved = (questionId: string) => ({
  questionId,
  answer: 'Saved answer.',
  version: 1,
  updatedAt: '2026-11-11T00:00:00.000Z',
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const ok = (transcript: string) =>
  json({ contractVersion: '1', transcript, durationMs: 1200 });
const sttError = (errorCode: string, status: number) =>
  json({ statusCode: status, errorCode, message: 'server text' }, status);
let stt: (init: RequestInit) => Promise<Response>;
let listFails = false;
let fb: (init: RequestInit) => Promise<Response>;
const feedback = {
  contractVersion: '1',
  mode: 'review',
  questionId: 'hr-strengths-01',
  answersQuestion: 'partly',
  mainIssue: 'Add one concrete example.',
  corrections: [],
  suggestion: null,
  suggestionWithheld: null,
  followUpQuestions: [],
  phrases: [],
  technicalNote: null,
  cvCheck: { status: 'unavailable', notices: [] },
};
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === '/api/v1/interview-prep/questions')
    return Promise.resolve(json({ contractVersion: '1', questions }));
  if (url === '/api/v1/interview-prep/answers/list' && listFails)
    return Promise.resolve(
      json({ errorCode: 'INTERVIEW_STORAGE_UNAVAILABLE', message: 'x' }, 503),
    );
  if (url === '/api/v1/interview-prep/answers/list')
    return Promise.resolve(
      json({
        contractVersion: '1',
        answers: [saved('hr-strengths-01'), saved('hr-goals-01'), saved(JD)],
      }),
    );
  if (url.startsWith('/api/v1/interview-prep/transcribe'))
    return stt(init ?? {});
  if (url === '/api/v1/interview-prep/feedback') return fb(init ?? {});
  return Promise.reject(new Error(`unexpected ${url}`));
});
const fbCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url.endsWith('/feedback'));
const fbBody = (i = 0) => JSON.parse(String(fbCalls()[i]![1]!.body));
const answerWrites = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.includes('/answers/') && init?.method !== 'POST',
  );
const sttCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url.includes('/transcribe'));
function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

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
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  toWavMock.mockReset();
  toWavMock.mockResolvedValue(new Blob(['wav'], { type: 'audio/wav' }));
  stt = async () => ok('I solve problems calmly.');
  listFails = false;
  fb = async () => json(feedback);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
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
      createObjectURL: vi.fn(() => 'blob:local/t'),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function start() {
  const router = createMemoryRouter(
    [{ path: '/interview-prep', element: <InterviewPrep /> }],
    { initialEntries: ['/interview-prep'] },
  );
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Practise HR communication' }),
  );
  await screen.findByRole('button', { name: 'Read Along' });
  await user.click(screen.getByRole('button', { name: 'Speak Freely' }));
  return user;
}
const step3 = () => screen.getByRole('region', { name: /Practice speaking/u });
const field = () =>
  within(step3()).getByLabelText('Transcript (edit it, or type your answer)');
async function record(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(step3()).getByRole('button', { name: /^Record( again)?$/u }),
  );
  await user.click(
    await within(step3()).findByRole('button', { name: 'Stop recording' }),
  );
}

test('record → transcribe locally → editable transcript; playback and privacy copy kept', async () => {
  const user = await start();
  expect(
    within(step3()).queryByRole('button', { name: 'Transcribe locally' }),
  ).toBeNull();
  expect(step3()).toHaveTextContent(
    /sends this recording to this app's own server/u,
  );
  expect(step3()).toHaveTextContent(/Audio and transcripts are not saved/u);
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await waitFor(() => expect(field()).toHaveValue('I solve problems calmly.'));
  expect(step3()).toHaveTextContent('Transcript ready');
  expect(step3()).toHaveTextContent('24/1500');
  const [url, init] = sttCalls()[0]!;
  expect(url).toBe(
    '/api/v1/interview-prep/transcribe?questionId=hr-strengths-01',
  );
  expect(init?.method).toBe('POST');
  expect(init?.headers).toEqual({ 'Content-Type': 'audio/wav' });
  expect(init?.body).toBeInstanceOf(Blob);
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/t',
  );
  await user.type(field(), ' Always.');
  expect(field()).toHaveValue('I solve problems calmly. Always.');
});

test.each([
  ['STT_UNAVAILABLE', 503, /isn't set up on this computer/u, false],
  ['STT_BUSY', 409, /Another recording is being transcribed/u, true],
  ['STT_TIMEOUT', 504, /took too long/u, true],
  ['STT_TOO_LARGE', 413, /longer than 3 minutes/u, false],
])(
  '%s: clear message, recording stays playable, typing still works',
  async (code, status, message, retry) => {
    stt = async () => sttError(code, status);
    const user = await start();
    await record(user);
    await user.click(
      within(step3()).getByRole('button', { name: 'Transcribe locally' }),
    );
    expect(await within(step3()).findByText(message)).toBeInTheDocument();
    expect(step3()).not.toHaveTextContent('server text');
    expect(document.querySelector('audio')).toHaveAttribute(
      'src',
      'blob:local/t',
    );
    // One retry path: the main button, never a second "Try again".
    expect(
      within(step3()).queryByRole('button', { name: 'Try again' }),
    ).toBeNull();
    if (retry) {
      stt = async () => ok('Second try.');
      await user.click(
        within(step3()).getByRole('button', { name: 'Transcribe locally' }),
      );
      await waitFor(() => expect(field()).toHaveValue('Second try.'));
    }
    await user.clear(field());
    await user.type(field(), 'Typed instead.');
    expect(field()).toHaveValue('Typed instead.');
  },
);

test('browser conversion failure is explained and nothing is uploaded', async () => {
  toWavMock.mockRejectedValue(new WavError('DECODE'));
  const user = await start();
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  expect(
    await within(step3()).findByText(/couldn't read the recording/u),
  ).toBeInTheDocument();
  expect(sttCalls()).toHaveLength(0);
});

test('manual entry without a recording; over 1500 shows a message and never truncates', async () => {
  const user = await start();
  await user.click(field());
  await user.paste('x'.repeat(1501));
  expect(field()).toHaveValue('x'.repeat(1501));
  expect(step3()).toHaveTextContent(
    /1501\/1500 · AI feedback needs 1500 characters or fewer/u,
  );
});

test('editing while transcription runs stops it; the late result never overwrites', async () => {
  const late = deferred();
  stt = () => late.promise;
  const user = await start();
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  expect(
    await within(step3()).findByText('Transcribing on this computer…'),
  ).toBeInTheDocument();
  await user.type(field(), 'Mine');
  expect(sttCalls()[0]![1]!.signal!.aborted).toBe(true);
  expect(step3()).toHaveTextContent(/stopped because you edited/u);
  late.resolve(ok('Late result.'));
  await new Promise((r) => setTimeout(r, 20));
  expect(field()).toHaveValue('Mine');
});

test('re-transcribing over edited text needs Replace; a new take keeps the text', async () => {
  const user = await start();
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await waitFor(() => expect(field()).toHaveValue('I solve problems calmly.'));
  await user.type(field(), ' Edited.');
  await record(user); // new take
  expect(field()).toHaveValue('I solve problems calmly. Edited.');
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  expect(sttCalls()).toHaveLength(1);
  expect(
    within(step3()).getByRole('button', { name: 'Keep my text' }),
  ).toHaveFocus();
  await user.click(
    within(step3()).getByRole('button', { name: 'Keep my text' }),
  );
  expect(field()).toHaveValue('I solve problems calmly. Edited.');
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  stt = async () => ok('Fresh.');
  await user.click(within(step3()).getByRole('button', { name: 'Replace' }));
  await waitFor(() => expect(field()).toHaveValue('Fresh.'));
});

test('a new take while transcribing cancels the old request', async () => {
  const late = deferred();
  stt = () => late.promise;
  const user = await start();
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await within(step3()).findByText('Transcribing on this computer…');
  await record(user);
  expect(sttCalls()[0]![1]!.signal!.aborted).toBe(true);
  late.resolve(ok('Old take.'));
  await new Promise((r) => setTimeout(r, 20));
  expect(field()).toHaveValue('');
});

test('switching question aborts the request and the late answer never reaches the next question', async () => {
  const late = deferred();
  stt = () => late.promise;
  const user = await start();
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await within(step3()).findByText('Transcribing on this computer…');
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  expect(document.getElementById('practice-question')).toHaveTextContent(
    'What are your career goals?',
  );
  expect(sttCalls()[0]![1]!.signal!.aborted).toBe(true);
  late.resolve(ok('For the old question.'));
  await new Promise((r) => setTimeout(r, 20));
  await user.click(screen.getByRole('button', { name: 'Speak Freely' }));
  expect(field()).toHaveValue('');
  expect(step3()).not.toHaveTextContent('Transcribing');
});

test('PR15 job practice sends the JD question id; unmount aborts in-flight transcription', async () => {
  const late = deferred();
  stt = () => late.promise;
  const job = jdJob();
  const router = createMemoryRouter(
    [{ path: '/x', element: <InterviewPrep job={job} /> }],
    { initialEntries: ['/x'] },
  );
  const { unmount } = render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Speak Freely' }));
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await waitFor(() => expect(sttCalls()).toHaveLength(1));
  expect(sttCalls()[0]![0]).toBe(
    `/api/v1/interview-prep/transcribe?questionId=${JD}`,
  );
  unmount();
  expect(sttCalls()[0]![1]!.signal!.aborted).toBe(true);
});

test('an empty transcript says no speech was detected and keeps the field as is', async () => {
  stt = async () => ok('');
  const user = await start();
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  expect(
    await within(step3()).findByText(/No speech was detected/u),
  ).toBeInTheDocument();
  expect(field()).toHaveValue('');
});

// ------------------------------------------------- Slice 4: transcript feedback
const getFeedback = () =>
  within(step3()).getByRole('button', { name: 'Get AI feedback' });
const feedbackArea = () =>
  within(step3()).queryByRole('region', {
    name: 'Feedback on your transcript',
  });

test('feedback sends the reviewed (edited) transcript for the current question, review mode', async () => {
  const user = await start();
  expect(step3()).toHaveTextContent(
    'Record your answer, transcribe it locally, or type it yourself. Review the text before requesting AI feedback.',
  );
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await waitFor(() => expect(field()).toHaveValue('I solve problems calmly.'));
  await user.type(field(), ' For example, outages.  ');
  await user.click(getFeedback());
  expect(fbBody()).toEqual({
    questionId: 'hr-strengths-01',
    mode: 'review',
    answer: 'I solve problems calmly. For example, outages.',
    variant: 0,
  });
  expect(
    await within(step3()).findByText('Add one concrete example.'),
  ).toBeInTheDocument();
  expect(getFeedback()).toBeEnabled(); // asking again stays possible
  expect(answerWrites()).toHaveLength(0); // saved reference answers untouched
  expect(document.querySelector('audio')).toHaveAttribute(
    'src',
    'blob:local/t',
  );
});

test('feedback is disabled for empty, whitespace-only and over-limit text', async () => {
  const user = await start();
  expect(getFeedback()).toBeDisabled();
  await user.type(field(), '   ');
  expect(getFeedback()).toBeDisabled();
  await user.clear(field());
  await user.click(field());
  await user.paste('x'.repeat(1501));
  expect(getFeedback()).toBeDisabled();
  expect(field()).toHaveValue('x'.repeat(1501));
  await user.type(field(), '{Backspace}');
  expect(getFeedback()).toBeEnabled();
  expect(fbCalls()).toHaveLength(0);
});

test('editing after feedback marks it outdated; editing while loading drops the late result', async () => {
  const user = await start();
  await user.type(field(), 'Typed answer.');
  await user.click(getFeedback());
  await within(step3()).findByText('Add one concrete example.');
  await user.type(field(), ' More');
  expect(
    within(feedbackArea()!).getByText(/Outdated: you changed the transcript/u),
  ).toBeInTheDocument();
  // Old assessment and issue are hidden until fresh feedback succeeds.
  expect(screen.queryByText('Add one concrete example.')).toBeNull();
  expect(screen.queryByText('Partly answers the question')).toBeNull();
  const late = deferred();
  fb = () => late.promise;
  await user.click(getFeedback());
  expect(
    await within(step3()).findByText(/Checking with the AI/u),
  ).toBeInTheDocument();
  await user.type(field(), '!');
  expect(fbCalls()[1]![1]!.signal!.aborted).toBe(true);
  late.resolve(json({ ...feedback, mainIssue: 'Late result.' }));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText('Late result.')).toBeNull();
  fb = async () => json({ ...feedback, mainIssue: 'Fresh result.' });
  await user.click(getFeedback());
  expect(await within(step3()).findByText('Fresh result.')).toBeInTheDocument();
  expect(fbBody(2).answer).toBe('Typed answer. More!');
  expect(screen.queryByText(/Outdated:/u)).toBeNull();
});

test.each([
  [503, 'INTERVIEW_AI_UNAVAILABLE', 'The AI is unavailable.'],
  [504, 'INTERVIEW_TIMEOUT', 'The AI took too long.'],
])(
  'feedback %s error keeps the text, offers Retry, manual entry still works',
  async (status, errorCode, message) => {
    fb = async () => json({ statusCode: status, errorCode, message }, status);
    const user = await start();
    await user.type(field(), 'Typed answer.');
    await user.click(getFeedback());
    expect(await within(step3()).findByText(message)).toBeInTheDocument();
    expect(field()).toHaveValue('Typed answer.');
    fb = async () => json(feedback);
    await user.click(within(step3()).getByRole('button', { name: 'Retry' }));
    expect(
      await within(step3()).findByText('Add one concrete example.'),
    ).toBeInTheDocument();
  },
);

test('leaving with transcript text asks first: Stay keeps it, Discard clears and aborts late feedback', async () => {
  const late = deferred();
  fb = () => late.promise;
  const user = await start();
  await user.type(field(), 'My transcript.');
  await user.click(getFeedback());
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Discard your transcript?');
  await user.click(
    within(dialog).getByRole('button', { name: 'Stay and edit' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(field()).toHaveValue('My transcript.');
  expect(document.getElementById('practice-question')).toHaveTextContent(
    'What is your biggest strength?',
  );
  await user.click(screen.getByRole('button', { name: 'Next question' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Discard changes',
    }),
  );
  expect(document.getElementById('practice-question')).toHaveTextContent(
    'What are your career goals?',
  );
  expect(fbCalls()[0]![1]!.signal!.aborted).toBe(true);
  late.resolve(json(feedback));
  await new Promise((r) => setTimeout(r, 20));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Speak Freely' }));
  expect(field()).toHaveValue('');
  expect(screen.queryByText('Add one concrete example.')).toBeNull();
});

test('reference-answer editor actions never prompt about the transcript', async () => {
  const user = await start();
  await user.type(field(), 'My transcript.');
  await user.click(screen.getByRole('button', { name: /^Edit/u }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

function jdJob() {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    jobTitle: 'Synthetic Engineer',
    setLabel: 'Current set',
    questions: [
      {
        id: JD,
        topic: 'technical' as const,
        category: 'Technical skill',
        kind: 'general' as const,
        variants: ['How does PostgreSQL MVCC work?'],
        hints: [],
      },
    ],
    context: {},
    questionId: JD,
    onSelect: vi.fn(),
    setId: '3f1c1a52-6d0e-4a7b-9c1d-2e3f4a5b6c7e',
  };
}
test('PR15 job practice: transcript feedback is bound to the JD question id', async () => {
  const router = createMemoryRouter(
    [{ path: '/x', element: <InterviewPrep job={jdJob()} /> }],
    { initialEntries: ['/x'] },
  );
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Speak Freely' }));
  await user.type(field(), 'Snapshots per transaction.');
  await user.click(getFeedback());
  await within(step3()).findByText('Add one concrete example.');
  expect(fbBody()).toMatchObject({
    questionId: JD,
    answer: 'Snapshots per transaction.',
  });
});

test('saved answers fail to load: step 3 still records, transcribes and gets feedback; writes stay disabled', async () => {
  listFails = true;
  const router = createMemoryRouter(
    [{ path: '/interview-prep', element: <InterviewPrep /> }],
    { initialEntries: ['/interview-prep'] },
  );
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Practise HR communication' }),
  );
  expect(
    await screen.findByText(
      /saved answers couldn't be loaded, so saving is paused/u,
    ),
  ).toBeInTheDocument();
  // No mutations, no possibly stale saved text, no Read Along.
  for (const name of [
    'Finalize answer',
    'Edit answer',
    'Remove prepared answer',
    'Read Along',
  ])
    expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByText('Saved answer.')).toBeNull();
  // Exactly one recorder on the page: the step 3 one.
  expect(
    screen.queryByRole('button', { name: 'Want to try speaking first?' }),
  ).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Record' })).toHaveLength(1);
  await record(user);
  await user.click(
    within(step3()).getByRole('button', { name: 'Transcribe locally' }),
  );
  await waitFor(() => expect(field()).toHaveValue('I solve problems calmly.'));
  await user.type(field(), ' Edited.');
  await user.click(getFeedback());
  expect(
    await within(step3()).findByText('Add one concrete example.'),
  ).toBeInTheDocument();
  expect(fbBody()).toMatchObject({
    questionId: 'hr-strengths-01',
    answer: 'I solve problems calmly. Edited.',
  });
  expect(answerWrites()).toHaveLength(0);
  // Recovery: Retry loads saved answers and restores Read Along.
  listFails = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(
    await screen.findByRole('button', { name: 'Read Along' }),
  ).toBeInTheDocument();
});
