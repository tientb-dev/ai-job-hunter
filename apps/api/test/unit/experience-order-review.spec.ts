import { expect, test } from '@jest/globals';
import { isSafeOrder } from '../../src/tailored-cv/experience-order.js';
import { canonicalExport } from '../../src/tailored-cv/tailored-cv-export.js';
import {
  applyReview,
  approveReview,
  reviewRequest,
} from '../../src/tailored-cv/tailored-draft-review.policy.js';
import { assembleDraft } from '../../src/tailored-cv/tailored-draft.policy.js';
import { draftInput } from '../support/tailored-draft-fixtures.js';

/** Synthetic draft whose Java bullet sits after an unrelated one. */
function draft() {
  const input = draftInput('Java');
  const facts = input.plan.facts;
  const java = facts.findIndex((f) => f.id === 'java');
  const scope = facts.findIndex((f) => f.id === 'scope');
  [facts[java], facts[scope]] = [facts[scope]!, facts[java]!];
  const doc = assembleDraft(input, []);
  const originals = new Map(input.plan.facts.map((f) => [f.id, f.value]));
  const entry = () =>
    doc.sections.find((s) => s.kind === 'experience')!.entries[0]!;
  return { doc, originals, entry };
}
const ids = (d: ReturnType<typeof draft>['doc']) =>
  d.sections
    .find((s) => s.kind === 'experience')!
    .entries[0]!.facts.map((f) => f.id);
const order = (entryId: string, decision: string) => ({
  action: 'order',
  entryId,
  decision,
});

test('generation stores a proposal but never applies it', () => {
  const { doc, entry } = draft();
  expect(entry().orderProposal).toEqual({
    originalFactIds: ['employer', 'role', 'dates', 'scope', 'java'],
    factIds: ['employer', 'role', 'dates', 'java', 'scope'],
    reasons: { java: expect.arrayContaining(['Java']) },
  });
  expect(ids(doc)).toEqual(entry().orderProposal!.originalFactIds);
});

test('a well-ordered entry gets no proposal (backward-compatible shape)', () => {
  const doc = assembleDraft(draftInput('Java'), []);
  for (const s of doc.sections)
    for (const e of s.entries) expect(e.orderProposal).toBeUndefined();
});

test('accept, reject and restore permute entry.facts only; text and reviews unchanged', () => {
  const { doc, originals, entry } = draft();
  const id = entry().id;
  const approved = approveReview(doc, [], 2, '2026-01-01T00:00:00.000Z');
  const accepted = applyReview(
    approved,
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 2,
      operations: [order(id, 'accept')],
    }).operations,
    originals,
  );
  expect(ids(accepted)).toEqual(['employer', 'role', 'dates', 'java', 'scope']);
  expect(accepted.review!.orders).toEqual({ [id]: 'accepted' });
  // Changing the order invalidates approval like any other review change.
  expect(accepted.review!.approval).toBeNull();
  expect(accepted.review!.factReviews).toEqual(approved.review!.factReviews);
  const text = (d: typeof doc) =>
    Object.fromEntries(
      d.sections.flatMap((s) =>
        s.entries.flatMap((e) => e.facts.map((f) => [f.id, f.acceptedText])),
      ),
    );
  expect(text(accepted)).toEqual(text(doc));
  // Export follows the accepted order (preview/PDF/DOCX all read this).
  const lines = JSON.stringify(
    canonicalExport(approveReview(accepted, [], 3, 'x'), 3),
  );
  expect(lines.indexOf('Built Java APIs')).toBeLessThan(
    lines.indexOf('Assisted a team prototype'),
  );
  for (const decision of ['reject', 'restore']) {
    const back = applyReview(
      accepted,
      [{ action: 'order', entryId: id, decision } as never],
      originals,
    );
    expect(ids(back)).toEqual(entry().orderProposal!.originalFactIds);
    expect(back.review!.orders).toEqual({ [id]: 'rejected' });
  }
  // Wording edits after a reorder keep the order.
  const edited = applyReview(
    accepted,
    [{ action: 'edit', factId: 'scope', text: 'Synthetic edit' }],
    originals,
  );
  expect(ids(edited)).toEqual(ids(accepted));
});

test('invalid order requests are rejected', () => {
  const { doc, originals, entry } = draft();
  const bad = (body: unknown) => () =>
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 1,
      operations: [body],
    });
  expect(bad(order(entry().id, 'shuffle'))).toThrow();
  expect(bad({ ...order(entry().id, 'accept'), factIds: ['java'] })).toThrow();
  expect(bad(order('', 'accept'))).toThrow();
  expect(bad({ action: 'order', entryId: 7, decision: 'accept' })).toThrow();
  const apply = (d: typeof doc, entryId: string) => () =>
    applyReview(
      d,
      [{ action: 'order', entryId, decision: 'accept' }],
      originals,
    );
  expect(apply(doc, 'missing')).toThrow();
  // An entry without a proposal (contact) cannot be reordered.
  const contact = doc.sections.find((s) => s.kind === 'contact')!.entries[0]!
    .id;
  expect(apply(doc, contact)).toThrow();
  // A tampered stored proposal that moves a title or date is refused.
  const tampered = structuredClone(doc);
  const e = tampered.sections.find((s) => s.kind === 'experience')!.entries[0]!;
  e.orderProposal!.factIds = ['role', 'employer', 'dates', 'java', 'scope'];
  expect(apply(tampered, e.id)).toThrow();
  e.orderProposal!.factIds = ['employer', 'role', 'dates', 'java', 'other'];
  expect(apply(tampered, e.id)).toThrow();
});

test('isSafeOrder keeps structure and body runs', () => {
  const facts = [
    { id: 'r', field: 'role' },
    { id: 'a', field: 'description' },
    { id: 'b', field: 'description' },
    { id: 'd', field: 'dates' },
    { id: 'c', field: 'description' },
  ];
  expect(isSafeOrder(facts, ['r', 'b', 'a', 'd', 'c'])).toBe(true);
  expect(isSafeOrder(facts, ['r', 'a', 'c', 'd', 'b'])).toBe(false);
  expect(isSafeOrder(facts, ['b', 'r', 'a', 'd', 'c'])).toBe(false);
  expect(isSafeOrder(facts, ['r', 'a', 'a', 'd', 'c'])).toBe(false);
  expect(isSafeOrder(facts, ['r', 'a', 'b', 'd'])).toBe(false);
});

test('Classic, Modern and Compact PDFs all carry the accepted order', async () => {
  const { doc, originals, entry } = draft();
  const accepted = approveReview(
    applyReview(
      doc,
      [{ action: 'order', entryId: entry().id, decision: 'accept' }],
      originals,
    ),
    [],
    2,
    '2026-01-01T00:00:00.000Z',
  );
  const { CV_TEMPLATES, renderPdf } =
    await import('../../src/tailored-cv/tailored-cv-export.js');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const template of CV_TEMPLATES) {
    const pdf = await renderPdf(canonicalExport(accepted, 2), template);
    const loading = getDocument({
      data: new Uint8Array(pdf),
      useSystemFonts: false,
      verbosity: 0,
    });
    let text = '';
    try {
      const loaded = await loading.promise;
      for (let n = 1; n <= loaded.numPages; n++)
        text += (await (await loaded.getPage(n)).getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
    } finally {
      await loading.destroy();
    }
    text = text.replace(/\s+/gu, ' ');
    const java = text.indexOf('Built Java APIs');
    expect(java).toBeGreaterThan(text.indexOf('2024'));
    expect(text.indexOf('Assisted a team prototype')).toBeGreaterThan(java);
  }
});
