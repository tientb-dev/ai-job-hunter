import { ThemeProvider } from '@mui/material';
import { expect, test, vi } from 'vitest';
import {
  closeSuccess,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from './render';
import { theme } from '../src/app/theme';
import { TailoredCvReview } from '../src/features/inbox/TailoredCvReview';
import { draftJobId, tailoredDraftFixture } from './fixtures/tailored-cv';

// Two pending suggestions in one saved draft (synthetic data only).
function twoPending() {
  const draft = tailoredDraftFixture();
  const entry = draft.document.sections.find((s) => s.kind === 'experience')!
    .entries[0]!;
  const second = structuredClone(entry.facts[0]!);
  second.id = 'pending-two';
  second.field = 'project';
  second.acceptedText = 'Second reviewed sentence.';
  second.proposedWording!.text = 'Second suggested sentence.';
  entry.facts.push(second);
  draft.document.review.factReviews[second.id] = {
    reviewedText: second.acceptedText,
    wording: 'reviewed_profile',
    proposal: 'pending',
  };
  return draft;
}

function setup(draft = twoPending()) {
  const onContinue = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/drafts/readiness'))
        return Response.json({
          contractVersion: '1',
          ready: false,
          reason: 'CV_DRAFT_MATCH_REQUIRED',
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
      if (url.endsWith('/review')) {
        // Synthetic save: every suggestion kept as original, new revision.
        const next = structuredClone(draft);
        next.revision += 1;
        for (const state of Object.values(next.document.review.factReviews))
          if (state.proposal === 'pending') state.proposal = 'rejected';
        for (const op of JSON.parse(init!.body as string).operations)
          if (op.action === 'edit') {
            next.document.sections
              .flatMap((s) => s.entries.flatMap((e) => e.facts))
              .find((f) => f.id === op.factId)!.acceptedText = op.text;
            next.document.review.factReviews[op.factId]!.wording =
              'user_edited';
          }
        return Response.json(next);
      }
      if (url.endsWith(`/drafts/${draft.id}`)) return Response.json(draft);
      throw Error(`Unexpected request: ${url}`);
    }),
  );
  render(
    <ThemeProvider theme={theme}>
      <TailoredCvReview
        jobId={draftJobId}
        jobRevision={draft.document.pins.jobUpdatedAt}
        cv={{ fileName: 'synthetic.pdf', updatedAt: draft.updatedAt }}
        disabled={false}
        onDirtyChange={() => {}}
        onBusyChange={() => {}}
        wizardStep={2}
        onContinueToApproval={onContinue}
      />
    </ThemeProvider>,
  );
  return { onContinue };
}

test('each decision offers the next undecided suggestion, then save unlocks Continue', async () => {
  const { onContinue } = setup();
  const bar = await screen.findByRole('region', { name: 'Review actions' });
  expect(bar).toHaveTextContent('0 of 2 decided');
  const keeps = screen.getAllByRole('button', { name: /^Keep original for/ });
  expect(keeps).toHaveLength(2);
  fireEvent.click(keeps[0]!);
  // Focus moves to the remaining undecided card without manual searching.
  await waitFor(() =>
    expect(document.activeElement?.id).toMatch(/^suggestion-/),
  );
  const next = document.activeElement as HTMLElement;
  expect(next).toContainElement(
    screen.getByRole('button', { name: /^Keep original for/ }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Keep original for/ }));
  await waitFor(() => expect(bar).toHaveFocus());
  expect(bar).toHaveTextContent('2 of 2 decided · unsaved changes');
  expect(
    screen.queryByRole('button', { name: 'Continue to Approve & Export' }),
  ).toBeNull();
  // One Save draft action only (no duplicate in the page body).
  expect(screen.getAllByRole('button', { name: 'Save draft' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await closeSuccess();
  const cont = await screen.findByRole('button', {
    name: 'Continue to Approve & Export',
  });
  await waitFor(() => expect(cont).toHaveFocus());
  fireEvent.click(cont);
  expect(onContinue).toHaveBeenCalledOnce();
});

test('Next undecided jumps to the first undecided suggestion', async () => {
  setup();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Next undecided' }),
  );
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('suggestion-description'),
  );
});

const anchor = (id: string) =>
  document.querySelector<HTMLElement>(`[data-fact-id="${id}"]`)!;

test('CV anchors open their suggestion and show decision state in text', async () => {
  setup();
  await screen.findByRole('region', { name: 'Review actions' });
  const second = anchor('pending-two');
  expect(second).toHaveAccessibleName(/suggestion to review/);
  fireEvent.click(second);
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('suggestion-pending-two'),
  );
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Suggestion 2 of 2')).toBeVisible();
  fireEvent.click(
    within(document.activeElement as HTMLElement).getByRole('button', {
      name: /^Keep original for/,
    }),
  );
  await waitFor(() =>
    expect(anchor('pending-two')).toHaveAccessibleName(/suggestion decided/),
  );
});

test('Previous and Next cycle suggestions; Escape returns focus to the CV', async () => {
  setup();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Next suggestion' }),
  );
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('suggestion-description'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next suggestion' }));
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('suggestion-pending-two'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous suggestion' }));
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('suggestion-description'),
  );
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(anchor('description')).toHaveFocus());
});

test('contextual Edit queues the same edit the Full CV editor shows', async () => {
  setup();
  const bar = await screen.findByRole('region', { name: 'Review actions' });
  fireEvent.click(anchor('pending-two'));
  const card = await waitFor(() => {
    const el = document.getElementById('suggestion-pending-two')!;
    expect(el).toHaveFocus();
    return el;
  });
  fireEvent.click(
    within(card).getByRole('button', { name: /^Edit wording for/ }),
  );
  const field = within(card).getByRole('textbox', { name: /^Your wording/ });
  expect(field).toHaveValue('Second reviewed sentence.');
  fireEvent.change(field, { target: { value: 'My own second sentence.' } });
  // The CV document and the unsaved state reflect the queued edit at once.
  expect(anchor('pending-two')).toHaveTextContent('My own second sentence.');
  expect(bar).toHaveTextContent('unsaved changes');
  // An emptied value blocks Save, as in the Full CV editor.
  fireEvent.change(field, { target: { value: ' ' } });
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

// Adds an optional AI claim warning on a fact without a rewrite, and puts the
// first suggestion in "Needs your check" (synthetic data only).
function withWarning() {
  const draft = twoPending();
  const entry = draft.document.sections.find((s) => s.kind === 'experience')!
    .entries[0]!;
  const warned = structuredClone(entry.facts[0]!);
  warned.id = 'warned';
  warned.field = 'impact';
  warned.acceptedText = 'Improved a synthetic report.';
  warned.proposedWording = null;
  warned.verification = {
    text: 'Improved a synthetic report by [X%].',
    details: ['[X%]'],
    requirementIds: [],
    explanation: 'Stronger framing.',
  };
  entry.facts.push(warned);
  draft.document.review.factReviews[warned.id] = {
    reviewedText: warned.acceptedText,
    wording: 'reviewed_profile',
    proposal: 'none',
  };
  draft.document.reviewIssues.push({
    code: 'CV_DRAFT_UNSAFE_REWRITE',
    factId: 'description',
    reason: 'Blocked verify: synthetic.',
  });
  return draft;
}

test('decisions and optional AI warnings use separate, consistent counters', async () => {
  setup(withWarning());
  const bar = await screen.findByRole('region', { name: 'Review actions' });
  expect(bar).toHaveTextContent('0 of 2 decided');
  expect(screen.getByText('2 suggestions · 1 AI warning')).toBeVisible();
  const next = screen.getByRole('button', { name: 'Next suggestion' });
  fireEvent.click(next);
  expect(screen.getByText('Suggestion 1 of 2')).toBeVisible();
  fireEvent.click(next);
  expect(screen.getByText('Suggestion 2 of 2')).toBeVisible();
  fireEvent.click(next);
  expect(screen.getByText('AI warning 1 of 1')).toBeVisible();
});

test('Keep original and a saved edit no longer count as open checks; AI provenance stays', async () => {
  setup(withWarning());
  await screen.findByRole('region', { name: 'Review actions' });
  const check = screen.getByRole('region', { name: /^Needs your check/ });
  expect(check).toHaveAccessibleName(/\(1 open of 1\)/);
  fireEvent.click(
    within(check).getByRole('button', { name: /^Keep original for/ }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('region', { name: /^Needs your check/ }),
    ).toHaveAccessibleName(/\(0 open of 1\)/),
  );
  const warnings = screen.getByRole('region', {
    name: /^AI claims not in your CV/,
  });
  fireEvent.click(
    within(warnings).getByRole('button', { name: 'Use as my draft' }),
  );
  fireEvent.change(
    await screen.findByDisplayValue('Improved a synthetic report by [X%].'),
    { target: { value: 'Improved a synthetic report by 12%.' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  const save = screen.getByRole('button', {
    name: 'Save draft with your wording for impact',
  });
  // Layout regression: not squeezed into the Alert action column.
  expect(save.closest('.MuiAlert-action')).toBeNull();
  expect(save).toHaveStyle({ whiteSpace: 'nowrap' });
  expect(
    screen.getByRole('alert', { name: 'Your wording for impact' }),
  ).toHaveTextContent('Edited by you — not saved');
  fireEvent.click(save);
  await closeSuccess();
  const mine = await screen.findByText(/Saved — user-authored wording/);
  expect(
    screen
      .getByRole('region', { name: /^AI claims not in your CV/ })
      .contains(mine),
  ).toBe(true);
  expect(screen.getAllByText(/Original AI suggestion/)[0]).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: /^Needs your check/ }),
  ).toHaveAccessibleName(/\(0 open of 1\)/);
});
