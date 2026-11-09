import { version, record, revision } from './tailored-cv.contract.js';
import {
  TailoredDraftError,
  issueBlocksApproval,
  type DraftFact,
  type TailoredDraftDocument,
} from './tailored-draft.contract.js';

export type ReviewOperation =
  | { action: 'edit'; factId: string; text: string }
  | { action: 'accept' | 'reject' | 'restore'; factId: string }
  | { action: 'acknowledge'; issueIndex: number }
  | { action: 'include'; factId: string; included: boolean };
export interface DraftReview {
  contractVersion: '1';
  factReviews: Record<
    string,
    {
      reviewedText: string;
      exportIncluded?: boolean;
      wording: 'reviewed_profile' | 'user_edited' | 'ai_accepted';
      proposal: 'pending' | 'accepted' | 'rejected' | 'none';
    }
  >;
  acknowledgedIssues: number[];
  approval: { revision: number; approvedAt: string } | null;
}
export function initialReview(document: TailoredDraftDocument): DraftReview {
  return {
    contractVersion: '1',
    factReviews: Object.fromEntries(
      document.sections.flatMap((s) =>
        s.entries.flatMap((e) =>
          e.facts.map((f) => [
            f.id,
            {
              reviewedText: f.acceptedText,
              wording: 'reviewed_profile' as const,
              proposal: f.proposedWording
                ? ('pending' as const)
                : ('none' as const),
            },
          ]),
        ),
      ),
    ),
    acknowledgedIssues: [],
    approval: null,
  };
}
export function reviewRequest(body: unknown, approve = false) {
  try {
    const value = version(
      body,
      approve
        ? ['expectedRevision', 'reviewedFactIds']
        : ['expectedRevision', 'operations'],
    );
    const expectedRevision = revision(value.expectedRevision);
    if (approve) {
      if (
        !Array.isArray(value.reviewedFactIds) ||
        value.reviewedFactIds.length > 96 ||
        !value.reviewedFactIds.every(
          (x) => typeof x === 'string' && x.length <= 100,
        ) ||
        new Set(value.reviewedFactIds).size !== value.reviewedFactIds.length
      )
        throw new Error();
      return {
        expectedRevision,
        operations: [] as ReviewOperation[],
        reviewedFactIds: value.reviewedFactIds as string[],
      };
    }
    if (
      !Array.isArray(value.operations) ||
      value.operations.length < 1 ||
      value.operations.length > 384 ||
      Buffer.byteLength(JSON.stringify(body)) > 96 * 1024
    )
      throw new Error();
    const operations: ReviewOperation[] = value.operations.map(
      (input: unknown) => {
        if (!input || typeof input !== 'object' || !('action' in input))
          throw new Error();
        if (input.action === 'acknowledge') {
          const op = record(input, ['action', 'issueIndex']);
          if (
            !Number.isSafeInteger(op.issueIndex) ||
            (op.issueIndex as number) < 0
          )
            throw new Error();
          return { action: 'acknowledge', issueIndex: op.issueIndex as number };
        }
        const op = record(
          input,
          input.action === 'edit'
            ? ['action', 'factId', 'text']
            : input.action === 'include'
              ? ['action', 'factId', 'included']
              : ['action', 'factId'],
        );
        if (typeof op.factId !== 'string' || op.factId.length > 100)
          throw new Error();
        if (op.action === 'include') {
          if (typeof op.included !== 'boolean') throw new Error();
          return {
            action: 'include',
            factId: op.factId,
            included: op.included,
          };
        }
        if (op.action === 'edit') {
          if (
            typeof op.text !== 'string' ||
            !op.text.trim() ||
            op.text.length > 4000 ||
            Array.from(op.text).some((char) => {
              const code = char.charCodeAt(0);
              return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
            })
          )
            throw new Error();
          return { action: 'edit', factId: op.factId, text: op.text };
        }
        if (
          op.action !== 'accept' &&
          op.action !== 'reject' &&
          op.action !== 'restore'
        )
          throw new Error();
        return { action: op.action, factId: op.factId };
      },
    );
    return { expectedRevision, operations, reviewedFactIds: [] as string[] };
  } catch {
    throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
  }
}
export function applyReview(
  document: TailoredDraftDocument,
  operations: ReviewOperation[],
  originals: Map<string, string>,
): TailoredDraftDocument {
  const next = structuredClone(document);
  const review = next.review ?? initialReview(next);
  next.review = review;
  const facts = new Map<string, DraftFact>(
    next.sections.flatMap((s) =>
      s.entries.flatMap((e) => e.facts.map((f) => [f.id, f] as const)),
    ),
  );
  for (const op of operations) {
    if (op.action === 'acknowledge') {
      const issue = next.reviewIssues[op.issueIndex];
      if (!issue || issue.code === 'SEMANTIC_REVIEW_REQUIRED')
        throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
      if (!review.acknowledgedIssues.includes(op.issueIndex))
        review.acknowledgedIssues.push(op.issueIndex);
      continue;
    }
    const fact = facts.get(op.factId),
      state = review.factReviews[op.factId];
    if (!fact || !state)
      throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
    if (op.action === 'include') {
      state.exportIncluded = op.included;
      continue;
    }
    if (op.action === 'edit') {
      fact.acceptedText = op.text;
      state.wording = 'user_edited';
      if (state.proposal === 'pending') state.proposal = 'rejected';
    } else if (op.action === 'restore') {
      const original = originals.get(fact.provenance.profileFactId);
      if (original === undefined)
        throw new TailoredDraftError('CV_DRAFT_STALE_PROFILE');
      fact.acceptedText = original;
      state.wording = 'reviewed_profile';
      if (fact.proposedWording) state.proposal = 'rejected';
    } else {
      if (!fact.proposedWording)
        throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
      state.proposal = op.action === 'accept' ? 'accepted' : 'rejected';
      if (op.action === 'accept') {
        fact.acceptedText = fact.proposedWording.text;
        state.wording = 'ai_accepted';
      } else {
        const original = originals.get(fact.provenance.profileFactId);
        if (original === undefined)
          throw new TailoredDraftError('CV_DRAFT_STALE_PROFILE');
        fact.acceptedText = original;
        state.wording = 'reviewed_profile';
      }
    }
  }
  review.approval = null;
  return next;
}
export function approveReview(
  document: TailoredDraftDocument,
  reviewedFactIds: string[],
  nextRevision: number,
  now: string,
): TailoredDraftDocument {
  const next = structuredClone(document);
  const review = next.review ?? initialReview(next);
  next.review = review;
  const required = Object.entries(review.factReviews)
    .filter(([, s]) => s.wording !== 'reviewed_profile')
    .map(([id]) => id);
  if (
    Object.values(review.factReviews).some((s) => s.proposal === 'pending') ||
    required.length !== reviewedFactIds.length ||
    required.some((id) => !reviewedFactIds.includes(id)) ||
    next.reviewIssues.some(
      (issue, i) =>
        issueBlocksApproval(issue) && !review.acknowledgedIssues.includes(i),
    )
  )
    throw new TailoredDraftError('CV_DRAFT_REVIEW_INCOMPLETE');
  // An adopted verification draft must have every [placeholder] replaced by
  // the user's own confirmed detail before approval.
  for (const section of next.sections)
    for (const entry of section.entries)
      for (const fact of entry.facts)
        if (
          fact.verification?.details.some(
            (d) => d.startsWith('[') && fact.acceptedText.includes(d),
          )
        )
          throw new TailoredDraftError('CV_DRAFT_REVIEW_INCOMPLETE');
  review.approval = { revision: nextRevision, approvedAt: now };
  return next;
}
