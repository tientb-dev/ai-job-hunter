import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnalysisResult } from '../src/features/dashboard/AnalysisResult';
import { Dashboard } from '../src/features/dashboard/Dashboard';
import { requirementFeedbackKeys } from '../src/features/dashboard/requirement-feedback';
import { completed, incomplete } from './fixtures/analysis';

const cv = () =>
  new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function fillAndAnalyze() {
  await userEvent.upload(screen.getByLabelText('CV file (PDF or DOCX)'), cv());
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Synthetic JD' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
}
function feedbackGroup(position: number) {
  return screen.getByRole('group', {
    name: `Feedback for requirement ${position}`,
  });
}

test('feedback supports selection, change, clear and an explicit local-only notice', async () => {
  render(<AnalysisResult response={completed()} />);
  expect(
    screen.getByText(/Requirement feedback is local.*not submitted/s),
  ).toBeInTheDocument();
  const group = feedbackGroup(1);
  const correct = within(group).getByRole('button', { name: 'Correct' });
  const incorrect = within(group).getByRole('button', { name: 'Incorrect' });
  const unsure = within(group).getByRole('button', { name: 'Unsure' });
  expect(correct).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(correct);
  expect(correct).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(incorrect);
  expect(correct).toHaveAttribute('aria-pressed', 'false');
  expect(incorrect).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(unsure);
  expect(unsure).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(unsure);
  expect(unsure).toHaveAttribute('aria-pressed', 'false');
});

test('duplicate, missing and empty IDs receive deterministic independent UI keys', async () => {
  const response = completed();
  Object.assign(response.result.requirements[0]!, { id: 'duplicate' });
  Object.assign(response.result.requirements[1]!, { id: 'duplicate' });
  delete (response.result.requirements[2] as { id?: string }).id;
  Object.assign(response.result.requirements[3]!, { id: '' });
  expect(
    requirementFeedbackKeys(response.result.requirements).slice(0, 5),
  ).toEqual([
    'requirement-fallback:0',
    'requirement-fallback:1',
    'requirement-fallback:2',
    'requirement-fallback:3',
    'requirement:r4',
  ]);
  render(<AnalysisResult response={response} />);
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  );
  await userEvent.click(
    within(feedbackGroup(2)).getByRole('button', { name: 'Incorrect' }),
  );
  await userEvent.click(
    within(feedbackGroup(3)).getByRole('button', { name: 'Unsure' }),
  );
  expect(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(feedbackGroup(2)).getByRole('button', { name: 'Incorrect' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(feedbackGroup(3)).getByRole('button', { name: 'Unsure' }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(feedbackGroup(4)).getByRole('button', { name: 'Unsure' }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('feedback neither mutates matching data nor writes storage or network', async () => {
  const response = completed();
  const original = structuredClone(response);
  const fetch = vi.fn();
  const storageReads = vi.spyOn(Storage.prototype, 'getItem');
  const storageWrites = vi.spyOn(Storage.prototype, 'setItem');
  const storageRemovals = vi.spyOn(Storage.prototype, 'removeItem');
  const storageClears = vi.spyOn(Storage.prototype, 'clear');
  vi.stubGlobal('fetch', fetch);
  render(<AnalysisResult response={response} />);
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Incorrect' }),
  );
  expect(response).toEqual(original);
  expect(
    screen.getByLabelText('Overall documented requirement support'),
  ).toHaveTextContent('0%');
  expect(screen.getAllByText('MATCHED').length).toBeGreaterThan(0);
  expect(fetch).not.toHaveBeenCalled();
  expect(storageReads).not.toHaveBeenCalled();
  expect(storageWrites).not.toHaveBeenCalled();
  expect(storageRemovals).not.toHaveBeenCalled();
  expect(storageClears).not.toHaveBeenCalled();
});

test('new completed analysis, incomplete result and unmount clear feedback', async () => {
  const first = completed();
  const second = completed();
  second.requestId = '00000000-0000-4000-8000-000000000099';
  const view = render(<AnalysisResult response={first} />);
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  );
  view.rerender(<AnalysisResult response={second} />);
  expect(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Unsure' }),
  );
  view.rerender(<AnalysisResult response={incomplete()} />);
  expect(
    screen.queryByRole('group', { name: /Feedback for requirement/ }),
  ).toBeNull();
  view.rerender(<AnalysisResult response={second} />);
  expect(
    within(feedbackGroup(1)).getByRole('button', { name: 'Unsure' }),
  ).toHaveAttribute('aria-pressed', 'false');
  view.unmount();
  render(<AnalysisResult response={second} />);
  expect(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('input edits and Clear remove completed feedback with the result', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => json(completed())),
  );
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await fillAndAnalyze();
  await screen.findByRole('group', { name: 'Feedback for requirement 1' });
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  );
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Edited JD' },
  });
  expect(
    screen.queryByRole('group', { name: /Feedback for requirement/ }),
  ).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  await screen.findByRole('group', { name: 'Feedback for requirement 1' });
  expect(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Incorrect' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(
    screen.queryByRole('group', { name: /Feedback for requirement/ }),
  ).toBeNull();
});

test('cancellation and subsequent incomplete or client-error results cannot retain feedback', async () => {
  const pending = deferred<Response>();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json(completed()))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(json(completed()))
    .mockResolvedValueOnce(json(incomplete(), 422))
    .mockResolvedValueOnce(json(completed()))
    .mockRejectedValueOnce(new Error('private network failure'));
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await fillAndAnalyze();
  await screen.findByRole('group', { name: 'Feedback for requirement 1' });
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(
    screen.queryByRole('group', { name: /Feedback for requirement/ }),
  ).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => {
    pending.resolve(json(completed()));
    await pending.promise;
  });
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  await screen.findByRole('group', { name: 'Feedback for requirement 1' });
  expect(
    within(feedbackGroup(1)).getByRole('button', { name: 'Correct' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(
    await screen.findByRole('heading', { name: 'Analysis incomplete' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('group', { name: /Feedback for requirement/ }),
  ).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  await screen.findByRole('group', { name: 'Feedback for requirement 1' });
  await userEvent.click(
    within(feedbackGroup(1)).getByRole('button', { name: 'Unsure' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Analyze' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach');
  expect(
    screen.queryByRole('group', { name: /Feedback for requirement/ }),
  ).toBeNull();
});
