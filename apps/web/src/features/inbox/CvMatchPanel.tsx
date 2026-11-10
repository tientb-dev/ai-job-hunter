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
}
export interface MatchPanelSummary {
  matchStatus: string;
  score: number | null;
  draft: { revision: number; jobUpdatedAt: string } | null;
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
}: Omit<CvMatchPanelProps, 'wizard'>) {
  const match = useCvMatch(jobId, revision, jobUpdatedAt);
  const { busy, result, cv, attempt, contextRejected, rejectContext } = match;
  const inspection = useRef<MatchInspection>(null);
  const [suggesting, setSuggesting] = useState(false);
  // Loaded once per job for the workspace tab badge; no review state is implied.
  const latestDraft = useLatestDraft(jobId, Boolean(onSummary));
  const score = result?.score ?? null;
  useEffect(() => {
    onSummary?.({ matchStatus: match.matchStatus, score, draft: latestDraft });
  }, [onSummary, match.matchStatus, score, latestDraft]);
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
function useLatestDraft(jobId: string, enabled: boolean) {
  const [latest, setLatest] = useState<{
    revision: number;
    jobUpdatedAt: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    draftRequest(`/jobs/${jobId}/drafts/list`, { before: null }).then(
      (value) => {
        const item = (value as { items?: unknown[] } | null)?.items?.[0] as
          { revision?: unknown; jobUpdatedAt?: unknown } | undefined;
        if (
          active &&
          item &&
          Number.isSafeInteger(item.revision) &&
          typeof item.jobUpdatedAt === 'string'
        )
          setLatest({
            revision: item.revision as number,
            jobUpdatedAt: item.jobUpdatedAt,
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
