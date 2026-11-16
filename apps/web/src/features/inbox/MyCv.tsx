import { dateLocale, tr } from '../../app/i18n';
import {
  DeleteIcon,
  EditIcon,
  RefreshIcon,
  UploadIcon,
} from '../../components/icons';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  MenuItem,
  Paper,
  TextField,
  Skeleton,
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

// null: no review saved yet.
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
  const [cvs, setCvs] = useState<SavedCv[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState(false);
  const cv =
    cvs.find((row) => row.id === selectedId) ??
    cvs.find((row) => row.isDefault) ??
    null;
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // undefined while loading; 'error' must never read as "not reviewed".
  const [progress, setProgress] = useState<Progress | 'error'>();
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const saved = useRef(false);
  useEffect(() => {
    let active = true;
    opportunityRequest<SavedCv[]>('/cv').then(
      (rows) => {
        if (!active) return;
        setCvs(rows ?? []);
        setLoaded(true);
      },
      () => {
        if (!active) return;
        setLoaded(true);
        setError(tr('Could not load your saved CV. Check the local API.'));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  const refreshProgress = useCallback(() => {
    if (!cv) return;
    readProgress(cv).then(setProgress, () => setProgress('error'));
  }, [cv]);
  useEffect(refreshProgress, [refreshProgress]);
  async function upload(file: File) {
    setUploading(true);
    setError('');
    try {
      // Adds a CV; existing CVs, job selections and the default are unchanged.
      const next = await opportunityRequest<SavedCv>('/cv', {
        method: 'POST',
        body: importUpload({}, file),
      });
      setProgress(undefined);
      setCvs((rows) => [...rows, next]);
      setSelectedId(next.id);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : tr('CV upload failed.'),
      );
    } finally {
      setUploading(false);
    }
  }
  async function manage(init: RequestInit) {
    if (!cv) return;
    setManaging(true);
    setError('');
    try {
      setCvs(await opportunityRequest<SavedCv[]>(`/cv/${cv.id}`, init));
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? tr(failure.message)
          : tr('Could not update this CV.'),
      );
      return false;
    } finally {
      setManaging(false);
    }
  }
  const locked = uploading || reviewBusy || reviewDirty || managing;
  const reviewed =
    typeof progress === 'object' &&
    progress !== null &&
    progress.total > 0 &&
    progress.reviewed === progress.total;
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <UnsavedJobGuard
        dirty={false}
        sourceCvDirty={reviewDirty}
        savedNavigation={saved}
      />
      <PageHeader
        title={tr('My CV')}
        description={tr(
          'Keep several CVs. New jobs use the default CV; each job can choose its own on the job page. Tailored CVs are built from the reviewed version.',
        )}
      />
      <Paper
        component="section"
        variant="outlined"
        aria-labelledby="saved-cv-title"
        sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}
      >
        <Stack spacing={1.5}>
          <Typography id="saved-cv-title" variant="h6" component="h2">
            {tr('Source CV')}
          </Typography>
          {!loaded ? (
            // Reserves the file, date, status, button and note rows of a saved CV.
            <Stack
              spacing={1.5}
              role="status"
              aria-label={tr('Loading your CV')}
            >
              <Box>
                <Skeleton width="45%" />
                <Skeleton
                  variant="text"
                  width="35%"
                  sx={{ fontSize: '0.875rem' }}
                />
                <Skeleton
                  variant="text"
                  width="30%"
                  sx={{ fontSize: '0.875rem', mt: 0.5 }}
                />
              </Box>
              <Skeleton
                variant="rounded"
                sx={{
                  height: { xs: 44, sm: 36 },
                  width: { xs: '100%', sm: 170 },
                }}
              />
              {/* The replace note wraps to two lines on phones. */}
              <Typography variant="body2" component="div">
                <Skeleton width="90%" />
                <Skeleton width="30%" sx={{ display: { sm: 'none' } }} />
              </Typography>
            </Stack>
          ) : cv ? (
            <Box sx={{ overflowWrap: 'anywhere' }}>
              {cvs.length > 1 && (
                <TextField
                  select
                  size="small"
                  label={tr('CV')}
                  value={cv.id}
                  disabled={locked}
                  onChange={(event) => {
                    setProgress(undefined);
                    setRenaming(null);
                    setSelectedId(event.target.value);
                  }}
                  sx={{ mb: 1.5, width: { xs: '100%', sm: 360 } }}
                >
                  {cvs.map((row) => (
                    <MenuItem
                      key={row.id}
                      value={row.id}
                      sx={{ whiteSpace: 'normal' }}
                    >
                      {row.isDefault
                        ? tr('{name} (default)', { name: row.name })
                        : row.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {renaming === null ? (
                <Typography sx={{ fontWeight: 600 }}>
                  {cv.name}
                  {cv.isDefault && ` · ${tr('Default')}`}
                </Typography>
              ) : (
                <Stack
                  component="form"
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void manage({
                      method: 'PATCH',
                      body: JSON.stringify({ name: renaming }),
                    }).then((done) => done && setRenaming(null));
                  }}
                >
                  <TextField
                    size="small"
                    label={tr('CV name')}
                    value={renaming}
                    autoFocus
                    slotProps={{ htmlInput: { maxLength: 120 } }}
                    onChange={(event) => setRenaming(event.target.value)}
                  />
                  <Button type="submit" disabled={managing || !renaming.trim()}>
                    {tr('Save')}
                  </Button>
                  <Button onClick={() => setRenaming(null)}>
                    {tr('Cancel')}
                  </Button>
                </Stack>
              )}
              <Typography variant="body2" color="text.secondary">
                {cv.fileName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tr('Saved')}{' '}
                {new Date(cv.updatedAt).toLocaleString(dateLocale())}
              </Typography>
              <Typography
                variant="body2"
                role="status"
                component="div"
                sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}
              >
                {progress === undefined ? (
                  <Skeleton
                    width={170}
                    aria-label={tr('Loading review status')}
                  />
                ) : progress === 'error' ? (
                  <>
                    {tr('Review status unavailable.')}
                    <Button
                      startIcon={<RefreshIcon />}
                      size="small"
                      onClick={() => {
                        setProgress(undefined);
                        refreshProgress();
                      }}
                    >
                      {tr('Retry')}
                    </Button>
                  </>
                ) : !progress ? (
                  tr('Not reviewed yet')
                ) : reviewed ? (
                  tr('Reviewed · {total} of {total} sections', {
                    total: progress.total,
                  })
                ) : (
                  tr('{reviewed} of {total} sections reviewed', {
                    reviewed: progress.reviewed,
                    total: progress.total,
                  })
                )}
              </Typography>
            </Box>
          ) : (
            <Typography>
              {tr(
                'No CV saved yet. Save a PDF or DOCX to review it and tailor it for jobs.',
              )}
            </Typography>
          )}
          {cv && (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              {!cv.isDefault && (
                <Button
                  size="small"
                  disabled={locked}
                  onClick={() =>
                    void manage({
                      method: 'PATCH',
                      body: JSON.stringify({ isDefault: true }),
                    })
                  }
                >
                  {tr('Make default')}
                </Button>
              )}
              <Button
                size="small"
                startIcon={<EditIcon />}
                disabled={locked || renaming !== null}
                onClick={() => setRenaming(cv.name)}
              >
                {tr('Rename')}
              </Button>
              {!cv.isDefault && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  disabled={locked}
                  onClick={() => setConfirmDelete(true)}
                >
                  {tr('Delete')}
                </Button>
              )}
            </Stack>
          )}
          {loaded && (
            <Button
              startIcon={<UploadIcon />}
              component="label"
              variant={cv ? 'outlined' : 'contained'}
              disabled={locked}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
            >
              {cv ? tr('Upload another CV') : tr('Save source CV')}
              <input
                hidden
                type="file"
                accept=".pdf,.docx"
                aria-label={cv ? tr('Upload another CV') : tr('Save source CV')}
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
              {tr(
                'Save or discard your review changes before switching or adding a CV.',
              )}
            </Typography>
          )}
          {uploading && (
            <Typography role="status">
              {tr('Saving your CV locally…')}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {cv && (
            <Typography variant="body2" color="text.secondary">
              {tr(
                'Adding a CV or changing the default never changes other jobs or tailored CVs you already saved.',
              )}
            </Typography>
          )}
        </Stack>
      </Paper>
      <ConfirmDialog
        open={confirmDelete}
        title={tr('Delete this CV?')}
        text={tr(
          'Jobs that use this CV keep it; deleting is only possible once no job uses it. Tailored CVs already saved are not affected.',
        )}
        safeLabel={tr('Cancel')}
        confirmLabel={tr('Delete')}
        destructive
        onSafe={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void manage({ method: 'DELETE' });
        }}
      />
      {cv && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <SourceCvReview
            key={cv.id}
            myCv
            wizardEntry={!reviewed}
            entryState={
              progress === undefined
                ? 'loading'
                : progress === 'error'
                  ? 'unknown'
                  : undefined
            }
            cv={cv}
            disabled={uploading}
            onDirtyChange={setReviewDirty}
            onBusyChange={setReviewBusy}
            onSaved={refreshProgress}
          />
        </Paper>
      )}
      <Typography variant="body2" color="text.secondary">
        {tr('Need a one-off check against a job description?')}{' '}
        <MuiLink component={Link} to="/cv/analyze">
          {tr('Quick CV and job analysis')}
        </MuiLink>
      </Typography>
    </Stack>
  );
}
