import { downloadDraft } from '../src/features/inbox/tailored-cv.contract';
import { useRef, useState } from 'react';
import { ThemeProvider } from '@mui/material';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { TailoredCvReview } from '../src/features/inbox/TailoredCvReview';
import { UnsavedJobGuard } from '../src/features/inbox/UnsavedJobGuard';
import { tailoredDraftFixture, draftJobId } from './fixtures/tailored-cv';
const noop = () => {};
function setup(initial = tailoredDraftFixture()) {
  let saved = initial;
  let conflict = false;
  let exportFailure = false;
  let late: ((value: Response) => void) | undefined;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/export'))
      return exportFailure
        ? Response.json({ errorCode: 'CV_EXPORT_UNAVAILABLE' }, { status: 503 })
        : new Response(new Uint8Array([37, 80, 68, 70]), {
            headers: {
              'Content-Type':
                JSON.parse(init!.body as string).format === 'pdf'
                  ? 'application/pdf'
                  : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Disposition':
                'attachment; filename="tailored-cv-synthetic.pdf"',
            },
          });
    if (url.endsWith('/drafts/list'))
      return Response.json({ items: [saved], nextCursor: null });
    if (url.endsWith('/review') || url.endsWith('/approve')) {
      if (conflict)
        return Response.json(
          { errorCode: 'CV_DRAFT_SAVE_CONFLICT' },
          { status: 409 },
        );
      const body = JSON.parse(init!.body as string);
      const next = structuredClone(saved);
      next.revision++;
      next.document.review.approval = null;
      if (url.endsWith('/approve'))
        next.document.review.approval = {
          revision: next.revision,
          approvedAt: next.updatedAt,
        };
      else
        for (const op of body.operations) {
          if (op.action === 'acknowledge') {
            next.document.review.acknowledgedIssues.push(op.issueIndex);
            continue;
          }
          const fact = next.document.sections
            .flatMap((s) => s.entries.flatMap((e) => e.facts))
            .find((f) => f.id === op.factId)!;
          const state = next.document.review.factReviews[fact.id]!;
          if (op.action === 'include') state.exportIncluded = op.included;
          if (op.action === 'acknowledge')
            next.document.review.acknowledgedIssues.push(op.issueIndex);
          if (op.action === 'accept') {
            fact.acceptedText = fact.proposedWording!.text;
            state.wording = 'ai_accepted';
            state.proposal = 'accepted';
          }
          if (op.action === 'reject') {
            state.proposal = 'rejected';
            state.wording = 'reviewed_profile';
            fact.acceptedText = state.reviewedText;
          }
          if (op.action === 'edit') {
            fact.acceptedText = op.text;
            state.wording = 'user_edited';
            state.proposal = 'rejected';
          }
          if (op.action === 'restore') {
            fact.acceptedText = state.reviewedText;
            state.wording = 'reviewed_profile';
            state.proposal = 'rejected';
          }
        }
      saved = next;
      return Response.json(saved);
    }
    if (late)
      return new Promise<Response>((resolve) => {
        late = resolve;
      });
    return Response.json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  function Harness() {
    const [dirty, setDirty] = useState(false);
    const nav = useRef(false);
    return (
      <ThemeProvider theme={theme}>
        <UnsavedJobGuard
          dirty={dirty}
          sourceCvDirty={dirty}
          savedNavigation={nav}
        />
        <TailoredCvReview
          jobId={draftJobId}
          jobRevision={saved.document.pins.jobUpdatedAt}
          cv={null}
          disabled={false}
          onDirtyChange={setDirty}
          onBusyChange={noop}
        />
        <Link to="/away">Leave</Link>
      </ThemeProvider>
    );
  }
  const router = createMemoryRouter([
    { path: '/', element: <Harness /> },
    { path: '/away', element: <p>Away</p> },
  ]);
  const rendered = render(<RouterProvider router={router} />);
  return {
    fetch,
    saved: () => saved,
    failExport: () => {
      exportFailure = true;
    },
    conflict: () => {
      conflict = true;
    },
    rendered,
    delay: () => {
      late = () => {};
    },
    resolve: () => late?.(Response.json(saved)),
  };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Load saved drafts' }));
  await screen.findByText(/Switch draft \(1\)/);
  fireEvent.click(screen.getByRole('button', { name: /^Draft 1 .*Open$/ }));
  await screen.findAllByText('Assisted a team prototype only.');
}
function openCv() {
  fireEvent.click(screen.getByText(/^Full CV:/));
}
test('complete CV supports explicit proposal acceptance, save, exact approval, reload and manual invalidation', async () => {
  const state = setup();
  await open();
  openCv();
  expect(screen.getByText(/^Not in your source CV/)).toHaveTextContent(
    /contact.*additional/,
  );
  expect(screen.getByRole('heading', { name: 'experience' })).toBeVisible();
  expect(screen.queryByText('Source-derived')).toBeNull();
  expect(
    screen.queryByRole('checkbox', { name: /Include .* in download/ }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: /Accept suggestion for .*Description/ }),
  );
  expect(screen.getByText('Accepted')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: /Change decision for .*Description/ }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Keep original for .*Description/ }),
  );
  expect(screen.getByText('Original kept')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: /Change decision for .*Description/ }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Accept suggestion for .*Description/ }),
  );
  expect(
    screen.getByRole('button', { name: 'Approve saved draft' }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Review notes \(2\) · no action needed/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /I checked this fact/ }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved.');
  expect(state.saved().revision).toBe(2);
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I reviewed the complete saved CV/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve saved draft' }));
  await screen.findByText('This saved draft revision is approved.');
  expect(state.saved().document.review.approval?.revision).toBe(3);
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }));
  // Revision and approval live on the draft card.
  const card = await screen.findByRole('region', { name: 'Current draft' });
  await waitFor(() =>
    expect(card).toHaveTextContent(/Approved.*Saved version 3/),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  fireEvent.change(
    screen.getByRole('textbox', { name: /description \(experience/ }),
    { target: { value: 'User-entered academic experience.' } },
  );
  expect(screen.getByText('Manually edited')).toBeVisible();
  expect(
    screen.getByText(/Unsaved changes — approval will be cleared/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. Approval cleared.');
  expect(state.saved().document.review.approval).toBeNull();
});
test('keep original, keyboard editing, unsaved navigation and conflicts retain local inputs', async () => {
  const state = setup();
  await open();
  const user = userEvent.setup();
  screen
    .getByRole('button', { name: /Keep original for .*Description/ })
    .focus();
  await user.keyboard('{Enter}');
  expect(screen.getByText('Original kept')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  const input = screen.getByRole('textbox', {
    name: /description \(experience/,
  });
  fireEvent.change(input, { target: { value: 'Local edited CV' } });
  state.conflict();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/changed in another window/);
  expect(input).toHaveValue('Local edited CV');
  fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
  await screen.findByRole('dialog', { name: 'Leave unsaved changes?' });
  expect(screen.getByRole('button', { name: 'Stay and edit' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(input).toHaveValue('Local edited CV');
});
test('late responses cannot reenable editing or overwrite local work after unmount', async () => {
  const state = setup();
  await open();
  state.delay();
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }));
  expect(
    screen.getByRole('button', { name: 'Edit experience' }),
  ).toBeDisabled();
  state.rendered.unmount();
  state.resolve();
  expect(screen.queryAllByText('Assisted a team prototype only.')).toHaveLength(
    0,
  );
});

test('generation pins reviewed profile and saved job timestamp, separately from local UI tokens', async () => {
  const fixture = tailoredDraftFixture();
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/drafts/readiness'))
      return Response.json({
        contractVersion: '1',
        ready: true,
        reason: null,
        pins: {
          sourceRevisionId: fixture.document.pins.sourceRevisionId,
          profileRevisionId: fixture.document.pins.profileRevisionId,
          expectedProfileRevision: 2,
          expectedJobUpdatedAt: fixture.document.pins.jobUpdatedAt,
          matchId: '00000000-0000-4000-8000-000000000086',
        },
        matchValidForMs: 900000,
      });
    if (url.endsWith('/sources'))
      return Response.json({ id: fixture.document.pins.sourceRevisionId });
    if (url.endsWith('/profile'))
      return Response.json({
        id: fixture.document.pins.profileRevisionId,
        revision: 2,
      });
    return Response.json(fixture);
  });
  vi.stubGlobal('fetch', fetch);
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  render(
    <ThemeProvider theme={theme}>
      <TailoredCvReview
        jobId={draftJobId}
        jobRevision={fixture.document.pins.jobUpdatedAt}
        cv={{ fileName: 'synthetic.txt', updatedAt: fixture.updatedAt }}
        matchId="00000000-0000-4000-8000-000000000086"
        disabled={false}
        onDirtyChange={noop}
        onBusyChange={noop}
      />
    </ThemeProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Generate new draft' }));
  await screen.findByText(
    'New draft generated and opened. Existing drafts are unchanged.',
  );
  const call = fetch.mock.calls.find(([url]) => url.endsWith('/drafts'));
  expect(call).toBeDefined();
  const init = (fetch.mock.calls as unknown as [string, RequestInit][]).find(
    ([url]) => url.endsWith('/drafts'),
  )![1];
  expect(JSON.parse(init.body as string)).toMatchObject({
    contractVersion: '1',
    expectedJobUpdatedAt: fixture.document.pins.jobUpdatedAt,
    expectedProfileRevision: 2,
    profileRevisionId: fixture.document.pins.profileRevisionId,
  });
  expect(storage).not.toHaveBeenCalled();
});

test('downloads use exact saved approval, errors retain work, and inclusion changes preserve unsaved wording', async () => {
  const state = setup();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:synthetic-cv'),
      revokeObjectURL: vi.fn(),
    }),
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  await open();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: /Keep original for .*Description/ }),
  );
  expect(
    screen.getByText(/Review notes \(2\) · no action needed/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('checkbox', { name: /I checked this fact/ }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved.');
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I reviewed the complete saved CV/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve saved draft' }));
  await screen.findByText('This saved draft revision is approved.');
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await screen.findByText('PDF download prepared from approved revision 3.');
  expect(click).toHaveBeenCalledOnce();
  const call = state.fetch.mock.calls.find(([url]) => url.endsWith('/export'))!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    contractVersion: '1',
    expectedRevision: 3,
    format: 'pdf',
  });
  state.failExport();
  fireEvent.click(screen.getByRole('button', { name: 'Download DOCX' }));
  await screen.findByText(/Download failed/);
  expect(state.saved().document.review.approval?.revision).toBe(3);
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  const input = screen.getByRole('textbox', {
    name: /description \(experience/,
  });
  fireEvent.change(input, { target: { value: 'Local edit to preserve' } });
  fireEvent.click(
    screen.getByRole('checkbox', { name: /Include description in download/ }),
  );
  expect(input).toHaveValue('Local edit to preserve');
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. Approval cleared.');
  expect(
    state.saved().document.review.factReviews.description!.exportIncluded,
  ).toBe(false);
  expect(state.saved().document.review.approval).toBeNull();
});

test('download transport failures are safe and a late response cannot trigger a download after leaving', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new TypeError('Network unavailable')),
  );
  await expect(
    downloadDraft(tailoredDraftFixture().id, 3, 'pdf'),
  ).rejects.toThrow('Your approved draft is unchanged');
  const create = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'Content-Type': 'application/pdf' },
        }),
    ),
  );
  await downloadDraft(tailoredDraftFixture().id, 3, 'pdf', () => false);
  expect(create).not.toHaveBeenCalled();
});

test('comparison decisions are explicit, reversible and distinct from optional inclusion', async () => {
  setup();
  await open();
  expect(screen.getByText('Waiting for you')).toBeVisible();
  expect(
    screen.getByText(/not independently verified evidence/),
  ).not.toBeVisible();
  fireEvent.click(screen.getByText('Show evidence and word changes'));
  expect(screen.getByText(/not independently verified evidence/)).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: /Accept suggestion for .*Description/ }),
  );
  expect(screen.getByText('Accepted')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Keep original for .*Description/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: /Change decision for .*Description/ }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Keep original for .*Description/ }),
  );
  expect(screen.getByText('Original kept')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  expect(
    screen.getByRole('checkbox', { name: /Include description in download/ }),
  ).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});

test('bulk keep-original confirms pending-only decisions, retains inclusion and requires explicit save/approval', async () => {
  const draft = tailoredDraftFixture();
  const entry = draft.document.sections.find((s) => s.kind === 'experience')!
    .entries[0]!;
  const second = structuredClone(entry.facts[0]!);
  second.id = 'pending-two';
  second.field = 'summary';
  second.acceptedText = 'Second reviewed sentence.';
  second.proposedWording!.text = 'Second AI wording.';
  const accepted = structuredClone(second);
  accepted.id = 'already-accepted';
  accepted.field = 'project';
  accepted.acceptedText = 'Previously accepted wording.';
  entry.facts.push(second, accepted);
  draft.document.review.factReviews[second.id] = {
    reviewedText: second.acceptedText,
    wording: 'reviewed_profile',
    proposal: 'pending',
    exportIncluded: false,
  };
  draft.document.review.factReviews[accepted.id] = {
    reviewedText: 'Prior original.',
    wording: 'ai_accepted',
    proposal: 'accepted',
  };
  const state = setup(draft);
  await open();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Keep all remaining originals' })[0]!,
  );
  await screen.findByRole('dialog', {
    name: /Keep your original wording for the 2 remaining\s+suggestions/,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole('button', { name: /Accept suggestion for .*Description/ }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Keep all remaining originals' })[0]!,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Keep 2 originals' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('button', { name: 'Save draft' })).toHaveFocus();
  expect(screen.getAllByText('Original kept')).toHaveLength(2);
  expect(screen.getByText('Accepted')).toBeVisible();
  expect(
    screen.getByText(/1 item hidden\s+from download\. Choose Edit/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  expect(
    screen.getByRole('checkbox', { name: /Include summary in download/ }),
  ).not.toBeChecked();
  expect(
    state.fetch.mock.calls.some(
      ([url]) => url.endsWith('/review') || url.endsWith('/approve'),
    ),
  ).toBe(false);
  expect(screen.getByText(/3 of 3 suggestions decided/)).toBeVisible();
  expect(
    screen.getByText(/Unsaved changes — approval will be cleared/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved.');
  expect(state.saved().document.review.factReviews[accepted.id]!.proposal).toBe(
    'accepted',
  );
  expect(state.saved().document.review.acknowledgedIssues).toEqual([]);
  expect(state.saved().document.review.approval).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Approve saved draft' }),
  ).toBeDisabled();
});

test('assembled preview shows default-included facts and local wording before approval without permitting export', async () => {
  setup();
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  fireEvent.change(
    screen.getByRole('textbox', { name: /description \(experience/ }),
    { target: { value: 'Unsaved preview wording.' } },
  );
  const preview = screen.getByText('Preview assembled CV');
  fireEvent.click(preview);
  expect(
    await within(preview.parentElement!).findByText('Unsaved preview wording.'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  expect(screen.getByText(/including unsaved edits/)).toBeVisible();
});

test('a proposal explanation is shown beside its comparison; older drafts without one are unchanged', async () => {
  const initial = tailoredDraftFixture();
  const fact = initial.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.proposedWording)!;
  fact.proposedWording!.explanation =
    'Leads with Docker, which the job names (p15). Same items; only the order changes.';
  setup(initial);
  await open();
  expect(
    screen.getByText(/Leads with Docker, which the job names \(p15\)/u),
  ).toBeVisible();
});

test('verification suggestions are labelled, not applied, and adopting one opens it as the user’s own editable wording', async () => {
  const initial = tailoredDraftFixture();
  const fact = initial.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.proposedWording)!;
  fact.verification = {
    text: 'Assisted a team prototype used by [number of users] staff.',
    details: ['[number of users]'],
    requirementIds: [],
    explanation: 'Stronger framing.',
  };
  setup(initial);
  await open();
  const box = screen.getByRole('alert', {
    name: `Needs your verification for ${fact.field}`,
  });
  expect(box).toHaveTextContent('not in your CV: [number of users]');
  expect(box).toHaveTextContent('Not included or exported');
  expect(
    screen.getAllByText('Assisted a team prototype only.')[0],
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Use as my draft' }));
  const field = await screen.findByDisplayValue(
    'Assisted a team prototype used by [number of users] staff.',
  );
  expect(field).toBeVisible();
  expect(screen.getByText(/user-authored wording/u)).toBeVisible();
});

test('meaning-review rewrites are ordinary pending decisions; only verification items need a factual check', async () => {
  const initial = tailoredDraftFixture();
  const fact = initial.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.proposedWording)!;
  expect(
    initial.document.reviewIssues.some(
      (i) => i.factId === fact.id && i.code === 'SEMANTIC_REVIEW_REQUIRED',
    ),
  ).toBe(true);
  fact.verification = {
    text: 'Led a team of [number] engineers.',
    details: ['[number]'],
    requirementIds: [],
    explanation: 'Stronger framing.',
  };
  setup(initial);
  await open();
  const recommended = screen.getByRole('region', { name: /^Recommended/ });
  expect(
    within(recommended).getByRole('button', {
      name: /Accept suggestion for .*Description/,
    }),
  ).toBeEnabled();
  expect(within(recommended).getByText('Waiting for you')).toBeVisible();
  expect(within(recommended).getByText(/unchanged meaning/)).toBeVisible();
  const check = screen.getByRole('region', { name: /^Needs your check/ });
  expect(within(check).getByText(/not in your CV: \[number\]/)).toBeVisible();
  expect(
    within(check).queryByRole('button', { name: /Accept suggestion/ }),
  ).toBeNull();
  expect(screen.queryByText(/Accept all formatting/)).toBeNull();
});

test('conflicting source evidence is the only issue that blocks approval, with a plain explanation', async () => {
  const initial = tailoredDraftFixture();
  initial.document.reviewIssues.push({
    code: 'CV_DRAFT_UNSAFE_REWRITE',
    factId: 'description',
    reason: 'Conflicting source evidence requires review.',
  });
  setup(initial);
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: /Keep original for .*Description/ }),
  );
  const approve = screen.getByRole('button', { name: 'Approve saved draft' });
  expect(approve).toBeDisabled();
  const needs = screen.getByText('To approve:').parentElement!;
  expect(needs).toHaveTextContent('Confirm 1 conflicting fact above.');
  expect(needs).toHaveTextContent('Save draft.');
  expect(needs).not.toHaveTextContent(/Decide/);
  expect(
    screen.getByText(/Review notes \(2\) · no action needed/),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: /I checked this fact against my CV: .*Description/,
    }),
  );
  expect(needs).not.toHaveTextContent('conflicting');
  expect(approve).toBeDisabled();
});

test('blocked approval explains remaining decisions and that keeping originals counts', async () => {
  setup();
  await open();
  const approve = screen.getByRole('button', { name: 'Approve saved draft' });
  expect(approve).toBeDisabled();
  const needs = screen.getByText('To approve:').closest('#approve-needs')!;
  expect(needs).toHaveTextContent(
    /Decide 1 remaining suggestion \(0 of 1 decided\)\. Accept or Keep original both count\./,
  );
  expect(needs).toHaveTextContent(/you do not have to accept any/);
  fireEvent.click(
    within(needs as HTMLElement).getByRole('button', {
      name: 'Keep all remaining originals',
    }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Keep 1 original' }),
  );
  await waitFor(() => expect(screen.getByText('Original kept')).toBeVisible());
  expect(screen.getByText(/1 of 1 suggestions decided/)).toBeVisible();
  expect(needs).not.toHaveTextContent(/Decide/);
  expect(needs).toHaveTextContent('Save draft.');
});
