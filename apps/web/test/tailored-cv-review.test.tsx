import { setLocale, useI18n } from '../src/app/i18n';
import { downloadDraft } from '../src/features/inbox/tailored-cv.contract';
import { useRef, useState } from 'react';
import { ThemeProvider } from '@mui/material';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  acknowledge,
  act,
  closeSuccess,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from './render';
import { theme } from '../src/app/theme';
import { TailoredCvReview } from '../src/features/inbox/TailoredCvReview';
import { UnsavedJobGuard } from '../src/features/inbox/UnsavedJobGuard';
import { tailoredDraftFixture, draftJobId } from './fixtures/tailored-cv';
const noop = () => {};
const emptySuggestions =
  'No AI suggestions. You can review and edit your CV before approving.';
function setup(initial = tailoredDraftFixture(), initialStep?: number) {
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
    useI18n();
    const [dirty, setDirty] = useState(false);
    const [step, setStep] = useState(initialStep);
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
          wizardStep={step}
          onContinueToApproval={() => setStep(3)}
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
  await closeSuccess();
  fireEvent.click(screen.getByRole('button', { name: /^Draft 1 .*Open$/ }));
  await screen.findAllByText('Assisted a team prototype only.');
  await closeSuccess();
}
function openCv() {
  fireEvent.click(screen.getByText(/^Full CV:/));
}
test('a saved draft with no suggestions shows the complete CV and opens the final preview before approval', async () => {
  const draft = tailoredDraftFixture();
  const { document } = draft;
  const [fact] = document.sections.flatMap((section) =>
    section.entries.flatMap((entry) => entry.facts),
  );
  fact!.proposedWording = null;
  document.review.factReviews[fact!.id]!.proposal = 'none';

  const { fetch } = setup(draft, 2);
  const suggestions = await screen.findByRole('complementary', {
    name: 'Suggestions',
  });
  expect(within(suggestions).getByText(emptySuggestions)).toBeVisible();
  expect(screen.getAllByText(emptySuggestions)).toHaveLength(1);
  expect(
    screen.queryByRole('region', { name: 'Save and approve' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('No changes suggested')).not.toBeInTheDocument();
  expect(
    screen.queryByText('No rewrite suggestions for this draft.'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('progressbar', { name: 'Suggestions decided' }),
  ).not.toBeInTheDocument();
  const documentPreview = screen.getByRole('region', {
    name: 'CV document preview',
  });
  expect(within(documentPreview).getByText(fact!.acceptedText)).toBeVisible();
  expect(within(documentPreview).queryByRole('button')).not.toBeInTheDocument();
  const editLink = within(suggestions).getByRole('link', {
    name: 'Edit full CV',
  });
  fireEvent.click(editLink);
  fireEvent.click(screen.getByRole('button', { name: 'Edit experience' }));
  const editor = screen.getByRole('textbox', {
    name: /description \(experience/,
  });
  expect(editor).toHaveValue(fact!.acceptedText);
  fireEvent.change(editor, { target: { value: '' } });
  expect(
    screen.getByRole('textbox', { name: /description \(experience/ }),
  ).toBe(editor);
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard local draft edits' }),
  );

  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Approve & Export' }),
  );
  const preview = screen.getByRole('region', { name: 'Preview edited CV' });
  expect(within(preview).getByText(fact!.acceptedText)).toBeVisible();
  const approve = screen.getByRole('button', { name: 'Approve saved draft' });
  expect(approve).toBeDisabled();
  fireEvent.click(
    screen.getByRole('checkbox', { name: /^I reviewed the complete saved CV/ }),
  );
  expect(approve).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    expect.stringMatching(/\/drafts\/list$/),
    expect.stringMatching(new RegExp(`/drafts/${draft.id}$`)),
  ]);
});

test.each([false, true])(
  'missing CV content blocks approval and export (approved revision: %s)',
  async (approved) => {
    const draft = tailoredDraftFixture();
    draft.document.sections = [];
    draft.document.review.factReviews = {};
    draft.document.reviewIssues = [];
    if (approved)
      draft.document.review.approval = {
        revision: draft.revision,
        approvedAt: draft.updatedAt,
      };

    const { fetch } = setup(draft, 3);
    expect(
      await screen.findByText(
        'This draft has no CV content to review or export.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(emptySuggestions)).not.toBeInTheDocument();
    for (const name of ['Approve saved draft', 'Download PDF', 'Download DOCX'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', {
        name: /^I reviewed the complete saved CV/,
      }),
    ).toBeDisabled();
    expect(
      fetch.mock.calls.some(([url]) =>
        /\/(approve|export|generate)$/.test(url),
      ),
    ).toBe(false);
  },
);

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
  await screen.findByText(/^Draft saved as revision \d+\.$/);
  await closeSuccess();
  expect(state.saved().revision).toBe(2);
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I reviewed the complete saved CV/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve saved draft' }));
  await screen.findByText('This saved draft revision is approved.');
  await closeSuccess();
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
  await screen.findByText(/^Draft saved as revision \d+\. Approval cleared\.$/);
  await closeSuccess();
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
    locale: 'en',
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
  await screen.findByText(/^Draft saved as revision \d+\.$/);
  await closeSuccess();
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I reviewed the complete saved CV/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve saved draft' }));
  await screen.findByText('This saved draft revision is approved.');
  await closeSuccess();
  // PDF first and primary; DOCX second and outlined.
  const buttons = within(
    screen.getByLabelText('Download approved CV'),
  ).getAllByRole('button');
  expect(buttons.map((b) => b.textContent)).toEqual([
    'Download PDF',
    'Download DOCX',
  ]);
  expect(buttons[0]).toHaveClass('MuiButton-contained');
  expect(buttons[1]).toHaveClass('MuiButton-outlined');
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  // Starting a download is not reported as a success.
  expect(
    document.querySelector('[aria-labelledby="notification-success-title"]'),
  ).toBeNull();
  expect(screen.queryByText(/download prepared/)).toBeNull();
  const call = state.fetch.mock.calls.find(([url]) => url.endsWith('/export'))!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    contractVersion: '1',
    expectedRevision: 3,
    format: 'pdf',
    template: 'classic',
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
  await screen.findByText(/^Draft saved as revision \d+\. Approval cleared\.$/);
  await closeSuccess();
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
  await screen.findByText(/^Draft saved as revision \d+\.$/);
  await closeSuccess();
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
  const preview = screen.getByText('Preview edited CV');
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
  // The AI claim warning is informational, not an open decision.
  expect(
    screen.queryByRole('region', { name: /^Needs your check/ }),
  ).toBeNull();
  const warnings = screen.getByRole('region', {
    name: /^AI claims not in your CV/,
  });
  expect(
    within(warnings).getByText(/not in your CV: \[number\]/),
  ).toBeVisible();
  expect(
    within(warnings).queryByRole('button', { name: /Accept suggestion/ }),
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

test('an adopted verification draft is "not saved" until Save draft succeeds, then saved as user-authored wording with its AI provenance kept', async () => {
  const initial = tailoredDraftFixture();
  const fact = initial.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.proposedWording)!;
  fact.verification = {
    text: 'Assisted a team prototype used by [X] staff.',
    details: ['[X]'],
    requirementIds: [],
    explanation: 'Stronger framing.',
  };
  const state = setup(initial);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Use as my draft' }));
  const field = await screen.findByDisplayValue(
    'Assisted a team prototype used by [X] staff.',
  );
  fireEvent.change(field, {
    target: { value: 'Assisted a team prototype used by 12 staff.' },
  });
  const mine = screen.getByRole('alert', {
    name: `Your wording for ${fact.field}`,
  });
  expect(mine).toHaveTextContent('Edited by you — not saved');
  expect(mine).not.toHaveTextContent(/Confirmed by you/);
  expect(mine).toHaveTextContent('not evidence from your original CV');
  // Original AI provenance stays available as history; no repeat adopt action.
  expect(within(mine).getByText(/Original AI suggestion/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use as my draft' })).toBeNull();
  expect(
    state.fetch.mock.calls.some(([url]) => String(url).endsWith('/review')),
  ).toBe(false);
  // A failed save shows no confirmation and keeps the unsaved status.
  state.conflict();
  fireEvent.click(
    within(mine).getByRole('button', { name: /Save draft with your wording/ }),
  );
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.some(([url]) => String(url).endsWith('/review')),
    ).toBe(true),
  );
  expect(screen.queryByText(/^Draft saved/)).toBeNull();
  expect(
    screen.getByRole('alert', { name: `Your wording for ${fact.field}` }),
  ).toHaveTextContent('Edited by you — not saved');
});

test('saved user-authored wording survives reopen with its status and provenance', async () => {
  const initial = tailoredDraftFixture();
  const fact = initial.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.proposedWording)!;
  fact.verification = {
    text: 'Assisted a team prototype used by [X] staff.',
    details: ['[X]'],
    requirementIds: [],
    explanation: 'Stronger framing.',
  };
  const state = setup(initial);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Use as my draft' }));
  fireEvent.change(
    await screen.findByDisplayValue(
      'Assisted a team prototype used by [X] staff.',
    ),
    { target: { value: 'Assisted a team prototype used by 12 staff.' } },
  );
  fireEvent.click(
    within(
      screen.getByRole('alert', { name: `Your wording for ${fact.field}` }),
    ).getByRole('button', { name: /Save draft with your wording/ }),
  );
  await screen.findByText('Draft saved as revision 2.');
  await closeSuccess();
  expect(state.saved().document.review.factReviews[fact.id]).toMatchObject({
    wording: 'user_edited',
    proposal: 'rejected',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved draft' }));
  await waitFor(() =>
    expect(
      screen.getByRole('alert', { name: `Your wording for ${fact.field}` }),
    ).toHaveTextContent('Saved — user-authored wording'),
  );
  expect(screen.getAllByText(/used by 12 staff/)[0]).toBeInTheDocument();
  expect(screen.getByText(/Original AI suggestion/)).toBeInTheDocument();
});

test.each([
  [true, false],
  [false, true],
  [true, true],
  [false, false],
])(
  'review keeps rewrites (%s) and questions (%s) independent',
  async (rewrite, question) => {
    const initial = tailoredDraftFixture();
    const fact = initial.document.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.proposedWording)!;
    if (!rewrite) {
      fact.proposedWording = null;
      initial.document.review.factReviews[fact.id]!.proposal = 'none';
    }
    if (question)
      fact.clarification = {
        kind: 'impact',
        requirementIds: [],
        status: 'open',
      };
    setup(initial);
    await open();
    expect(Boolean(screen.queryByText(emptySuggestions))).toBe(!rewrite);
    expect(
      Boolean(
        screen.queryByRole('progressbar', { name: 'Suggestions decided' }),
      ),
    ).toBe(rewrite);
    expect(
      Boolean(screen.queryByRole('button', { name: 'Provide details' })),
    ).toBe(question);
  },
);

test('shows an AI question and job context while blocking verbatim acceptance of flagged wording', async () => {
  const draft = tailoredDraftFixture();
  draft.document.requirements = [
    { id: 'p1', text: 'Database query performance' },
  ];
  const fact = draft.document.sections.find(
    (section) => section.kind === 'experience',
  )!.entries[0]!.facts[0]!;
  fact.proposedWording = {
    text: 'Improved prototype query response time by 50%.',
    status: 'pending',
    requirementIds: ['p1'],
    explanation: 'Shows the impact of the prototype work.',
    requiresConfirmation: true,
    confirmationAssertion: 'Query response time improved by 50%.',
  };
  fact.clarification = {
    kind: 'impact',
    status: 'open',
    requirementIds: ['p1'],
    question: 'What changed after the query optimization, if observed?',
    explanation:
      'An observed result would strengthen the performance evidence.',
  };
  const state = setup(draft);
  await open();
  // Accept needs an explicit, unticked-by-default confirmation of the claim.
  const accept = screen.getByRole('button', {
    name: /^Confirm and accept suggestion for/,
  });
  const confirm = screen.getByRole('checkbox', {
    name: 'I confirm this information is true to my actual experience.',
  });
  expect(confirm).not.toBeChecked();
  expect(accept).toBeDisabled();
  expect(
    screen.getByRole('button', { name: /^Keep original for/ }),
  ).toBeEnabled();
  expect(
    screen.getByText('Detail to check: Query response time improved by 50%.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/use Edit wording to remove or correct/),
  ).toBeVisible();
  expect(screen.getByText(fact.clarification.question!)).toBeInTheDocument();
  expect(
    screen.getByText(/Query response time improved by 50%/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/shows the impact of the prototype work/i),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/database query performance/i)).toHaveLength(2);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Provide details' }));
  expect(
    screen.getByRole('textbox', { name: 'Your factual detail' }),
  ).toBeInTheDocument();
  fireEvent.click(confirm);
  expect(accept).toBeEnabled();
  fireEvent.click(accept);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => {
    const review = state.fetch.mock.calls.find(([url]) =>
      String(url).endsWith('/review'),
    );
    expect(JSON.parse(review![1]!.body as string).operations).toContainEqual({
      action: 'accept',
      factId: fact.id,
      confirmed: {
        assertion: 'Query response time improved by 50%.',
        text: 'Improved prototype query response time by 50%.',
      },
    });
  });
});

test('locale switching keeps historical flags and saved AI content while translating fixed labels', async () => {
  const draft = tailoredDraftFixture();
  const fact = draft.document.sections.find(
    (section) => section.kind === 'experience',
  )!.entries[0]!.facts[0]!;
  fact.proposedWording!.requiresConfirmation = true;
  fact.proposedWording!.explanation = 'Saved rationale in English.';
  fact.clarification = {
    kind: 'impact',
    status: 'open',
    requirementIds: [],
    question: 'Saved question in English?',
  };
  const state = setup(draft);
  await open();
  // Flagged without a stated claim: nothing to confirm, so accept stays off.
  const accept = screen.getByRole('button', {
    name: /^Confirm and accept suggestion for/,
  });
  expect(accept).toBeDisabled();
  const requests = state.fetch.mock.calls.length;
  act(() => setLocale('vi-VN'));
  expect(accept).toBeDisabled();
  expect(accept).toHaveTextContent('Xác nhận và chấp nhận');
  expect(screen.getByText(fact.proposedWording!.text)).toBeInTheDocument();
  expect(screen.getByText('Saved rationale in English.')).toBeInTheDocument();
  expect(screen.getByText('Saved question in English?')).toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(requests);
  act(() => setLocale('en-US'));
});

test('before download, the export panel names the system templates and says the original CV is unchanged, in both languages', async () => {
  setup();
  await open();
  const note = screen.getByLabelText('About the downloaded CV');
  expect(note).toHaveTextContent('Edited CV uses a system template');
  expect(note).toHaveTextContent(
    'PDF template: Classic · DOCX template: Classic.',
  );
  expect(note).toHaveTextContent(
    /may not keep the original CV's layout, fonts, columns or images/,
  );
  expect(note).toHaveTextContent('Your uploaded original CV is not changed.');
  // Shown ahead of the download buttons, which keep their approval gate.
  expect(
    note.compareDocumentPosition(
      screen.getByRole('button', { name: 'Download PDF' }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
  act(() => setLocale('vi-VN'));
  const viNote = screen.getByLabelText('Về CV được tải xuống');
  expect(viNote).toHaveTextContent('CV đã chỉnh sửa dùng mẫu của hệ thống');
  expect(viNote).toHaveTextContent('Mẫu PDF: Cổ điển · Mẫu DOCX: Cổ điển.');
  expect(viNote).toHaveTextContent('CV gốc bạn đã tải lên không bị thay đổi.');
  act(() => setLocale('en-US'));
});

// Template persistence: PUT /drafts/:id/template, separate from review saves.
function withTemplateApi(
  fetch: ReturnType<typeof setup>['fetch'],
  respond: (template: string) => Promise<Response>,
) {
  const base = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url: string, init?: RequestInit) =>
    url.endsWith('/template')
      ? respond(JSON.parse(init!.body as string).template)
      : base(url, init),
  );
}
const templateBodies = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls
    .filter(([url]) => String(url).endsWith('/template'))
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
// The non-wizard selector sits above the shared preview, inside its disclosure.
async function openTemplates() {
  if (!screen.queryByRole('radio', { name: /^Classic/ }))
    fireEvent.click(screen.getByText('Preview edited CV'));
  await screen.findByRole('radio', { name: /^Classic/ });
}
async function pickTemplate(name: RegExp) {
  await openTemplates();
  fireEvent.click(screen.getByRole('radio', { name }));
}
async function selectedTemplate(name: RegExp) {
  await openTemplates();
  return screen.getByRole('radio', { name });
}

test.each([
  ['modern', /^Modern/],
  [undefined, /^Classic/],
] as const)(
  'a draft opens with its saved template (%s; missing reads as Classic)',
  async (saved, label) => {
    const draft = tailoredDraftFixture();
    if (saved) draft.exportTemplate = saved;
    else delete (draft as Partial<typeof draft>).exportTemplate;
    setup(draft);
    await open();
    expect(await selectedTemplate(label)).toBeChecked();
  },
);

test('changing the template saves it once without a review save, and PDF uses it', async () => {
  const { fetch } = setup(tailoredDraftFixture());
  withTemplateApi(fetch, async (template) =>
    Response.json({
      contractVersion: '1',
      id: tailoredDraftFixture().id,
      exportTemplate: template,
    }),
  );
  await open();
  const reviewCalls = () =>
    fetch.mock.calls.filter(([url]) => /\/(review|approve)$/.test(String(url)))
      .length;
  const before = reviewCalls();
  await pickTemplate(/^Compact/);
  await waitFor(() =>
    expect(templateBodies(fetch)).toEqual([
      { contractVersion: '1', template: 'compact' },
    ]),
  );
  await waitFor(() =>
    expect(screen.queryByText('Saving template…')).not.toBeInTheDocument(),
  );
  expect(await selectedTemplate(/^Compact/)).toBeChecked();
  expect(reviewCalls()).toBe(before);
  expect(screen.getByLabelText('About the downloaded CV')).toHaveTextContent(
    'PDF template: Compact · DOCX template: Classic.',
  );
});

test('a failed template save returns to the saved template and says so', async () => {
  const { fetch } = setup(tailoredDraftFixture());
  withTemplateApi(fetch, async () =>
    Response.json({ errorCode: 'CV_FOUNDATION_503' }, { status: 503 }),
  );
  await open();
  await pickTemplate(/^Modern/);
  expect(
    await screen.findByText(
      'Could not save the CV template. The previous template is kept.',
    ),
  ).toBeVisible();
  await acknowledge();
  expect(await selectedTemplate(/^Classic/)).toBeChecked();
});

test('rapid template changes are saved in order and end on the latest choice', async () => {
  const { fetch } = setup(tailoredDraftFixture());
  const pending: (() => void)[] = [];
  withTemplateApi(
    fetch,
    (template) =>
      new Promise<Response>((resolve) =>
        pending.push(() =>
          resolve(
            Response.json({
              contractVersion: '1',
              id: tailoredDraftFixture().id,
              exportTemplate: template,
            }),
          ),
        ),
      ),
  );
  await open();
  await pickTemplate(/^Modern/);
  await pickTemplate(/^Compact/);
  // Only one request in flight; the newer choice waits for it.
  expect(templateBodies(fetch).map((b) => b.template)).toEqual(['modern']);
  expect(screen.getByText('Saving template…')).toBeVisible();
  act(() => pending.shift()!());
  await waitFor(() =>
    expect(templateBodies(fetch).map((b) => b.template)).toEqual([
      'modern',
      'compact',
    ]),
  );
  act(() => pending.shift()!());
  await waitFor(() =>
    expect(screen.queryByText('Saving template…')).not.toBeInTheDocument(),
  );
  expect(await selectedTemplate(/^Compact/)).toBeChecked();
});

test('PDF download waits for the template save; DOCX stays available; a failed save restores the saved template', async () => {
  const state = setup();
  let finish: (ok: boolean) => void = () => {};
  withTemplateApi(
    state.fetch,
    (template) =>
      new Promise<Response>((resolve) => {
        finish = (ok) =>
          resolve(
            ok
              ? Response.json({
                  contractVersion: '1',
                  id: tailoredDraftFixture().id,
                  exportTemplate: template,
                })
              : Response.json(
                  { errorCode: 'CV_FOUNDATION_503' },
                  { status: 503 },
                ),
          );
      }),
  );
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: /Keep original for .*Description/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/^Draft saved as revision \d+\.$/);
  await closeSuccess();
  fireEvent.click(
    screen.getByRole('checkbox', { name: /I reviewed the complete saved CV/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve saved draft' }));
  const pdf = screen.getByRole('button', { name: 'Download PDF' });
  const docx = screen.getByRole('button', { name: 'Download DOCX' });
  await waitFor(() => expect(pdf).toBeEnabled());
  await closeSuccess();
  const approved = state.saved();
  await pickTemplate(/^Modern/);
  expect(pdf).toBeDisabled();
  expect(docx).toBeEnabled();
  act(() => finish(true));
  await waitFor(() => expect(pdf).toBeEnabled());
  await pickTemplate(/^Compact/);
  expect(pdf).toBeDisabled();
  act(() => finish(false));
  expect(
    await screen.findByText(
      'Could not save the CV template. The previous template is kept.',
    ),
  ).toBeVisible();
  await acknowledge();
  expect(pdf).toBeEnabled();
  expect(await selectedTemplate(/^Modern/)).toBeChecked();
  // Template saves never touch the draft content, revision or approval.
  expect(state.saved()).toEqual(approved);
});

const okTemplate = (template: string) =>
  Promise.resolve(
    Response.json({
      contractVersion: '1',
      id: tailoredDraftFixture().id,
      exportTemplate: template,
    }),
  );
const previews = () => [...document.querySelectorAll('[data-template]')];

test('non-wizard: one selector above the shared preview, which updates in place without scrolling', async () => {
  const state = setup();
  withTemplateApi(state.fetch, okTemplate);
  await open();
  const user = userEvent.setup();
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const intoView = vi.fn();
  Element.prototype.scrollIntoView = intoView;
  await openTemplates();
  expect(screen.getAllByRole('group', { name: 'CV template' })).toHaveLength(1);
  const [preview] = previews();
  expect(preview).toHaveAttribute('data-template', 'classic');
  // The selector comes before the preview it controls.
  expect(
    screen
      .getByRole('group', { name: 'CV template' })
      .compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  for (const [name, value] of [
    [/^Modern/, 'modern'],
    [/^Compact/, 'compact'],
    [/^Classic/, 'classic'],
  ] as const) {
    await user.click(screen.getByRole('radio', { name }));
    expect(screen.getByRole('radio', { name })).toHaveFocus();
    expect(previews()).toEqual([preview]); // same node: no remount
    expect(preview).toHaveAttribute('data-template', value);
  }
  expect(scrollTo).not.toHaveBeenCalled();
  expect(intoView).not.toHaveBeenCalled();
  // Still the draft's content, not placeholder data.
  expect(
    within(preview as HTMLElement).getByText('Assisted a team prototype only.'),
  ).toBeInTheDocument();
  scrollTo.mockRestore();
});

test.each([2, 3])(
  'wizard Step %i shows one selector and its preview follows the choice',
  async (step) => {
    const state = setup(tailoredDraftFixture(), step);
    withTemplateApi(state.fetch, okTemplate);
    const group = await screen.findByRole('group', { name: 'CV template' });
    expect(screen.getAllByRole('group', { name: 'CV template' })).toHaveLength(
      1,
    );
    const visible = () =>
      previews().filter((node) => !node.closest('[hidden]'));
    expect(visible()).toHaveLength(1);
    fireEvent.click(within(group).getByRole('radio', { name: /^Modern/ }));
    expect(visible()[0]).toHaveAttribute('data-template', 'modern');
    await waitFor(() =>
      expect(templateBodies(state.fetch)).toEqual([
        { contractVersion: '1', template: 'modern' },
      ]),
    );
  },
);

test('Step 3 PDF preview: the previous PDF stays while loading and a late response for an older choice never replaces the newer one', async () => {
  const draft = tailoredDraftFixture();
  draft.document.review.approval = {
    revision: draft.revision,
    approvedAt: draft.updatedAt,
  };
  const state = setup(draft, 3);
  withTemplateApi(state.fetch, okTemplate);
  const exports: Record<string, (r: Response) => void> = {};
  const base = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!url.endsWith('/export')) return base(url, init);
    const template = JSON.parse(init!.body as string).template as string;
    return new Promise<Response>((resolve) => {
      exports[template] = resolve;
    });
  });
  const urls = new Map<Blob, string>();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        const url = `blob:${urls.size}`;
        urls.set(blob, url);
        return url;
      }),
      revokeObjectURL: vi.fn(),
    }),
  );
  const pdf = (template: string) =>
    new Response(new Blob([template], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${template}.pdf"`,
      },
    });
  await waitFor(() => expect(exports.classic).toBeDefined());
  act(() => exports.classic!(pdf('classic')));
  const frame = await screen.findByTitle('PDF preview');
  const first = frame.getAttribute('src');
  const group = screen.getByRole('group', { name: 'CV template' });
  fireEvent.click(within(group).getByRole('radio', { name: /^Modern/ }));
  await waitFor(() => expect(exports.modern).toBeDefined());
  fireEvent.click(within(group).getByRole('radio', { name: /^Compact/ }));
  await waitFor(() => expect(exports.compact).toBeDefined());
  // While loading, the last PDF stays in the same frame with a progress bar.
  expect(screen.getByTitle('PDF preview')).toBe(frame);
  expect(frame).toHaveAttribute('src', first);
  expect(
    screen.getByRole('progressbar', { name: 'Generating PDF preview' }),
  ).toBeVisible();
  act(() => exports.compact!(pdf('compact')));
  await waitFor(() => expect(frame.getAttribute('src')).not.toBe(first));
  const compact = frame.getAttribute('src');
  act(() => exports.modern!(pdf('modern')));
  await new Promise((r) => setTimeout(r, 20));
  expect(frame).toHaveAttribute('src', compact);
  expect(screen.getByRole('radio', { name: /^Compact/ })).toBeChecked();
});
