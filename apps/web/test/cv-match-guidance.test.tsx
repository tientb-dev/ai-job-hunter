import { afterEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import { isMatchResult } from '../src/features/inbox/useCvMatch';
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
  await screen.findByRole('button', {
    name: vi_VN ? /Phân tích lại/u : 'Reanalyze CV Match',
  });
}

test('optional Coverage withholding remains validated on the legacy response contract', () => {
  const { coverageHidden, ...legacy } = fixture.worth;
  expect(coverageHidden).toBeNull();
  expect(isMatchResult(legacy)).toBe(true);
  const withheld = {
    ...fixture.worth,
    score: null,
    coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
  };
  expect(isMatchResult(withheld)).toBe(true);
  expect(isMatchResult({ ...withheld, coverageHidden: 'INVALID' })).toBe(false);
  expect(isMatchResult({ ...withheld, score: 50 })).toBe(false);
});

test('Conditions show the backend states, original JD text, and attributable CV quotes in Vietnamese', async () => {
  const languageQuote = 'Languages: English C1';
  const durationQuote = '3 years of Java\nInternal tooling';
  await mount(
    {
      ...fixture.worth,
      conditions: [
        {
          kind: 'LANGUAGE',
          mode: 'SINGLE',
          jdQuote: 'English B2',
          status: 'MET',
          evidence: [
            {
              cvQuote: languageQuote,
              start: 0,
              end: languageQuote.length,
              cvOrigin: 'source',
            },
          ],
        },
        {
          kind: 'CERTIFICATION',
          mode: 'SINGLE',
          jdQuote: 'PMP certification',
          status: 'UNKNOWN',
          evidence: [],
        },
        {
          kind: 'EXPERIENCE',
          mode: 'SINGLE',
          jdQuote: '5+ years of Java',
          status: 'NOT_MET',
          evidence: [
            {
              cvQuote: durationQuote,
              start: 50,
              end: 50 + durationQuote.length,
              cvOrigin: 'user_entered',
            },
          ],
        },
      ],
    },
    'job-conditions',
    true,
  );
  const section = within(screen.getByRole('region', { name: 'Điều kiện' }));
  const [met, unknown, notMet] = section
    .getAllByRole('listitem')
    .map((item) => within(item));
  expect(met!.getByRole('heading', { name: 'English B2' })).toBeVisible();
  expect(met!.getByText('Có bằng chứng đáp ứng')).toBeVisible();
  expect(met!.getByLabelText('Bằng chứng trong CV').textContent).toBe(
    languageQuote,
  );
  expect(
    unknown!.getByRole('heading', { name: 'PMP certification' }),
  ).toBeVisible();
  expect(unknown!.getByText('Chưa có bằng chứng')).toBeVisible();
  expect(unknown!.queryByLabelText('Bằng chứng trong CV')).toBeNull();
  expect(
    notMet!.getByRole('heading', { name: '5+ years of Java' }),
  ).toBeVisible();
  expect(notMet!.getByText('Có bằng chứng chưa đáp ứng')).toBeVisible();
  expect(notMet!.getByLabelText('Bằng chứng trong CV').textContent).toBe(
    durationQuote,
  );
  expect(notMet!.getByText(/Bạn đã bổ sung khi rà soát CV/u)).toBeVisible();
});

test('legacy saved matches still load, with Coverage and guidance withheld', async () => {
  expect(isMatchResult(fixture.worth)).toBe(true);
  await mount(fixture.worth, 'job-legacy');
  expect(screen.queryByRole('region', { name: 'Conditions' })).toBeNull();
  expect(
    screen.queryByText(
      /Technical Evidence Coverage|Your CV shows strong relevant evidence/,
    ),
  ).toBeNull();
  expect(
    screen.getByText(
      /JD–CV Skill Match is unavailable for this saved assessment/,
    ),
  ).toBeVisible();
});

test('invalid condition states and evidence are rejected at the response boundary', () => {
  const condition = {
    kind: 'LANGUAGE',
    mode: 'SINGLE',
    jdQuote: 'English B2',
    status: 'MET',
    evidence: [{ cvQuote: 'English C1', start: 0, end: 10 }],
  };
  expect(isMatchResult({ ...fixture.worth, conditions: [condition] })).toBe(
    true,
  );
  for (const invalid of [
    { ...condition, status: 'PARTIAL' },
    { ...condition, evidence: [] },
    { ...condition, evidence: [{ cvQuote: 'English C1', start: 0, end: 0 }] },
  ]) {
    expect(isMatchResult({ ...fixture.worth, conditions: [invalid] })).toBe(
      false,
    );
  }
});
