import { surface, theme } from './theme';
import {
  ArrowBackIcon,
  CloseIcon,
  DashboardIcon,
  DescriptionIcon,
  ExploreIcon,
  ForumIcon,
  MenuIcon,
  WorkIcon,
} from '../components/icons';
import { DiscoverJobsPage } from '../features/inbox/DiscoverJobsPage';
import { JobInbox } from '../features/inbox/JobInbox';
import { JobEditor, JobEditorForJob } from '../features/inbox/JobEditor';
import { lazy, Suspense, useState } from 'react';
import {
  Box,
  Button,
  Container,
  Drawer,
  IconButton,
  useMediaQuery,
  Stack,
  Typography,
} from '@mui/material';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useMatch,
} from 'react-router-dom';
import { Dashboard } from '../features/dashboard/Dashboard';
import { MyCv } from '../features/inbox/MyCv';
import { SourceCvReviewPage } from '../features/inbox/SourceCvReviewPage';
import { Home } from '../features/home/Home';
import { InterviewPrep } from '../features/interview-prep/InterviewPrep';
import { JobPractice } from '../features/interview-prep/JobPractice';
import { MockInterview } from '../features/interview-prep/MockInterview';
import { ApiReadiness } from '../features/health/ApiReadiness';
import { AccountMenu } from '../features/auth/session';
import { useI18n, type MessageKey } from './i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

const UiAcceptancePreview = import.meta.env.DEV
  ? lazy(() => import('../features/dashboard/UiAcceptancePreview'))
  : null;

const navigation: {
  label: MessageKey;
  path: string;
  Icon: typeof DashboardIcon;
}[] = [
  { label: 'nav.dashboard', path: '/dashboard', Icon: DashboardIcon },
  { label: 'nav.jobs', path: '/jobs', Icon: WorkIcon },
  { label: 'nav.discover', path: '/discover', Icon: ExploreIcon },
  { label: 'nav.cv', path: '/cv', Icon: DescriptionIcon },
  { label: 'nav.interview', path: '/interview-prep', Icon: ForumIcon },
];
// Wider than MUI xl (1536) so 2K screens use the space; capped to avoid edge-to-edge lines.
const SHELL_MAX_WIDTH = 1920;

export function App() {
  const { t } = useI18n();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const desktop = useMediaQuery(theme.breakpoints.up('md'), {
    defaultMatches: true,
  });
  const jobPractice = Boolean(useMatch('/interview-prep/jobs/*'));
  const navigationContent = (
    <>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
      >
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'primary.main',
          }}
        >
          AI Job Hunter
        </Typography>
        {!desktop && (
          <IconButton
            aria-label={t('nav.close')}
            onClick={() => setNavigationOpen(false)}
            sx={{ width: 44, height: 44 }}
          >
            <CloseIcon sx={{ fontSize: 20 }} />
          </IconButton>
        )}
      </Stack>
      <Stack
        component="nav"
        id="workspace-navigation"
        aria-label={t('nav.main')}
        spacing={0.5}
      >
        {navigation.map(({ label, path, Icon }) => (
          <Button
            key={path}
            component={NavLink}
            to={path}
            // Job-specific practice belongs to a saved job: Jobs, not the curated catalog.
            end={path === '/interview-prep'}
            className={path === '/jobs' && jobPractice ? 'active' : undefined}
            onClick={() => setNavigationOpen(false)}
            startIcon={<Icon />}
            sx={{
              justifyContent: 'flex-start',
              minHeight: 44,
              px: 1.5,
              color: 'text.secondary',
              fontWeight: 500,
              '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
              // Inset indicator: no width change, so the label never shifts.
              '&.active': {
                bgcolor: surface.primaryTint,
                color: 'primary.dark',
                fontWeight: 600,
                boxShadow: (t) => `inset 3px 0 0 ${t.palette.primary.main}`,
              },
            }}
          >
            {t(label)}
          </Button>
        ))}
      </Stack>
    </>
  );
  const jobsMatch = useMatch('/jobs');
  const inbox = Boolean(jobsMatch);
  const discoveryPage = Boolean(useMatch('/discover'));
  const [discoveryViewport, setDiscoveryViewport] = useState(false);
  const bounded = inbox || (discoveryPage && discoveryViewport);
  return (
    <Box
      sx={{
        minHeight: bounded ? 0 : '100vh',
        height: bounded ? '100dvh' : undefined,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '208px minmax(0, 1fr)' },
        gridTemplateRows: bounded ? 'minmax(0, 1fr)' : '1fr',
      }}
    >
      <Box
        component="aside"
        sx={{
          display: { xs: 'none', md: 'flex' },
          // Stays in view while the document scrolls; long navigation scrolls itself.
          position: 'sticky',
          top: 0,
          alignSelf: 'start',
          height: '100dvh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          bgcolor: 'background.paper',
          borderRight: 1,
          borderColor: 'divider',
          px: 2,
          py: 2,
          flexDirection: 'column',
        }}
      >
        {desktop && navigationContent}
      </Box>
      <Drawer
        open={navigationOpen && !desktop}
        onClose={() => setNavigationOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: 280,
              maxWidth: 'calc(100vw - 32px)',
              p: 2,
              borderRadius: 0,
            },
            role: 'dialog',
            'aria-label': t('nav.workspace'),
          },
        }}
      >
        {!desktop && navigationContent}
      </Drawer>
      <Box
        sx={{
          minWidth: 0,
          ...(bounded && {
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }),
        }}
      >
        <Container
          component="header"
          maxWidth={false}
          // Sticky so language and sign-out stay reachable on long pages.
          sx={{
            maxWidth: SHELL_MAX_WIDTH,
            position: 'sticky',
            top: 0,
            zIndex: 'appBar',
            // Frosted bar keeps content readable under it while scrolling.
            bgcolor: 'rgba(245, 248, 255, 0.92)',
            backdropFilter: 'saturate(180%) blur(8px)',
            borderBottom: 1,
            borderColor: 'divider',
            px: { xs: 2, sm: 3 },
            py: 1,
            flexShrink: 0,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              minHeight: 44,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <IconButton
                aria-label={t('nav.open')}
                aria-expanded={navigationOpen && !desktop}
                aria-controls={
                  navigationOpen && !desktop
                    ? 'workspace-navigation'
                    : undefined
                }
                onClick={() => setNavigationOpen(true)}
                sx={{
                  display: { xs: 'inline-flex', md: 'none' },
                  width: 44,
                  height: 44,
                }}
              >
                <MenuIcon sx={{ fontSize: 20 }} />
              </IconButton>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  color: 'primary.main',
                  display: { md: 'none' },
                }}
              >
                AI Job Hunter
              </Typography>
            </Stack>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', ml: 'auto' }}
            >
              <LanguageSwitcher />
              <AccountMenu compact={!desktop} />
            </Stack>
          </Stack>
        </Container>
        <Container
          component="main"
          maxWidth={false}
          sx={{
            maxWidth: SHELL_MAX_WIDTH,
            px: { xs: 2, sm: 3 },
            py: 3,
            ...(bounded && {
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }),
          }}
        >
          <ApiReadiness />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Home />} />
            <Route
              path="/discover"
              element={
                <DiscoverJobsPage
                  onViewportLayoutChange={setDiscoveryViewport}
                />
              }
            />
            <Route path="/cv" element={<MyCv />} />
            <Route path="/cv/:cvId/review" element={<SourceCvReviewPage />} />
            <Route path="/interview-prep" element={<InterviewPrep />} />
            <Route path="/interview-prep/mock" element={<MockInterview />} />
            <Route
              path="/interview-prep/jobs/:jobId/sets/:setId"
              element={<JobPractice />}
            />
            <Route path="/cv/analyze" element={<Dashboard />} />
            <Route path="/jobs" element={<JobInbox />} />
            <Route path="/jobs/new" element={<JobEditor key="new" />} />
            <Route path="/jobs/:id/*" element={<JobEditorForJob />} />
            {UiAcceptancePreview && (
              <Route
                path="/dashboard/ui-check"
                element={
                  <Suspense
                    fallback={
                      <Typography>Loading synthetic preview…</Typography>
                    }
                  >
                    <UiAcceptancePreview />
                  </Suspense>
                }
              />
            )}
            {/* Retired placeholder pages keep old bookmarks working. */}
            {['/candidates', '/matches', '/settings'].map((path) => (
              <Route
                key={path}
                path={path}
                element={<Navigate to="/jobs" replace />}
              />
            ))}
            <Route
              path="*"
              element={
                <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <Typography variant="h4" component="h1">
                    {t('notFound.title')}
                  </Typography>
                  <Typography color="text.secondary">
                    {t('notFound.text')}
                  </Typography>
                  <Button
                    startIcon={<ArrowBackIcon />}
                    component={Link}
                    to="/jobs"
                    variant="contained"
                  >
                    {t('notFound.back')}
                  </Button>
                </Stack>
              }
            />
          </Routes>
        </Container>
      </Box>
    </Box>
  );
}
