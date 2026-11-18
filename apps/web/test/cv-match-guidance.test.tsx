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
    name: vi_VN ? 'Chuẩn bị hồ sơ ứng tuyển' : 'Application guidance',
  });
}

test('guidance is the primary takeaway; score stays secondary and labeled as CV evidence coverage', async () => {
  const guidance = await mount(fixture.worth, 'job-worth');
  expect(
    within(guidance).getByText('Your CV shows strong relevant evidence'),
  ).toBeVisible();
  expect(
    within(guidance).getByText(
      /Your CV documents 2 of 3 core requirements\. Relevant experience appears in your work history\./u,
    ),
  ).toBeVisible();
  const actions = within(
    screen.getByRole('list', { name: 'Next steps to strengthen your CV' }),
  ).getAllByRole('listitem');
  // Action sentences never embed raw JD wording; it is shown separately.
  expect(actions.map((item) => item.textContent)).toEqual([
    'If you applied OOP principles in a project, describe a concrete example.',
    'If you maintained, debugged or enhanced existing applications, add a concrete example.',
    'If you have done this, add one concrete example to the role or project where you did it.JD: “Git”',
  ]);
  // The heuristic score is secondary: collapsed under Technical details.
  expect(
    screen.queryByText('Documented CV evidence coverage'),
  ).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
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
  expect(
    within(guidance).getByText('Clarify key evidence in your CV'),
  ).toBeVisible();
  expect(within(guidance).getByText('Low confidence')).toBeVisible();
  expect(
    within(guidance).queryByText('Your CV shows strong relevant evidence'),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
  expect(
    screen.getByText(/Evaluated: 1 of 4 JD requirements · Low confidence/u),
  ).toBeVisible();
  const region = screen.getByRole('region', { name: 'Requirements' });
  // Its group is open by default when nonempty.
  expect(
    within(region).getByRole('button', {
      name: 'System could not analyze (3)',
    }),
  ).toHaveAttribute('aria-expanded', 'true');
  expect(
    within(region).getAllByRole('button', {
      name: /^System could not analyze: /u,
    }),
  ).toHaveLength(3);
  // Score withheld; an unanalyzed row is not reported as missing CV evidence.
  expect(
    screen.getByText(
      'Insufficient information to assess reliably, so no score is shown.',
    ),
  ).toBeVisible();
  fireEvent.click(
    within(region).getAllByRole('button', {
      name: /^System could not analyze: /u,
    })[0]!,
  );
  expect(
    within(region).getAllByText('Not analyzed by the system')[0],
  ).toBeVisible();
  expect(within(region).queryByText('Not evidenced in CV')).toBeNull();
});

test('a mismatched candidate gets no positive label; vi-VN wording renders', async () => {
  const guidance = await mount(fixture.stretch, 'job-stretch', true);
  expect(
    within(guidance).getByText('Bổ sung bằng chứng còn thiếu vào CV'),
  ).toBeVisible();
  expect(
    within(guidance).queryByText(/Cân nhắc kỹ|Cơ hội thử thách/u),
  ).toBeNull();
  expect(
    within(guidance).queryByText('CV đã thể hiện rõ nhiều yêu cầu liên quan'),
  ).toBeNull();
  expect(
    screen.getByText(
      'Nếu bạn đã áp dụng nguyên lý OOP trong dự án, hãy mô tả một ví dụ cụ thể.',
    ),
  ).toBeVisible();
});

test('identical action instructions are grouped with every JD reference', async () => {
  await mount(
    {
      ...fixture.worth,
      guidance: {
        ...fixture.worth.guidance,
        actions: [
          { code: 'ADD_EXAMPLE', label: 'Git' },
          { code: 'ADD_EXAMPLE', label: 'Docker' },
          { code: 'SHOW_IN_WORK', label: 'SQL' },
        ],
      },
    },
    'job-grouped',
  );
  const items = within(
    await screen.findByRole('list', {
      name: 'Next steps to strengthen your CV',
    }),
  ).getAllByRole('listitem');
  expect(items.map((item) => item.textContent)).toEqual([
    'If you have done this, add one concrete example to the role or project where you did it.JD: “Git”JD: “Docker”',
    'Listed only as a skill. If you used it at work, describe how in that role.JD: “SQL”',
  ]);
});
