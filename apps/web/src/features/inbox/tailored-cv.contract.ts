export interface DraftFact {
  id: string;
  field: string;
  acceptedText: string;
  selected: boolean;
  provenance: {
    profileFactId: string;
    origin: 'source' | 'user_entered';
    evidence: {
      start: number;
      end: number;
      quote: string;
      sourceRevisionId: string;
    }[];
  };
  proposedWording: {
    text: string;
    status: 'pending';
    requirementIds: string[];
    explanation?: string;
  } | null;
  verification?: {
    text: string;
    details: string[];
    requirementIds: string[];
    explanation: string;
  } | null;
}
export interface DraftDocument {
  contractVersion: '1';
  kind: 'tailored_cv';
  pins: {
    sourceRevisionId: string;
    profileRevisionId: string;
    profileRevision: number;
    jobId: string;
    jobUpdatedAt: string;
  };
  sections: {
    id: string;
    kind: string;
    entries: { id: string; facts: DraftFact[] }[];
  }[];
  reviewIssues: {
    code: string;
    reason: string;
    factId?: string;
    requirementId?: string;
    sectionKind?: string;
  }[];
  recoverable: {
    unselectedFactIds: string[];
    structuralFactIds: string[];
    supersededFactIds: string[];
    sourceCoverage: {
      start: number;
      end: number;
      disposition: string;
      reason: string | null;
    }[];
  };
  review: {
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
  };
}
export interface SavedDraft {
  contractVersion: '1';
  id: string;
  jobId: string;
  revision: number;
  updatedAt: string;
  document: DraftDocument;
}
export type DraftOperation =
  | { action: 'edit'; factId: string; text: string }
  | { action: 'accept' | 'reject' | 'restore'; factId: string }
  | { action: 'acknowledge'; issueIndex: number }
  | { action: 'include'; factId: string; included: boolean };
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);
export function decodeDraft(value: unknown, jobId: string): SavedDraft {
  if (
    !object(value) ||
    value.contractVersion !== '1' ||
    typeof value.id !== 'string' ||
    value.jobId !== jobId ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    typeof value.updatedAt !== 'string' ||
    !object(value.document)
  )
    throw new Error('Invalid saved draft response. Your edits are retained.');
  const doc = value.document;
  if (
    doc.kind !== 'tailored_cv' ||
    doc.contractVersion !== '1' ||
    !object(doc.pins) ||
    doc.pins.jobId !== jobId ||
    !Array.isArray(doc.sections) ||
    !Array.isArray(doc.reviewIssues) ||
    !object(doc.review) ||
    doc.review.contractVersion !== '1' ||
    !object(doc.review.factReviews) ||
    !Array.isArray(doc.review.acknowledgedIssues) ||
    !object(doc.recoverable) ||
    typeof doc.pins.sourceRevisionId !== 'string' ||
    typeof doc.pins.profileRevisionId !== 'string' ||
    typeof doc.pins.jobUpdatedAt !== 'string' ||
    !Number.isSafeInteger(doc.pins.profileRevision) ||
    doc.sections.length > 16
  )
    throw new Error('Invalid saved draft document.');
  const issues = doc.reviewIssues;
  const ids = new Set<string>();
  for (const s of doc.sections) {
    if (
      !object(s) ||
      typeof s.id !== 'string' ||
      typeof s.kind !== 'string' ||
      !Array.isArray(s.entries)
    )
      throw new Error('Invalid draft section.');
    for (const e of s.entries) {
      if (!object(e) || !Array.isArray(e.facts))
        throw new Error('Invalid draft entry.');
      for (const f of e.facts) {
        if (
          !object(f) ||
          typeof f.id !== 'string' ||
          ids.has(f.id) ||
          typeof f.acceptedText !== 'string' ||
          typeof f.field !== 'string' ||
          !object(f.provenance) ||
          !Array.isArray(f.provenance.evidence) ||
          !object(doc.review.factReviews[f.id])
        )
          throw new Error('Invalid draft fact.');
        const state = doc.review.factReviews[f.id];
        if (
          !object(state) ||
          typeof state.reviewedText !== 'string' ||
          (state.exportIncluded !== undefined &&
            typeof state.exportIncluded !== 'boolean') ||
          !['reviewed_profile', 'user_edited', 'ai_accepted'].includes(
            state.wording as string,
          ) ||
          !['pending', 'accepted', 'rejected', 'none'].includes(
            state.proposal as string,
          ) ||
          !['source', 'user_entered'].includes(f.provenance.origin as string) ||
          typeof f.provenance.profileFactId !== 'string' ||
          f.provenance.evidence.some(
            (ref) =>
              !object(ref) ||
              typeof ref.quote !== 'string' ||
              !Number.isSafeInteger(ref.start) ||
              !Number.isSafeInteger(ref.end),
          ) ||
          (f.proposedWording !== null &&
            (!object(f.proposedWording) ||
              typeof f.proposedWording.text !== 'string' ||
              !Array.isArray(f.proposedWording.requirementIds) ||
              (f.proposedWording.explanation !== undefined &&
                typeof f.proposedWording.explanation !== 'string'))) ||
          (state.proposal === 'pending' && f.proposedWording === null)
        )
          throw new Error('Invalid draft review state.');
        ids.add(f.id);
      }
    }
  }
  if (
    ids.size > 96 ||
    Object.keys(doc.review.factReviews).length !== ids.size ||
    doc.reviewIssues.some(
      (issue) =>
        !object(issue) ||
        typeof issue.code !== 'string' ||
        typeof issue.reason !== 'string',
    ) ||
    doc.review.acknowledgedIssues.some(
      (i) =>
        !Number.isSafeInteger(i) ||
        (i as number) < 0 ||
        (i as number) >= issues.length,
    ) ||
    (doc.review.approval !== null &&
      (!object(doc.review.approval) ||
        doc.review.approval.revision !== value.revision ||
        typeof doc.review.approval.approvedAt !== 'string'))
  )
    throw new Error('Invalid saved draft review state.');
  return structuredClone(value) as unknown as SavedDraft;
}
export async function draftRequest(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`/api/v1/tailored-cv${path}`, {
    method: 'POST',
    cache: 'no-store',
    ...(body === undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contractVersion: '1' }),
        }
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contractVersion: '1', ...(body as object) }),
        }),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      object(value) && typeof value.errorCode === 'string'
        ? value.errorCode
        : '';
    const messages: Record<string, string> = {
      CV_DRAFT_CONTEXT_LIMIT:
        'This CV exceeds the local document budget. Shorten or split overly long fields in source review, then generate a separate draft. Your saved work is unchanged.',
      CV_DRAFT_INVALID_OUTPUT:
        'The AI returned an invalid proposal. Your existing drafts are unchanged. Retry generation.',
      CV_DRAFT_UNSUPPORTED_REFERENCE:
        'The AI referenced unsupported content. Your existing drafts are unchanged. Retry generation.',
      CV_DRAFT_UNAVAILABLE:
        'The AI service is unavailable. Check it (start Ollama if you run AI locally) and retry. Saved drafts can still be reviewed and downloaded.',
      CV_DRAFT_PROFILE_NOT_FOUND:
        'Review and save your source CV profile before generating a draft.',
      CV_DRAFT_SAVE_CONFLICT:
        'This draft changed in another window. Your edits are retained. Discard local edits and reload before retrying.',
      CV_DRAFT_PROFILE_INCOMPLETE:
        'Finish source CV review and resolve every ambiguous fact before generation.',
      CV_DRAFT_REVIEW_INCOMPLETE:
        'Decide every proposal, acknowledge issues and review all edited wording before approval.',
      CV_DRAFT_STALE_MATCH:
        'Reanalyze CV Match for the current source CV before generation.',
      CV_DRAFT_STALE_JOB: 'The job changed. Save it and reanalyze CV Match.',
      CV_DRAFT_STALE_PROFILE:
        'The pinned profile is unavailable or changed. Reload its source review.',
      CV_DRAFT_BUSY:
        'Draft generation is already running. Retry after it finishes.',
      CV_DRAFT_TIMEOUT: 'The AI timed out. Existing drafts are unchanged.',
    };
    throw new Error(
      messages[code] ??
        'The tailored CV request failed. Your saved work and local edits are retained. Retry when the local service is available.',
    );
  }
  return value;
}

export async function downloadDraft(
  id: string,
  expectedRevision: number,
  format: 'docx' | 'pdf',
  isCurrent: () => boolean = () => true,
) {
  const response = await fetch(`/api/v1/tailored-cv/drafts/${id}/export`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractVersion: '1', expectedRevision, format }),
  }).catch(() => {
    throw new Error(
      'Download failed. Your approved draft is unchanged; check the local API and retry.',
    );
  });
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    const code = object(value) ? value.errorCode : null;
    throw new Error(
      code === 'CV_EXPORT_UNSUPPORTED_TEXT'
        ? 'Some characters are unsupported by the export font. Review the CV wording and approve again.'
        : code === 'CV_EXPORT_EMPTY'
          ? 'Include at least one reviewed fact, save and approve again.'
          : response.status === 409
            ? 'The saved revision or approval changed. Reload, review and approve the saved draft before downloading.'
            : 'Download failed. Your approved draft is unchanged; check the local API and retry.',
    );
  }
  const mime =
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (response.headers.get('Content-Type')?.split(';')[0] !== mime)
    throw new Error(
      'The API did not return a valid CV file. Retry the download.',
    );
  const blob = await response.blob();
  if (!blob.size || blob.size > 10 * 1024 * 1024)
    throw new Error(
      'The returned CV file is empty or exceeds the download limit.',
    );
  const filename =
    response.headers
      .get('Content-Disposition')
      ?.match(/filename="(tailored-cv-[a-z0-9-]+\.(?:pdf|docx))"/u)?.[1] ??
    `tailored-cv-r${expectedRevision}.${format}`;
  if (!isCurrent()) return;
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Mirrors the API approval rule (tailored-draft.contract.ts): only conflicting
// source evidence blocks approval. Other issues stay recorded as notes.
export const CONFLICTING_SOURCE_REASON =
  'Conflicting source evidence requires review.';
export function issueBlocksApproval(issue: {
  code: string;
  reason: string;
}): boolean {
  return (
    issue.code === 'CV_DRAFT_UNSAFE_REWRITE' &&
    issue.reason === CONFLICTING_SOURCE_REASON
  );
}
