import { theme } from './theme';
import { DiscoverJobsPage } from '../features/inbox/DiscoverJobsPage';
import { JobInbox } from '../features/inbox/JobInbox';
import { TailoredCvPage } from '../features/inbox/TailoredCvPage';
import { JobEditor } from '../features/inbox/JobEditor';
import { lazy, Suspense, useState } from 'react';
import {
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  IconButton,
  SvgIcon,
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
import { ApiReadiness } from '../features/health/ApiReadiness';

const UiAcceptancePreview = import.meta.env.DEV
  ? lazy(() => import('../features/dashboard/UiAcceptancePreview'))
  : null;

const navigation = [
  { label: 'Jobs', path: '/jobs' },
  { label: 'Discover', path: '/discover' },
  { label: 'My CV', path: '/cv' },
];
export function App() {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const desktop = useMediaQuery(theme.breakpoints.up('md'), {
    defaultMatches: true,
  });
  const navigationContent = (
    <>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
      >
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, letterSpacing: '-0.01em' }}
        >
          AI Job Hunter
        </Typography>
        {!desktop && (
          <IconButton
            aria-label="Close navigation"
            onClick={() => setNavigationOpen(false)}
            sx={{ width: 44, height: 44 }}
          >
            <SvgIcon aria-hidden="true" sx={{ fontSize: 20 }}>
              <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" />
            </SvgIcon>
          </IconButton>
        )}
      </Stack>
      <Stack
        component="nav"
        id="workspace-navigation"
        aria-label="Main navigation"
        spacing={0.5}
      >
        {navigation.map(({ label, path }) => (
          <Button
            key={path}
            component={NavLink}
            to={path}
            onClick={() => setNavigationOpen(false)}
            sx={{
              justifyContent: 'flex-start',
              minHeight: 44,
              px: 1.5,
              color: 'text.secondary',
              fontWeight: 500,
              '&.active': {
                bgcolor: 'action.selected',
                color: 'text.primary',
                fontWeight: 600,
              },
            }}
          >
            {label}
          </Button>
        ))}
      </Stack>
      {desktop && (
        <Box sx={{ mt: 'auto', pt: 2 }}>
          <ApiReadiness />
        </Box>
      )}
    </>
  );
  const jobsMatch = useMatch('/jobs');
  const inbox = Boolean(jobsMatch);
  const discoveryPage = Boolean(useMatch('/discover'));
  const [discoveryViewport, setDiscoveryViewport] = useState(false);
  const newJob = Boolean(useMatch('/jobs/new'));
  const jobDetails = Boolean(useMatch('/jobs/:id'));
  const [editorViewport, setEditorViewport] = useState(false);
  const bounded =
    inbox ||
    newJob ||
    (jobDetails && editorViewport) ||
    (discoveryPage && discoveryViewport);
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
          minHeight: bounded ? 0 : undefined,
          overflowY: bounded ? 'auto' : undefined,
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
            'aria-label': 'Workspace navigation',
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
          maxWidth="lg"
          sx={{
            display: { xs: 'block', md: 'none' },
            px: { xs: 2, sm: 3 },
            py: 0.5,
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
                aria-label="Open navigation"
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
                <SvgIcon aria-hidden="true" sx={{ fontSize: 20 }}>
                  <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />
                </SvgIcon>
              </IconButton>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                AI Job Hunter
              </Typography>
            </Stack>
            {!desktop && <ApiReadiness />}
          </Stack>
        </Container>
        <Divider sx={{ flexShrink: 0, display: { md: 'none' } }} />
        <Container
          component="main"
          maxWidth="lg"
          sx={{
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
          <Routes>
            <Route path="/" element={<Navigate to="/jobs" replace />} />
            <Route
              path="/discover"
              element={
                <DiscoverJobsPage
                  onViewportLayoutChange={setDiscoveryViewport}
                />
              }
            />
            <Route path="/cv" element={<Dashboard />} />
            <Route path="/jobs/:id/tailored-cv" element={<TailoredCvPage />} />
            <Route path="/jobs" element={<JobInbox />} />
            <Route
              path="/jobs/new"
              element={
                <JobEditor
                  key="new"
                  onViewportLayoutChange={setEditorViewport}
                />
              }
            />
            <Route
              path="/jobs/:id"
              element={<JobEditor onViewportLayoutChange={setEditorViewport} />}
            />
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
            {['/dashboard', '/candidates', '/matches', '/settings'].map(
              (path) => (
                <Route
                  key={path}
                  path={path}
                  element={<Navigate to="/jobs" replace />}
                />
              ),
            )}
            <Route
              path="*"
              element={
                <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <Typography variant="h4" component="h1">
                    Page not found
                  </Typography>
                  <Typography color="text.secondary">
                    This page does not exist in your workspace.
                  </Typography>
                  <Button component={Link} to="/jobs" variant="contained">
                    Back to Jobs
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
