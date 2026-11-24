import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from './render';
import { MemoryRouter } from 'react-router-dom';
import { DuplicateJobNotice } from '../src/features/inbox/DuplicateJobNotice';
import { JobEditor } from '../src/features/inbox/JobEditor';

const url = 'https://itviec.com/it-jobs/synthetic';
const match = {
  id: 'synthetic-existing',
  title: 'Synthetic engineer',
  company: 'Synthetic company',
};
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });

test('valid existing URL is debounced and displays title, company and a direct link preserving the draft', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => Response.json({ match }));
  vi.stubGlobal('fetch', fetch);
  render(<DuplicateJobNotice url={url} />);
  expect(fetch).not.toHaveBeenCalled();
  await tick();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toBeDefined();
  expect(
    screen.getByText(/Synthetic engineer · Synthetic company/),
  ).toBeVisible();
  const link = screen.getByRole('link', { name: 'Open existing job' });
  expect(link).toHaveAttribute('href', `/jobs/${match.id}`);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test.each([
  '',
  'invalid',
  'javascript:alert(1)',
  'https://user:secret@example.com/job',
  `https://example.com/${'x'.repeat(2048)}`,
])('invalid/empty URL causes no lookup: %s', async (value) => {
  vi.useFakeTimers();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<DuplicateJobNotice url={value} />);
  await tick();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('new URL has no duplicate warning', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ match: null })),
  );
  render(<DuplicateJobNotice url={url} />);
  await tick();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('rapid edits send only the final lookup; stale success and failure are ignored', async () => {
  vi.useFakeTimers();
  const pending: {
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }[] = [];
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve, reject) =>
        pending.push({ resolve, reject }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<DuplicateJobNotice url={url} />);
  rerender(<DuplicateJobNotice url={`${url}-b`} />);
  rerender(<DuplicateJobNotice url={`${url}-c`} />);
  await tick();
  expect(fetch).toHaveBeenCalledTimes(1);
  rerender(<DuplicateJobNotice url={`${url}-d`} />);
  await tick();
  await act(async () => pending[0]!.resolve(Response.json({ match })));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  rerender(<DuplicateJobNotice url={`${url}-e`} />);
  await tick();
  await act(async () => pending[1]!.reject(new Error('stale failure')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => pending[2]!.resolve(Response.json({ match })));
  expect(screen.getByRole('link', { name: 'Open existing job' })).toBeVisible();
  rerender(<DuplicateJobNotice url="invalid" />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('lookup failure gives non-blocking guidance without exposing the response', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ message: 'internal details' }, { status: 503 }),
    ),
  );
  render(<DuplicateJobNotice url={url} />);
  await tick();
  expect(screen.getByText(/Could not check for an existing job/)).toBeVisible();
  expect(screen.queryByText(/internal details/)).not.toBeInTheDocument();
});

test('Add Job warns before review, stays editable and preserves save-time 409 protection and draft', async () => {
  const fetch = vi.fn(async (path: string, init?: RequestInit) =>
    path.includes('/duplicate-url?') && !init?.method
      ? Response.json({ match })
      : Response.json(
          { message: 'This job URL is already saved.' },
          { status: 409 },
        ),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: url },
  });
  await screen.findByRole('link', { name: 'Open existing job' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe(
    `/api/v1/opportunities/duplicate-url?url=${encodeURIComponent(url)}`,
  );
  // Continue requires JD content (PR87).
  fireEvent.click(screen.getByRole('button', { name: /Paste content/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Use for this job' }));
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: 'Synthetic JD' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue without AI' }));
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Manual draft title' },
  });
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  await screen.findByText(/This job URL is already saved/);
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Manual draft title');
  expect(screen.getByLabelText('Original link')).toHaveValue(url);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls[1]![1]!.method).toBe('POST');
});
