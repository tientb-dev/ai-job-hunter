import { dateLocale, tr } from '../../app/i18n';
import {
  ArrowForwardIcon,
  CheckIcon,
  DeleteIcon,
  DescriptionIcon,
  DownloadIcon,
  EditIcon,
  UploadIcon,
  RefreshIcon,
  StarIcon,
  VisibilityIcon,
} from '../../components/icons';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useNotify } from '../../components/useNotify';
import { enter, surface } from '../../app/theme';
import { useEffect, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Skeleton,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { importUpload, opportunityRequest } from './opportunities-api';
import { canPreviewOriginal, cvUploadError } from './cv-file';
import { sourceCvRequest } from './source-cv-review.contract';
import type { SavedCv } from './useCvMatch';

/** Matches the API limit; uploads from individual jobs count too. */
export const MAX_CVS = 5;

// null: no review saved yet.
type Progress = { reviewed: number; total: number } | null;

// One read-only request for every CV's review progress; it never creates
// review records, so selecting a CV needs no further request.
async function readReviews(): Promise<Record<string, Progress>> {
  const value = (await sourceCvRequest('/saved-cv-reviews/list')) as {
    items?: { cvId: string; review: Progress }[];
  } | null;
  if (!Array.isArray(value?.items)) throw Error('Invalid review summaries.');
  return Object.fromEntries(value.items.map((i) => [i.cvId, i.review]));
}

function MoreIcon() {
  return (
    <SvgIcon sx={{ fontSize: 20 }}>
      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
    </SvgIcon>
  );
}

const fileFormat = (fileName: string) =>
  fileName.split('.').at(-1)?.toUpperCase() ?? '';
const fileSize = (bytes: number | null | undefined) =>
  bytes == null
    ? '—'
    : bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function CvChips({
  viewing,
  isDefault,
}: {
  viewing: boolean;
  isDefault: boolean;
}) {
  if (!viewing && !isDefault) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {viewing && (
        <Chip
          size="small"
          variant="outlined"
          icon={<CheckIcon />}
          label={tr('Viewing')}
        />
      )}
      {isDefault && <Chip size="small" color="primary" label={tr('Default')} />}
    </Stack>
  );
}

export function MyCv() {
  const notify = useNotify();
  const navigate = useNavigate();
  const [cvs, setCvs] = useState<SavedCv[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; cv: SavedCv }>();
  const [previewing, setPreviewing] = useState<SavedCv | null>(null);
  const cv =
    cvs.find((row) => row.id === selectedId) ??
    cvs.find((row) => row.isDefault) ??
    null;
  const defaultCv = cvs.find((row) => row.isDefault) ?? null;
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // undefined while loading; 'error' must never read as "not reviewed".
  const [reviews, setReviews] = useState<Record<string, Progress> | 'error'>();
  // A CV missing from the summaries was added after they loaded: not reviewed.
  const progress =
    reviews === undefined || reviews === 'error'
      ? reviews
      : cv
        ? (reviews[cv.id] ?? null)
        : undefined;
  // The panel renders once, with the CV list and every review status together.
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      opportunityRequest<SavedCv[]>('/cv'),
      readReviews(),
    ]).then(([list, summaries]) => {
      if (!active) return;
      if (list.status === 'fulfilled') setCvs(list.value ?? []);
      else setError(tr('Could not load your saved CV. Check the local API.'));
      setReviews(summaries.status === 'fulfilled' ? summaries.value : 'error');
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);
  function retryReviews() {
    setReviews(undefined);
    readReviews().then(setReviews, () => setReviews('error'));
  }
  function select(id: string) {
    if (id === cv?.id) return;
    setRenaming(null);
    // Closing the review unmounts it; its pending requests are discarded.
    setSelectedId(id);
  }
  async function upload(file: File) {
    const invalid = await cvUploadError(file);
    if (invalid) {
      notify({
        severity: 'error',
        title: tr('CV upload failed.'),
        text: invalid,
      });
      return;
    }
    setUploading(true);
    setError('');
    try {
      // Adds a CV; existing CVs, job selections and the default are unchanged.
      const next = await opportunityRequest<SavedCv>('/cv', {
        method: 'POST',
        body: importUpload({}, file),
      });
      setRenaming(null);
      setCvs((rows) => [...rows, next]);
      setSelectedId(next.id);
      notify({
        severity: 'success',
        title: tr('CV saved'),
        text: `${tr('Continue reviewing your CV.')}\n${tr('Complete the review before using CV Match.')}`,
      });
      // Source CV Review is the mandatory next step for every new CV.
      navigate(`/cv/${next.id}/review`);
    } catch (failure) {
      notify({
        severity: 'error',
        title: tr('CV upload failed.'),
        text:
          failure instanceof Error
            ? tr(failure.message)
            : tr('Check the file and try again.'),
      });
    } finally {
      setUploading(false);
    }
  }
  async function manage(
    id: string,
    init: RequestInit,
    done: string,
    failed = tr('Could not update this CV.'),
  ) {
    setManaging(true);
    try {
      setCvs(await opportunityRequest<SavedCv[]>(`/cv/${id}`, init));
      notify({ severity: 'success', text: done });
      return true;
    } catch (failure) {
      notify({
        severity: 'error',
        title: failed,
        text:
          failure instanceof Error
            ? tr(failure.message)
            : tr('Check the local API and try again.'),
      });
      return false;
    } finally {
      setManaging(false);
    }
  }
  const makeDefault = (id: string) =>
    void manage(
      id,
      {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      },
      tr('Default CV updated.'),
    );
  // An open or loading review never locks the library; only unsaved review
  // edits do, so switching or adding a CV cannot silently discard them.
  const locked = uploading || managing;
  const full = cvs.length >= MAX_CVS;
  const reviewed =
    typeof progress === 'object' &&
    progress !== null &&
    progress.total > 0 &&
    progress.reviewed === progress.total;
  const addLabel = cvs.length ? tr('Add CV') : tr('Save source CV');
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <PageHeader
        title={tr('My CV')}
        description={`${tr(
          'Manage your CVs and choose the default used for new jobs.',
        )} ${tr('Each new CV opens Source CV Review, required once before CV Match.')}`}
        actions={
          loaded && (
            <Button
              startIcon={<UploadIcon />}
              component="label"
              variant="contained"
              disabled={locked || full}
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              {addLabel}
              <input
                hidden
                type="file"
                accept=".pdf,application/pdf"
                aria-label={addLabel}
                disabled={locked || full}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </Button>
          )
        }
      />
      {uploading && (
        <Typography role="status">{tr('Saving your CV locally…')}</Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {!loaded ? (
        <Box
          role="status"
          aria-label={tr('Loading your CV')}
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: {
              xs: '1fr',
              md: '320px minmax(0, 1fr)',
              xl: '380px minmax(0, 1fr)',
            },
          }}
        >
          <Skeleton variant="rounded" height={220} />
          <Skeleton variant="rounded" height={320} />
        </Box>
      ) : !cv ? (
        !error && (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, ...enter(0) }}>
            <Typography>
              {tr(
                'No CV saved yet. Save a PDF to review it and tailor it for jobs.',
              )}
            </Typography>
          </Paper>
        )
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            alignItems: 'start',
            gridTemplateColumns: {
              xs: '1fr',
              md: '320px minmax(0, 1fr)',
              xl: '380px minmax(0, 1fr)',
            },
          }}
        >
          <Paper
            component="section"
            variant="outlined"
            aria-labelledby="cv-library-title"
            sx={{ p: 2, minWidth: 0, ...enter(0) }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
            >
              <Typography id="cv-library-title" variant="h6" component="h2">
                {tr('Your CVs')}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                aria-label={tr('{count} of {max} CVs saved', {
                  count: cvs.length,
                  max: MAX_CVS,
                })}
              >
                {cvs.length}/{MAX_CVS}
              </Typography>
            </Stack>
            <List
              disablePadding
              sx={{
                mt: 1.5,
                display: 'grid',
                gap: 1,
                gridTemplateColumns: 'minmax(0, 1fr)',
              }}
            >
              {cvs.map((row) => {
                const viewing = row.id === cv.id;
                return (
                  <ListItem
                    key={row.id}
                    disablePadding
                    // The row owns the outline so the menu button sits inside it.
                    sx={{
                      borderRadius: 1,
                      border: 1,
                      borderColor: viewing ? 'primary.main' : 'divider',
                      bgcolor: viewing ? 'action.selected' : undefined,
                    }}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        aria-label={tr('More actions for {name}', {
                          name: row.name,
                        })}
                        disabled={locked}
                        onClick={(event) =>
                          setMenu({ anchor: event.currentTarget, cv: row })
                        }
                      >
                        <MoreIcon />
                      </IconButton>
                    }
                  >
                    <ListItemButton
                      selected={viewing}
                      aria-current={viewing ? 'true' : undefined}
                      disabled={locked && !viewing}
                      onClick={() => select(row.id)}
                      sx={{
                        alignItems: 'flex-start',
                        gap: 1.5,
                        py: 1.5,
                        borderRadius: 1,
                        '&.Mui-selected, &.Mui-selected:hover': {
                          bgcolor: 'transparent',
                        },
                      }}
                    >
                      <DescriptionIcon
                        sx={{ fontSize: 20, mt: 0.25, color: 'text.secondary' }}
                      />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          noWrap
                          title={row.name}
                          sx={{ fontWeight: 600 }}
                        >
                          {row.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {tr('Updated {date}', {
                            date: new Date(row.updatedAt).toLocaleDateString(
                              dateLocale(),
                            ),
                          })}
                        </Typography>
                        <Box sx={{ mt: 0.5 }}>
                          <CvChips
                            viewing={viewing}
                            isDefault={row.isDefault}
                          />
                        </Box>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
            {full && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {tr(
                  'You can keep up to 5 CVs. Delete a CV you no longer need before adding another.',
                )}
              </Alert>
            )}
          </Paper>
          <Stack spacing={3} sx={{ minWidth: 0 }}>
            <Paper
              component="section"
              variant="outlined"
              aria-labelledby="cv-details-title"
              sx={{ p: { xs: 2, sm: 3 }, minWidth: 0, ...enter(1) }}
            >
              <Stack spacing={2.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  sx={{ alignItems: { sm: 'flex-start' } }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      display: { xs: 'none', sm: 'grid' },
                      placeItems: 'center',
                      width: 48,
                      height: 48,
                      flexShrink: 0,
                      borderRadius: '50%',
                      bgcolor: 'action.hover',
                      color: 'text.secondary',
                    }}
                  >
                    <DescriptionIcon />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                    {renaming === null ? (
                      <Typography
                        id="cv-details-title"
                        variant="h6"
                        component="h2"
                      >
                        {cv.name}
                      </Typography>
                    ) : (
                      <Stack
                        component="form"
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void manage(
                            cv.id,
                            {
                              method: 'PATCH',
                              body: JSON.stringify({ name: renaming }),
                            },
                            tr('CV renamed.'),
                          ).then((done) => done && setRenaming(null));
                        }}
                      >
                        <TextField
                          id="cv-details-title"
                          label={tr('CV name')}
                          value={renaming}
                          autoFocus
                          slotProps={{ htmlInput: { maxLength: 120 } }}
                          onChange={(event) => setRenaming(event.target.value)}
                        />
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={managing || !renaming.trim()}
                        >
                          {tr('Save')}
                        </Button>
                        <Button onClick={() => setRenaming(null)}>
                          {tr('Cancel')}
                        </Button>
                      </Stack>
                    )}
                    {cv.name !== cv.fileName && (
                      <Typography variant="body2" color="text.secondary">
                        {cv.fileName}
                      </Typography>
                    )}
                    <Box sx={{ mt: 1 }}>
                      <CvChips viewing isDefault={cv.isDefault} />
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    sx={{
                      flexShrink: 0,
                      alignSelf: { xs: 'stretch', sm: 'flex-start' },
                    }}
                    component={Link}
                    to={`/cv/${cv.id}/review`}
                    startIcon={<VisibilityIcon />}
                  >
                    {tr('Review CV')}
                  </Button>
                </Stack>
                <Box
                  component="dl"
                  sx={{
                    m: 0,
                    display: 'grid',
                    gap: 2,
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0, 1fr))',
                      md: 'repeat(4, minmax(0, 1fr))',
                    },
                    '& dd': { m: 0 },
                  }}
                >
                  {(
                    [
                      [
                        tr('Updated'),
                        new Date(cv.updatedAt).toLocaleString(dateLocale(), {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }),
                      ],
                      [tr('Format'), fileFormat(cv.fileName)],
                      [tr('Size'), fileSize(cv.fileSize)],
                    ] as const
                  ).map(([label, value]) => (
                    <Box
                      key={label}
                      sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
                    >
                      <Typography
                        component="dt"
                        variant="caption"
                        color="text.secondary"
                      >
                        {label}
                      </Typography>
                      <Typography component="dd" variant="body2">
                        {value}
                      </Typography>
                    </Box>
                  ))}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      component="dt"
                      variant="caption"
                      color="text.secondary"
                    >
                      {tr('Review status')}
                    </Typography>
                    <Typography
                      component="dd"
                      variant="body2"
                      role="status"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        flexWrap: 'wrap',
                      }}
                    >
                      {progress === undefined ? (
                        <Skeleton
                          width={140}
                          aria-label={tr('Loading review status')}
                        />
                      ) : progress === 'error' ? (
                        <>
                          {tr('Review status unavailable.')}
                          <Button
                            startIcon={<RefreshIcon />}
                            size="small"
                            onClick={retryReviews}
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
                </Box>
                {typeof progress === 'object' &&
                  progress !== null &&
                  progress.total > 0 && (
                    <Box>
                      <Typography
                        variant="subtitle1"
                        component="h3"
                        sx={{ fontWeight: 600, mb: 1 }}
                      >
                        {tr('Review progress')}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={2}
                        sx={{ alignItems: 'center' }}
                      >
                        <LinearProgress
                          variant="determinate"
                          value={(progress.reviewed / progress.total) * 100}
                          aria-label={tr('Review progress')}
                          sx={{
                            flex: 1,
                            height: 8,
                            borderRadius: 4,
                            bgcolor: surface.primaryTint,
                          }}
                        />
                        <Typography sx={{ fontWeight: 600 }}>
                          {progress.reviewed}/{progress.total}
                        </Typography>
                      </Stack>
                      {!reviewed && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          {tr('Sections left to review: {count}', {
                            count: progress.total - progress.reviewed,
                          })}
                        </Typography>
                      )}
                    </Box>
                  )}
                {/* Next step only from real status: not reviewed or partly reviewed. */}
                {(progress === null ||
                  (typeof progress === 'object' && !reviewed)) && (
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    sx={{
                      p: 2,
                      borderRadius: 1,
                      bgcolor: surface.primaryTint,
                      alignItems: { sm: 'center' },
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography component="h3" sx={{ fontWeight: 600 }}>
                        {tr('Next step')}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {tr(
                          'Review your CV so CV Match and tailored CVs use accurate, complete information.',
                        )}
                      </Typography>
                    </Box>
                    <Button
                      variant="contained"
                      component={Link}
                      to={`/cv/${cv.id}/review`}
                      endIcon={<ArrowForwardIcon />}
                      sx={{ flexShrink: 0 }}
                    >
                      {tr(progress ? 'Continue review' : 'Start review')}
                    </Button>
                  </Stack>
                )}
                <Box>
                  <Typography
                    variant="subtitle1"
                    component="h3"
                    sx={{ fontWeight: 600, mb: 1.5 }}
                  >
                    {tr('Actions for this CV')}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    <Button
                      variant="outlined"
                      startIcon={<EditIcon />}
                      disabled={locked || renaming !== null}
                      onClick={() => setRenaming(cv.name)}
                    >
                      {tr('Rename')}
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<VisibilityIcon />}
                      disabled={!canPreviewOriginal(cv)}
                      onClick={() => setPreviewing(cv)}
                    >
                      {tr('View CV')}
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      disabled={!cv.originalAvailable}
                      {...(cv.originalAvailable && {
                        href: `/api/v1/opportunities/cv/${cv.id}/file`,
                        download: cv.fileName,
                      })}
                    >
                      {tr('Download CV')}
                    </Button>
                    {/* The default CV can't become default again or be deleted. */}
                    <Button
                      variant="outlined"
                      startIcon={<StarIcon />}
                      disabled={locked || cv.isDefault}
                      onClick={() => makeDefault(cv.id)}
                    >
                      {tr('Make default')}
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteIcon />}
                      disabled={locked || cv.isDefault}
                      onClick={() => setConfirmDelete(true)}
                    >
                      {tr('Delete')}
                    </Button>
                  </Stack>
                  {!cv.originalAvailable && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {tr(
                        'The original file was not kept for this CV. Upload it again to download it.',
                      )}
                    </Typography>
                  )}
                  {cv.originalAvailable && !canPreviewOriginal(cv) && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 1 }}
                    >
                      {tr(
                        'Browser preview is available for PDF CVs only. Download the CV to open it.',
                      )}
                    </Typography>
                  )}
                </Box>
                <Alert severity="info">
                  {cv.isDefault ? (
                    <>
                      <AlertTitle>{tr('Default CV')}</AlertTitle>
                      {tr(
                        'New jobs use this CV for CV Match and tailored CVs. Each job can choose its own CV on the job page.',
                      )}
                    </>
                  ) : (
                    tr(
                      'You are viewing a CV that is not the default. New jobs use {name}.',
                      {
                        name: defaultCv?.name ?? '',
                      },
                    )
                  )}
                </Alert>
              </Stack>
            </Paper>
          </Stack>
        </Box>
      )}
      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(undefined)}
      >
        {/* Row shortcuts open the CV and run the same action as its details panel. */}
        {menu && [
          !menu.cv.isDefault && (
            <MenuItem
              key="default"
              onClick={() => {
                setMenu(undefined);
                select(menu.cv.id);
                makeDefault(menu.cv.id);
              }}
            >
              {tr('Make default')}
            </MenuItem>
          ),
          <MenuItem
            key="rename"
            onClick={() => {
              setMenu(undefined);
              select(menu.cv.id);
              setRenaming(menu.cv.name);
            }}
          >
            {tr('Rename')}
          </MenuItem>,
          <MenuItem
            key="download"
            component="a"
            disabled={!menu.cv.originalAvailable}
            href={`/api/v1/opportunities/cv/${menu.cv.id}/file`}
            download={menu.cv.fileName}
            onClick={() => setMenu(undefined)}
          >
            {tr('Download CV')}
          </MenuItem>,
          !menu.cv.isDefault && (
            <MenuItem
              key="delete"
              sx={{ color: 'error.main' }}
              onClick={() => {
                setMenu(undefined);
                select(menu.cv.id);
                setConfirmDelete(true);
              }}
            >
              {tr('Delete')}
            </MenuItem>
          ),
        ]}
      </Menu>
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
          if (cv)
            void manage(
              cv.id,
              { method: 'DELETE' },
              tr('CV deleted.'),
              tr('Could not delete CV'),
            );
        }}
      />
      {previewing && (
        <OriginalCvDialog cv={previewing} onClose={() => setPreviewing(null)} />
      )}
    </Stack>
  );
}

/** Shows the exact uploaded PDF bytes; the file itself is never changed. */
function OriginalCvDialog({
  cv,
  onClose,
}: {
  cv: SavedCv;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fileUrl = `/api/v1/opportunities/cv/${cv.id}/file`;
  useEffect(() => {
    let live = true,
      objectUrl: string | null = null;
    fetch(fileUrl, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        // The API sends octet-stream attachments; type it so the viewer opens it.
        const blob = new Blob([await response.arrayBuffer()], {
          type: 'application/pdf',
        });
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileUrl]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{cv.fileName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {tr('This is the file you uploaded, unchanged.')}
        </Typography>
        {failed ? (
          <Alert severity="error">
            {tr('Could not load this CV. Download it instead.')}
          </Alert>
        ) : (
          <Box
            aria-busy={!url}
            sx={{
              height: { xs: '65vh', sm: '75vh' },
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: '#ffffff',
              overflow: 'hidden',
            }}
          >
            {url ? (
              <Box
                component="iframe"
                title={tr('CV preview')}
                src={url}
                sx={{ width: '100%', height: '100%', border: 0 }}
              />
            ) : (
              <LinearProgress aria-label={tr('Loading CV')} />
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          startIcon={<DownloadIcon />}
          href={fileUrl}
          download={cv.fileName}
        >
          {tr('Download CV')}
        </Button>
        <Button onClick={onClose}>{tr('Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
