import { useEffect, useRef, useState } from 'react';
import { draftRequest } from './tailored-cv.contract';
import { Box, Paper } from '@mui/material';
import { CvSuggestionsSection } from './CvSuggestionsSection';
import { CvMatchSection, type MatchInspection } from './CvMatchSection';
import { TailoredCvWorkflow } from './TailoredCvWorkflow';
import { useCvMatch } from './useCvMatch';

interface CvMatchPanelProps {
  wizard?: boolean;
  jobId: string;
  revision: string;
  jobUpdatedAt?: string;
  view?: 'match' | 'improve' | 'hidden';
  jobDirty?: boolean;
  onGoToMatch?: () => void;
  onReviewDirtyChange?: (dirty: boolean) => void;
  onSummary?: (summary: MatchPanelSummary) => void;
  /** Changing it re-reads the summary's draft and source state. */
  summaryRefresh?: number;
}
export interface MatchPanelSummary {
  matchStatus: string;
  score: number | null;
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

/**
 * Entry point kept for existing routes: Job Detail tabs (CV Match / Improve CV)
 * or, with `wizard`, the Tailored CV workspace. Both read the same saved match.
 */
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

/**
 * Job workspace Match tab: assessment plus P7 gaps-and-advice suggestions.
 * `improve` shows the suggestions alone (embedded/legacy use).
 */
function JobMatchPanel({
  jobId,
  revision,
  jobUpdatedAt,
  view = 'match',
  jobDirty = false,
  onGoToMatch,
  onSummary,
  summaryRefresh = 0,
}: Omit<CvMatchPanelProps, 'wizard'>) {
  const match = useCvMatch(jobId, revision, jobUpdatedAt);
  const { busy, result, cv, attempt, contextRejected, rejectContext } = match;
  const inspection = useRef<MatchInspection>(null);
  const [suggesting, setSuggesting] = useState(false);
  // Loaded once per job for the workspace tab badge; no review state is implied.
  const latestDraft = useLatestDraft(jobId, Boolean(onSummary), summaryRefresh);
  const sourceReason = useSourceReason(
    jobId,
    jobUpdatedAt,
    cv?.updatedAt,
    Boolean(onSummary) && latestDraft === null,
    summaryRefresh,
  );
  const score = result?.score ?? null;
  const cvSaved = match.cvLoaded ? Boolean(cv) : null;
  useEffect(() => {
    onSummary?.({
      matchStatus: match.matchStatus,
      score,
      draft: latestDraft,
      cvSaved,
      sourceReason,
    });
  }, [onSummary, match.matchStatus, score, latestDraft, cvSaved, sourceReason]);
  const [source, setSource] = useState({ jobId, revision });
  if (source.jobId !== jobId || source.revision !== revision) {
    setSource({ jobId, revision });
    setSuggesting(false);
  }
  return (
    <>
      <CvMatchSection
        match={match}
        labelledBy="job-tab-1"
        hidden={view !== 'match'}
        inspection={inspection}
        analyzeBlocked={suggesting}
        uploadBlocked={suggesting}
      />
      <Box
        component="section"
        aria-label="Gaps and advice"
        hidden={view === 'hidden'}
        sx={{ mt: 3 }}
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <CvSuggestionsSection
            key={`${result?.matchId ?? 'none'}:${attempt}:${contextRejected}`}
            result={result}
            jobId={jobId}
            disabled={busy}
            cvSaved={!!cv}
            jobDirty={jobDirty}
            // The hook rejects context for every non-valid status; a match that
            // never existed (or has no CV) is "not analyzed", not outdated.
            rejected={
              contextRejected &&
              !['MISSING', 'CV_UNAVAILABLE'].includes(match.matchStatus)
            }
            onBusyChange={setSuggesting}
            onGoToMatch={() => onGoToMatch?.()}
            onInvalidContext={rejectContext}
            onInspect={(parentId) => {
              if (inspection.current?.inspect(parentId)) onGoToMatch?.();
            }}
          />
        </Paper>
      </Box>
    </>
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
