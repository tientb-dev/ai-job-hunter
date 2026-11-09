import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from './render';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import { tailoredDraftFixture, draftJobId } from './fixtures/tailored-cv';

test('resume bypasses completed source work, preserves draft pins and explains export blockers', async () => {
  const draft = tailoredDraftFixture();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/match') && init?.method === 'POST')
      throw Error('Resume must not analyze');
    if (url.endsWith('/cv/current'))
      return Response.json({
        fileName: 'Synthetic.docx',
        updatedAt: draft.updatedAt,
      });
    if (url.endsWith('/match')) return Response.json({ status: 'MISSING' });
    if (url.endsWith('/drafts/readiness'))
      return Response.json({
        contractVersion: '1',
        ready: false,
        reason: 'CV_DRAFT_STALE_MATCH',
        pins: null,
        matchValidForMs: 0,
      });
    if (url.endsWith('/drafts/list'))
      return Response.json({
        items: [
          {
            id: draft.id,
            revision: draft.revision,
            updatedAt: draft.updatedAt,
          },
        ],
        nextCursor: null,
      });
    if (url.endsWith(`/drafts/${draft.id}`)) return Response.json(draft);
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <CvMatchPanel
        jobId={draftJobId}
        revision="1"
        jobUpdatedAt={draft.updatedAt}
        view="improve"
        wizard
      />
    </MemoryRouter>,
  );
  // Stale match: Tailor & Review opens with the match gate and the earlier draft.
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  // Compact gate only: full evidence stays on the job page.
  expect(
    screen.getByRole('link', { name: 'View full assessment' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('group', { name: 'Filter requirements' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  await screen.findAllByText('Assisted a team prototype only.');
  expect(
    screen.getByText(/Your saved draft below stays available/),
  ).toBeVisible();
  // An open draft drives the next action even though the match is stale.
  expect(screen.getByRole('status', { name: 'Next step' })).toHaveTextContent(
    /Decide each suggestion and save, then continue to Approve & Export/,
  );
  expect(screen.getByText(/Pinned source/)).toHaveTextContent(
    draft.document.pins.sourceRevisionId.slice(0, 8),
  );
  expect(
    fetch.mock.calls.some(
      ([url, init]) => url.endsWith('/match') && init?.method === 'POST',
    ),
  ).toBe(false);
  // Approval belongs to the final step, not to suggestion review.
  expect(
    screen.queryByRole('button', { name: 'Approve saved draft' }),
  ).not.toBeInTheDocument();
  // Continue appears only once review work is finished; the step stays reachable.
  expect(
    screen.queryByRole('button', { name: 'Continue to Approve & Export' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Approve & Export/ }));
  await screen.findByRole('heading', {
    name: 'Step 3 of 3 · Approve & Export',
  });
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  expect(
    screen.getByText(
      /Approval is blocked: \d+ of \d+ suggestions still need a decision/,
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Approve saved draft' }),
  ).toBeDisabled();
  // One approval status source on this step: no extra success banners.
  expect(screen.queryByRole('status', { name: /approved/i })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Save draft' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Final preview' })).toBeVisible();
  // Decisions belong to Tailor & Review: no bulk decision control here.
  const exportPanel = screen.getByRole('region', { name: 'Download' });
  expect(
    within(exportPanel).queryByRole('button', {
      name: /Keep (all )?remaining originals/,
    }),
  ).toBeNull();
  // The unapproved export panel routes back to the step that unblocks it.
  fireEvent.click(
    screen.getByRole('button', { name: 'Finish review in Tailor & Review' }),
  );
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(screen.queryByText('Preview assembled CV')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /Approve & Export/ }));
  await screen.findByRole('heading', {
    name: 'Step 3 of 3 · Approve & Export',
  });
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
    ).toHaveFocus(),
  );
  // An unsaved bulk decision stays in Tailor & Review with Save draft at hand;
  // Approve & Export waits for the saved revision and nothing traps the user.
  fireEvent.click(
    screen.getByRole('button', { name: 'Keep remaining originals' }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: /^Keep \d+ originals?$/ }),
  );
  expect(
    await screen.findByRole('button', { name: 'Save draft' }),
  ).toBeEnabled();
  expect(screen.getByRole('tab', { name: /Approve & Export/ })).toBeDisabled();
  expect(screen.getByRole('tab', { name: /Tailor & Review/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/sources'))).toBe(
    false,
  );
});

test('Improve CV keeps suggestions and links to the dedicated workspace', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(null)),
  );
  render(
    <MemoryRouter>
      <CvMatchPanel jobId={draftJobId} revision="1" view="improve" />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: /tailored CV$/ })).toHaveAttribute(
    'href',
    `/jobs/${draftJobId}/tailored-cv`,
  );
  expect(
    screen.queryByRole('button', { name: 'Review source CV' }),
  ).not.toBeInTheDocument();
});
