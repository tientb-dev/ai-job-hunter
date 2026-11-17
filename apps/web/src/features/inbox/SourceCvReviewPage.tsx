import { tr } from '../../app/i18n';
import { ArrowBackIcon, RefreshIcon } from '../../components/icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Paper, Skeleton, Stack } from '@mui/material';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { opportunityRequest } from './opportunities-api';
import { SourceCvReview } from './SourceCvReview';
import { UnsavedJobGuard } from './UnsavedJobGuard';
import type { SavedCv } from './useCvMatch';

type Load = 'loading' | 'error' | 'missing' | SavedCv;

// Only this app's own job Match tab is a valid return target.
const JOB_MATCH =
  /^\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/match$/iu;

/**
 * Review of one saved CV (`/cv/:cvId/review`), opened from My CV or from a
 * job's Match tab (`?returnTo=/jobs/:id/match`). Completing it returns there;
 * CV Match is never started automatically.
 */
export function SourceCvReviewPage() {
  const { cvId = '' } = useParams();
  const [search] = useSearchParams();
  const requested = search.get('returnTo') ?? '';
  const jobReturn = JOB_MATCH.test(requested) ? requested : null;
  const back = jobReturn ?? '/cv';
  const navigate = useNavigate();
  const [completed, setCompleted] = useState(false);
  const [load, setLoad] = useState<Load>('loading');
  const [attempt, setAttempt] = useState(0);
  const [dirty, setDirty] = useState(false);
  const saved = useRef(false);
  useEffect(() => {
    let active = true;
    opportunityRequest<SavedCv[]>('/cv').then(
      (rows) => {
        if (active)
          setLoad((rows ?? []).find((row) => row.id === cvId) ?? 'missing');
      },
      () => active && setLoad('error'),
    );
    return () => {
      active = false;
    };
  }, [cvId, attempt]);
  const cv = typeof load === 'object' ? load : null;
  // Leave only once the completed review reports clean, so the guard stays quiet.
  useEffect(() => {
    if (completed && !dirty) {
      saved.current = true;
      navigate(back);
    }
  }, [completed, dirty, back, navigate]);
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {/* Leaving with unsaved review edits asks to stay or discard. */}
      <UnsavedJobGuard
        dirty={false}
        sourceCvDirty={dirty}
        savedNavigation={saved}
      />
      <Button
        component={Link}
        to={back}
        startIcon={<ArrowBackIcon />}
        sx={{ alignSelf: 'flex-start' }}
      >
        {jobReturn ? tr('Back to job') : tr('Back to My CV')}
      </Button>
      <PageHeader
        title={cv ? tr('Review: {name}', { name: cv.name }) : tr('Review CV')}
        description={
          jobReturn
            ? tr(
                'Review is required once per CV before CV Match. Your progress is saved as you go; completing it returns you to the job, where you start CV Match.',
              )
            : tr(
                'Review is required once per CV before CV Match and Tailored CV. Your progress is saved as you go.',
              )
        }
      />
      {load === 'loading' && (
        <Skeleton
          variant="rounded"
          height={320}
          aria-label={tr('Loading your CV')}
        />
      )}
      {load === 'error' && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={() => {
                setLoad('loading');
                setAttempt((n) => n + 1);
              }}
            >
              {tr('Retry')}
            </Button>
          }
        >
          {tr('Could not load your saved CV. Check the local API.')}
        </Alert>
      )}
      {load === 'missing' && (
        <Alert severity="warning">
          {tr('This CV no longer exists. Go back to My CV to choose another.')}
        </Alert>
      )}
      {cv && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <SourceCvReview
            key={cv.id}
            myCv
            page
            autoOpen
            cv={cv}
            disabled={false}
            onDirtyChange={setDirty}
            onBusyChange={() => {}}
            onContinue={() => setCompleted(true)}
          />
        </Paper>
      )}
    </Stack>
  );
}
