import { AddIcon, ExploreIcon, RefreshIcon } from '../../components/icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useLocalCalendarDate } from '../inbox/follow-ups';
import { opportunityRequest } from '../inbox/opportunities-api';
import type { Opportunity } from '../inbox/opportunities-api';
import { sourceCvRequest } from '../inbox/source-cv-review.contract';
import type { NextAction } from '../inbox/next-action';
import { continueItems, cvStep, homeSections } from './home-sections';
import type { HomeSections, JobProgress } from './home-sections';

// All visible text in one place so it can move to a locale file later.
const copy = {
  title: 'Dashboard',
  description: 'Your job search at a glance.',
  addJob: 'Add job',
  discover: 'Discover jobs',
  loadError: 'Jobs could not be loaded. Retry, or open Jobs later.',
  retry: 'Retry',
  emptyTitle: 'No jobs yet',
  emptyBody: 'Add a job you found, or discover new ones to review.',
  summary: 'Job search summary',
  active: 'Active jobs',
  activeHint: 'Not rejected or closed',
  inProgress: 'In progress',
  inProgressHint: 'Contacted through offer',
  interview: 'Interview',
  currentStatus: 'Current status',
  due: 'Follow-ups due',
  dueHint: 'Today or overdue',
  overdue: (count: number) => `${count} overdue`,
  byStatus: 'Jobs by status',
  followUps: 'Follow-ups',
  followUpsEmpty: 'No follow-ups are due today or overdue.',
  openApplication: 'Open application',
  openApplicationFor: (title: string) => `Open application for ${title}`,
  showMore: (count: number) => `Show ${count} more`,
  showFewer: 'Show fewer',
  continueTitle: 'Continue where you left off',
  continueEmpty: 'Nothing to continue right now.',
  continueError: 'Next steps could not be loaded.',
  actionFor: (label: string, title: string) => `${label}: ${title}`,
  viewAll: 'View all jobs',
  cvTitle: 'Save your CV',
  cvBody:
    'Add your CV once in My CV. Every job then uses it for matching and tailoring.',
  cvAction: 'Open My CV',
  cvReviewTitle: 'Review your CV',
  cvReviewBody:
    'Review your CV once in My CV. Every job then uses it for tailoring.',
  cvReviewAction: 'Review in My CV',
};
const FOLLOW_UP_PREVIEW = 3;

// Persisted dates are local YYYY-MM-DD values; never parse them as UTC.
const shortDate = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
};

function Panel({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={id}
      sx={{ minWidth: 0 }}
    >
      <Stack
        // Phones stack the heading above its action instead of wrapping both.
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 0.5, sm: 1 }}
        sx={{
          px: 2,
          py: 1.5,
          minHeight: 44,
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Typography id={id} component="h2" variant="h6">
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

function Summary({
  sections,
  total,
}: {
  sections: HomeSections;
  total: number;
}) {
  const { metrics, due, counts } = sections;
  const cells = [
    { label: copy.active, value: metrics.active, hint: copy.activeHint },
    {
      label: copy.inProgress,
      value: metrics.inProgress,
      hint: copy.inProgressHint,
    },
    {
      label: copy.interview,
      value: metrics.interview,
      hint: copy.currentStatus,
    },
    {
      label: copy.due,
      value: due.length,
      hint: metrics.overdue ? copy.overdue(metrics.overdue) : copy.dueHint,
      alert: metrics.overdue > 0,
    },
  ];
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-label={copy.summary}
      sx={{ overflow: 'hidden' }}
    >
      {/* 1px gaps over the divider colour draw the cell borders at any column count. */}
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: '1px',
          bgcolor: 'divider',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {cells.map(({ label, value, hint, alert }) => (
          <Box
            key={label}
            sx={{
              bgcolor: 'background.paper',
              px: 2,
              py: 1.5,
              display: 'flex',
              flexDirection: 'column-reverse',
              justifyContent: 'flex-end',
            }}
          >
            <Typography component="dt" variant="body2" sx={{ fontWeight: 500 }}>
              {label}
              <Typography
                component="span"
                variant="caption"
                color={alert ? 'error' : 'text.secondary'}
                sx={{ display: 'block', fontWeight: alert ? 600 : 400 }}
              >
                {hint}
              </Typography>
            </Typography>
            <Typography
              component="dd"
              variant="h4"
              sx={{ m: 0, fontWeight: 600, lineHeight: 1.2 }}
            >
              {value}
            </Typography>
          </Box>
        ))}
      </Box>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ px: 2, py: 1.5, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Typography variant="body2" color="text.secondary">
          {copy.byStatus} ({total})
        </Typography>
        <Stack
          component="ul"
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{ m: 0, p: 0, listStyle: 'none', flexWrap: 'wrap' }}
        >
          {counts.map(({ status, count }) => (
            <Stack
              component="li"
              key={status}
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center' }}
            >
              <StatusChip status={status} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {count}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function JobTitle({ job }: { job: Opportunity }) {
  return (
    <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <MuiLink component={Link} to={`/jobs/${job.id}`} sx={{ fontWeight: 600 }}>
        {job.title}
      </MuiLink>
      {job.company && (
        <Typography variant="body2" color="text.secondary">
          {job.company}
        </Typography>
      )}
    </Box>
  );
}

function FollowUpDate({ label, date }: { label: string; date: string }) {
  return (
    <Typography
      variant="body2"
      color={label === 'Overdue' ? 'error' : 'text.primary'}
      sx={{ whiteSpace: 'nowrap' }}
    >
      {label}{' '}
      <Box component="time" dateTime={date} title={date}>
        {shortDate(date)}
      </Box>
    </Typography>
  );
}

function FollowUps({ due }: { due: HomeSections['due'] }) {
  const [expanded, setExpanded] = useState(false);
  const [first, ...rest] = due;
  const shown = expanded ? rest : rest.slice(0, FOLLOW_UP_PREVIEW - 1);
  const hidden = rest.length - shown.length;
  const applicationLink = (job: Opportunity, variant: 'outlined' | 'text') => (
    <Button
      component={Link}
      to={`/jobs/${job.id}/application`}
      size="small"
      variant={variant}
      aria-label={copy.openApplicationFor(job.title)}
      sx={{
        flexShrink: 0,
        width: { xs: variant === 'outlined' ? '100%' : 'auto', sm: 'auto' },
      }}
    >
      {copy.openApplication}
    </Button>
  );
  return (
    <Panel id="follow-ups-heading" title={copy.followUps}>
      {!first ? (
        <Typography color="text.secondary" sx={{ px: 2, pb: 2 }}>
          {copy.followUpsEmpty}
        </Typography>
      ) : (
        <>
          {/* The oldest follow-up is the one to act on now. */}
          <Stack
            spacing={1.5}
            sx={{
              mx: 2,
              mb: 1,
              p: 2,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <JobTitle job={first.job} />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{
                alignItems: { xs: 'stretch', sm: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <FollowUpDate
                label={first.label}
                date={first.job.followUpDate!}
              />
              {applicationLink(first.job, 'outlined')}
            </Stack>
          </Stack>
          {shown.length > 0 && (
            <Box
              component="ul"
              id="more-follow-ups"
              sx={{ m: 0, px: 0, pb: 0, pt: 0, listStyle: 'none' }}
            >
              {shown.map(({ job, label }) => (
                <Stack
                  component="li"
                  key={job.id}
                  spacing={0.5}
                  sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider' }}
                >
                  {/* Title and company get the full row; date and action sit below. */}
                  <JobTitle job={job} />
                  <Stack
                    direction="row"
                    useFlexGap
                    sx={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      columnGap: 1,
                    }}
                  >
                    <FollowUpDate label={label} date={job.followUpDate!} />
                    {applicationLink(job, 'text')}
                  </Stack>
                </Stack>
              ))}
            </Box>
          )}
          {rest.length > FOLLOW_UP_PREVIEW - 1 && (
            <Box sx={{ px: 1, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
              <Button
                size="small"
                aria-expanded={expanded}
                aria-controls="more-follow-ups"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? copy.showFewer : copy.showMore(hidden)}
              </Button>
            </Box>
          )}
        </>
      )}
    </Panel>
  );
}

function Continue({
  items,
  onRetry,
}: {
  items: { job: Opportunity; action: NextAction }[] | 'loading' | 'error';
  onRetry: () => void;
}) {
  return (
    <Panel
      id="continue-heading"
      title={copy.continueTitle}
      action={
        <Button component={Link} to="/jobs" size="small">
          {copy.viewAll}
        </Button>
      }
    >
      {items === 'loading' ? (
        <Stack spacing={1} sx={{ px: 2, pb: 2 }} aria-busy="true">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="rounded" height={88} />
          ))}
        </Stack>
      ) : items === 'error' ? (
        <Box sx={{ px: 2, pb: 2 }}>
          <Alert
            severity="error"
            action={
              <Button
                startIcon={<RefreshIcon />}
                color="inherit"
                size="small"
                onClick={onRetry}
              >
                {copy.retry}
              </Button>
            }
          >
            {copy.continueError}
          </Alert>
        </Box>
      ) : items.length === 0 ? (
        <Typography color="text.secondary" sx={{ px: 2, pb: 2 }}>
          {copy.continueEmpty}
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {items.map(({ job, action }) => (
            <Stack
              component="li"
              key={job.id}
              spacing={0.5}
              sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}
            >
              <JobTitle job={job} />
              <Typography variant="body2">{action.text}</Typography>
              <Button
                component={Link}
                // Same destination as the job Overview's next step.
                to={`/jobs/${job.id}/${action.to}`}
                size="small"
                aria-label={copy.actionFor(action.label, job.title)}
                sx={{ alignSelf: 'flex-start', ml: -1 }}
              >
                {action.label}
              </Button>
            </Stack>
          ))}
        </Box>
      )}
    </Panel>
  );
}

const isProgress = (value: unknown): value is JobProgress =>
  !!value &&
  typeof value === 'object' &&
  'jobs' in value &&
  Array.isArray(value.jobs) &&
  'cv' in value &&
  !!value.cv &&
  typeof value.cv === 'object';

export function Home() {
  const today = useLocalCalendarDate();
  const [rows, setRows] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Scoped to Continue and the CV banner; undefined while loading.
  const [progress, setProgress] = useState<JobProgress | 'error'>();
  const [progressAttempt, setProgressAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    opportunityRequest<Opportunity[]>().then(
      (data) => active && setRows(data),
      () => active && setError(true),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    let active = true;
    sourceCvRequest('/job-progress').then(
      (value) => {
        if (active) setProgress(isProgress(value) ? value : 'error');
      },
      () => active && setProgress('error'),
    );
    return () => {
      active = false;
    };
  }, [progressAttempt]);
  const sections = rows && homeSections(rows, today);
  const known = progress && progress !== 'error' ? progress : null;
  const cvGuide = known && cvStep(known);
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <Button
            startIcon={<AddIcon />}
            component={Link}
            to="/jobs/new"
            variant="contained"
          >
            {copy.addJob}
          </Button>
        }
      />
      {cvGuide && (
        <Alert
          severity="info"
          action={
            <Button component={Link} to="/cv" color="inherit" size="small">
              {known.cv.saved ? copy.cvReviewAction : copy.cvAction}
            </Button>
          }
        >
          <strong>{known.cv.saved ? copy.cvReviewTitle : copy.cvTitle}.</strong>{' '}
          {known.cv.saved ? copy.cvReviewBody : copy.cvBody}
        </Alert>
      )}
      {error ? (
        <Alert
          severity="error"
          action={
            <Button
              startIcon={<RefreshIcon />}
              color="inherit"
              size="small"
              onClick={() => {
                setError(false);
                setAttempt((value) => value + 1);
              }}
            >
              {copy.retry}
            </Button>
          }
        >
          {copy.loadError}
        </Alert>
      ) : !sections ? (
        <Stack spacing={3} aria-busy="true" aria-label="Loading dashboard">
          <Skeleton variant="rounded" height={140} />
          <Box sx={layout}>
            <Skeleton variant="rounded" height={240} />
            <Skeleton variant="rounded" height={240} />
          </Box>
        </Stack>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" component="section" sx={{ p: 3 }}>
          <Typography component="h2" variant="h6">
            {copy.emptyTitle}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            {copy.emptyBody}
          </Typography>
          <Button
            startIcon={<ExploreIcon />}
            component={Link}
            to="/discover"
            variant="outlined"
          >
            {copy.discover}
          </Button>
        </Paper>
      ) : (
        <>
          <Summary sections={sections} total={rows.length} />
          <Box sx={layout}>
            <FollowUps due={sections.due} />
            <Continue
              items={
                progress === undefined
                  ? 'loading'
                  : progress === 'error'
                    ? 'error'
                    : continueItems(rows, progress, today)
              }
              onRetry={() => {
                setProgress(undefined);
                setProgressAttempt((value) => value + 1);
              }}
            />
          </Box>
        </>
      )}
    </Stack>
  );
}

const layout = {
  display: 'grid',
  gap: 3,
  alignItems: 'start',
  gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' },
} as const;
