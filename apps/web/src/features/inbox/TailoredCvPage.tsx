import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Button, Stack } from '@mui/material';
import { PageHeader } from '../../components/PageHeader';
import { CvMatchPanel } from './CvMatchPanel';
import { opportunityRequest, type Opportunity } from './opportunities-api';
import { UnsavedJobGuard } from './UnsavedJobGuard';

export function TailoredCvPage() {
  const { id } = useParams();
  const [job, setJob] = useState<Opportunity | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const savedNavigation = useRef(false);
  useEffect(() => {
    let active = true;
    opportunityRequest<Opportunity>(`/${id}`).then(
      (value) => {
        if (active) setJob(value);
      },
      () => {
        if (active)
          setError('Could not load this job. Return to Jobs and reopen it.');
      },
    );
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <Stack spacing={3}>
      <UnsavedJobGuard
        dirty={false}
        sourceCvDirty={dirty}
        savedNavigation={savedNavigation}
      />
      <PageHeader
        title="Tailored CV"
        description="Use your saved reviews and drafts. Save edits explicitly before leaving."
      />
      <Button
        component={Link}
        to={`/jobs/${id}?tab=improve`}
        sx={{ alignSelf: 'flex-start' }}
      >
        Back to job
      </Button>
      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : job ? (
        <CvMatchPanel
          key={job.id}
          jobId={job.id}
          revision={job.updatedAt}
          jobUpdatedAt={job.updatedAt}
          view="improve"
          wizard
          onReviewDirtyChange={setDirty}
        />
      ) : (
        <Alert severity="info" role="status">
          Loading saved job…
        </Alert>
      )}
    </Stack>
  );
}
