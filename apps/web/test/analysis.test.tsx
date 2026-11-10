import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { Dashboard } from '../src/features/dashboard/Dashboard';
import { useAnalysis } from '../src/features/dashboard/useAnalysis';
import {
  analyze,
  decodeAnalysis,
} from '../src/features/dashboard/analysis-api';
import type { MatchingResult as BackendMatchingResult } from '../../api/src/matching/matching.types';
import {
  CV_BYTES,
  DOCX_MIME,
  jdBytes,
  validateFile,
  validateJd,
} from '../src/features/dashboard/analysis-validation';
import { completed, incomplete } from './fixtures/analysis';
function renderDashboard() {
  const view = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  return view;
}
const cv = () =>
  new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function mockFetch(
  analysis: () => Promise<Response> = async () => json(completed()),
) {
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    void options;
    return url === '/api/v1/health/ready'
      ? Promise.resolve(json({ status: 'ok' }))
      : url === '/api/v1/analyses?mode=partial'
        ? analysis()
        : Promise.reject(new Error('unexpected URL'));
  });
  vi.stubGlobal('fetch', (url: string, options?: RequestInit) =>
    url === '/api/v1/jobs'
      ? Promise.resolve(
          json({
            source: 'Arbeitnow',
            sourceUrl: 'https://www.arbeitnow.com/api/job-board-api',
            fetchedAt: '2026-10-30T00:00:00Z',
            jobs: [],
            omittedCount: 0,
            scope: 'Synthetic empty feed',
          }),
        )
      : fetch(url, options),
  );
  return fetch;
}
async function fill(text = ' \nSynthetic JD 😀\t') {
  await userEvent.upload(screen.getByLabelText('CV file (PDF or DOCX)'), cv());
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: text },
  });
}
async function submit() {
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
}

test('file metadata/count/size validation includes exact boundary', () => {
  expect(validateFile([])).toBeTruthy();
  expect(validateFile([cv(), cv()])).toBeTruthy();
  expect(
    validateFile([new File([], 'empty.pdf', { type: 'application/pdf' })]),
  ).toMatch(/empty/);
  for (const [name, type] of [
    ['a.pdf', ''],
    ['a.docx', 'application/pdf'],
    ['a.pdf', DOCX_MIME],
    ['a.txt', 'text/plain'],
    ['a/b.pdf', 'application/pdf'],
  ] as const)
    expect(validateFile([new File(['x'], name, { type })])).toBeTruthy();
  expect(
    validateFile([new File(['x'], 'a.docx', { type: DOCX_MIME })]),
  ).toBeUndefined();
  expect(
    validateFile([
      new File([new Uint8Array(CV_BYTES)], 'a.pdf', {
        type: 'application/pdf',
      }),
    ]),
  ).toBeUndefined();
  expect(
    validateFile([
      new File([new Uint8Array(CV_BYTES + 1)], 'a.pdf', {
        type: 'application/pdf',
      }),
    ]),
  ).toMatch(/5 MiB/);
});
test('JD validates UTF-16, UTF-8, blank text and malformed surrogates without normalization', () => {
  expect(validateJd(' \r\n\t')).toBeTruthy();
  expect(validateJd('😀'.repeat(6000))).toBeUndefined();
  expect(validateJd('😀'.repeat(6000) + 'x')).toMatch(/12,000/);
  expect(validateJd('界'.repeat(12000))).toBeUndefined();
  expect(jdBytes('界'.repeat(12000))).toBe(36000);
  // The UTF-16 limit is stricter than 48 KiB for well-formed Unicode, but both are checked.
  expect(validateJd('界'.repeat(16384))).toBeTruthy();
  expect(validateJd('界'.repeat(16385))).toBeTruthy();
  for (const text of ['\ud800', '\udc00', '\ud800x', '\ud800\ud800'])
    expect(validateJd(text)).toMatch(/surrogate/);
  expect(validateJd(' \r\n😀\t')).toBeUndefined();
});
test('accessible empty/validation state and counters', async () => {
  mockFetch();
  renderDashboard();
  await submit();
  expect(
    screen.getByText('Choose exactly one PDF or DOCX file.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('CV file (PDF or DOCX)')).toHaveFocus();
  await fill('😀');
  expect(
    screen.getByText(
      /JD length: 2 \/ 12,000 UTF-16 units; 4 \/ 49,152 UTF-8 bytes/,
    ),
  ).toBeInTheDocument();
});
test('FormData contains exactly the original CV and whitespace-preserved JD', async () => {
  const fetch = mockFetch();
  renderDashboard();
  const text = ' \r\nSynthetic 😀\t';
  await fill(text);
  await submit();
  await screen.findByRole('heading', {
    name: 'Documented requirement support',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [, options] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
  expect(options).toMatchObject({
    method: 'POST',
    cache: 'no-store',
    signal: expect.any(AbortSignal),
  });
  expect(options.headers).toBeUndefined();
  const body = options.body as FormData;
  expect([...body.keys()]).toEqual(['cv', 'jdText']);
  // Native textarea normalizes CRLF to LF before the value reaches React.
  expect(body.get('jdText')).toBe(
    (screen.getByLabelText('Job description') as HTMLTextAreaElement).value,
  );
  expect((body.get('cv') as File).name).toBe('synthetic.pdf');
});
test('completed UI preserves zero/null, statuses, coverage, exclusions, warnings and plain evidence', async () => {
  const result = completed();
  mockFetch(async () => json(result));
  const { container } = renderDashboard();
  await fill();
  await submit();
  expect(
    await screen.findByLabelText('Overall documented requirement support'),
  ).toHaveTextContent('0%');
  expect(screen.getByText('Not calculable')).toBeInTheDocument();
  for (const status of [
    'MATCHED',
    'PARTIAL',
    'MISSING_EVIDENCE',
    'NOT_MATCHED',
    'EVALUABLE',
    'AMBIGUOUS_JD',
    'UNSUPPORTED',
  ])
    expect(screen.getAllByText(status).length).toBeGreaterThan(0);
  expect(
    screen.getByText(/Evaluable: 4; excluded: 2; unclassified: 1/),
  ).toBeInTheDocument();
  expect(screen.getByText(/PAGE_WITHOUT_TEXT \(page 2\)/)).toBeInTheDocument();
  expect(screen.getByText(/CV: PDF_RECOVERY_USED/)).toBeInTheDocument();
  expect(
    screen.getAllByText(/does not establish that the candidate lacks/).length,
  ).toBeGreaterThan(0);
  const article = screen.getAllByRole('article')[0]!;
  const summary = within(article).getByText(/Evidence \(2\)/);
  expect(summary.closest('details')).not.toHaveAttribute('open');
  await userEvent.click(summary);
  expect(within(article).getByText(/<img src=x/)).toBeInTheDocument();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('script')).toBeNull();
});
test('null overall remains not calculable', async () => {
  const data = completed();
  data.result = { ...data.result, overallScore: null };
  mockFetch(async () => json(data));
  renderDashboard();
  await fill();
  await submit();
  expect(
    await screen.findByLabelText('Overall documented requirement support'),
  ).toHaveTextContent('Not calculable');
});
test.each([
  [400, 'INVALID_INPUT'],
  [403, 'LOCAL_REQUEST_DENIED'],
  [408, 'UPLOAD_TIMEOUT'],
  [413, 'DOCUMENT_TOO_LARGE'],
  [415, 'UNSUPPORTED_FILE_TYPE'],
  [422, 'INVALID_EVIDENCE'],
  [429, 'ANALYSIS_BUSY'],
  [500, 'ANALYSIS_FAILED'],
  [503, 'ANALYSIS_UNAVAILABLE'],
  [504, 'ANALYSIS_TIMEOUT'],
] as const)(
  'INCOMPLETE %s shows sanitized stage/code with no score',
  async (status, code) => {
    mockFetch(async () => json(incomplete(code), status));
    renderDashboard();
    await fill();
    await submit();
    expect(
      await screen.findByRole('heading', { name: 'Analysis incomplete' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Stage: CV. Error code: ${code}.`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Extraction can fail even when the document contains valid information.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Overall documented requirement support'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('jd: NOT_RUN')).toBeInTheDocument();
  },
);
test.each([
  'network',
  'json',
  'version',
  'field',
  'unknown-code',
  'diagnostic',
])('fixed error for %s without raw messages', async (kind) => {
  mockFetch(async () => {
    if (kind === 'network') throw new Error('PRIVATE source');
    if (kind === 'json') return new Response('PRIVATE source', { status: 502 });
    const value =
      kind === 'unknown-code' || kind === 'diagnostic'
        ? incomplete()
        : completed();
    if (kind === 'version')
      Object.assign(value, { contractVersion: 'PRIVATE source' });
    if (kind === 'field' && value.result)
      Object.assign(value.result, { coverage: 'PRIVATE source' });
    if (kind === 'unknown-code' && value.error)
      value.error.code = 'PRIVATE source';
    if (kind === 'diagnostic' && value.error)
      value.error.diagnostic = {
        stage: 'EVIDENCE',
        rule: 'PRIVATE source',
        field: 'cv',
      };
    return json(value, value.outcome === 'INCOMPLETE' ? 422 : 200);
  });
  renderDashboard();
  await fill();
  await submit();
  expect(
    await within(
      screen.getByRole('region', { name: 'CV/JD analysis' }),
    ).findByRole('alert'),
  ).toHaveTextContent(
    kind === 'network' ? 'Could not reach' : 'invalid or incompatible',
  );
  expect(screen.queryByText(/PRIVATE source/)).toBeNull();
});
test('editing clears results; Clear removes inputs, file selection, evidence and errors without persistence/logging', async () => {
  const logs = [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'warn'),
  ];
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  mockFetch();
  renderDashboard();
  await fill('Synthetic private JD');
  await submit();
  await screen.findByLabelText('Overall documented requirement support');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Changed synthetic JD' },
  });
  expect(
    screen.queryByLabelText('Overall documented requirement support'),
  ).toBeNull();
  await submit();
  await screen.findByLabelText('Overall documented requirement support');
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByLabelText('Job description')).toHaveValue('');
  expect(
    (screen.getByLabelText('CV file (PDF or DOCX)') as HTMLInputElement).files,
  ).toHaveLength(0);
  expect(screen.queryByText(/Synthetic private JD/)).toBeNull();
  expect(screen.queryByText(/<img src=x/)).toBeNull();
  expect(storage).not.toHaveBeenCalled();
  for (const log of logs) expect(log).not.toHaveBeenCalled();
});
test('processing disables edits; Cancel retains inputs and ignores a late completion', async () => {
  const pending = deferred<Response>();
  const fetch = mockFetch(() => pending.promise);
  renderDashboard();
  await fill('Retained JD');
  await submit();
  expect(screen.getByLabelText('Job description')).toBeDisabled();
  expect(screen.getByLabelText('CV file (PDF or DOCX)')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText(/Stopped waiting/)).toBeInTheDocument();
  expect(screen.getByLabelText('Job description')).toHaveValue('Retained JD');
  const options = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(options.signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(json(completed()));
    await pending.promise;
  });
  expect(
    screen.queryByLabelText('Overall documented requirement support'),
  ).toBeNull();
});
test.each(['resolve', 'reject'] as const)(
  'StrictMode duplicate guard and stale %s/cleanup cannot replace or unlock a new request',
  async (mode) => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetch = mockFetch(
      vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise),
    );
    const { result } = renderHook(() => useAnalysis(), { wrapper: StrictMode });
    act(() => {
      void result.current.start(cv(), 'one');
      void result.current.start(cv(), 'duplicate');
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.cancel();
      void result.current.start(cv(), 'two');
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (mode === 'resolve') old.resolve(json(completed()));
      else old.reject(new Error('PRIVATE'));
      await old.promise.catch(() => {});
    });
    expect(result.current.state.status).toBe('processing');
    act(() => {
      void result.current.start(cv(), 'third');
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => {
      fresh.resolve(json(incomplete(), 422));
      await fresh.promise;
    });
    expect(result.current.state.status).toBe('incomplete');
  },
);
test.each(['resolve', 'reject'] as const)(
  'unmount aborts and ignores late %s even if fetch ignores abort',
  async (mode) => {
    const pending = deferred<Response>();
    const fetch = mockFetch(() => pending.promise);
    const { result, unmount } = renderHook(() => useAnalysis(), {
      wrapper: StrictMode,
    });
    act(() => {
      void result.current.start(cv(), 'Synthetic');
    });
    unmount();
    expect(
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal
        ?.aborted,
    ).toBe(true);
    await act(async () => {
      if (mode === 'resolve') pending.resolve(json(completed()));
      else pending.reject(new Error('PRIVATE'));
      await pending.promise.catch(() => {});
    });
  },
);
test('decoder preserves every supplied matching field and rejects nested malformed values', () => {
  const value = completed();
  expect(decodeAnalysis(value, true)).toEqual(value);
  for (const mutate of [
    (v: ReturnType<typeof completed>) =>
      Object.assign(v.result.categories[0]!, { score: '0' }),
    (v: ReturnType<typeof completed>) =>
      Object.assign(v.result.requirements[0]!, { evaluability: 'invented' }),
    (v: ReturnType<typeof completed>) =>
      Object.assign(v.result.requirements[0]!.evidence[0]!.reference, {
        quote: 42,
      }),
    (v: ReturnType<typeof completed>) =>
      Object.assign(v.result, { reviewRequired: false }),
  ]) {
    const bad = completed();
    mutate(bad);
    expect(() => decodeAnalysis(bad, true)).toThrow();
  }
});

test('API boundary preserves CRLF and all original JD code units supplied to it', async () => {
  const fetch = mockFetch();
  const text = ' \r\nSynthetic 😀\t\n';
  await analyze(cv(), text, new AbortController().signal);
  expect(
    (
      (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as FormData
    ).get('jdText'),
  ).toBe(text);
});
test('browser matching wire type remains assignable to the existing backend contract', () => {
  const compatible: BackendMatchingResult = completed().result;
  expect(compatible).toEqual(completed().result);
});
test('Clear invalidates a cancelled request before its late response, and blocks nothing new', async () => {
  const pending = deferred<Response>();
  mockFetch(
    vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(json(completed())),
  );
  renderDashboard();
  await fill('Synthetic retained input');
  await submit();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await act(async () => {
    pending.resolve(json(completed()));
    await pending.promise;
  });
  expect(
    screen.queryByLabelText('Overall documented requirement support'),
  ).toBeNull();
  expect(screen.getByLabelText('Job description')).toHaveValue('');
  await fill('New input');
  await submit();
  expect(
    await screen.findByLabelText('Overall documented requirement support'),
  ).toHaveTextContent('0%');
});
