export interface DraftPins {
  profileRevisionId: string;
  expectedProfileRevision: number;
  expectedJobUpdatedAt: string;
  matchId: string;
  sourceRevisionId: string;
}
export interface DraftReadiness {
  contractVersion: '1';
  ready: boolean;
  reason: string | null;
  pins: DraftPins | null;
  matchValidForMs: number;
  /** Latest reviewed source profile for the current CV, when known. */
  currentProfileRevisionId?: string | null;
}
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function decodeReadiness(value: unknown): DraftReadiness {
  if (
    !object(value) ||
    value.contractVersion !== '1' ||
    typeof value.ready !== 'boolean' ||
    !Number.isFinite(value.matchValidForMs) ||
    Number(value.matchValidForMs) < 0 ||
    Number(value.matchValidForMs) > 900000 ||
    (value.currentProfileRevisionId != null &&
      !uuid(value.currentProfileRevisionId))
  )
    throw Error('Invalid draft readiness response. Retry checking readiness.');
  if (value.ready) {
    const p = value.pins;
    if (
      value.reason !== null ||
      !object(p) ||
      !uuid(p.profileRevisionId) ||
      !uuid(p.sourceRevisionId) ||
      !uuid(p.matchId) ||
      !Number.isSafeInteger(p.expectedProfileRevision) ||
      Number(p.expectedProfileRevision) < 1 ||
      typeof p.expectedJobUpdatedAt !== 'string' ||
      !Number.isFinite(Date.parse(p.expectedJobUpdatedAt)) ||
      new Date(p.expectedJobUpdatedAt).toISOString() !==
        p.expectedJobUpdatedAt ||
      Number(value.matchValidForMs) <= 0
    )
      throw Error('Invalid draft readiness pins. Retry checking readiness.');
  } else if (
    typeof value.reason !== 'string' ||
    !Object.hasOwn(readinessReasons, value.reason) ||
    value.pins !== null ||
    value.matchValidForMs !== 0
  )
    throw Error('Invalid draft readiness reason. Retry checking readiness.');
  return value as unknown as DraftReadiness;
}
export const readinessReasons: Record<
  string,
  { text: string; action: 'match' | 'review' | 'reload' | 'check' | 'none' }
> = {
  CV_DRAFT_CONTEXT_LIMIT: {
    text: 'The reviewed CV exceeds the local draft generation budget. Your review is preserved; use a more concise source for generation.',
    action: 'none',
  },
  CV_DRAFT_CV_UNAVAILABLE: {
    text: 'No saved CV is available. Upload a CV in CV Match.',
    action: 'none',
  },
  CV_DRAFT_STALE_CV: {
    text: 'Saved CV details changed. Reload this job to use the current CV; saved reviews remain available.',
    action: 'reload',
  },
  CV_DRAFT_PROFILE_NOT_FOUND: {
    text: 'Open Source CV Review and save a reviewed profile for the current CV.',
    action: 'review',
  },
  CV_DRAFT_PROFILE_INCOMPLETE: {
    text: 'Finish and save Source CV Review, including highlighted details and unassigned content.',
    action: 'review',
  },
  CV_DRAFT_STALE_PROFILE: {
    text: 'The reviewed profile changed. Check readiness again to use its latest saved revision.',
    action: 'check',
  },
  CV_DRAFT_STALE_JOB: {
    text: 'The saved job changed. Reload the job, then refresh CV Match. Your source review is preserved.',
    action: 'reload',
  },
  CV_DRAFT_JOB_REQUIREMENTS_REQUIRED: {
    text: 'Add job requirements in Edit JD, save the job, then refresh CV Match. Your source review is preserved.',
    action: 'none',
  },
  CV_DRAFT_JOB_NOT_FOUND: {
    text: 'This saved job is unavailable. Reopen it from Jobs.',
    action: 'none',
  },
  CV_DRAFT_MATCH_REQUIRED: {
    text: 'Analyze CV Match for this saved CV and job. Your completed source review will be reused.',
    action: 'match',
  },
  CV_DRAFT_STALE_MATCH: {
    text: 'CV Match expired, was replaced, or belongs to different CV/job revisions. Refresh it here; no upload or source review is needed.',
    action: 'match',
  },
};
export function generationReadiness(input: {
  cv: boolean;
  jobRevision: boolean;
  disabled: boolean;
  dirty: boolean;
  checking: boolean;
  error: string;
  server: DraftReadiness | null;
  blockedReason?: string;
}) {
  if (input.dirty)
    return {
      ready: false,
      text: 'Save or discard draft edits before generating a separate draft.',
      action: 'none' as const,
    };
  if (input.disabled)
    return {
      ready: false,
      text:
        input.blockedReason ??
        'Wait for the current operation or save pending source/job changes.',
      action: 'none' as const,
    };
  if (!input.cv)
    return { ready: false, ...readinessReasons.CV_DRAFT_CV_UNAVAILABLE! };
  if (!input.jobRevision)
    return {
      ready: false,
      text: 'Save or reload this job before generating a draft.',
      action: 'none' as const,
    };
  if (input.checking)
    return {
      ready: false,
      text: 'Checking draft generation readiness…',
      action: 'none' as const,
    };
  if (input.error)
    return { ready: false, text: input.error, action: 'check' as const };
  if (!input.server)
    return {
      ready: false,
      text: 'Check draft generation readiness.',
      action: 'check' as const,
    };
  if (!input.server.ready)
    return { ready: false, ...readinessReasons[input.server.reason!]! };
  return {
    ready: true,
    text: 'Ready to generate from your saved reviewed profile and fresh CV Match.',
    action: 'none' as const,
  };
}
