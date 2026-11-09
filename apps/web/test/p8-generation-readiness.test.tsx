import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from './render';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import { syntheticMatch } from './fixtures/cv-suggestions';
import { richProfile, richSource } from './fixtures/structured-source-review';
const matchId = '00000000-0000-4000-8000-000000000090';
const jobId = '00000000-0000-4000-8000-000000000091';
function completed() {
  const profile = richProfile(),
    source = structuredClone(richSource),
    quote = 'https://example.invalid/morgan\n',
    start = source.text.length;
  source.text += quote;
  profile.document.sections.push({
    id: 'section-links',
    kind: 'links',
    review: 'confirmed',
    entries: [
      {
        id: 'record-links',
        facts: [
          {
            id: 'fact-link',
            field: 'link',
            value: quote,
            origin: 'source',
            review: 'confirmed',
            evidence: [
              {
                sourceRevisionId: source.id,
                start,
                end: source.text.length,
                quote,
              },
            ],
          },
        ],
      },
    ],
  });
  profile.document.coverage.push({
    start,
    end: source.text.length,
    disposition: 'mapped',
    factIds: ['fact-link'],
    reason: null,
  });
  for (const s of profile.document.sections) {
    s.review = 'confirmed';
    for (const e of s.entries) for (const f of e.facts) f.review = 'confirmed';
  }
  return { profile, source };
}
test('completed six-section review and fresh match enable P8 independently of P7 wall-clock rejection', async () => {
  const { profile, source } = completed(),
    now = Date.now();
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60 * 1000);
  let analyzed = false;
  const current = {
    ...syntheticMatch,
    matchId,
    cvUpdatedAt: source.savedCvUpdatedAt,
    analyzedAt: new Date(now).toISOString(),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/drafts/readiness'))
        return Response.json(
          !analyzed
            ? {
                contractVersion: '1',
                ready: false,
                reason: 'CV_DRAFT_MATCH_REQUIRED',
                pins: null,
                matchValidForMs: 0,
              }
            : {
                contractVersion: '1',
                ready: true,
                reason: null,
                pins: {
                  sourceRevisionId: source.id,
                  profileRevisionId: profile.id,
                  expectedProfileRevision: profile.revision,
                  expectedJobUpdatedAt: syntheticMatch.jobUpdatedAt,
                  matchId,
                },
                matchValidForMs: 900000,
              },
        );
      if (url.endsWith('/drafts/list'))
        return Response.json({ items: [], nextCursor: null });
      if (url.endsWith('/cv/current'))
        return Response.json({
          fileName: source.fileName,
          updatedAt: source.savedCvUpdatedAt,
        });
      if (url.endsWith('/match')) {
        if (init?.method !== 'POST')
          return Response.json(
            analyzed
              ? { status: 'VALID', result: current, matchValidForMs: 900000 }
              : { status: 'MISSING' },
          );
        analyzed = true;
        return Response.json(current);
      }
      if (url.endsWith('/sources') || url.endsWith('/content'))
        return Response.json(source);
      if (url.endsWith('/profile')) return Response.json(profile);
      throw Error('Unexpected synthetic route');
    }),
  );
  render(
    <MemoryRouter>
      <CvMatchPanel
        jobId={jobId}
        revision="1"
        jobUpdatedAt={syntheticMatch.jobUpdatedAt}
        view="improve"
        wizard
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByText(/Saved CV:/);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Analyze CV Match' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByRole('button', { name: 'Reanalyze CV Match' });
  fireEvent.click(screen.getByRole('tab', { name: /Source CV/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review source CV' }));
  await screen.findByText(/6 of 6 sections reviewed/);
  expect(screen.getByRole('button', { name: 'Complete review' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeEnabled(),
  );
  await screen.findByText(/Source review saved. Check readiness below/);
});

test('expired server context refreshes in place without repeating source review and survives tab navigation', async () => {
  const { profile, source } = completed();
  let expired = false,
    analyses = 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/cv/current'))
      return Response.json({
        fileName: source.fileName,
        updatedAt: source.savedCvUpdatedAt,
      });
    if (url.endsWith('/match')) {
      if (init?.method !== 'POST')
        return Response.json(
          !analyses
            ? { status: 'MISSING' }
            : expired
              ? { status: 'EXPIRED' }
              : {
                  status: 'VALID',
                  result: {
                    ...syntheticMatch,
                    matchId:
                      analyses === 1
                        ? matchId
                        : '00000000-0000-4000-8000-000000000092',
                    cvUpdatedAt: source.savedCvUpdatedAt,
                    analyzedAt: new Date().toISOString(),
                  },
                  matchValidForMs: 900000,
                },
        );
      expired = false;
      analyses++;
      return Response.json({
        ...syntheticMatch,
        matchId:
          analyses === 1 ? matchId : '00000000-0000-4000-8000-000000000092',
        cvUpdatedAt: source.savedCvUpdatedAt,
        analyzedAt: new Date().toISOString(),
      });
    }
    if (url.endsWith('/drafts/readiness')) {
      const id = JSON.parse(init!.body as string).matchId;
      return Response.json(
        expired || !id
          ? {
              contractVersion: '1',
              ready: false,
              reason: expired
                ? 'CV_DRAFT_STALE_MATCH'
                : 'CV_DRAFT_MATCH_REQUIRED',
              pins: null,
              matchValidForMs: 0,
            }
          : {
              contractVersion: '1',
              ready: true,
              reason: null,
              pins: {
                sourceRevisionId: source.id,
                profileRevisionId: profile.id,
                expectedProfileRevision: profile.revision,
                expectedJobUpdatedAt: syntheticMatch.jobUpdatedAt,
                matchId: id,
              },
              matchValidForMs: 900000,
            },
      );
    }
    if (url.endsWith('/drafts/list'))
      return Response.json({ items: [], nextCursor: null });
    throw Error('Unexpected synthetic route');
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <CvMatchPanel
        jobId={jobId}
        revision="1"
        jobUpdatedAt={syntheticMatch.jobUpdatedAt}
        view="improve"
        wizard
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByText(/Saved CV:/);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Analyze CV Match' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByRole('button', { name: 'Reanalyze CV Match' });
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeEnabled(),
  );
  expired = true;
  fireEvent.focus(window);
  await screen.findByText(/CV Match expired, was replaced/);
  expect(
    screen.getByRole('button', { name: 'Generate new draft' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh CV Match' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeEnabled(),
  );
  expect(analyses).toBe(2);
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeEnabled(),
  );
  // Drafts load automatically in the workspace; no manual load control.
  expect(
    screen.queryByRole('button', { name: 'Load saved drafts' }),
  ).toBeNull();
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/sources'))).toBe(
    false,
  );
});

test('a late readiness response cannot enable generation for changed job revisions', async () => {
  const { profile, source } = completed();
  let resolve!: (response: Response) => void;
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      calls++;
      if (calls === 1)
        return new Promise<Response>((done) => {
          resolve = done;
        });
      return Response.json({
        contractVersion: '1',
        ready: false,
        reason: 'CV_DRAFT_MATCH_REQUIRED',
        pins: null,
        matchValidForMs: 0,
      });
    }),
  );
  const props = {
    jobId,
    jobRevision: syntheticMatch.jobUpdatedAt!,
    cv: { fileName: source.fileName, updatedAt: source.savedCvUpdatedAt },
    matchId,
    disabled: false,
    onDirtyChange: () => {},
    onBusyChange: () => {},
  };
  const { TailoredCvReview } =
    await import('../src/features/inbox/TailoredCvReview');
  const view = render(<TailoredCvReview {...props} />);
  await waitFor(() => expect(calls).toBe(1));
  view.rerender(
    <TailoredCvReview {...props} jobRevision="2026-05-02T00:00:00.000Z" />,
  );
  await screen.findByRole('button', { name: 'Refresh CV Match' });
  resolve(
    Response.json({
      contractVersion: '1',
      ready: true,
      reason: null,
      pins: {
        sourceRevisionId: source.id,
        profileRevisionId: profile.id,
        expectedProfileRevision: profile.revision,
        expectedJobUpdatedAt: syntheticMatch.jobUpdatedAt,
        matchId,
      },
      matchValidForMs: 900000,
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeDisabled(),
  );
  expect(
    screen.getByRole('button', { name: 'Refresh CV Match' }),
  ).toBeVisible();
});

test('completing source review without a saved match opens CV Match instead of skipping it', async () => {
  const { profile, source } = completed();
  Element.prototype.scrollIntoView = vi.fn();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/drafts/readiness'))
      return Response.json({
        contractVersion: '1',
        ready: false,
        reason: 'CV_DRAFT_MATCH_REQUIRED',
        pins: null,
        matchValidForMs: 0,
      });
    if (url.endsWith('/drafts/list'))
      return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/cv/current'))
      return Response.json({
        fileName: source.fileName,
        updatedAt: source.savedCvUpdatedAt,
      });
    if (url.endsWith('/match')) {
      if (init?.method === 'POST') throw Error('No analysis expected');
      return Response.json({ status: 'MISSING' });
    }
    if (url.endsWith('/sources') || url.endsWith('/content'))
      return Response.json(source);
    if (url.endsWith('/profile')) return Response.json(profile);
    throw Error('Unexpected synthetic route');
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <CvMatchPanel
        jobId={jobId}
        revision="1"
        jobUpdatedAt={syntheticMatch.jobUpdatedAt}
        view="improve"
        wizard
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: /Source CV/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Review source CV' }));
  await screen.findByText(/6 of 6 sections reviewed/);
  fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(
    screen.getByRole('tab', { name: /Tailor & Review/ }),
  ).toHaveTextContent(/Current/);
  expect(await screen.findByText(/Not analyzed yet/)).toBeVisible();
  expect(
    fetch.mock.calls.some(
      ([url, init]) =>
        String(url).endsWith('/match') && init?.method === 'POST',
    ),
  ).toBe(false);
});
