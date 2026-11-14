import { expect, test } from '@jest/globals';
import {
  applyReview,
  initialReview,
  approveReview,
  reviewRequest,
} from '../../src/tailored-cv/tailored-draft-review.policy.js';
import { assembleDraft } from '../../src/tailored-cv/tailored-draft.policy.js';
import { draftInput } from '../support/tailored-draft-fixtures.js';
function fixture() {
  // An order-only skills list change: the one substantive proposal D2.1 admits.
  const input = draftInput('Java', false, 'Python, Java\n', 'skill');
  const doc = assembleDraft(input, [
    {
      selectedFactIds: ['java'],
      proposals: [
        {
          factId: 'java',
          text: 'Java, Python',
          requirementIds: [],
        },
      ],
    },
  ]);
  const originals = new Map(input.plan.facts.map((f) => [f.id, f.value]));
  return { doc, originals };
}
test('AI decisions are explicit; manual and restored wording preserve pinned evidence and assessments', () => {
  const { doc, originals } = fixture();
  const accepted = applyReview(
    doc,
    [{ action: 'accept', factId: 'java' }],
    originals,
  );
  const get = (d: typeof doc) =>
    d.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === 'java')!;
  expect(accepted.review!.factReviews.java).toMatchObject({
    wording: 'ai_accepted',
    proposal: 'accepted',
  });
  expect(get(accepted).provenance).toEqual(get(doc).provenance);
  const edited = applyReview(
    accepted,
    [
      {
        action: 'edit',
        factId: 'java',
        text: 'User states academic Java only.',
      },
    ],
    originals,
  );
  expect(edited.review!.factReviews.java!.wording).toBe('user_edited');
  expect(edited.requirements).toEqual(doc.requirements);
  expect(edited.pins).toEqual(doc.pins);
  expect(get(edited).provenance).toEqual(get(doc).provenance);
  const restored = applyReview(
    edited,
    [{ action: 'restore', factId: 'java' }],
    originals,
  );
  expect(get(restored).acceptedText).toBe(originals.get('java'));
  expect(restored.review!.factReviews.java!.wording).toBe('reviewed_profile');
  expect(doc.review).toBeUndefined();
});
test('approval needs proposal decisions, issue acknowledgements and exact edited IDs; every save clears approval', () => {
  const { doc, originals } = fixture();
  expect(() => approveReview(doc, [], 2, '2026-01-01')).toThrow();
  let reviewed = applyReview(
    doc,
    [{ action: 'reject', factId: 'java' }],
    originals,
  );
  reviewed = applyReview(
    reviewed,
    reviewed.reviewIssues.flatMap((r, i) =>
      r.code === 'SEMANTIC_REVIEW_REQUIRED'
        ? []
        : [{ action: 'acknowledge' as const, issueIndex: i }],
    ),
    originals,
  );
  const approved = approveReview(reviewed, [], 3, '2026-01-01');
  expect(approved.review!.approval!.revision).toBe(3);
  const edited = applyReview(
    approved,
    [{ action: 'edit', factId: 'java', text: 'New user claim' }],
    originals,
  );
  expect(edited.review!.approval).toBeNull();
  expect(() => approveReview(edited, [], 5, '2026-01-01')).toThrow();
  expect(
    approveReview(edited, ['java'], 5, '2026-01-01').review!.approval!.revision,
  ).toBe(5);
});
test('reject keeps source defaults; malformed operations, unsupported facts and unsupported decisions fail closed', () => {
  const { doc, originals } = fixture();
  const next = applyReview(
    doc,
    [{ action: 'reject', factId: 'java' }],
    originals,
  );
  expect(next.sections).toEqual(doc.sections);
  const reconsidered = applyReview(
    next,
    [{ action: 'accept', factId: 'java' }],
    originals,
  );
  expect(reconsidered.review!.factReviews.java!.proposal).toBe('accepted');
  const rejectedAgain = applyReview(
    reconsidered,
    [{ action: 'reject', factId: 'java' }],
    originals,
  );
  expect(rejectedAgain.sections).toEqual(doc.sections);
  expect(() =>
    applyReview(
      doc,
      [{ action: 'edit', factId: 'foreign', text: 'x' }],
      originals,
    ),
  ).toThrow();
  for (const operation of [
    { action: 'edit', factId: 'java', text: '' },
    { action: 'edit', factId: 'java', text: 'x'.repeat(4001) },
    { action: 'edit', factId: 'java', text: 'x', evidence: [] },
    { action: 'acknowledge', issueIndex: -1 },
  ])
    expect(() =>
      reviewRequest({
        contractVersion: '1',
        expectedRevision: 1,
        operations: [operation],
      }),
    ).toThrow();
  expect(() =>
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 0,
      operations: [],
    }),
  ).toThrow();
  expect(() =>
    reviewRequest(
      {
        contractVersion: '1',
        expectedRevision: 1,
        reviewedFactIds: ['java', 'java'],
      },
      true,
    ),
  ).toThrow();
});

test('explicit export exclusion retains facts/provenance and invalidates approval', () => {
  const { doc, originals } = fixture();
  doc.review = {
    ...initialReview(doc),
    approval: { revision: 3, approvedAt: '2026-01-01' },
  };
  const next = applyReview(
    doc,
    [{ action: 'include', factId: 'java', included: false }],
    originals,
  );
  expect(next.sections).toEqual(doc.sections);
  expect(next.review!.factReviews.java!.exportIncluded).toBe(false);
  expect(next.review!.approval).toBeNull();
  expect(
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 3,
      operations: [{ action: 'include', factId: 'java', included: true }],
    }).operations,
  ).toHaveLength(1);
  expect(() =>
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 3,
      operations: [{ action: 'include', factId: 'java', included: 'yes' }],
    }),
  ).toThrow();
});
test('only conflicting source evidence blocks approval; informational and resolved issues stay recorded but do not block', () => {
  const { doc, originals } = fixture();
  const base = structuredClone(doc);
  base.reviewIssues = [
    {
      code: 'SEMANTIC_REVIEW_REQUIRED',
      factId: 'java',
      reason: 'Meaning reminder.',
    },
    {
      code: 'CV_DRAFT_UNSAFE_REWRITE',
      factId: 'java',
      reason: 'Blocked rewrite: new claim',
    },
    { code: 'REQUIREMENT_UNKNOWN', requirementId: 'p1', reason: 'Not shown.' },
    {
      code: 'REQUIREMENT_PARTIAL',
      requirementId: 'p2',
      reason: 'Partly shown.',
    },
    { code: 'REQUIREMENT_CONFLICT', requirementId: 'p3', reason: 'Differs.' },
    {
      code: 'SECTION_NOT_IN_PROFILE',
      sectionKind: 'projects',
      reason: 'Absent.',
    },
  ];
  // Pending proposals still block.
  expect(() => approveReview(base, [], 2, '2026-01-01')).toThrow();
  const decided = applyReview(
    base,
    [{ action: 'reject', factId: 'java' }],
    originals,
  );
  const approved = approveReview(decided, [], 3, '2026-01-01');
  expect(approved.review!.approval!.revision).toBe(3);
  expect(approved.reviewIssues).toHaveLength(6);
  expect(approved.review!.acknowledgedIssues).toEqual([]);

  const conflicted = structuredClone(decided);
  conflicted.reviewIssues.push({
    code: 'CV_DRAFT_UNSAFE_REWRITE',
    factId: 'java',
    reason: 'Conflicting source evidence requires review.',
  });
  expect(() => approveReview(conflicted, [], 4, '2026-01-01')).toThrow();
  const resolved = applyReview(
    conflicted,
    [{ action: 'acknowledge', issueIndex: 6 }],
    originals,
  );
  expect(
    approveReview(resolved, [], 5, '2026-01-01').review!.approval!.revision,
  ).toBe(5);
});
test('approval rejects new [placeholders] in accepted or edited wording in any section, but keeps bracketed source text', () => {
  const { doc, originals } = fixture();
  const ack = (d: typeof doc) =>
    d.reviewIssues.flatMap((r, i) =>
      r.code === 'SEMANTIC_REVIEW_REQUIRED'
        ? []
        : [{ action: 'acknowledge' as const, issueIndex: i }],
    );
  // A non-bullet (skills) AI suggestion that carries a placeholder.
  const risky = structuredClone(doc);
  risky.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.id === 'java')!.proposedWording!.text = 'Java [X%], Python';
  let accepted = applyReview(
    risky,
    [{ action: 'accept', factId: 'java' }],
    originals,
  );
  accepted = applyReview(accepted, ack(accepted), originals);
  expect(() => approveReview(accepted, ['java'], 3, '2026-01-01')).toThrow();
  for (const text of ['Java [X], Python', 'Java for [N users], Python']) {
    const edited = applyReview(
      accepted,
      [{ action: 'edit', factId: 'java', text }],
      originals,
    );
    expect(() => approveReview(edited, ['java'], 4, '2026-01-01')).toThrow();
  }
  // Brackets that were already in the reviewed source wording stay allowed.
  const source = structuredClone(accepted);
  source.review!.factReviews.java!.reviewedText = 'Python, Java [Remote]';
  const kept = applyReview(
    source,
    [{ action: 'edit', factId: 'java', text: 'Java [Remote], Python' }],
    originals,
  );
  expect(
    approveReview(kept, ['java'], 5, '2026-01-01').review!.approval!.revision,
  ).toBe(5);
});
