import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';

const job = '00000000-0000-4000-8000-0000000000e1';
const cv = {
  id: '00000000-0000-4000-8000-0000000000e2',
  name: 'Main CV',
  fileName: 'main.pdf',
  isDefault: true,
  updatedAt: '2026-11-01T00:00:00.000Z',
};
const added = {
  ...cv,
  id: '00000000-0000-4000-8000-0000000000e3',
  name: 'new.pdf',
  fileName: 'new.pdf',
  isDefault: false,
};

function JobMatch() {
  return (
    <CvMatchPanel
      jobId={job}
      revision="1"
      jobUpdatedAt="2026-11-02T00:00:00.000Z"
    />
  );
}
function Review() {
  const location = useLocation();
  return <p>Review page {location.pathname + location.search}</p>;
}
function mount(match: unknown, analyzed?: unknown) {
  let saved = match;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith(`/${job}/cv/current`))
      return Response.json(init?.method === 'PUT' ? added : cv);
    if (url.endsWith('/opportunities/cv'))
      return Response.json(init?.method === 'POST' ? added : [cv, added]);
    if (url.endsWith(`/${job}/match`)) {
      if (init?.method === 'POST') {
        saved = { status: 'VALID', result: analyzed, matchValidForMs: 900000 };
        return Response.json(analyzed);
      }
      return Response.json(saved);
    }
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter initialEntries={[`/jobs/${job}/match`]}>
      <Routes>
        <Route path="/jobs/:id/match" element={<JobMatch />} />
        <Route path="/cv/:cvId/review" element={<Review />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetch;
}
const returnTo = `?returnTo=${encodeURIComponent(`/jobs/${job}/match`)}`;

test('an unreviewed CV blocks Match with a Review CV action back to this job', async () => {
  const fetch = mount({
    status: 'CV_REVIEW_REQUIRED',
    cvId: cv.id,
    reviewStatus: 'PENDING',
  });
  expect(
    await screen.findByText(/Review this CV before matching/),
  ).toBeVisible();
  expect(screen.getByRole('link', { name: 'Review CV' })).toHaveAttribute(
    'href',
    `/cv/${cv.id}/review${returnTo}`,
  );
  expect(
    screen.getByRole('button', { name: 'Analyze CV Match' }),
  ).toBeDisabled();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith('/match') && init?.method === 'POST',
    ),
  ).toBe(false);
});

test('uploading a CV in Job Detail saves it for this job, then opens its review', async () => {
  const fetch = mount({ status: 'MISSING' });
  fireEvent.click(await screen.findByText('About this analysis'));
  expect(
    await screen.findByText(/A new CV opens Source CV Review first/),
  ).toBeVisible();
  await userEvent
    .setup()
    .upload(
      await screen.findByLabelText('Save CV for matching'),
      new File(['synthetic'], 'new.pdf', { type: 'application/pdf' }),
    );
  expect(
    await screen.findByText(`Review page /cv/${added.id}/review${returnTo}`),
  ).toBeVisible();
  // Associated with this job before leaving; no match is started.
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith(`/${job}/cv/current`) && init?.method === 'PUT',
    ),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith('/match') && init?.method === 'POST',
    ),
  ).toBe(false);
});

test.each(['MISSING', 'STALE_JOB', 'STALE_CV', 'EXPIRED'] as const)(
  '%s shows only preliminary evidence even if the response includes old rows',
  async (status) => {
    mount({
      status,
      cvUpdatedAt: cv.updatedAt,
      result: {
        requirements: [{ requirement: 'Old assessment', status: 'EVIDENCED' }],
      },
      skillMatch: {
        version: 1,
        score: null,
        limitation: 'INCOMPLETE_INVENTORY',
        matchedCount: 0,
        totalCount: 0,
        rows: [],
        findings: [
          {
            kind: 'skill',
            label: 'Java',
            sources: [{ field: 'jdText', start: 0, end: 4, quote: 'Java' }],
            evidence: { quote: 'Skills: Java', origin: 'source' },
          },
        ],
      },
    });
    expect(
      await screen.findByText('Preliminary skill evidence: Java'),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Saved assessment coverage' }),
    ).toBeNull();
    expect(screen.queryByText('Old assessment')).toBeNull();
  },
);

test('user-entered evidence is labelled as added in review, not from the file', async () => {
  const fetch = mount(
    { status: 'MISSING' },
    {
      matchId: '00000000-0000-4000-8000-0000000000e4',
      cvUpdatedAt: cv.updatedAt,
      jobUpdatedAt: '2026-11-02T00:00:00.000Z',
      analyzedAt: new Date().toISOString(),
      score: null,
      coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
      skillMatch: {
        version: 1,
        score: 100,
        limitation: null,
        matchedCount: 1,
        totalCount: 1,
        rows: [
          {
            source: {
              field: 'jdText',
              start: 0,
              end: 12,
              quote: 'AWS required',
            },
            priority: 'required',
            skills: [
              {
                name: 'AWS',
                evidence: {
                  quote: 'Certification: AWS Certified Developer',
                  origin: 'user_entered',
                },
              },
            ],
          },
        ],
        findings: [
          {
            kind: 'skill',
            label: 'AWS',
            sources: [{ field: 'jdText', start: 0, end: 3, quote: 'AWS' }],
            evidence: {
              quote: 'Certification: AWS Certified Developer',
              origin: 'user_entered',
              sectionKind: 'skills',
            },
          },
        ],
      },
      recommendation: 'Apply',
      explanation: 'Synthetic heuristic',
      advice: 'Verify accurate experience.',
      requirements: [
        {
          requirement: 'AWS',
          priority: 'required',
          category: 'skill',
          jdQuote: 'AWS required',
          cvQuote: 'Certification: AWS Certified Developer',
          cvOrigin: 'user_entered',
          status: 'EVIDENCED',
        },
      ],
    },
  );
  const analyze = await screen.findByRole('button', {
    name: 'Analyze CV Match',
  });
  await waitFor(() => expect(analyze).toBeEnabled());
  fireEvent.click(analyze);
  fireEvent.click(await screen.findByRole('button', { name: 'Matched (1)' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Matched: AWS required' }),
  );
  fireEvent.click(screen.getByText('Original CV evidence'));
  expect(
    screen.getAllByText('Certification: AWS Certified Developer')[0],
  ).toBeVisible();
  expect(screen.getAllByText(/Added by you in CV review/)[0]).toBeVisible();
  expect(screen.getByText('1 JD requirements')).toBeVisible();

  const saved = await (await fetch('/opportunities/' + job + '/match')).json();
  cleanup();
  const reload = mount(saved);
  expect(await screen.findByText('1 JD requirements')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Matched (1)' })).toBeVisible();
  expect(reload.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
    false,
  );
});

test('choosing another job CV keeps the previous assessment stale until reanalysis', async () => {
  const fetch = mount({ status: 'STALE_CV' });
  const user = userEvent.setup();
  const selector = await screen.findByRole('combobox', {
    name: 'CV for this job',
  });
  await user.click(selector);
  await user.click(await screen.findByRole('option', { name: added.name }));
  await waitFor(() => expect(selector).toHaveTextContent(added.name));
  expect(
    await screen.findByText(/different CV than the saved match/),
  ).toBeVisible();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        url.endsWith('/cv/current') &&
        init?.body === JSON.stringify({ cvId: added.id }),
    ),
  ).toBe(true);
  expect(
    fetch.mock.calls.some(
      ([url, init]) => url.endsWith('/match') && init?.method === 'POST',
    ),
  ).toBe(false);
});
