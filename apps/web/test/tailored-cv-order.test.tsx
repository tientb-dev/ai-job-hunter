import { expect, test } from 'vitest';
import { render } from './render';
import { TailoredCvPreview } from '../src/features/inbox/TailoredCvPreview';
import {
  applyOrder,
  decodeDraft,
  isSafeOrder,
  type DraftFact,
} from '../src/features/inbox/tailored-cv.contract';
import { draftJobId, tailoredDraftFixture } from './fixtures/tailored-cv';

/** Synthetic role: title and dates, then an unrelated bullet before a Java one. */
function ordered() {
  const draft = tailoredDraftFixture();
  const doc = draft.document;
  const entry = doc.sections.find((s) => s.kind === 'experience')!.entries[0]!;
  const base = entry.facts[0]!;
  const make = (id: string, field: string, acceptedText: string): DraftFact => {
    doc.review.factReviews[id] = {
      reviewedText: acceptedText,
      wording: 'reviewed_profile',
      proposal: 'none',
    };
    return {
      ...structuredClone(base),
      id,
      field,
      acceptedText,
      proposedWording: null,
      provenance: { ...base.provenance, profileFactId: id },
    };
  };
  entry.facts = [
    make('role-title', 'role', 'Developer'),
    make('dates', 'dates', 'January 2023 - December 2024'),
    base,
    make('java', 'description', 'Built Java APIs for internal tools.'),
  ];
  entry.orderProposal = {
    originalFactIds: ['role-title', 'dates', 'description', 'java'],
    factIds: ['role-title', 'dates', 'java', 'description'],
    reasons: { java: ['Java'] },
  };
  return draft;
}
const ids = (doc: ReturnType<typeof ordered>['document']) =>
  doc.sections
    .find((s) => s.kind === 'experience')!
    .entries[0]!.facts.map((f) => f.id);

test('accept, reject and restore permute only that entry; text and decisions unchanged', () => {
  const { document: doc } = ordered();
  const before = structuredClone(doc);
  expect(applyOrder(doc, 'role', 'accept')).toBe(true);
  expect(ids(doc)).toEqual(['role-title', 'dates', 'java', 'description']);
  expect(doc.review.orders).toEqual({ role: 'accepted' });
  expect(doc.review.factReviews).toEqual(before.review.factReviews);
  const text = (d: typeof doc) =>
    d.sections.flatMap((s) =>
      s.entries.flatMap((e) =>
        e.facts.map((f) => [f.id, f.acceptedText] as const),
      ),
    );
  expect(new Map(text(doc))).toEqual(new Map(text(before)));
  // Other sections are untouched.
  expect(doc.sections.filter((s) => s.kind !== 'experience')).toEqual(
    before.sections.filter((s) => s.kind !== 'experience'),
  );
  for (const decision of ['reject', 'restore'] as const) {
    const copy = structuredClone(doc);
    expect(applyOrder(copy, 'role', decision)).toBe(true);
    expect(ids(copy)).toEqual(
      before.sections[3]!.entries[0]!.facts.map((f) => f.id),
    );
    expect(copy.review.orders).toEqual({ role: 'rejected' });
  }
});

test('unsafe or missing proposals never change the document', () => {
  const { document: doc } = ordered();
  const entry = doc.sections.find((s) => s.kind === 'experience')!.entries[0]!;
  const before = structuredClone(doc);
  expect(applyOrder(doc, 'missing', 'accept')).toBe(false);
  entry.orderProposal!.factIds = ['dates', 'role-title', 'java', 'description'];
  expect(applyOrder(doc, 'role', 'accept')).toBe(false);
  expect(ids(doc)).toEqual(ids(before));
  const old = tailoredDraftFixture().document;
  expect(applyOrder(old, 'role', 'accept')).toBe(false);
  expect(
    isSafeOrder(entry.facts, ['role-title', 'dates', 'java', 'description']),
  ).toBe(true);
  expect(isSafeOrder(entry.facts, ['role-title', 'dates', 'java'])).toBe(false);
});

test('preview renders the applied order, same as a reloaded server draft', () => {
  const local = ordered().document;
  applyOrder(local, 'role', 'accept');
  const lines = (doc: typeof local) =>
    render(<TailoredCvPreview document={doc} />).container.textContent!.replace(
      /\s+/gu,
      ' ',
    );
  const text = lines(local);
  expect(text.indexOf('Built Java APIs')).toBeLessThan(
    text.indexOf('Assisted a team prototype'),
  );
  // A reloaded draft carries the saved order in entry.facts.
  const reloaded = decodeDraft(
    JSON.parse(JSON.stringify({ ...ordered(), document: local })),
    draftJobId,
  );
  expect(ids(reloaded.document)).toEqual(ids(local));
  expect(reloaded.document.review.orders).toEqual({ role: 'accepted' });
});

test('decodeDraft: old drafts still decode; malformed order fields are rejected', () => {
  const old = tailoredDraftFixture();
  expect(
    decodeDraft(structuredClone(old), draftJobId).document.review.orders,
  ).toBeUndefined();
  expect(decodeDraft(ordered(), draftJobId)).toBeTruthy();
  const bad = (edit: (d: ReturnType<typeof ordered>) => void) => {
    const d = ordered();
    edit(d);
    return () => decodeDraft(d, draftJobId);
  };
  expect(
    bad((d) => {
      d.document.sections[3]!.entries[0]!.orderProposal!.factIds = [1 as never];
    }),
  ).toThrow();
  expect(
    bad((d) => {
      d.document.review.orders = { role: 'maybe' as never };
    }),
  ).toThrow();
});
