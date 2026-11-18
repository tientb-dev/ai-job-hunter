import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function Review() {
  const location = useLocation();
  return <p>Review page {location.pathname + location.search}</p>;
}
function mount(match: unknown, analyzed?: unknown) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith(`/${job}/cv/current`))
      return Response.json(init?.method === 'PUT' ? added : cv);
    if (url.endsWith('/opportunities/cv'))
      return Response.json(init?.method === 'POST' ? added : [cv]);
    if (url.endsWith(`/${job}/match`))
      return Response.json(init?.method === 'POST' ? analyzed : match);
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter initialEntries={[`/jobs/${job}/match`]}>
      <Routes>
        <Route
          path="/jobs/:id/match"
          element={
            <CvMatchPanel
              jobId={job}
              revision="1"
              jobUpdatedAt="2026-11-02T00:00:00.000Z"
            />
          }
        />
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
  // Improve your CV names the real prerequisite, not a generic "Outdated".
  expect(
    screen.getByText(/Review this CV first. Suggestions need a completed/),
  ).toBeVisible();
  expect(
    screen.queryByText(/Outdated. This match is no longer current/),
  ).toBeNull();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith('/match') && init?.method === 'POST',
    ),
  ).toBe(false);
});

test('uploading a CV in Job Detail saves it for this job, then opens its review', async () => {
  const fetch = mount({ status: 'MISSING' });
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

test('user-entered evidence is labelled as added in review, not from the file', async () => {
  mount(
    { status: 'MISSING' },
    {
      matchId: '00000000-0000-4000-8000-0000000000e4',
      cvUpdatedAt: cv.updatedAt,
      jobUpdatedAt: '2026-11-02T00:00:00.000Z',
      analyzedAt: '2026-11-03T00:00:00.000Z',
      score: 100,
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
  fireEvent.click(
    await screen.findByRole('button', { name: /^Already matched \(/u }),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Matched: AWS' }));
  expect(
    await screen.findByText(
      'Your CV · added by you in review, not from the uploaded file',
    ),
  ).toBeVisible();
});
