import { afterEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import { setLocale } from '../src/app/i18n';
// Generated from the real API scoring output (cv-match.acceptance-corpus.spec).
import fixture from './fixtures/cv-match-guidance.json';

afterEach(() => setLocale('en-US'));
async function mount(result: unknown, jobId: string, vi_VN = false) {
  if (vi_VN) setLocale('vi-VN');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : { ...(result as object), analyzedAt: '2026-11-17T00:00:00Z' },
      ),
    ),
  );
  render(<CvMatchPanel jobId={jobId} revision="1" />);
  await screen.findByRole('combobox', {
    name: vi_VN ? 'CV cho việc làm này' : 'CV for this job',
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: vi_VN ? 'Phân tích Đối chiếu CV' : 'Analyze CV Match',
    }),
  );
  return screen.findByRole('region', {
    name: vi_VN ? 'Gợi ý ứng tuyển' : 'Application guidance',
  });
}

test('guidance is the primary takeaway; score stays secondary and labeled as CV evidence coverage', async () => {
  const guidance = await mount(fixture.worth, 'job-worth');
  expect(within(guidance).getByText('Worth applying')).toBeVisible();
  expect(
    within(guidance).getByText(
      /Your CV documents 2 of 3 core requirements\. Relevant experience appears in your work history\./u,
    ),
  ).toBeVisible();
  const actions = within(guidance).getAllByRole('listitem');
  expect(actions.map((item) => item.textContent)).toEqual([
    'If you applied OOP principles in a project, describe a concrete example.',
    'If you maintained, debugged or enhanced existing applications, add a concrete example.',
    'If you have experience with “Git”, add a concrete example to the relevant role.',
  ]);
  expect(screen.getByText('Documented CV evidence coverage')).toBeVisible();
  expect(screen.getByLabelText('Fit score: 50/100 (heuristic)')).toBeVisible();
  expect(screen.getByText('Evaluated: 4 of 4 JD requirements')).toBeVisible();
  // Detailed requirement review is unchanged.
  expect(
    await screen.findByRole('region', { name: 'Requirements' }),
  ).toBeVisible();
});

test('low evaluability is qualified and uninterpreted requirements are distinct from missing evidence', async () => {
  const guidance = await mount(fixture.low, 'job-low');
  expect(within(guidance).getByText('Consider carefully')).toBeVisible();
  expect(within(guidance).getByText('Low confidence')).toBeVisible();
  expect(within(guidance).queryByText('Worth applying')).toBeNull();
  expect(
    screen.getByText(/Evaluated: 1 of 4 JD requirements · Low confidence/u),
  ).toBeVisible();
  const region = screen.getByRole('region', { name: 'Requirements' });
  fireEvent.click(
    within(region).getByRole('button', {
      name: 'Could not interpret requirement',
    }),
  );
  expect(
    within(region).getAllByRole('button', {
      name: /^Could not interpret requirement: /u,
    }),
  ).toHaveLength(3);
});

test('a mismatched candidate gets no positive label; vi-VN wording renders', async () => {
  const guidance = await mount(fixture.stretch, 'job-stretch', true);
  expect(within(guidance).getByText('Cơ hội thử thách')).toBeVisible();
  expect(within(guidance).queryByText('Nên ứng tuyển')).toBeNull();
  expect(
    within(guidance).getByText(
      'Nếu bạn đã áp dụng nguyên lý OOP trong dự án, hãy mô tả một ví dụ cụ thể.',
    ),
  ).toBeVisible();
});
