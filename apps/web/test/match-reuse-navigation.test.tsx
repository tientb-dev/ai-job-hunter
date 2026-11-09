import {
  createMemoryRouter,
  RouterProvider,
  useParams,
} from 'react-router-dom';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import { TailoredCvPage } from '../src/features/inbox/TailoredCvPage';
import { syntheticMatch } from './fixtures/cv-suggestions';
import { tailoredDraftFixture, draftJobId } from './fixtures/tailored-cv';

function setup(
  options: {
    status?: string;
    reviewed?: boolean;
    draft?: boolean;
    source?: boolean;
    deferDraft?: boolean;
    deferInitial?: 'job' | 'cv' | 'match' | 'list' | 'readiness';
    draftFailure?: boolean;
    drafts?: ReturnType<typeof tailoredDraftFixture>[];
    approved?: boolean;
    start?: string;
    replaceDuringReadiness?: boolean;
  } = {},
) {
  const draft = tailoredDraftFixture();
  if (options.approved)
    draft.document.review.approval = {
      revision: draft.revision,
      approvedAt: draft.updatedAt,
    };
  const drafts = options.drafts ?? (options.draft ? [draft] : []);
  let releaseInitial!: () => void;
  const initialWait = new Promise<void>((resolve) => {
    releaseInitial = resolve;
  });
  let releaseDraft!: () => void;
  const draftWait = new Promise<void>((resolve) => {
    releaseDraft = resolve;
  });
  let status = options.status ?? 'VALID';
  let current = {
    ...syntheticMatch,
    matchId: '00000000-0000-4000-8000-000000000090',
    cvUpdatedAt: draft.updatedAt,
    jobUpdatedAt: draft.updatedAt,
    analyzedAt: new Date().toISOString(),
  };
  let analyses = 0;
  let refreshWait: Promise<void> | undefined;
  let releaseRefresh = () => {};
  let refreshFailure = false;
  let replacePending = options.replaceDuringReadiness;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const deferred = {
      job: `/opportunities/${draftJobId}`,
      cv: '/cv/current',
      match: '/match',
      list: '/drafts/list',
      readiness: '/drafts/readiness',
    };
    if (options.deferInitial && url.endsWith(deferred[options.deferInitial]))
      await initialWait;
    if (url.endsWith('/cv/current'))
      return Response.json(
        options.source === false
          ? null
          : {
              fileName: 'Synthetic.docx',
              updatedAt: draft.updatedAt,
            },
      );
    if (url.endsWith('/match')) {
      if (init?.method === 'POST') {
        analyses++;
        status = 'VALID';
        current = {
          ...current,
          matchId: '00000000-0000-4000-8000-000000000091',
        };
        return Response.json(current);
      }
      if (refreshWait) await refreshWait;
      if (refreshFailure) throw Error('Synthetic refresh failure');
      return Response.json(
        status === 'VALID'
          ? { status, result: current, matchValidForMs: 900000 }
          : { status },
      );
    }
    if (url.endsWith('/drafts/readiness')) {
      if (refreshWait) await refreshWait;
      if (refreshFailure) throw Error('Synthetic refresh failure');
      const body = JSON.parse(init!.body as string);
      if (replacePending && body.matchId === current.matchId) {
        replacePending = false;
        current = {
          ...current,
          matchId: '00000000-0000-4000-8000-000000000092',
          score: 42,
        };
      }
      const ready =
        options.reviewed !== false &&
        status === 'VALID' &&
        body.matchId === current.matchId;
      return Response.json({
        contractVersion: '1',
        ready,
        reason: ready
          ? null
          : options.reviewed === false
            ? 'CV_DRAFT_PROFILE_INCOMPLETE'
            : status === 'VALID' && body.matchId
              ? 'CV_DRAFT_STALE_MATCH'
              : 'CV_DRAFT_MATCH_REQUIRED',
        pins: ready
          ? {
              sourceRevisionId: draft.document.pins.sourceRevisionId,
              profileRevisionId: draft.document.pins.profileRevisionId,
              expectedProfileRevision: 2,
              expectedJobUpdatedAt: draft.updatedAt,
              matchId: current.matchId,
            }
          : null,
        matchValidForMs: ready ? 900000 : 0,
      });
    }
    if (url.endsWith('/drafts/list'))
      return Response.json({
        items: drafts.map((row) => ({
          id: row.id,
          revision: row.revision,
          updatedAt: row.updatedAt,
        })),
        nextCursor: null,
      });
    const selected = drafts.find((row) => url.endsWith(`/drafts/${row.id}`));
    if (selected) {
      if (options.deferDraft) await draftWait;
      if (options.draftFailure)
        return Response.json({ error: 'synthetic failure' }, { status: 503 });
      return Response.json(selected);
    }
    if (url.endsWith(`/opportunities/${draftJobId}`))
      return Response.json({ id: draftJobId, updatedAt: draft.updatedAt });
    throw Error(`Unexpected synthetic request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  function Job() {
    const { id } = useParams();
    const [view, setView] = useState<'match' | 'improve'>('match');
    return (
      <>
        <button onClick={() => setView('improve')}>Improve CV tab</button>
        <CvMatchPanel
          jobId={id!}
          revision="1"
          jobUpdatedAt={draft.updatedAt}
          view={view}
        />
      </>
    );
  }
  const router = createMemoryRouter(
    [
      { path: '/jobs/:id', element: <Job /> },
      { path: '/jobs/:id/tailored-cv', element: <TailoredCvPage /> },
    ],
    {
      initialEntries: [
        `/jobs/${draftJobId}`,
        options.start ?? `/jobs/${draftJobId}/tailored-cv`,
      ],
      initialIndex: 1,
    },
  );
  render(<RouterProvider router={router} />);
  return {
    fetch,
    releaseDraft,
    releaseInitial,
    router,
    analyses: () => analyses,
    pauseRefresh: () => {
      refreshWait = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
    },
    releaseRefresh: () => {
      releaseRefresh();
      refreshWait = undefined;
    },
    changeStatus: (value: string) => {
      status = value;
    },
    failRefresh: () => {
      refreshFailure = true;
    },
    draft,
    replace: () => {
      current = {
        ...current,
        matchId: '00000000-0000-4000-8000-000000000092',
        score: 42,
      };
    },
  };
}

test('reviewed source and authoritative valid match enter Step 3 without analysis', async () => {
  const state = setup();
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(state.analyses()).toBe(0);
  expect(
    screen.getByText(/Saved match.*No new analysis is needed/),
  ).toBeEnabled();
  expect(
    screen.getByRole('tab', { name: /Approve & Export.*Unavailable/ }),
  ).toBeDisabled();
});

test.each(['MISSING', 'EXPIRED', 'STALE_CV', 'STALE_JOB'])(
  'reviewed source + %s match enter Step 2 with a specific reason',
  async (status) => {
    const state = setup({ status });
    await screen.findByRole('heading', {
      name: 'Step 2 of 3 · Tailor & Review',
    });
    const reason = {
      MISSING: /Not analyzed yet/,
      EXPIRED: /Matching rules were updated/,
      STALE_CV: /Your CV changed since/,
      STALE_JOB: /The job changed since/,
    }[status]!;
    expect(screen.getByText(reason)).toBeVisible();
    expect(state.analyses()).toBe(0);
  },
);

test('Job Detail analysis is reused by wizard and wizard analysis is reflected on browser back', async () => {
  const state = setup({ status: 'MISSING', start: `/jobs/${draftJobId}` });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Analyze CV Match' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  await screen.findByText(/Saved match.*No new analysis is needed/);
  fireEvent.click(screen.getByRole('button', { name: 'Improve CV tab' }));
  fireEvent.click(screen.getByRole('link', { name: /tailored CV$/ }));
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(state.analyses()).toBe(1);
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Reanalyze CV Match' }));
  await waitFor(() => expect(state.analyses()).toBe(2));
  await screen.findByText(/Saved match.*No new analysis is needed/);
  await state.router.navigate(-1);
  await screen.findByRole('button', { name: 'Reanalyze CV Match' });
  await screen.findByText(/Saved match.*No new analysis is needed/);
  expect(state.analyses()).toBe(2);
});

test.each([false, true])(
  'saved draft resumes with unavailable match (approved=%s) and preserves edits',
  async (approved) => {
    const state = setup({ status: 'MISSING', draft: true, approved });
    // A saved draft never implies CV Match is complete.
    await screen.findByRole('heading', {
      name: 'Step 2 of 3 · Tailor & Review',
    });
    // The merged step's match gate shows the match is not current.
    expect(screen.queryByText(/No new analysis is needed/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
    await screen.findByRole('heading', {
      name: 'Step 2 of 3 · Tailor & Review',
    });
    await screen.findAllByText('Assisted a team prototype only.');
    expect(state.analyses()).toBe(0);
    expect(screen.getByText(/Pinned source/)).toHaveTextContent(
      state.draft.document.pins.sourceRevisionId.slice(0, 8),
    );
    if (approved) {
      expect(screen.getByText('Approved — Ready to export')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Save draft' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Discard local draft edits' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('checkbox', {
          name: /I reviewed the complete saved CV/,
        }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Approve saved draft' }),
      ).not.toBeInTheDocument();
      // Drafts load automatically; reload is offered only after an error.
      expect(
        screen.queryByRole('button', { name: 'Reload saved draft' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Current · Complete')).not.toBeInTheDocument();
      return;
    }
    fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
    fireEvent.change(
      screen.getByRole('textbox', { name: /description \(experience/ }),
      { target: { value: 'Synthetic local edit' } },
    );
    // Unsaved draft edits keep Tailor & Review reachable; other steps wait.
    expect(screen.getByRole('tab', { name: /Tailor & Review/ })).toBeEnabled();
    expect(screen.getByRole('tab', { name: /Source CV/ })).toBeDisabled();
    expect(
      screen.getByRole('tab', { name: /Approve & Export/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('link', { name: /Back to job/ }));
    await screen.findByRole('dialog', { name: 'Leave unsaved changes?' });
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('textbox', { name: /description \(experience/ }),
    ).toHaveValue('Synthetic local edit');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    void state.router.navigate(-1);
    await screen.findByRole('dialog', { name: 'Leave unsaved changes?' });
    fireEvent.click(screen.getByRole('button', { name: 'Stay and edit' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole('textbox', { name: /description \(experience/ }),
    ).toHaveValue('Synthetic local edit');
  },
);

test('manual source selection is retained when readiness refreshes', async () => {
  setup();
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  fireEvent.click(screen.getByRole('tab', { name: /Source CV.*Complete/ }));
  fireEvent.focus(window);
  await screen.findByRole('heading', { name: 'Step 1 of 3 · Source CV' });
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Step 1 of 3 · Source CV' }),
    ).toHaveFocus(),
  );
});

test('a replacement from another view is adopted on focus without analysis', async () => {
  const state = setup();
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  state.replace();
  fireEvent.focus(window);
  await screen.findByLabelText(/Fit score: 42\/100/);
  expect(state.analyses()).toBe(0);
});

test('valid match does not skip an incomplete source review', async () => {
  const state = setup({ reviewed: false });
  await screen.findByRole('heading', { name: 'Step 1 of 3 · Source CV' });
  expect(
    await screen.findByRole('button', { name: 'Review source CV' }),
  ).toBeEnabled();
  expect(
    screen.getByText(/Saved match.*No new analysis is needed/),
  ).toBeEnabled();
  expect(state.analyses()).toBe(0);
});

test('invalid current-match output offers read retry without automatic analysis', async () => {
  const state = setup({ status: 'INVALID' });
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(
    screen.getByRole('button', { name: 'Retry loading match' }),
  ).toBeEnabled();
  expect(screen.getByText(/Could not load the current CV Match/)).toBeVisible();
  expect(state.analyses()).toBe(0);
});

test('replacement between current-match read and readiness is reread without analysis', async () => {
  const state = setup({ replaceDuringReadiness: true });
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByLabelText(/Fit score: 42\/100/);
  expect(state.analyses()).toBe(0);
});

test('no saved source and no draft enter Source CV', async () => {
  setup({ source: false, status: 'CV_UNAVAILABLE' });
  await screen.findByRole('heading', { name: 'Step 1 of 3 · Source CV' });
  expect(screen.getByRole('button', { name: 'Save source CV' })).toBeEnabled();
});

test('explicit Resume selects Step 3 before a delayed approved draft load and stays there', async () => {
  const state = setup({
    draft: true,
    approved: true,
    status: 'EXPIRED',
    deferDraft: true,
  });
  fireEvent.click(await screen.findByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByRole('button', { name: 'Resume latest draft' });
  fireEvent.click(screen.getByRole('button', { name: 'Resume latest draft' }));
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  state.releaseDraft();
  await screen.findByText('Approved — Ready to export');
  expect(
    screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
  ).toBeVisible();
  expect(state.analyses()).toBe(0);
});

test('manual step selection during automatic draft loading is not overridden by completion', async () => {
  const state = setup({ draft: true, approved: true, deferDraft: true });
  fireEvent.click(await screen.findByRole('tab', { name: /Source CV/ }));
  state.releaseDraft();
  await waitFor(() =>
    expect(
      screen.queryByText(/Finding your next step/),
    ).not.toBeInTheDocument(),
  );
  fireEvent.focus(window);
  expect(
    screen.getByRole('heading', { name: 'Step 1 of 3 · Source CV' }),
  ).toBeVisible();
});

test('approved draft enters review from Job Detail; export is explicit and return remains in review', async () => {
  setup({ draft: true, approved: true, start: `/jobs/${draftJobId}` });
  fireEvent.click(screen.getByRole('button', { name: 'Improve CV tab' }));
  fireEvent.click(screen.getByRole('link', { name: /tailored CV$/ }));
  await screen.findByText('Approved — Ready to export');
  expect(
    screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
  ).toBeVisible();
  expect(
    screen.getAllByText('Assisted a team prototype only.')[0],
  ).toBeVisible();
  const preview = await screen.findByRole('button', {
    name: 'Continue to Approve & Export',
  });
  expect(preview).toHaveClass('MuiButton-contained');
  fireEvent.click(preview);
  await screen.findByRole('heading', {
    name: 'Step 3 of 3 · Approve & Export',
  });
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  fireEvent.focus(window);
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(screen.getByText('Approved — Ready to export')).toBeVisible();
});

test('editing approved content retains saved approval, exposes save/discard and blocks export', async () => {
  const state = setup({ draft: true, approved: true });
  await screen.findByText('Approved — Ready to export');
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  fireEvent.change(
    screen.getByRole('textbox', { name: /description \(experience/ }),
    { target: { value: 'Unapproved synthetic local edit' } },
  );
  expect(screen.getByText(/Local edits are not approved/)).toBeVisible();
  expect(
    screen.queryByText('Approved — Ready to export'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Discard local draft edits' }),
  ).toBeEnabled();
  // Unsaved edits hide Continue; the export step stays locked.
  expect(
    screen.queryByRole('button', { name: 'Continue to Approve & Export' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Approve & Export/ })).toBeDisabled();
  expect(state.draft.document.review.approval?.revision).toBe(
    state.draft.revision,
  );
  expect(state.fetch.mock.calls.some(([url]) => url.endsWith('/export'))).toBe(
    false,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard local draft edits' }),
  );
  await screen.findByText('Approved — Ready to export');
});

test('Load selected older approved draft from preview opens Step 3 and preserves that selection', async () => {
  const newest = tailoredDraftFixture();
  const older = structuredClone(newest);
  older.id = '00000000-0000-4000-8000-000000000085';
  older.revision = 3;
  older.document.review.approval = { revision: 3, approvedAt: older.updatedAt };
  older.document.sections.find(
    (section) => section.kind === 'experience',
  )!.entries[0]!.facts[0]!.acceptedText = 'Distinct older draft content.';
  setup({ drafts: [newest, older] });
  await screen.findAllByText('Assisted a team prototype only.');
  // Entry resolves after the readiness check; steps are inert until then.
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  fireEvent.click(screen.getByRole('tab', { name: /Approve & Export/ }));
  // Approve & Export shows the open draft only and explains where to switch.
  expect(screen.queryByRole('list', { name: 'Saved drafts' })).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Switch drafts in Tailor & Review' }),
  );
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  fireEvent.click(screen.getByText('Switch draft (2)'));
  fireEvent.click(screen.getByRole('button', { name: /^Draft 1 .*version 3/ }));
  await screen.findByText('Distinct older draft content.');
  expect(screen.getByText(/Opened Draft 1\./)).toBeVisible();
  expect(
    screen.getByRole('button', { name: /^Draft 1 .*Open now$/ }),
  ).toHaveAttribute('aria-current', 'true');
  expect(
    screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
  ).toBeVisible();
  fireEvent.focus(window);
  fireEvent.click(screen.getByText(/^Full CV:/));
  expect(screen.getByText('Distinct older draft content.')).toBeVisible();
});

test.each(['VALID', 'EXPIRED', 'MISSING'])(
  'slow saved draft with %s match never paints a default source step',
  async (status) => {
    const state = setup({ draft: true, deferDraft: true, status });
    await waitFor(() =>
      expect(
        state.fetch.mock.calls.some(([url]) =>
          url.endsWith(`/drafts/${state.draft.id}`),
        ),
      ).toBe(true),
    );
    expect(screen.getByText(/Finding your next step/)).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: /Step \d of 3/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save source CV' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Replace source CV' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resume latest draft' }),
    ).not.toBeInTheDocument();
    state.releaseDraft();
    if (status === 'VALID')
      await screen.findByRole('heading', {
        name: 'Step 2 of 3 · Tailor & Review',
      });
    else {
      await screen.findByRole('heading', {
        name: 'Step 2 of 3 · Tailor & Review',
      });
      // The merged step's match gate shows the match is not current.
      expect(screen.queryByText(/No new analysis is needed/)).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
      await screen.findByRole('heading', {
        name: 'Step 2 of 3 · Tailor & Review',
      });
    }
    expect(
      screen.getAllByText('Assisted a team prototype only.')[0],
    ).toBeVisible();
    expect(state.analyses()).toBe(0);
  },
);

test.each(['job', 'cv', 'match', 'list', 'readiness'] as const)(
  'initial %s hydration is neutral until the first step is known',
  async (deferInitial) => {
    const state = setup({ deferInitial });
    await waitFor(() =>
      expect(state.fetch.mock.calls.length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByRole('heading', { name: /Step \d of 3/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save source CV' }),
    ).not.toBeInTheDocument();
    state.releaseInitial();
    await screen.findByRole('heading', {
      name: 'Step 2 of 3 · Tailor & Review',
    });
    expect(state.analyses()).toBe(0);
  },
);

test('draft restoration failure remains visible instead of leaving a permanent loading shell', async () => {
  setup({ draft: true, draftFailure: true });
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(screen.getByText(/Could not load saved drafts/)).toBeVisible();
  expect(screen.queryByText(/Finding your next step/)).not.toBeInTheDocument();
});

test('returning from Job Detail restores the saved draft without analysis', async () => {
  const state = setup({ draft: true, status: 'EXPIRED' });
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  fireEvent.click(screen.getByRole('link', { name: /Back to job/ }));
  await screen.findByRole('button', { name: 'Improve CV tab' });
  fireEvent.click(screen.getByRole('button', { name: 'Improve CV tab' }));
  fireEvent.click(screen.getByRole('link', { name: /tailored CV$/ }));
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  // The merged step's match gate shows the match is not current.
  expect(screen.queryByText(/No new analysis is needed/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByRole('heading', {
    name: 'Step 2 of 3 · Tailor & Review',
  });
  expect(
    screen.getAllByText('Assisted a team prototype only.')[0],
  ).toBeVisible();
  expect(state.analyses()).toBe(0);
});

test('focus revalidation keeps saved workspace and completion labels stable while generation waits', async () => {
  const state = setup({ draft: true });
  const heading = await screen.findByRole('heading', {
    name: 'Step 2 of 3 · Tailor & Review',
  });
  await screen.findByRole('tab', { name: /Source CV.*Complete/ });
  await screen.findByText(/Saved match.*No new analysis is needed/);
  fireEvent.click(
    screen.getByText('Generate a separate draft for the current job'),
  );
  const generate = screen.getByRole('button', { name: 'Generate new draft' });
  await waitFor(() => expect(generate).toBeEnabled());
  const lists = () =>
    state.fetch.mock.calls.filter(([url]) => url.endsWith('/drafts/list'))
      .length;
  const reads = () =>
    state.fetch.mock.calls.filter(
      ([url, init]) => url.endsWith('/match') && init?.method !== 'POST',
    ).length;
  const listBefore = lists(),
    readsBefore = reads();
  state.pauseRefresh();
  fireEvent.focus(window);
  await waitFor(() => expect(reads()).toBeGreaterThan(readsBefore));
  expect(
    screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
  ).toBe(heading);
  expect(
    screen.getByText(/Saved match.*No new analysis is needed/),
  ).toBeVisible();
  expect(
    screen.getByRole('tab', { name: /Source CV.*Complete/ }),
  ).toBeVisible();
  expect(
    screen.getAllByText('Assisted a team prototype only.')[0],
  ).toBeVisible();
  expect(generate).toBeDisabled();
  state.releaseRefresh();
  await waitFor(() => expect(generate).toBeEnabled());
  expect(lists()).toBe(listBefore);
  expect(state.analyses()).toBe(0);
});

test('repeated focus revalidation preserves unsaved draft edits and proposal decisions', async () => {
  const state = setup({ draft: true });
  await screen.findByRole('tab', { name: /Source CV.*Complete/ });
  const heading = screen.getByRole('heading', {
    name: 'Step 2 of 3 · Tailor & Review',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  const editor = screen.getByRole('textbox', {
    name: /description \(experience/,
  });
  fireEvent.change(editor, { target: { value: 'Unsaved synthetic wording.' } });
  for (let i = 0; i < 3; i++) fireEvent.focus(window);
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.filter(
        ([url, init]) => url.endsWith('/match') && init?.method !== 'POST',
      ).length,
    ).toBeGreaterThan(1),
  );
  expect(
    screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
  ).toBe(heading);
  expect(
    screen.getByRole('textbox', { name: /description \(experience/ }),
  ).toBe(editor);
  expect(editor).toHaveValue('Unsaved synthetic wording.');
  // Unsaved draft edits keep Tailor & Review reachable; other steps wait.
  expect(screen.getByRole('tab', { name: /Tailor & Review/ })).toBeEnabled();
  expect(screen.getByRole('tab', { name: /Source CV/ })).toBeDisabled();
  expect(screen.getByRole('tab', { name: /Approve & Export/ })).toBeDisabled();
  expect(state.analyses()).toBe(0);
});

test.each(['EXPIRED', 'MISSING', 'STALE_CV', 'STALE_JOB'])(
  'focus still applies authoritative %s invalidation without reopening the draft',
  async (status) => {
    const state = setup({ draft: true });
    await screen.findByRole('tab', { name: /Source CV.*Complete/ });
    state.pauseRefresh();
    state.changeStatus(status);
    fireEvent.focus(window);
    state.releaseRefresh();
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: /Tailor & Review/ }),
      ).not.toHaveTextContent('Complete'),
    );
    expect(
      screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByText('Generate a separate draft for the current job'),
    );
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeDisabled();
    expect(
      screen.getAllByText('Assisted a team prototype only.')[0],
    ).toBeVisible();
    expect(state.analyses()).toBe(0);
  },
);

test('failed background checks retain the draft, report the error and block generation', async () => {
  const state = setup({ draft: true });
  await screen.findByRole('tab', { name: /Source CV.*Complete/ });
  state.failRefresh();
  fireEvent.focus(window);
  expect(
    (
      await screen.findByRole('button', { name: 'Retry loading match' })
    ).closest('[role="alert"]'),
  ).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByText('Generate a separate draft for the current job'),
  );
  expect(
    screen.getByRole('button', { name: 'Generate new draft' }),
  ).toBeDisabled();
  expect(
    screen.getAllByText('Assisted a team prototype only.')[0],
  ).toBeVisible();
  expect(state.analyses()).toBe(0);
});

test('focus rechecks readiness even when the previous match was missing', async () => {
  const state = setup({ draft: true, status: 'MISSING' });
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  const reads = () =>
    state.fetch.mock.calls.filter(([url]) => url.endsWith('/drafts/readiness'))
      .length;
  await waitFor(() => expect(reads()).toBeGreaterThan(0));
  const before = reads();
  fireEvent.focus(window);
  await waitFor(() => expect(reads()).toBeGreaterThan(before));
  expect(state.analyses()).toBe(0);
});

test('an earlier draft does not skip an incomplete source review for the current CV', async () => {
  const state = setup({ status: 'VALID', draft: true, reviewed: false });
  await screen.findByRole('heading', { name: 'Step 1 of 3 · Source CV' });
  expect(state.analyses()).toBe(0);
  expect(
    screen.getByRole('tab', { name: /Tailor & Review/ }),
  ).toHaveTextContent('Earlier draft available');
  fireEvent.click(screen.getByRole('tab', { name: /Tailor & Review/ }));
  await screen.findByRole('heading', { name: 'Step 2 of 3 · Tailor & Review' });
  expect(
    screen.getAllByText('Assisted a team prototype only.')[0],
  ).toBeVisible();
});

test('restoring the step on load does not focus the heading; a user step change does', async () => {
  setup({ status: 'VALID', draft: true });
  const restored = await screen.findByRole('heading', {
    name: 'Step 2 of 3 · Tailor & Review',
  });
  await screen.findAllByText('Assisted a team prototype only.');
  expect(restored).not.toHaveFocus();
  fireEvent.click(screen.getByRole('tab', { name: /Source CV/ }));
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Step 1 of 3 · Source CV' }),
    ).toHaveFocus(),
  );
});
