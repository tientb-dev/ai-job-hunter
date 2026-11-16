import { tr } from '../../app/i18n';
import { ArrowBackIcon, RefreshIcon } from '../../components/icons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Paper, Skeleton, Stack } from '@mui/material';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { opportunityRequest } from './opportunities-api';
import { SourceCvReview } from './SourceCvReview';
import { UnsavedJobGuard } from './UnsavedJobGuard';
import type { SavedCv } from './useCvMatch';

type Load = 'loading' | 'error' | 'missing' | SavedCv;

/** Review of one saved CV, opened from My CV (`/cv/:cvId/review`). */
export function SourceCvReviewPage() {
  const { cvId = '' } = useParams();
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
        to="/cv"
        startIcon={<ArrowBackIcon />}
        sx={{ alignSelf: 'flex-start' }}
      >
        {tr('Back to My CV')}
      </Button>
      <PageHeader
        title={cv ? tr('Review: {name}', { name: cv.name }) : tr('Review CV')}
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
          />
        </Paper>
      )}
    </Stack>
  );
}
