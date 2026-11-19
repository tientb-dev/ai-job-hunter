import { version, record, revision } from './tailored-cv.contract.js';
import {
  TailoredDraftError,
  issueBlocksApproval,
  type DraftFact,
  type TailoredDraftDocument,
} from './tailored-draft.contract.js';

export type ReviewOperation =
  | { action: 'confirm_answer'; factId: string; text: string }
  | {
      action:
        'use_answer' | 'replace_with_answer' | 'skip_question' | 'no_metrics';
      factId: string;
    }
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
/** Bracketed tokens in changed wording that the reviewed source text lacks. */
export function newPlaceholders(
  text: string,
  state: DraftReview['factReviews'][string] | undefined,
) {
  if (!state || state.wording === 'reviewed_profile') return [];
  return [...text.matchAll(/\[[^\]\n]{1,40}\]/gu)]
    .map((m) => m[0])
    .filter((token) => !state.reviewedText.includes(token));
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
          input.action === 'edit' || input.action === 'confirm_answer'
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
        if (op.action === 'confirm_answer') {
          if (
            typeof op.text !== 'string' ||
            !op.text.trim() ||
            op.text.trim().length > 600 ||
            /[[\]\p{Cc}\p{Cf}]/u.test(op.text.trim())
          )
            throw new Error();
          return { action: op.action, factId: op.factId, text: op.text.trim() };
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
          op.action !== 'restore' &&
          op.action !== 'use_answer' &&
          op.action !== 'replace_with_answer' &&
          op.action !== 'skip_question' &&
          op.action !== 'no_metrics'
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
function detailAddition(answer: string) {
  // shortcut: accept explicit action/result phrases. Ask for the missing context in fragments.
  const explicitAction =
    /\b(?:\p{L}{3,}ed|was|were|had|has|did|used|ran|built|cut|grew|fell|rose|went|wrote|made|met|led|got|saved|took|gave|kept|set|won|saw|found|brought|became)\b/iu.test(
      answer,
    ) ||
    /(?<!\p{L})(?:giảm|tăng|loại bỏ|dùng|sử dụng|triển khai|tạo|viết|rút ngắn|tiết kiệm|phụ trách|xử lý)\s+\p{L}/iu.test(
      answer,
    );
  if (
    !explicitAction ||
    /\?\s*$/u.test(answer) ||
    /^(?:(?:it|this|that)\s+)?(?:helped|worked|improved|changed|reduced)\s*[.!]?$/iu.test(
      answer,
    )
  )
    throw new TailoredDraftError('CV_DRAFT_DETAIL_UNCLEAR');
  const wording = answer.replace(/^(\p{Ll})(?=\p{Ll}{2})/u, (first) =>
    first.toUpperCase(),
  );
  return /[.!。]$/u.test(wording) ? wording : wording + '.';
}

export function enrichedWording(original: string, answer: string) {
  return `${original.trimEnd()}\n${answer}`;
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
    const clarification = fact.clarification;
    const original = originals.get(fact.provenance.profileFactId);
    if (
      op.action === 'confirm_answer' ||
      op.action === 'use_answer' ||
      op.action === 'replace_with_answer' ||
      op.action === 'skip_question' ||
      op.action === 'no_metrics'
    ) {
      if (!clarification || original === undefined)
        throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
      if (op.action === 'use_answer' || op.action === 'replace_with_answer') {
        const addition = clarification.addition ?? clarification.answer;
        if (
          clarification.status !== 'confirmed' ||
          !addition ||
          state.proposal === 'pending' ||
          (state.wording !== 'reviewed_profile') !==
            (op.action === 'replace_with_answer') ||
          original.trimEnd().length + addition.length + 1 > 4000
        )
          throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
        fact.acceptedText = enrichedWording(original, addition);
        clarification.status = 'included';
        state.wording = 'user_edited';
        if (state.proposal === 'accepted') state.proposal = 'rejected';
        continue;
      }
      if (clarification.status === 'included') {
        fact.acceptedText = original;
        state.wording = 'reviewed_profile';
      }
      if (op.action === 'confirm_answer') {
        const addition = detailAddition(op.text);
        if (original.trimEnd().length + addition.length + 1 > 4000)
          throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
        clarification.status = 'confirmed';
        clarification.answer = op.text;
        clarification.addition = addition;
      } else {
        clarification.status =
          op.action === 'no_metrics' ? 'no_metrics' : 'skipped';
        delete clarification.answer;
        delete clarification.addition;
      }
      continue;
    }
    if (clarification?.status === 'included') {
      if (op.action === 'edit' && op.text !== fact.acceptedText)
        throw new TailoredDraftError('CV_DRAFT_INVALID_REQUEST');
      if (op.action !== 'edit') clarification.status = 'confirmed';
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
      if (
        !fact.proposedWording ||
        (op.action === 'accept' && fact.proposedWording.requiresConfirmation)
      )
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
  // Adopted or edited wording must have every [placeholder] replaced by the
  // user's own detail before approval. Brackets already in the source wording
  // (e.g. "[Remote]") are the user's CV text, not placeholders.
  for (const section of next.sections)
    for (const entry of section.entries)
      for (const fact of entry.facts)
        if (
          (fact.clarification?.status === 'included' &&
            (!fact.clarification.answer ||
              fact.acceptedText !==
                enrichedWording(
                  review.factReviews[fact.id]!.reviewedText,
                  fact.clarification.addition ?? fact.clarification.answer,
                ))) ||
          fact.verification?.details.some(
            (d) => d.startsWith('[') && fact.acceptedText.includes(d),
          ) ||
          newPlaceholders(fact.acceptedText, review.factReviews[fact.id]).length
        )
          throw new TailoredDraftError('CV_DRAFT_REVIEW_INCOMPLETE');
  review.approval = { revision: nextRevision, approvedAt: now };
  return next;
}
