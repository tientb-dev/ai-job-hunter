import { MemoryRouter } from 'react-router-dom';
import { execFileSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../src/features/dashboard/Dashboard';
import { decodeAnalysis } from '../src/features/dashboard/analysis-api';
import type { AnalysisResponse } from '../src/features/dashboard/analysis.types';

// Real HTTP + multipart + worker parser, stubbed AI; no model/network access.
// The optional private CV source remains in this process, never in snapshots.
const enabled =
  process.env.MVP_UPLOAD_SMOKE === '1' ||
  Boolean(process.env.MVP_SMOKE_CV_PATH);
const output: unknown = enabled
  ? JSON.parse(
      execFileSync(
        process.execPath,
        ['../api/.test-dist/test/manual/upload.smoke.js'],
        { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
      ).toString(),
    )
  : {};
const responses = output as Record<string, AnalysisResponse | null>;

for (const scenario of [
  'parsed',
  'partial',
  'cvFailure',
  'jdFailure',
  ...(responses.realParsed ? ['realParsed'] : []),
]) {
  test.runIf(enabled)(
    `production upload smoke renders ${scenario} source safely`,
    async () => {
      const response = responses[scenario]!;
      const parseOnly = response.outcome === 'PARSED';
      const ok = response.outcome !== 'INCOMPLETE';
      // Exercise the actual decoder and dashboard submission with the HTTP body.
      decodeAnalysis(response, ok);
      const fetch = vi.fn<(url: string) => Promise<Response>>(async (url) =>
        url === '/api/v1/jobs'
          ? Response.json({
              source: 'Arbeitnow',
              sourceUrl: 'https://www.arbeitnow.com/api/job-board-api',
              fetchedAt: '2026-10-30T00:00:00Z',
              jobs: [],
              omittedCount: 0,
              scope: 'Synthetic empty feed',
            })
          : new Response(JSON.stringify(response), {
              status: ok ? 200 : 504,
            }),
      );
      vi.stubGlobal('fetch', fetch);
      render(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
      );
      await userEvent.upload(
        screen.getByLabelText('CV file (PDF or DOCX)'),
        new File(['synthetic'], 'cv.pdf', { type: 'application/pdf' }),
      );
      fireEvent.change(screen.getByLabelText('Job description'), {
        target: { value: 'Synthetic JD' },
      });
      await userEvent.click(
        screen.getByRole('button', {
          name: parseOnly ? 'Parse without AI' : 'Analyze',
        }),
      );
      await screen.findByRole('heading', { name: 'CV source' });
      expect(
        screen.getByRole('heading', { name: 'JD source' }),
      ).toBeInTheDocument();
      // Boolean assertions keep private source out of test failure output.
      expect(
        document.body.textContent?.includes(response.documents!.cv!.text),
      ).toBe(true);
      expect(
        document.body.textContent?.includes(response.documents!.jd!.text),
      ).toBe(true);
      expect(
        screen.queryByLabelText('Overall documented requirement support'),
      ).not.toBeInTheDocument();
      expect(
        document.body.textContent?.includes('matching is disabled') ||
          document.body.textContent?.includes('Matching is disabled'),
      ).toBe(true);
      if (scenario === 'jdFailure')
        expect(
          screen.getByText(/Evidence-validated facts/),
        ).toBeInTheDocument();
      if (scenario === 'partial') {
        expect(screen.getByText('VALID')).toBeInTheDocument();
        expect(screen.getByText('NEEDS_REVIEW')).toBeInTheDocument();
        expect(screen.getAllByText('MISSING').length).toBeGreaterThan(0);
        expect(
          screen.getByText(/JD AI extraction failed: TIMEOUT/),
        ).toBeInTheDocument();
        expect(
          fetch.mock.calls.find(([url]) =>
            url.startsWith('/api/v1/analyses'),
          )?.[0],
        ).toBe('/api/v1/analyses?mode=partial');
      }
      if (parseOnly)
        expect(
          fetch.mock.calls.find(([url]) =>
            url.startsWith('/api/v1/analyses'),
          )?.[0],
        ).toBe('/api/v1/analyses?mode=parse-only');
      else if (!ok)
        expect(
          screen.getByRole('heading', { name: 'Analysis incomplete' }),
        ).toBeInTheDocument();
    },
  );
}

test.runIf(enabled)('decoder rejects malformed source data', () => {
  expect(() =>
    decodeAnalysis(
      {
        ...responses.parsed,
        documents: { cv: { text: 5, facts: null }, jd: null },
      },
      true,
    ),
  ).toThrow();
});
