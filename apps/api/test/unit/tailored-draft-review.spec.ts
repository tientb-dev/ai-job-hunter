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
  // Historical draft with an order-only suggestion from the former policy.
  const input = draftInput('Java', false, 'Python, Java\n', 'skill');
  const doc = assembleDraft(input, []);
  const fact = doc.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.id === 'java')!;
  fact.proposedWording = {
    text: 'Java, Python',
    requirementIds: [],
    status: 'pending',
  };
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

test('marketing clarification is independent of rewrites and prioritizes the documented contribution', () => {
  const input = draftInput(
    'campaign',
    false,
    'Automated campaign reporting for the weekly handoff.',
  );
  const doc = assembleDraft(input, [
    {
      selectedFactIds: ['java'],
      proposals: [],
      questions: [
        {
          factId: 'java',
          requirementIds: ['p1'],
          question: 'What changed in the weekly handoff?',
          explanation: 'The role needs reliable campaign reporting.',
        },
      ],
    },
  ]);
  const get = (draft: typeof doc) =>
    draft.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === 'java')!;
  const originals = new Map(input.plan.facts.map((f) => [f.id, f.value]));
  const original = get(doc).acceptedText;
  expect(get(doc).proposedWording).toBeNull();
  expect(get(doc).clarification?.kind).toBe('impact');
  expect(() => approveReview(doc, [], 2, '2026-11-20')).not.toThrow();
  for (const action of ['no_metrics', 'skip_question'] as const) {
    const dismissed = applyReview(doc, [{ action, factId: 'java' }], originals);
    expect(get(dismissed).acceptedText).toBe(original);
    expect(() => approveReview(dismissed, [], 2, '2026-11-20')).not.toThrow();
  }
  const confirm = (draft: typeof doc, text: string) =>
    applyReview(
      draft,
      [
        {
          action: 'confirm_answer',
          factId: 'java',
          text,
        },
      ],
      originals,
    );
  const firstAnswer = confirm(doc, 'I prepared the weekly summary.');
  const included = applyReview(
    firstAnswer,
    [{ action: 'use_answer', factId: 'java' }],
    originals,
  );
  expect(get(included).acceptedText).toBe(
    original + '\nI prepared the weekly summary.',
  );
  const editedAnswer = confirm(
    included,
    'I checked the weekly summary before handoff.',
  );
  expect(get(editedAnswer).acceptedText).toBe(original);
  expect(get(editedAnswer).clarification?.status).toBe('confirmed');
  const rejected = applyReview(
    editedAnswer,
    [{ action: 'skip_question', factId: 'java' }],
    originals,
  );
  expect(get(rejected).clarification).toMatchObject({ status: 'skipped' });
  expect(get(rejected).clarification?.answer).toBeUndefined();
  expect(() =>
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 1,
      operations: [
        { action: 'confirm_answer', factId: 'java', text: 'Improved by [X%].' },
      ],
    }),
  ).toThrow();
});

test('already quantified or unrelated descriptions can yield zero questions', () => {
  const input = draftInput(
    'campaign',
    false,
    'Built campaign reports for 12 markets.',
  );
  const facts = assembleDraft(input, []).sections.flatMap((s) =>
    s.entries.flatMap((e) => e.facts),
  );
  expect(facts.every((f) => !f.clarification && !f.proposedWording)).toBe(true);
});

test('confirmed detail and rewrite coexist until an explicit replacement', () => {
  const input = draftInput(
    'campaign',
    false,
    'Automated campaign reporting to simplify weekly handoffs.',
  );
  const doc = assembleDraft(input, [
    {
      selectedFactIds: ['java'],
      questions: [
        {
          factId: 'java',
          requirementIds: ['p1'],
          question: 'What changed in the weekly handoff?',
          explanation: 'The role needs reliable campaign reporting.',
        },
      ],
      proposals: [
        {
          factId: 'java',
          text: 'Automated the weekly campaign report so the sales handoff no longer needed manual exports.',
          requirementIds: [],
        },
      ],
    },
  ]);
  const get = (draft: typeof doc) =>
    draft.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === 'java')!;
  const originals = new Map(input.plan.facts.map((f) => [f.id, f.value]));
  const use = { action: 'use_answer', factId: 'java' } as const;
  expect(get(doc).proposedWording).toBeTruthy();
  expect(get(doc).clarification?.kind).toBe('impact');
  expect(() =>
    applyReview(
      doc,
      [{ action: 'confirm_answer', factId: 'java', text: '20%' }],
      originals,
    ),
  ).toThrow('Say what changed');
  const vietnamese = applyReview(
    doc,
    [
      {
        action: 'confirm_answer',
        factId: 'java',
        text: 'Giảm hai bước báo cáo thủ công',
      },
    ],
    originals,
  );
  expect(get(vietnamese).clarification?.addition).toBe(
    'Giảm hai bước báo cáo thủ công.',
  );
  const confirmed = applyReview(
    doc,
    [
      {
        action: 'confirm_answer',
        factId: 'java',
        text: 'removed two manual reporting steps',
      },
    ],
    originals,
  );
  expect(get(confirmed).clarification).toMatchObject({
    status: 'confirmed',
    answer: 'removed two manual reporting steps',
    addition: 'Removed two manual reporting steps.',
  });
  expect(get(confirmed).acceptedText).toBe(get(doc).acceptedText);
  expect(() => applyReview(confirmed, [use], originals)).toThrow();
  const accepted = applyReview(
    confirmed,
    [{ action: 'accept', factId: 'java' }],
    originals,
  );
  expect(get(accepted).acceptedText).toBe(get(doc).proposedWording?.text);
  expect(() => applyReview(accepted, [use], originals)).toThrow();
  const replaced = applyReview(
    accepted,
    [{ ...use, action: 'replace_with_answer' }],
    originals,
  );
  expect(get(replaced).acceptedText).toBe(
    get(doc).acceptedText + '\nRemoved two manual reporting steps.',
  );
  expect(get(replaced).proposedWording).toEqual(get(doc).proposedWording);
  expect(() =>
    approveReview(replaced, ['java'], 5, '2026-11-20'),
  ).not.toThrow();
});

test('a suggestion needing confirmation is accepted only with an exact, current confirmation of its claim', () => {
  const { doc, originals } = fixture();
  const fact = doc.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.id === 'java')!;
  fact.proposedWording = {
    text: 'Java (5 years), Python',
    requirementIds: [],
    status: 'pending',
    requiresConfirmation: true,
    confirmationAssertion: 'Five years of Java experience.',
  };
  const confirmed = {
    assertion: 'Five years of Java experience.',
    text: 'Java (5 years), Python',
  };
  const reject = (op: unknown) =>
    expect(() =>
      applyReview(
        doc,
        [op as Parameters<typeof applyReview>[1][number]],
        originals,
      ),
    ).toThrow(
      expect.objectContaining({ errorCode: 'CV_DRAFT_INVALID_REQUEST' }),
    );
  // No confirmation, a different claim, or stale text: still refused.
  reject({ action: 'accept', factId: 'java' });
  reject({
    action: 'accept',
    factId: 'java',
    confirmed: { ...confirmed, assertion: 'Three years of Java experience.' },
  });
  reject({
    action: 'accept',
    factId: 'java',
    confirmed: { ...confirmed, text: 'Java (3 years), Python' },
  });
  const accepted = applyReview(
    doc,
    [{ action: 'accept', factId: 'java', confirmed }],
    originals,
  );
  const state = accepted.review!.factReviews.java!;
  expect(state).toMatchObject({
    wording: 'ai_accepted',
    proposal: 'accepted',
    userConfirmed: { assertion: 'Five years of Java experience.' },
  });
  expect(Date.parse(state.userConfirmed!.confirmedAt)).not.toBeNaN();
  const get = (d: typeof doc) =>
    d.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === 'java')!;
  expect(get(accepted).acceptedText).toBe('Java (5 years), Python');
  // Accepted wording is user-reviewed content: approval must list it.
  expect(() =>
    approveReview(accepted, [], 2, new Date().toISOString()),
  ).toThrow();
  expect(
    approveReview(accepted, ['java'], 2, new Date().toISOString()).review!
      .approval,
  ).toEqual(expect.objectContaining({ revision: 2 }));
  // Any later wording decision drops the confirmation.
  for (const op of [
    { action: 'reject', factId: 'java' },
    { action: 'edit', factId: 'java', text: 'Java, Python' },
    { action: 'restore', factId: 'java' },
  ] as const) {
    const next = applyReview(accepted, [op], originals);
    expect(next.review!.factReviews.java!.userConfirmed).toBeUndefined();
  }
  // Keep original and edit remain available without any confirmation.
  expect(
    applyReview(doc, [{ action: 'reject', factId: 'java' }], originals).review!
      .factReviews.java!.proposal,
  ).toBe('rejected');
});

test('an ordinary suggestion rejects a confirmation payload; malformed confirmations fail parsing', () => {
  const { doc, originals } = fixture();
  expect(() =>
    applyReview(
      doc,
      [
        {
          action: 'accept',
          factId: 'java',
          confirmed: { assertion: 'x', text: 'Java, Python' },
        },
      ],
      originals,
    ),
  ).toThrow(expect.objectContaining({ errorCode: 'CV_DRAFT_INVALID_REQUEST' }));
  const body = (confirmed: unknown) => ({
    contractVersion: '1',
    expectedRevision: 1,
    operations: [{ action: 'accept', factId: 'java', confirmed }],
  });
  expect(reviewRequest(body({ assertion: 'a', text: 'b' })).operations).toEqual(
    [
      {
        action: 'accept',
        factId: 'java',
        confirmed: { assertion: 'a', text: 'b' },
      },
    ],
  );
  for (const bad of [
    true,
    { assertion: 'a' },
    { assertion: '', text: 'b' },
    { assertion: 'a', text: 'b', extra: 1 },
    { assertion: 'a'.repeat(2001), text: 'b' },
  ])
    expect(() => reviewRequest(body(bad))).toThrow(
      expect.objectContaining({ errorCode: 'CV_DRAFT_INVALID_REQUEST' }),
    );
  // Only accept carries a confirmation.
  expect(() =>
    reviewRequest({
      contractVersion: '1',
      expectedRevision: 1,
      operations: [{ action: 'reject', factId: 'java', confirmed: {} }],
    }),
  ).toThrow(expect.objectContaining({ errorCode: 'CV_DRAFT_INVALID_REQUEST' }));
});
