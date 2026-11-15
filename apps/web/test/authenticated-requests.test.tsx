import { expect, test, vi } from 'vitest';
import { activeSession } from '../src/features/interview-prep/mock-interview-api';
import { listJobQuestionSets } from '../src/features/interview-prep/job-interview-api';
import { analyze } from '../src/features/dashboard/analysis-api';
import { loadJobs, parseJobsCv } from '../src/features/dashboard/jobs-api';

// Regression: these clients sent credentials: 'omit', so the session cookie
// never reached the API and signed-in users got 401. Same-origin (the fetch
// default every other client uses) sends it.
const file = () =>
  new File(['%PDF synthetic'], 'cv.pdf', { type: 'application/pdf' });
test.each([
  ['mock interview', () => activeSession(new AbortController().signal)],
  [
    'job interview questions',
    () =>
      listJobQuestionSets(
        '00000000-0000-4000-8000-0000000000aa',
        new AbortController().signal,
      ),
  ],
  [
    'dashboard analysis',
    () => analyze(file(), 'Synthetic JD', new AbortController().signal),
  ],
  ['dashboard jobs feed', () => loadJobs(new AbortController().signal)],
  [
    'dashboard CV parse',
    () => parseJobsCv(file(), new AbortController().signal),
  ],
])('%s request sends the session cookie', async (_name, call) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  await call().catch(() => undefined); // response decoding is not under test
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]![1] as RequestInit | undefined;
  expect(init?.credentials ?? 'same-origin').toBe('same-origin');
});
