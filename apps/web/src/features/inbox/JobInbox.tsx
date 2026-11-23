import { dateLocale, tr } from '../../app/i18n';
import { enter, surface } from '../../app/theme';
import { PageHeader } from '../../components/PageHeader';
import {
  AddIcon,
  ArrowBackIcon,
  ArrowForwardIcon,
  DescriptionIcon,
  ExploreIcon,
  ForumIcon,
  OpenInNewIcon,
  RefreshIcon,
  SearchIcon,
  AutoAwesomeIcon,
  WorkIcon,
} from '../../components/icons';
import { StatusChip } from '../../components/StatusChip';
import { dueFollowUp, useLocalCalendarDate } from './follow-ups';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Paper,
  Stack,
  TablePagination,
  Typography,
  Link as MuiLink,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import {
  fieldLabels,
  jobUrlInfo,
  opportunityRequest,
} from './opportunities-api';
import type { Opportunity } from './opportunities-api';
import { displayExperience, previewRequirements } from './job-display';
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : tr('Request failed. Retry manually.');
// Case- and diacritic-insensitive, so "ky su" finds "Kỹ sư".
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase();
const sourceOf = (row: Opportunity) =>
  row.discovery?.sourceName ??
  [row.source, jobUrlInfo(row.originalLink).platform]
    .filter(Boolean)
    .join(' · ');
const hidden = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
const focusRing = {
  outline: '2px solid',
  outlineColor: 'primary.main',
  outlineOffset: 2,
} as const;

export function JobInbox() {
  const today = useLocalCalendarDate();
  const wide = useMediaQuery(useTheme().breakpoints.up('md'));
  const [dueOnly, setDueOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  // ?job=<id> is the selection, so mobile Back/Forward moves between list and detail.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('job');
  const navigate = useNavigate();
  const location = useLocation();
  const select = (id: string | null, push = false) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set('job', id);
        else next.delete('job');
        return next;
      },
      { replace: !push, state: push ? { jobFromList: true } : undefined },
    );
  // The entrance plays once per page visit, not on each list/detail switch.
  const [initialJob] = useState(selectedId);
  const [switched, setSwitched] = useState(false);
  if (!switched && selectedId !== initialJob) setSwitched(true);
  const entrance = (step: number) => (switched ? undefined : enter(step));
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    opportunityRequest<Opportunity[]>()
      .then(
        (data) => {
          if (active) {
            setRows(data);
            setError('');
          }
        },
        (error) => {
          if (active) setError(message(error));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const isDue = (row: Opportunity) =>
    dueFollowUp(row.followUpDate, row.status, today, row.followUpStatus);
  const dueCount = rows.filter(isDue).length;
  const needle = fold(query.trim());
  // Search covers every saved job: the API already returns the full list.
  const visibleRows = rows.filter(
    (row) =>
      (!dueOnly || isDue(row)) &&
      (!needle || fold(`${row.title} ${row.company}`).includes(needle)),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visibleRows.length / 10) - 1),
  );
  const pageRows = visibleRows.slice(currentPage * 10, currentPage * 10 + 10);
  const chosen = visibleRows.find((row) => row.id === selectedId);
  const selected = chosen ?? (wide ? pageRows[0] : undefined);
  // Mobile shows either the list or the job named in the URL.
  const mobileDetail = !wide && Boolean(chosen);
  const showDetail = wide || mobileDetail;
  const showList = wide || !showDetail;
  // Drop a link to a deleted or unknown job instead of keeping a dead ?job.
  const unknownJob =
    !loading &&
    !error &&
    selectedId !== null &&
    !rows.some((r) => r.id === selectedId);
  useEffect(() => {
    if (unknownJob)
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('job');
          return next;
        },
        { replace: true },
      );
  }, [unknownJob, setParams]);
  useEffect(() => {
    if (mobileDetail) {
      returnFocus.current = selectedId;
      detailHeading.current?.focus();
    }
  }, [mobileDetail, selectedId]);
  useEffect(() => {
    if (showList && returnFocus.current) {
      document.getElementById(`job-card-${returnFocus.current}`)?.focus();
      returnFocus.current = null;
    }
  }, [showList]);
  const resetPage = () => setPage(0);
  const emptyTitle = needle
    ? tr('No jobs match your search')
    : dueOnly
      ? tr('No due follow-ups')
      : tr('No saved opportunities yet');
  const list = (
    <Paper
      component="section"
      aria-labelledby="saved-jobs-heading"
      variant="outlined"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
        ...entrance(0),
      }}
    >
      <Typography
        id="saved-jobs-heading"
        component="h2"
        variant="h6"
        sx={hidden}
      >
        {tr('Saved jobs')}
        {!loading && !error ? ` (${rows.length})` : ''}
      </Typography>
      <Stack spacing={1.5} sx={{ p: 2, flexShrink: 0 }}>
        <TextField
          size="small"
          type="search"
          value={query}
          placeholder={tr('Search by job title or company')}
          onChange={(event) => {
            setQuery(event.target.value);
            resetPage();
          }}
          slotProps={{
            htmlInput: { 'aria-label': tr('Search jobs') },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 20 }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <ToggleButtonGroup
          sx={{
            '& .MuiToggleButton-root': {
              px: 1.5,
              minHeight: 44,
              border: 0,
              borderRadius: `${surface.controlRadius}px !important`,
            },
            '& .Mui-selected': {
              bgcolor: `${surface.primaryTint} !important`,
              color: 'primary.main',
              fontWeight: 600,
            },
            '& .Mui-focusVisible': { ...focusRing, zIndex: 1 },
          }}
          exclusive
          size="small"
          value={dueOnly ? 'due' : 'all'}
          aria-label={tr('Saved jobs filter')}
          onChange={(_, value: string | null) => {
            if (value === null) return;
            setDueOnly(value === 'due');
            resetPage();
          }}
        >
          <ToggleButton value="all">
            {tr('All jobs')}
            {!loading && !error && <span>&nbsp;({rows.length})</span>}
          </ToggleButton>
          <ToggleButton value="due">
            {tr('Due follow-ups')}
            {!loading && !error && <span>&nbsp;({dueCount})</span>}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {error && (
        <Alert
          severity="error"
          sx={{ mx: 2, mb: 2 }}
          action={
            <Button
              startIcon={<RefreshIcon />}
              onClick={() => {
                setLoading(true);
                setAttempt((value) => value + 1);
              }}
            >
              {tr('Retry')}
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {loading ? (
        <Stack direction="row" spacing={1} sx={{ p: 3 }} role="status">
          <CircularProgress
            size={20}
            aria-label={tr('Loading opportunities')}
          />
          <Typography variant="body2">{tr('Loading jobs…')}</Typography>
        </Stack>
      ) : (
        !error && (
          <Box
            tabIndex={0}
            role="region"
            aria-label={tr('Scrollable saved jobs')}
            sx={{
              flex: '1 1 auto',
              minHeight: 0,
              overflow: 'auto',
              overflowAnchor: 'none',
              px: 1,
              pb: 1,
            }}
          >
            <Stack
              component="ul"
              aria-label={tr('Saved opportunities')}
              spacing={0.5}
              sx={{ listStyle: 'none', m: 0, p: 0 }}
            >
              {pageRows.map((row) => {
                const urgency = isDue(row);
                const active = wide && row.id === selected?.id;
                return (
                  <li key={row.id}>
                    <ButtonBase
                      id={`job-card-${row.id}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        if (row.id !== selectedId) select(row.id, !wide);
                      }}
                      sx={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'grid',
                        gridTemplateColumns: '40px minmax(0, 1fr) auto',
                        columnGap: 1.5,
                        alignItems: 'start',
                        p: 1.5,
                        borderRadius: `${surface.radius}px`,
                        border: 1,
                        borderColor: active ? 'primary.main' : 'transparent',
                        bgcolor: active ? surface.primaryTint : undefined,
                        // Inset accent: selected stays distinct from the hover tint.
                        boxShadow: active
                          ? (theme) =>
                              `inset 3px 0 0 ${theme.palette.primary.main}`
                          : undefined,
                        transition:
                          'background-color 160ms, border-color 160ms',
                        '&:hover': active
                          ? undefined
                          : { borderColor: 'divider' },
                        '&.Mui-focusVisible': focusRing,
                      }}
                    >
                      <Box
                        aria-hidden
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          bgcolor: surface.primaryTint,
                          color: 'primary.main',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <WorkIcon sx={{ fontSize: 20 }} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body1"
                          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                        >
                          {row.title}
                        </Typography>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{ color: 'text.primary', fontWeight: 500 }}
                        >
                          {row.company || tr('Unknown company')}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                        >
                          {sourceOf(row)}
                        </Typography>
                      </Box>
                      <Stack spacing={0.5} sx={{ alignItems: 'flex-end' }}>
                        <StatusChip status={row.status} />
                        {row.followUpDate && (
                          <Typography
                            variant="caption"
                            title={row.followUpDate}
                            sx={{
                              fontWeight: urgency ? 600 : undefined,
                              color: urgency
                                ? 'text.primary'
                                : 'text.secondary',
                            }}
                            aria-label={tr('Follow-up {followUpDate}', {
                              followUpDate: row.followUpDate,
                            })}
                          >
                            {urgency ? tr(urgency) : row.followUpDate}
                          </Typography>
                        )}
                      </Stack>
                    </ButtonBase>
                  </li>
                );
              })}
            </Stack>
            {!visibleRows.length && (
              <Box sx={{ p: 2 }}>
                <Typography
                  variant="h6"
                  component="h3"
                  sx={{ fontWeight: 600, mb: 0.5 }}
                >
                  {emptyTitle}
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ maxWidth: '52ch', mb: 2 }}
                >
                  {needle
                    ? tr('Try another job title or company name.')
                    : dueOnly
                      ? tr(
                          'No active jobs have a follow-up due today or earlier. Clear the filter to see all jobs.',
                        )
                      : tr(
                          'Add a job from a website, recruiter conversation, or email to start tracking it.',
                        )}
                </Typography>
                {needle ? (
                  <Button onClick={() => setQuery('')}>
                    {tr('Clear search')}
                  </Button>
                ) : dueOnly ? (
                  <Button
                    onClick={() => {
                      setDueOnly(false);
                      resetPage();
                    }}
                  >
                    {tr('Clear filter')}
                  </Button>
                ) : (
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    <Button
                      startIcon={<ExploreIcon />}
                      component={Link}
                      to="/discover"
                      variant="outlined"
                    >
                      {tr('Discover jobs')}
                    </Button>
                    <Button
                      startIcon={<AddIcon />}
                      component={Link}
                      to="/jobs/new"
                      variant="outlined"
                    >
                      {tr('Add job')}
                    </Button>
                  </Stack>
                )}
              </Box>
            )}
          </Box>
        )
      )}
      {!loading && !error && (
        <TablePagination
          component="div"
          aria-label={tr('Jobs pagination')}
          count={visibleRows.length}
          page={currentPage}
          rowsPerPage={10}
          rowsPerPageOptions={[]}
          onPageChange={(_, nextPage) => setPage(nextPage)}
          labelDisplayedRows={({ from, to, count }) =>
            tr('{from}–{to} of {count} jobs', { from, to, count })
          }
          sx={{
            flexShrink: 0,
            borderTop: 1,
            borderColor: 'divider',
            '& .MuiTablePagination-toolbar': {
              px: 2,
              flexWrap: 'wrap',
              minHeight: 52,
            },
            '& .MuiTablePagination-actions .MuiIconButton-root': {
              width: 44,
              height: 44,
            },
            '& .MuiTablePagination-displayedRows': { mr: 'auto' },
            '& .MuiTablePagination-spacer': { display: 'none' },
          }}
        />
      )}
    </Paper>
  );
  return (
    <Stack
      spacing={2}
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflowY: { xs: 'auto', md: 'hidden' },
      }}
    >
      <PageHeader
        title={tr('Jobs')}
        description={tr('Your opportunities, conversations, and next steps.')}
        actions={
          <Button
            component={Link}
            to="/jobs/new"
            variant="contained"
            startIcon={<AddIcon />}
          >
            {tr('Add job')}
          </Button>
        }
      />
      <Box
        sx={{
          flex: { xs: '0 0 auto', md: '1 1 auto' },
          minHeight: 0,
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '2fr 3fr' },
        }}
      >
        {showList && list}
        {showDetail && selected && (
          <Stack spacing={1} sx={{ minHeight: 0, minWidth: 0, ...entrance(1) }}>
            {!wide && (
              <Box>
                <Button
                  startIcon={<ArrowBackIcon />}
                  onClick={() => {
                    // Undo our own push so Back/Forward stay in step; never leave /jobs.
                    if (
                      (location.state as { jobFromList?: boolean } | null)
                        ?.jobFromList
                    )
                      navigate(-1);
                    else select(null);
                  }}
                >
                  {tr('Back to jobs')}
                </Button>
              </Box>
            )}
            <JobDetail
              key={selected.id}
              row={selected}
              urgency={isDue(selected)}
              headingRef={detailHeading}
            />
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function JobDetail({
  row,
  urgency,
  headingRef,
}: {
  row: Opportunity;
  urgency: string | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const base = `/jobs/${row.id}`;
  const date = (value: string) =>
    new Date(value.length === 10 ? `${value}T00:00` : value).toLocaleDateString(
      dateLocale(),
      { day: 'numeric', month: 'short', year: 'numeric' },
    );
  // Only fields this job actually has; nothing is inferred.
  const facts = [
    ...(
      [
        'location',
        'workMode',
        'employmentType',
        'seniority',
        'domain',
        'salary',
      ] as const
    ).map((key) => [fieldLabels[key], row[key]] as const),
    [tr('Applied date'), row.appliedDate && date(row.appliedDate)] as const,
    [
      tr('Next follow-up date'),
      row.followUpDate && date(row.followUpDate),
    ] as const,
    [tr('Added'), row.createdAt && date(row.createdAt)] as const,
  ].filter((fact): fact is readonly [string, string] =>
    Boolean(fact[1]?.trim()),
  );
  const steps = [
    {
      to: 'match',
      Icon: DescriptionIcon,
      title: tr('CV Match'),
      text: tr('Check how well your CV fits this job'),
    },
    {
      to: 'tailored-cv',
      Icon: AutoAwesomeIcon,
      title: tr('Tailored CV'),
      text: tr('Tailor your CV to this job'),
    },
    {
      to: 'interview',
      Icon: ForumIcon,
      title: tr('Interview practice'),
      text: tr('Prepare and practice answers'),
    },
  ];
  const original = row.originalLink && jobUrlInfo(row.originalLink).valid;
  return (
    <Paper
      component="section"
      aria-labelledby="job-detail-heading"
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, minHeight: 0, overflowY: 'auto' }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            id="job-detail-heading"
            ref={headingRef}
            tabIndex={-1}
            component="h2"
            variant="h5"
            sx={{ fontWeight: 700, overflowWrap: 'anywhere', outline: 'none' }}
          >
            {row.title}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {row.company || tr('Unknown company')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {sourceOf(row)}
          </Typography>
        </Box>
        <StatusChip status={row.status} />
        {original && (
          <Tooltip title={tr('Open original job / apply')}>
            <IconButton
              component="a"
              href={row.originalLink}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tr('Original job / apply for {title}', {
                title: row.title,
              })}
              sx={{ width: 44, height: 44, mt: -1, color: 'text.secondary' }}
            >
              <OpenInNewIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{
          mt: 2.5,
          p: 2,
          borderRadius: `${surface.radius}px`,
          bgcolor: surface.primaryTint,
          alignItems: { sm: 'center' },
        }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography
            component="h3"
            variant="subtitle1"
            sx={{ fontWeight: 600 }}
          >
            {tr('Next step')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {urgency
              ? tr(
                  'Follow-up {v0}. Contact the recruiter, then update the application.',
                  {
                    v0: tr(urgency).toLowerCase(),
                  },
                )
              : tr('Continue working on this job in its workspace.')}
          </Typography>
        </Box>
        {urgency ? (
          <Button
            component={Link}
            to={`${base}/application`}
            variant="contained"
            endIcon={<ArrowForwardIcon />}
            aria-label={tr('{urgency}: open Application for {title}', {
              urgency: tr(urgency),
              title: row.title,
            })}
          >
            {tr('Open Application')}
          </Button>
        ) : (
          <Button
            component={Link}
            to={base}
            variant="contained"
            endIcon={<ArrowForwardIcon />}
          >
            {tr('Open job')}
          </Button>
        )}
      </Stack>
      <Box
        sx={{
          mt: 3,
          display: 'grid',
          gap: 3,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: 'repeat(2, minmax(0, 1fr))',
          },
        }}
      >
        <Box>
          <Typography
            component="h3"
            variant="subtitle1"
            sx={{ fontWeight: 600, mb: 1 }}
          >
            {tr('Job details')}
          </Typography>
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: 'minmax(7rem, auto) minmax(0, 1fr)',
              columnGap: 2,
              rowGap: 1,
              typography: 'body2',
              '& dt': { color: 'text.secondary' },
              '& dd': { m: 0, overflowWrap: 'anywhere' },
            }}
          >
            {facts.map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Box>
            ))}
          </Box>
        </Box>
        <Box>
          <Typography
            component="h3"
            variant="subtitle1"
            sx={{ fontWeight: 600, mb: 1 }}
          >
            {tr('Job workspace')}
          </Typography>
          <Stack spacing={1}>
            {steps.map(({ to, Icon, title, text }) => (
              <ButtonBase
                key={to}
                component={Link}
                to={`${base}/${to}`}
                sx={{
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: 1.5,
                  p: 1.5,
                  border: 1,
                  borderColor: surface.panelBorder,
                  borderRadius: `${surface.radius}px`,
                  '&:hover': { bgcolor: 'action.hover' },
                  '&.Mui-focusVisible': focusRing,
                }}
              >
                <Icon
                  aria-hidden
                  sx={{ fontSize: 20, color: 'primary.main' }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {text}
                  </Typography>
                </Box>
                <ArrowForwardIcon
                  aria-hidden
                  sx={{ fontSize: 20, color: 'text.secondary' }}
                />
              </ButtonBase>
            ))}
          </Stack>
        </Box>
      </Box>
      <Requirements row={row} overview={base} />
      {row.notes.trim() && (
        <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography
            component="h3"
            variant="subtitle1"
            sx={{ fontWeight: 600, mb: 0.5 }}
          >
            {tr('Application notes')}
          </Typography>
          <Typography
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {row.notes}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

// Preview only: Job Overview stays the full source of requirements.
function Requirements({
  row,
  overview,
}: {
  row: Opportunity;
  overview: string;
}) {
  const items = previewRequirements([row.skills, row.preferredSkills]);
  return (
    <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1 }}
      >
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
          {tr('Requirements & skills')}
        </Typography>
        <MuiLink
          component={Link}
          to={overview}
          variant="body2"
          underline="hover"
        >
          {tr('View full requirements')}
        </MuiLink>
      </Stack>
      {row.experience && (
        <Typography variant="body2" sx={{ mb: 1 }}>
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {tr('Experience')}:{' '}
          </Box>
          {displayExperience(row.experience)}
        </Typography>
      )}
      {items.length ? (
        <Box
          component="ul"
          sx={{
            m: 0,
            p: 0,
            listStyle: 'none',
            display: 'grid',
            gap: 1,
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
            },
          }}
        >
          {items.map((item, index) => (
            <Typography
              component="li"
              variant="body2"
              key={index}
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: `${surface.controlRadius}px`,
                bgcolor: surface.primaryTint,
                overflowWrap: 'anywhere',
              }}
            >
              {item}
            </Typography>
          ))}
        </Box>
      ) : (
        !row.experience && (
          <Typography variant="body2" color="text.secondary">
            {tr('No requirements found yet.')}
          </Typography>
        )
      )}
    </Box>
  );
}
