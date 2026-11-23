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
import {
  applyOrder,
  type DraftFact,
  type SavedDraft,
} from '../src/features/inbox/tailored-cv.contract';
import { draftJobId, tailoredDraftFixture } from './fixtures/tailored-cv';

/** Two synthetic roles, each with a stored order suggestion; no wording work. */
function twoRoles(approved = false) {
  const draft = tailoredDraftFixture();
  const doc = draft.document;
  const section = doc.sections.find((s) => s.kind === 'experience')!;
  const base = section.entries[0]!.facts[0]!;
  doc.review.factReviews = {};
  doc.reviewIssues = [];
  const fact = (id: string, field: string, text: string): DraftFact => {
    doc.review.factReviews[id] = {
      reviewedText: text,
      wording: 'reviewed_profile',
      proposal: 'none',
    };
    return {
      ...structuredClone(base),
      id,
      field,
      acceptedText: text,
      proposedWording: null,
      provenance: { ...base.provenance, profileFactId: id },
    };
  };
  section.entries = ['a', 'b'].map((r) => ({
    id: `role-${r}`,
    facts: [
      fact(`${r}-role`, 'role', `Synthetic Role ${r.toUpperCase()}`),
      fact(`${r}-dates`, 'dates', '2021 - 2024'),
      fact(`${r}-docs`, 'description', `Wrote team docs ${r}`),
      fact(`${r}-java`, 'description', `Built Java APIs ${r}`),
    ],
    orderProposal: {
      originalFactIds: [`${r}-role`, `${r}-dates`, `${r}-docs`, `${r}-java`],
      factIds: [`${r}-role`, `${r}-dates`, `${r}-java`, `${r}-docs`],
      reasons: { [`${r}-java`]: ['Java'] },
    },
  }));
  if (approved)
    doc.review.approval = {
      revision: draft.revision,
      approvedAt: draft.updatedAt,
    };
  return draft;
}

function setup(draft: SavedDraft) {
  let current = draft;
  const saves: unknown[][] = [];
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
              id: current.id,
              revision: current.revision,
              updatedAt: current.updatedAt,
            },
          ],
          nextCursor: null,
        });
      if (url.endsWith('/review')) {
        // Synthetic API: same order rule, new revision, approval cleared.
        const { operations } = JSON.parse(init!.body as string);
        saves.push(operations);
        const next = structuredClone(current);
        for (const op of operations)
          if (op.action === 'order')
            applyOrder(next.document, op.entryId, op.decision);
        next.revision += 1;
        next.document.review.approval = null;
        current = next;
        return Response.json(next);
      }
      if (url.endsWith(`/drafts/${current.id}`)) return Response.json(current);
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
        onContinueToApproval={() => {}}
      />
    </ThemeProvider>,
  );
  return { saves, current: () => current };
}
const card = (name: RegExp) => screen.getByRole('article', { name });
const order = (name: RegExp, list: 'Original order' | 'Suggested order') =>
  within(within(card(name)).getByRole('list', { name: list }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);
/** Text order of the bullets in the shared CV preview. */
const previewIndex = (text: string) =>
  document.body.textContent!.lastIndexOf(text);

test('cards show both orders; roles decide independently; preview follows before save', async () => {
  setup(twoRoles());
  await screen.findByRole('region', { name: /Suggested bullet order/ });
  expect(screen.getAllByRole('article')).toHaveLength(2);
  const a = /Synthetic Role A/;
  expect(order(a, 'Original order')[0]).toMatch(/Wrote team docs a/);
  expect(order(a, 'Suggested order')[0]).toMatch(/Built Java APIs a/);
  expect(within(card(a)).getByText('Moved up')).toBeInTheDocument();
  expect(within(card(a)).getByText('Matches: Java')).toBeInTheDocument();
  expect(within(card(a)).getByRole('status')).toHaveTextContent('Not decided');
  fireEvent.click(
    within(card(a)).getByRole('button', { name: 'Apply suggested order' }),
  );
  expect(within(card(a)).getByRole('status')).toHaveTextContent(
    'Suggested order applied.',
  );
  // Unsaved preview: role A reordered, role B untouched.
  expect(previewIndex('Built Java APIs a')).toBeLessThan(
    previewIndex('Wrote team docs a'),
  );
  expect(previewIndex('Wrote team docs b')).toBeLessThan(
    previewIndex('Built Java APIs b'),
  );
  const b = /Synthetic Role B/;
  fireEvent.click(
    within(card(b)).getByRole('button', { name: 'Keep original order' }),
  );
  expect(within(card(b)).getByRole('status')).toHaveTextContent(
    'Original order kept.',
  );
  expect(
    within(card(a)).getByRole('button', { name: 'Restore original order' }),
  ).toBeInTheDocument();
});

test('saved order survives reload; restore and approval invalidation', async () => {
  const { saves, current } = setup(twoRoles(true));
  await screen.findByRole('region', { name: /Suggested bullet order/ });
  const a = /Synthetic Role A/;
  fireEvent.click(
    within(card(a)).getByRole('button', { name: 'Apply suggested order' }),
  );
  expect(
    screen.getAllByText('Unsaved changes — approval will be cleared').length,
  ).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(saves[0]).toEqual([
    { action: 'order', entryId: 'role-a', decision: 'accept' },
  ]);
  const saved = current();
  expect(saved.document.review.approval).toBeNull();
  expect(saved.document.review.orders).toEqual({ 'role-a': 'accepted' });
  expect(
    saved.document.sections
      .find((s) => s.kind === 'experience')!
      .entries[0]!.facts.map((f) => f.id),
  ).toEqual(['a-role', 'a-dates', 'a-java', 'a-docs']);
  await closeSuccess();
  // Reloaded state shows the saved decision and still allows restore.
  const restore = await within(card(a)).findByRole('button', {
    name: 'Restore original order',
  });
  restore.focus();
  expect(restore).toHaveFocus();
  fireEvent.click(restore);
  expect(previewIndex('Wrote team docs a')).toBeLessThan(
    previewIndex('Built Java APIs a'),
  );
  expect(within(card(a)).getByRole('status')).toHaveTextContent(
    'Original order kept.',
  );
});

test('old drafts without suggestions show no card', async () => {
  const draft = twoRoles();
  for (const e of draft.document.sections.flatMap((s) => s.entries))
    delete e.orderProposal;
  setup(draft);
  await screen.findByText(/Full CV: read your tailored CV/);
  expect(
    screen.queryByRole('region', { name: /Suggested bullet order/ }),
  ).toBeNull();
});
