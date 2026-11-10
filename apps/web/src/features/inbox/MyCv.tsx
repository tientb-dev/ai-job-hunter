import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { importUpload, opportunityRequest } from './opportunities-api';
import { sourceCvRequest } from './source-cv-review.contract';
import { SourceCvReview } from './SourceCvReview';
import { UnsavedJobGuard } from './UnsavedJobGuard';
import type { SavedCv } from './useCvMatch';

type Progress = { reviewed: number; total: number } | null;

// Read-only summary of the saved review. Capture is idempotent for an
// unchanged saved CV and never creates a review profile.
async function readProgress(cv: SavedCv): Promise<Progress> {
  const source = await sourceCvRequest('/sources', {
    expectedSavedCvUpdatedAt: cv.updatedAt,
  });
  const id =
    source && typeof source === 'object' && 'id' in source
      ? String(source.id)
      : '';
  if (!/^[0-9a-f-]{36}$/iu.test(id)) return null;
  const profile = (await sourceCvRequest(`/sources/${id}/profile`)) as {
    document?: { sections?: { review?: string }[] };
  } | null;
  const sections = profile?.document?.sections;
  if (!Array.isArray(sections)) return null;
  return {
    reviewed: sections.filter((s) => s.review === 'confirmed').length,
    total: sections.length,
  };
}

export function MyCv() {
  const [cv, setCv] = useState<SavedCv | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Progress>(null);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const saved = useRef(false);
  useEffect(() => {
    let active = true;
    opportunityRequest<SavedCv | null>('/cv/current').then(
      (row) => {
        if (!active) return;
        setCv(row);
        setLoaded(true);
      },
      () => {
        if (!active) return;
        setLoaded(true);
        setError('Could not load your saved CV. Check the local API.');
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const refreshProgress = useCallback(() => {
    if (!cv) return;
    readProgress(cv).then(setProgress, () => setProgress(null));
  }, [cv]);
  useEffect(refreshProgress, [refreshProgress]);
  async function upload(file: File) {
    setUploading(true);
    setError('');
    try {
      const next = await opportunityRequest<SavedCv>('/cv/current', {
        method: 'POST',
        body: importUpload({}, file),
      });
      setProgress(null);
      setCv(next);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'CV upload failed.',
      );
    } finally {
      setUploading(false);
    }
  }
  const locked = uploading || reviewBusy || reviewDirty;
  const reviewed =
    progress && progress.total > 0 && progress.reviewed === progress.total;
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <UnsavedJobGuard
        dirty={false}
        sourceCvDirty={reviewDirty}
        savedNavigation={saved}
      />
      <PageHeader
        title="My CV"
        description="Every job uses this CV. Review it once; tailored CVs are built from the reviewed version."
      />
      <Paper
        component="section"
        variant="outlined"
        aria-labelledby="saved-cv-title"
        sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}
      >
        <Stack spacing={1.5}>
          <Typography id="saved-cv-title" variant="h6" component="h2">
            Source CV
          </Typography>
          {!loaded ? (
            <Typography role="status">Loading your CV…</Typography>
          ) : cv ? (
            <Box sx={{ overflowWrap: 'anywhere' }}>
              <Typography sx={{ fontWeight: 600 }}>{cv.fileName}</Typography>
              <Typography variant="body2" color="text.secondary">
                Saved {new Date(cv.updatedAt).toLocaleString()}
              </Typography>
              <Typography variant="body2" role="status" sx={{ mt: 0.5 }}>
                {!progress
                  ? 'Not reviewed yet'
                  : reviewed
                    ? `Reviewed · ${progress.total} of ${progress.total} sections`
                    : `${progress.reviewed} of ${progress.total} sections reviewed`}
              </Typography>
            </Box>
          ) : (
            <Typography>
              No CV saved yet. Save a PDF or DOCX to review it and tailor it for
              jobs.
            </Typography>
          )}
          {loaded && (
            <Button
              component="label"
              variant={cv ? 'outlined' : 'contained'}
              disabled={locked}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
            >
              {cv ? 'Replace source CV' : 'Save source CV'}
              <input
                hidden
                type="file"
                accept=".pdf,.docx"
                aria-label={cv ? 'Replace source CV' : 'Save source CV'}
                disabled={locked}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </Button>
          )}
          {cv && reviewDirty && (
            <Typography variant="body2" color="text.secondary">
              Save or discard your review changes before replacing the CV.
            </Typography>
          )}
          {uploading && (
            <Typography role="status">Saving your CV locally…</Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {cv && (
            <Typography variant="body2" color="text.secondary">
              Replacing the CV never changes tailored CVs you already saved.
            </Typography>
          )}
        </Stack>
      </Paper>
      {cv && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <SourceCvReview
            key={cv.updatedAt}
            myCv
            wizardEntry={!reviewed}
            cv={cv}
            disabled={uploading}
            onDirtyChange={setReviewDirty}
            onBusyChange={setReviewBusy}
            onSaved={refreshProgress}
          />
        </Paper>
      )}
      <Typography variant="body2" color="text.secondary">
        Need a one-off check against a job description?{' '}
        <MuiLink component={Link} to="/cv/analyze">
          Quick CV and job analysis
        </MuiLink>
      </Typography>
    </Stack>
  );
}
