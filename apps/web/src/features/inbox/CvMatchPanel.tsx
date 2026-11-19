import { tr } from '../../app/i18n';
import { useEffect, useState } from 'react';
import { draftRequest } from './tailored-cv.contract';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { CvMatchSection } from './CvMatchSection';
import { TailoredCvWorkflow } from './TailoredCvWorkflow';
import { Link, useInRouterContext } from 'react-router-dom';
import { CvSuggestionsSection } from './CvSuggestionsSection';
import { reviewHref, useCvMatch } from './useCvMatch';

interface CvMatchPanelProps {
  wizard?: boolean;
  jobId: string;
  revision: string;
  jobUpdatedAt?: string;
  view?: 'match' | 'improve' | 'hidden';
  jobDirty?: boolean;
  onGoToMatch?: () => void;
  onGoToImprove?: () => void;
  onReviewDirtyChange?: (dirty: boolean) => void;
  onSummary?: (summary: MatchPanelSummary) => void;
  /** Changing it re-reads the summary's draft and source state. */
  summaryRefresh?: number;
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

function JobMatchPanel({
  jobId,
  revision,
  jobUpdatedAt,
  view = 'match',
  jobDirty = false,
  onGoToMatch,
  onGoToImprove,
  onSummary,
  summaryRefresh = 0,
}: Omit<CvMatchPanelProps, 'wizard'>) {
  const match = useCvMatch(jobId, revision, jobUpdatedAt);
  const { cv, busy, result, attempt, contextRejected, rejectContext } = match;
  const [suggesting, setSuggesting] = useState(false);
  const [inspected, setInspected] = useState<{
    parentId: string;
    matchId?: string;
  }>();
  const routing = useInRouterContext();
  const requirement =
    inspected && result?.matchId === inspected.matchId
      ? result?.requirements.find(
          ({ parentId }) => parentId === inspected.parentId,
        )
      : undefined;
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
    <>
      <CvMatchSection
        match={match}
        labelledBy="job-tab-1"
        hidden={view !== 'match'}
        analyzeBlocked={suggesting}
        uploadBlocked={suggesting}
        onGoToImprove={onGoToImprove}
      />
      <Box
        role="tabpanel"
        id="job-panel-5"
        aria-labelledby="job-tab-5"
        hidden={view !== 'improve'}
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <Stack spacing={2}>
            <Typography component="h2" variant="h6">
              {tr('Review & Improve CV')}
            </Typography>
            {routing && cv && (
              <Button
                component={Link}
                to={reviewHref(cv.id, jobId)}
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
              >
                {tr('Review CV')}
              </Button>
            )}
            <CvSuggestionsSection
              key={`${result?.matchId ?? 'none'}:${attempt}:${contextRejected}`}
              result={result}
              jobId={jobId}
              disabled={busy}
              cvSaved={!!cv}
              jobDirty={jobDirty}
              rejected={
                contextRejected &&
                !['MISSING', 'CV_UNAVAILABLE', 'CV_REVIEW_REQUIRED'].includes(
                  match.matchStatus,
                )
              }
              reviewRequired={match.matchStatus === 'CV_REVIEW_REQUIRED'}
              onBusyChange={setSuggesting}
              onGoToMatch={() => onGoToMatch?.()}
              onInvalidContext={rejectContext}
              onInspect={(parentId) =>
                setInspected({ parentId, matchId: result?.matchId })
              }
            />
            <Dialog
              open={
                view === 'improve' && Boolean(requirement) && !contextRejected
              }
              onClose={() => setInspected(undefined)}
              aria-labelledby="cv-suggestion-evidence-title"
            >
              <DialogTitle id="cv-suggestion-evidence-title">
                {tr('Requirement evidence')}
              </DialogTitle>
              {requirement && (
                <DialogContent sx={{ overflowWrap: 'anywhere' }}>
                  <Typography variant="subtitle2">
                    {tr('Job description')}
                  </Typography>
                  <Typography variant="body2">{requirement.jdQuote}</Typography>
                  {requirement.cvQuote && (
                    <>
                      <Typography variant="subtitle2" sx={{ mt: 1 }}>
                        {tr('CV evidence')}
                      </Typography>
                      <Typography variant="body2">
                        {requirement.cvQuote}
                      </Typography>
                    </>
                  )}
                </DialogContent>
              )}
              <DialogActions>
                <Button autoFocus onClick={() => setInspected(undefined)}>
                  {tr('Close')}
                </Button>
              </DialogActions>
            </Dialog>
          </Stack>
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
