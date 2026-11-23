import { useEffect, useState } from 'react';
import { draftRequest } from './tailored-cv.contract';
import { CvMatchSection } from './CvMatchSection';
import { TailoredCvWorkflow } from './TailoredCvWorkflow';
import { useCvMatch } from './useCvMatch';

interface CvMatchPanelProps {
  wizard?: boolean;
  jobId: string;
  revision: string;
  jobUpdatedAt?: string;
  view?: 'match' | 'hidden';
  jobDirty?: boolean;
  onGoToTailored?: () => void;
  onReviewDirtyChange?: (dirty: boolean) => void;
  onSummary?: (summary: MatchPanelSummary) => void;
  /** Changing it re-reads the summary's draft and source state. */
  summaryRefresh?: number;
  /** Called after this panel changes the job's CV or match on the server. */
  onSourceChange?: () => void;
}
export interface MatchPanelSummary {
  matchStatus: string;
  /** undefined while loading; null when the job has no draft. */
  draft: LatestDraft | null | undefined;
  /** null while loading. */
  cvSaved: boolean | null;
  /** Read-only source review readiness reason; undefined while unknown. */
  sourceReason: string | null | undefined;
}
interface LatestDraft {
  revision: number;
  jobUpdatedAt: string;
  pending: number;
  approved: boolean;
}

export function CvMatchPanel({ wizard = false, ...props }: CvMatchPanelProps) {
  return wizard ? (
    <TailoredCvWorkflow
      jobId={props.jobId}
      revision={props.revision}
      jobUpdatedAt={props.jobUpdatedAt}
      jobDirty={props.jobDirty}
      onReviewDirtyChange={props.onReviewDirtyChange}
    />
  ) : (
    <JobMatchPanel {...props} />
  );
}

function JobMatchPanel({
  jobId,
  revision,
  jobUpdatedAt,
  view = 'match',
  onGoToTailored,
  onSummary,
  summaryRefresh = 0,
  onSourceChange,
}: Omit<CvMatchPanelProps, 'wizard'>) {
  const loaded = useCvMatch(jobId, revision, jobUpdatedAt);
  // A kept-mounted Tailored CV reads its own copy, so report server changes.
  const match = {
    ...loaded,
    select: async (cvId: string) => {
      await loaded.select(cvId);
      onSourceChange?.();
    },
    upload: async (file: File) => {
      const added = await loaded.upload(file);
      if (added) onSourceChange?.();
      return added;
    },
    analyze: async () => {
      await loaded.analyze();
      onSourceChange?.();
    },
  };
  const { cv } = match;
  // Loaded once per job for the workspace tab badge; no review state is implied.
  const latestDraft = useLatestDraft(jobId, Boolean(onSummary), summaryRefresh);
  const sourceReason = useSourceReason(
    jobId,
    jobUpdatedAt,
    cv?.updatedAt,
    Boolean(onSummary) && latestDraft === null,
    summaryRefresh,
  );
  const cvSaved = match.cvLoaded ? Boolean(cv) : null;
  useEffect(() => {
    onSummary?.({
      matchStatus: match.matchStatus,
      draft: latestDraft,
      cvSaved,
      sourceReason,
    });
  }, [onSummary, match.matchStatus, latestDraft, cvSaved, sourceReason]);
  return (
    <CvMatchSection
      match={match}
      labelledBy="job-tab-1"
      hidden={view !== 'match'}
      onGoToTailored={onGoToTailored}
    />
  );
}

/** Read-only lookup of the newest saved draft, used only for the tab badge. */
// Read-only: the latest draft's review state, for the job workspace summary.
function useLatestDraft(jobId: string, enabled: boolean, refresh: number) {
  const [latest, setLatest] = useState<LatestDraft | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const value = (await draftRequest(`/jobs/${jobId}/drafts/list`, {
        before: null,
      })) as { items?: unknown[] } | null;
      const item = value?.items?.[0] as
        | { id?: unknown; revision?: unknown; jobUpdatedAt?: unknown }
        | undefined;
      if (!item) return null;
      if (
        typeof item.id !== 'string' ||
        !Number.isSafeInteger(item.revision) ||
        typeof item.jobUpdatedAt !== 'string'
      )
        throw Error();
      const draft = (await draftRequest(`/drafts/${item.id}`)) as {
        revision?: unknown;
        document?: {
          review?: {
            factReviews?: Record<string, { proposal?: unknown }>;
            approval?: { revision?: unknown } | null;
          };
        };
      } | null;
      const review = draft?.document?.review;
      if (!review?.factReviews) throw Error();
      return {
        revision: item.revision as number,
        jobUpdatedAt: item.jobUpdatedAt,
        pending: Object.values(review.factReviews).filter(
          (s) => s.proposal === 'pending',
        ).length,
        approved:
          review.approval?.revision !== undefined &&
          review.approval.revision === draft?.revision,
      };
    })().then(
      (value) => {
        if (active) setLatest(value);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [jobId, enabled, refresh]);
  return latest;
}

// Read-only readiness without a match reports only source review state.
function useSourceReason(
  jobId: string,
  jobUpdatedAt: string | undefined,
  cvUpdatedAt: string | undefined,
  enabled: boolean,
  refresh: number,
) {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !jobUpdatedAt || !cvUpdatedAt) return;
    let active = true;
    draftRequest(`/jobs/${jobId}/drafts/readiness`, {
      expectedJobUpdatedAt: jobUpdatedAt,
      expectedSavedCvUpdatedAt: cvUpdatedAt,
      matchId: null,
    }).then(
      (value) => {
        const next = (value as { reason?: unknown } | null)?.reason;
        if (active) setReason(typeof next === 'string' ? next : null);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [jobId, jobUpdatedAt, cvUpdatedAt, enabled, refresh]);
  return reason;
}
