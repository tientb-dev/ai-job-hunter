import { dateLocale, tr } from '../../app/i18n';
import {
  AddIcon,
  ArrowForwardIcon,
  BoltIcon,
  DescriptionIcon,
  EventIcon,
  ExploreIcon,
  FlagIcon,
  ForumIcon,
  MailIcon,
  NotificationsIcon,
  PlayCircleIcon,
  RefreshIcon,
  WorkIcon,
} from '../../components/icons';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { enter, surface } from '../../app/theme';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useNotify } from '../../components/useNotify';
import { useLocalCalendarDate } from '../inbox/follow-ups';
import {
  emptyOpportunity,
  importUpload,
  opportunityRequest,
} from '../inbox/opportunities-api';
import type { Opportunity, OpportunityInput } from '../inbox/opportunities-api';
import { sourceCvRequest } from '../inbox/source-cv-review.contract';
import type { NextAction } from '../inbox/next-action';
import { continueItems, cvStep, homeSections } from './home-sections';
import type { HomeSections, JobProgress } from './home-sections';

// All visible text in one place so it can move to a locale file later.
const copy = {
  get title() {
    return tr('Dashboard');
  },
  get description() {
    return tr('Your job search at a glance.');
  },
  get addJob() {
    return tr('Add job');
  },
  get discover() {
    return tr('Discover jobs');
  },
  get loadError() {
    return tr('Jobs could not be loaded. Retry, or open Jobs later.');
  },
  get retry() {
    return tr('Retry');
  },
  get emptyTitle() {
    return tr('No jobs yet');
  },
  get emptyBody() {
    return tr('Add a job you found, or discover new ones to review.');
  },
  get summary() {
    return tr('Job search summary');
  },
  get active() {
    return tr('Active jobs');
  },
  get activeHint() {
    return tr('Not rejected or closed');
  },
  get inProgress() {
    return tr('In progress');
  },
  get inProgressHint() {
    return tr('Contacted through offer');
  },
  get interview() {
    return tr('Interview');
  },
  get currentStatus() {
    return tr('Current status');
  },
  get due() {
    return tr('Follow-ups due');
  },
  get dueHint() {
    return tr('Today or overdue');
  },
  overdue: (count: number) => tr('{count} overdue', { count }),
  get byStatus() {
    return tr('Jobs by status');
  },
  get followUps() {
    return tr('Follow-ups');
  },
  get followUpsEmpty() {
    return tr('No follow-ups are due today or overdue.');
  },
  get openApplication() {
    return tr('Open application');
  },
  openApplicationFor: (title: string) =>
    tr('Open application for {title}', { title: title }),
  get done() {
    return tr('Done');
  },
  get dismiss() {
    return tr('Dismiss');
  },
  doneFor: (title: string) =>
    tr('Mark follow-up done for {title}', { title: title }),
  dismissFor: (title: string) =>
    tr('Dismiss follow-up for {title}', { title: title }),
  resolved: (title: string, status: Resolution) =>
    tr(
      status === 'DONE'
        ? 'Follow-up marked done: {title}'
        : 'Follow-up dismissed: {title}',
      { title },
    ),
  changedElsewhere: (title: string) =>
    tr('Follow-up for {title} changed elsewhere; showing the latest.', {
      title: title,
    }),
  showMore: (count: number) => tr('Show {count} more', { count: count }),
  get showFewer() {
    return tr('Show fewer');
  },
  get continueTitle() {
    return tr('Continue where you left off');
  },
  get continueEmpty() {
    return tr('Nothing to continue right now.');
  },
  get continueError() {
    return tr('Next steps could not be loaded.');
  },
  actionFor: (label: string, title: string) => `${label}: ${title}`,
  get viewAll() {
    return tr('View all jobs');
  },
  get cvTitle() {
    return tr('Save your CV');
  },
  get cvBody() {
    return tr(
      'Add your CV once in My CV. Every job then uses it for matching and tailoring.',
    );
  },
  get cvAction() {
    return tr('Open My CV');
  },
  get cvReviewTitle() {
    return tr('Review your CV');
  },
  get cvReviewBody() {
    return tr(
      'Review your CV once in My CV. Every job then uses it for tailoring.',
    );
  },
  get cvReviewAction() {
    return tr('Review in My CV');
  },
  get welcome() {
    return tr('Welcome back');
  },
  tracking: (count: number) => tr('You are tracking {count} jobs.', { count }),
  needAttention: (count: number) =>
    tr('{count} follow-ups need your attention today.', { count }),
  allClear: () => tr('No follow-ups are waiting. Keep the momentum going.'),
  dueCount: (count: number) => tr('{count} due', { count }),
  get quickActions() {
    return tr('Quick actions');
  },
  get discoverHint() {
    return tr('Find new roles to review');
  },
  get cvHint() {
    return tr('Manage CVs and tailored versions');
  },
  get interviewHint() {
    return tr('Prepare for your next round');
  },
  get interviewPractice() {
    return tr('Interview practice');
  },
  get myCv() {
    return tr('My CV');
  },
};

const card = {
  borderRadius: `${surface.radius}px`,
  borderColor: surface.panelBorder,
  boxShadow: surface.panelShadow,
} as const;
type Tone = 'primary' | 'success' | 'secondary' | 'warning' | 'error';

function IconBadge({
  tone,
  size = 40,
  children,
}: {
  tone: Tone;
  size?: number;
  children: ReactNode;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: `${tone}.main`,
        bgcolor: (theme: Theme) => alpha(theme.palette[tone].main, 0.1),
        '& svg': { fontSize: size * 0.55 },
      }}
    >
      {children}
    </Box>
  );
}
const FOLLOW_UP_PREVIEW = 3;

// Persisted dates are local YYYY-MM-DD values; never parse them as UTC.
const shortDate = (value: string) => {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'short',
  });
};

function Panel({
  id,
  title,
  icon,
  badge,
  action,
  step = 0,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  step?: number;
  children: ReactNode;
}) {
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={id}
      sx={{ ...card, ...enter(step), minWidth: 0, overflow: 'hidden' }}
    >
      <Stack
        // Phones stack the heading above its action instead of wrapping both.
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 0.5, sm: 1 }}
        sx={{
          px: 2,
          pt: { xs: 2, md: 1.5 },
          pb: { xs: 1.5, md: 1 },
          minHeight: 44,
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Box aria-hidden sx={{ color: 'primary.main', display: 'flex' }}>
            {icon}
          </Box>
          <Typography id={id} component="h2" variant="h6">
            {title}
          </Typography>
          {badge}
        </Stack>
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
  const cells: {
    label: string;
    value: number;
    hint: string;
    tone: Tone;
    icon: ReactNode;
    alert?: boolean;
  }[] = [
    {
      label: copy.active,
      value: metrics.active,
      hint: copy.activeHint,
      tone: 'primary',
      icon: <WorkIcon />,
    },
    {
      label: copy.inProgress,
      value: metrics.inProgress,
      hint: copy.inProgressHint,
      tone: 'success',
      icon: <MailIcon />,
    },
    {
      label: copy.interview,
      value: metrics.interview,
      hint: copy.currentStatus,
      tone: 'secondary',
      icon: <EventIcon />,
    },
    {
      label: copy.due,
      value: due.length,
      hint: metrics.overdue ? copy.overdue(metrics.overdue) : copy.dueHint,
      tone: 'warning',
      icon: <NotificationsIcon />,
      alert: metrics.overdue > 0,
    },
  ];
  return (
    <Box component="section" aria-label={copy.summary} sx={{ minWidth: 0 }}>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: { xs: 1.5, md: 2 },
          // Desktop: icon, number and label on one line keeps the row short.
        }}
      >
        {cells.map(({ label, value, hint, tone, icon, alert }, index) => (
          <Paper
            key={label}
            variant="outlined"
            sx={{
              ...card,
              ...enter(index),
              px: { xs: 1.5, sm: 2 },
              py: { xs: 2, md: 1.25 },
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              gap: { xs: 1, sm: 1.5 },
              alignItems: { xs: 'flex-start', sm: 'center' },
              bgcolor: (theme: Theme) => alpha(theme.palette[tone].main, 0.035),
              transition: 'transform 160ms ease-out, border-color 160ms',
              '&:hover': {
                transform: 'translateY(-2px)',
                borderColor: (theme: Theme) =>
                  alpha(theme.palette[tone].main, 0.35),
              },
            }}
          >
            <IconBadge tone={tone}>{icon}</IconBadge>
            <Box
              sx={{
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column-reverse',
                justifyContent: 'flex-end',
              }}
            >
              <Typography
                component="dt"
                variant="body2"
                sx={{ fontWeight: 500 }}
              >
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
                sx={{ m: 0, fontWeight: 700, lineHeight: 1.15 }}
              >
                {value}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Box>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ pt: 1, px: 0.5, alignItems: 'center', flexWrap: 'wrap' }}
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
    </Box>
  );
}

const rowSx = {
  px: 2,
  py: { xs: 1.5, md: 1 },
  borderTop: 1,
  borderColor: 'divider',
  transition: 'background-color 160ms',
  '&:hover': { bgcolor: 'action.hover' },
} as const;

function JobRow({
  job,
  children,
  aside,
  sx,
}: {
  job: Opportunity;
  children: ReactNode;
  // Actions: beside the text from md up, below it on smaller screens.
  aside?: ReactNode;
  sx?: object;
}) {
  return (
    <Stack
      component="li"
      direction="row"
      spacing={1.5}
      sx={{ ...rowSx, ...sx }}
    >
      <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
        <IconBadge tone="primary" size={32}>
          <WorkIcon />
        </IconBadge>
      </Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 0.75, md: 2 }}
        sx={{ minWidth: 0, flex: 1, alignItems: { md: 'center' } }}
      >
        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
          <JobTitle job={job} />
          {children}
        </Stack>
        {aside}
      </Stack>
    </Stack>
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
      {tr(label)}{' '}
      <Box component="time" dateTime={date} title={date}>
        {shortDate(date)}
      </Box>
    </Typography>
  );
}

type Resolution = Exclude<OpportunityInput['followUpStatus'], 'PENDING'>;

/**
 * PUT needs the full record, so re-read the job first and write only if its
 * follow-up is still the one shown; this keeps the stale-write window small.
 * shortcut: no version check, so an edit saved between GET and PUT is lost;
 * add expectedVersion to PUT if multi-tab editing becomes common.
 */
async function resolveFollowUp(
  shown: Opportunity,
  status: Resolution,
): Promise<{ row: Opportunity; written: boolean }> {
  const fresh = await opportunityRequest<Opportunity>(`/${shown.id}`);
  if (
    fresh.followUpStatus !== 'PENDING' ||
    fresh.followUpDate !== shown.followUpDate
  )
    return { row: fresh, written: false };
  const payload = Object.fromEntries(
    Object.keys(emptyOpportunity()).map((key) => [
      key,
      fresh[key as keyof OpportunityInput],
    ]),
  ) as unknown as OpportunityInput;
  payload.followUpStatus = status;
  // Same size switch as JobEditor's save.
  const record = JSON.stringify(payload);
  const row = await opportunityRequest<Opportunity>(`/${shown.id}`, {
    method: 'PUT',
    body: record.length > 20000 ? importUpload(payload) : record,
  });
  return { row, written: true };
}

function FollowUps({
  due,
  onResolved,
}: {
  due: HomeSections['due'];
  onResolved: (row: Opportunity) => void;
}) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  const resolve = async (job: Opportunity, status: Resolution) => {
    setBusy(job.id);
    try {
      const { row, written } = await resolveFollowUp(job, status);
      onResolved(row);
      notify(
        written
          ? { severity: 'success', text: copy.resolved(job.title, status) }
          : { severity: 'info', text: copy.changedElsewhere(job.title) },
      );
    } catch (error) {
      notify({
        severity: 'error',
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };
  const actions = (job: Opportunity, variant: 'outlined' | 'text') => (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{
        flexShrink: 0,
        width: { xs: '100%', md: 'auto' },
        '& .MuiButton-root': { px: 1.25 },
      }}
    >
      <Button
        size="small"
        variant={variant}
        disabled={busy !== null}
        aria-label={copy.doneFor(job.title)}
        onClick={() => void resolve(job, 'DONE')}
      >
        {copy.done}
      </Button>
      <Button
        size="small"
        color="inherit"
        disabled={busy !== null}
        aria-label={copy.dismissFor(job.title)}
        onClick={() => void resolve(job, 'DISMISSED')}
      >
        {copy.dismiss}
      </Button>
      {applicationLink(job)}
    </Stack>
  );
  const [expanded, setExpanded] = useState(false);
  const [first, ...rest] = due;
  const shown = expanded ? rest : rest.slice(0, FOLLOW_UP_PREVIEW - 1);
  const hidden = rest.length - shown.length;
  const applicationLink = (job: Opportunity) => (
    <Button
      component={Link}
      to={`/jobs/${job.id}/application`}
      size="small"
      aria-label={copy.openApplicationFor(job.title)}
      sx={{ flexShrink: 0, ml: { xs: 'auto', md: 0 } }}
    >
      {copy.openApplication}
    </Button>
  );
  return (
    <Panel
      id="follow-ups-heading"
      title={copy.followUps}
      icon={<FlagIcon />}
      step={4}
      badge={
        due.length > 0 && (
          <Chip
            size="small"
            label={copy.dueCount(due.length)}
            color={
              due.some(({ label }) => label === 'Overdue') ? 'error' : 'warning'
            }
            variant="outlined"
          />
        )
      }
    >
      {!first ? (
        <Typography color="text.secondary" sx={{ px: 2, pb: 2 }}>
          {copy.followUpsEmpty}
        </Typography>
      ) : (
        <>
          <Box
            component="ul"
            id="more-follow-ups"
            sx={{ m: 0, p: 0, listStyle: 'none' }}
          >
            {[first, ...shown].map(({ job, label }, index) => (
              <JobRow
                key={job.id}
                job={job}
                aside={actions(job, index === 0 ? 'outlined' : 'text')}
                // The oldest follow-up is the one to act on now.
                sx={
                  index === 0
                    ? {
                        boxShadow: (theme: Theme) =>
                          `inset 3px 0 0 ${theme.palette[label === 'Overdue' ? 'error' : 'warning'].main}`,
                        bgcolor: (theme: Theme) =>
                          alpha(
                            theme.palette[
                              label === 'Overdue' ? 'error' : 'warning'
                            ].main,
                            0.05,
                          ),
                      }
                    : undefined
                }
              >
                <FollowUpDate label={label} date={job.followUpDate!} />
              </JobRow>
            ))}
          </Box>
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
      icon={<PlayCircleIcon />}
      step={5}
      action={
        <Button
          component={Link}
          to="/jobs"
          size="small"
          endIcon={<ArrowForwardIcon />}
        >
          {copy.viewAll}
        </Button>
      }
    >
      {items === 'loading' ? (
        <Stack spacing={1} sx={{ px: 2, pb: 2 }} aria-busy="true">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="rounded" height={84} />
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
            <JobRow
              key={job.id}
              job={job}
              aside={
                <Button
                  component={Link}
                  // Same destination as the job Overview's next step.
                  to={`/jobs/${job.id}/${action.to}`}
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowForwardIcon />}
                  aria-label={copy.actionFor(action.label, job.title)}
                  sx={{
                    alignSelf: { xs: 'flex-start', md: 'center' },
                    flexShrink: 0,
                  }}
                >
                  {action.label}
                </Button>
              }
            >
              <Typography variant="body2" color="text.secondary">
                {action.text}
              </Typography>
            </JobRow>
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
  const cvNotice = cvGuide && {
    title: known.cv.saved ? copy.cvReviewTitle : copy.cvTitle,
    body: known.cv.saved ? copy.cvReviewBody : copy.cvBody,
    action: known.cv.saved ? copy.cvReviewAction : copy.cvAction,
  };
  const loaded = sections && rows.length > 0;
  return (
    <Stack spacing={{ xs: 3, md: 2 }} sx={{ minWidth: 0 }}>
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
      {/* With jobs loaded the CV step moves into the side column. */}
      {cvNotice && !loaded && (
        <Alert
          severity="info"
          action={
            <Button component={Link} to="/cv" color="inherit" size="small">
              {cvNotice.action}
            </Button>
          }
        >
          <strong>{cvNotice.title}.</strong> {cvNotice.body}
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
        <Stack
          spacing={3}
          aria-busy="true"
          aria-label={tr('Loading dashboard')}
        >
          {/* Same footprint as the loaded page, so nothing jumps on arrival. */}
          <Skeleton variant="rounded" height={80} />
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
            }}
          >
            {[0, 1, 2, 3].map((cell) => (
              <Skeleton key={cell} variant="rounded" height={84} />
            ))}
          </Box>
          <Box sx={layout}>
            <Skeleton variant="rounded" height={280} />
            <Skeleton variant="rounded" height={280} />
          </Box>
        </Stack>
      ) : rows.length === 0 ? (
        <Paper
          variant="outlined"
          component="section"
          sx={{
            ...card,
            ...enter(0),
            p: { xs: 3, sm: 5 },
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <IconBadge tone="primary" size={56}>
            <WorkIcon />
          </IconBadge>
          <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
            {copy.emptyTitle}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
            {copy.emptyBody}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              startIcon={<AddIcon />}
              component={Link}
              to="/jobs/new"
              variant="contained"
            >
              {copy.addJob}
            </Button>
            <Button
              startIcon={<ExploreIcon />}
              component={Link}
              to="/discover"
              variant="outlined"
            >
              {copy.discover}
            </Button>
          </Stack>
        </Paper>
      ) : (
        <>
          <Welcome total={rows.length} due={sections.due.length} />
          <Summary sections={sections} total={rows.length} />
          <Box sx={layout}>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              <FollowUps
                due={sections.due}
                onResolved={(row) =>
                  setRows(
                    (current) =>
                      current?.map((item) =>
                        item.id === row.id ? row : item,
                      ) ?? current,
                  )
                }
              />
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
            </Stack>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              {cvNotice && (
                <Paper
                  component="section"
                  variant="outlined"
                  aria-labelledby="cv-step-heading"
                  sx={{ ...card, ...enter(4), p: 2.5 }}
                >
                  <Stack direction="row" spacing={1.5}>
                    <IconBadge tone="primary">
                      <DescriptionIcon />
                    </IconBadge>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        id="cv-step-heading"
                        component="h2"
                        variant="h6"
                      >
                        {cvNotice.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {cvNotice.body}
                      </Typography>
                      <Button
                        component={Link}
                        to="/cv"
                        variant="outlined"
                        size="small"
                        endIcon={<ArrowForwardIcon />}
                        sx={{ mt: 1.5 }}
                      >
                        {cvNotice.action}
                      </Button>
                    </Box>
                  </Stack>
                </Paper>
              )}
              <QuickActions />
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}

const layout = {
  display: 'grid',
  gap: { xs: 3, md: 2 },
  alignItems: 'start',
  gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
} as const;

function Welcome({ total, due }: { total: number; due: number }) {
  return (
    <Box
      component="section"
      aria-labelledby="welcome-heading"
      sx={{
        ...enter(0),
        position: 'relative',
        overflow: 'hidden',
        borderRadius: `${surface.radius}px`,
        px: { xs: 2.5, sm: 4 },
        py: { xs: 2.5, md: 2 },
        color: 'primary.contrastText',
        background: (theme: Theme) =>
          `linear-gradient(120deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main} 55%, ${alpha(theme.palette.primary.main, 0.75)})`,
      }}
    >
      {/* Decorative glyph standing in for the mockup illustration. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          right: { xs: -16, sm: 32 },
          top: '50%',
          transform: 'translateY(-50%) rotate(-8deg)',
          opacity: 0.18,
          display: 'flex',
          '& svg': { fontSize: { xs: 96, md: 88 } },
        }}
      >
        <WorkIcon />
      </Box>
      <Typography
        id="welcome-heading"
        component="h2"
        variant="h5"
        sx={{ position: 'relative', fontWeight: 600, fontSize: '1.375rem' }}
      >
        {copy.welcome}
      </Typography>
      <Typography
        sx={{ mt: 0.5, opacity: 0.92, position: 'relative', maxWidth: '60ch' }}
      >
        {copy.tracking(total)}{' '}
        {due > 0 ? copy.needAttention(due) : copy.allClear()}
      </Typography>
    </Box>
  );
}

function QuickActions() {
  const items = [
    {
      to: '/discover',
      label: copy.discover,
      hint: copy.discoverHint,
      icon: <ExploreIcon />,
    },
    {
      to: '/cv',
      label: copy.myCv,
      hint: copy.cvHint,
      icon: <DescriptionIcon />,
    },
    {
      to: '/interview-prep',
      label: copy.interviewPractice,
      hint: copy.interviewHint,
      icon: <ForumIcon />,
    },
  ];
  return (
    <Panel
      id="quick-actions-heading"
      title={copy.quickActions}
      icon={<BoltIcon />}
      step={5}
    >
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {items.map(({ to, label, hint, icon }) => (
          <li key={to}>
            <Box
              component={Link}
              to={to}
              sx={{
                ...rowSx,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                color: 'text.primary',
                textDecoration: 'none',
                '& .arrow': { transition: 'transform 160ms' },
                '&:hover .arrow': { transform: 'translateX(3px)' },
                '&:focus-visible': {
                  outline: (theme: Theme) =>
                    `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: -2,
                },
              }}
            >
              <IconBadge tone="primary" size={36}>
                {icon}
              </IconBadge>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {hint}
                </Typography>
              </Box>
              <ArrowForwardIcon
                className="arrow"
                fontSize="small"
                color="action"
              />
            </Box>
          </li>
        ))}
      </Box>
    </Panel>
  );
}
