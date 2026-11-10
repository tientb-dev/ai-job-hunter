import { ThemeProvider } from '@mui/material';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from './render';
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

function setup() {
  const draft = twoPending();
  const onContinue = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
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
