import { useEffect, useRef, useState } from 'react';
import { draftRequest } from './tailored-cv.contract';
import { Link, useInRouterContext } from 'react-router-dom';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
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

/** Job Detail: CV Match assessment and Improve CV (P7 suggestions) tabs. */
function JobMatchPanel({
  jobId,
  revision,
  jobUpdatedAt,
  view = 'match',
  jobDirty = false,
  onGoToMatch,
}: Omit<CvMatchPanelProps, 'wizard'>) {
  const routing = useInRouterContext();
  const match = useCvMatch(jobId, revision, jobUpdatedAt);
  const { busy, result, cv, attempt, contextRejected, rejectContext } = match;
  const inspection = useRef<MatchInspection>(null);
  const [suggesting, setSuggesting] = useState(false);
  const latestDraft = useLatestDraft(jobId, view === 'improve');
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
        role="tabpanel"
        id="job-panel-2"
        aria-labelledby="job-tab-2"
        hidden={view !== 'improve'}
      >
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <Stack spacing={2} sx={{ mb: 3 }}>
            <Typography variant="h6" component="h2">
              Tailored CV
            </Typography>
            <Typography>
              Build a version of your CV for this job from facts you have
              reviewed. You approve every change before downloading.
            </Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
              <Typography component="li" variant="body2">
                CV Match: {matchSummary(match.matchStatus)}
              </Typography>
              {latestDraft && (
                <Typography component="li" variant="body2">
                  Latest draft: revision {latestDraft.revision}, saved{' '}
                  {new Date(latestDraft.updatedAt).toLocaleString()}
                </Typography>
              )}
            </Stack>
            <Button
              sx={{ alignSelf: 'flex-start' }}
              component={routing ? Link : 'a'}
              {...(routing
                ? { to: `/jobs/${jobId}/tailored-cv` }
                : { href: `/jobs/${jobId}/tailored-cv` })}
              variant="contained"
              disabled={jobDirty}
            >
              {latestDraft ? 'Continue tailored CV' : 'Start tailored CV'}
            </Button>
            {jobDirty && (
              <Alert severity="info">
                Save job changes in Edit JD before opening Tailored CV.
              </Alert>
            )}
          </Stack>
          <CvSuggestionsSection
            key={`${result?.matchId ?? 'none'}:${attempt}:${contextRejected}`}
            result={result}
            jobId={jobId}
            disabled={busy}
            cvSaved={!!cv}
            jobDirty={jobDirty}
            rejected={contextRejected}
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

function matchSummary(status: string) {
  return status === 'VALID'
    ? 'saved and current'
    : status === 'CHECKING'
      ? 'checking…'
      : ['STALE_CV', 'STALE_JOB', 'EXPIRED'].includes(status)
        ? 'out of date, reanalyze before tailoring'
        : status === 'CV_UNAVAILABLE'
          ? 'save a CV first'
          : 'not analyzed yet';
}

/** Read-only lookup of the newest saved draft, used only for the resume hint. */
function useLatestDraft(jobId: string, enabled: boolean) {
  const [latest, setLatest] = useState<{
    revision: number;
    updatedAt: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    draftRequest(`/jobs/${jobId}/drafts/list`, { before: null }).then(
      (value) => {
        const item = (value as { items?: unknown[] } | null)?.items?.[0] as
          { revision?: unknown; updatedAt?: unknown } | undefined;
        if (
          active &&
          item &&
          Number.isSafeInteger(item.revision) &&
          typeof item.updatedAt === 'string' &&
          Number.isFinite(Date.parse(item.updatedAt))
        )
          setLatest({
            revision: item.revision as number,
            updatedAt: item.updatedAt,
          });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [jobId, enabled]);
  return latest;
}
