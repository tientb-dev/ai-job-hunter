import { ThemeProvider } from '@mui/material';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
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
