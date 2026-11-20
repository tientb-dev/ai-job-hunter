import { dateLocale, tr } from '../../app/i18n';
import { AddIcon, EditIcon, SearchIcon } from '../../components/icons';
import { useNotify } from '../../components/useNotify';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Paper,
  Popover,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { discoveryRequest, type DiscoverySummary } from './discovery-api';
export function DiscoverJobs({ onDiscovered }: { onDiscovered: () => void }) {
  const notify = useNotify();
  const [detailsAnchor, setDetailsAnchor] = useState<HTMLElement | null>(null);
  const running = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [location, setLocation] = useState('Ho Chi Minh City');
  const [family, setFamily] = useState('All');
  // Optional IT-only narrowing; cleared when another family is chosen.
  const [stacks, setStacks] = useState<string[]>([]);
  const familyLabel = (value: string) =>
    value === 'All'
      ? tr('Any job family')
      : value === 'Sales'
        ? tr('Sales')
        : value;
  const [workMode, setWorkMode] = useState('All');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<DiscoverySummary | null>(null);
  const [error, setError] = useState('');
  const allFailed =
    summary !== null &&
    summary.sources.length > 0 &&
    summary.sourceFailures === summary.sources.length;
  async function discover() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');

    try {
      const result = await discoveryRequest<DiscoverySummary>('/runs', {
        method: 'POST',
        body: JSON.stringify({
          family,
          location,
          stacks,
          workMode,
        }),
      });
      setSummary(result);
      notify({
        // Only failed sources need acknowledgment; listing warnings stay in
        // Run details behind a normal success popup.
        severity: result.sourceFailures ? 'warning' : 'success',
        text:
          result.sources.length > 0 &&
          result.sourceFailures === result.sources.length
            ? tr('No sources available. Retry later; see Run details.')
            : tr(
                '{eligible} eligible · {added} added · {refreshed} known · {remaining} over limit{v4}',
                {
                  eligible: result.eligible,
                  added: result.added,
                  refreshed: result.refreshed,
                  remaining: result.remaining,
                  v4: result.sourceFailures
                    ? tr(' · {sourceFailures} source unavailable', {
                        sourceFailures: result.sourceFailures,
                      })
                    : '',
                },
              ),
      });
      onDiscovered();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : tr('Discovery failed. Retry later.'),
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Paper
      component="section"
      aria-label={tr('Discovery run')}
      variant="outlined"
      sx={{ p: 2 }}
    >
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2">
              {tr(
                'Up to 50 new candidates per run. Review before saving to Jobs.',
              )}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ overflowWrap: 'anywhere' }}
            >
              {location} · {familyLabel(family)}
              {stacks.length ? ` (${stacks.join(', ')})` : ''} ·{' '}
              {workMode === 'All' ? tr('Any work mode') : workMode}
            </Typography>
          </Box>
          <Button
            startIcon={<EditIcon />}
            variant="outlined"
            aria-expanded={expanded}
            aria-controls="discovery-preferences"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? tr('Hide preferences') : tr('Edit preferences')}
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => void discover()}
            startIcon={<SearchIcon />}
            sx={{ flexShrink: 0 }}
          >
            {tr('Run discovery')}
          </Button>
        </Stack>
        <Alert
          severity="info"
          role="note"
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<AddIcon />}
              component={Link}
              to="/jobs/new"
              sx={{ whiteSpace: 'nowrap' }}
            >
              {tr('Add job from JD or URL')}
            </Button>
          }
          sx={{ flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
        >
          {tr(
            'Discover only searches a few public company career boards (Axon, Backbase, Temus, Go1 Vietnam, Thoughtworks, Agoda), mostly IT roles. Found a job on another website? Add it from its JD or URL.',
          )}
        </Alert>
        {expanded && (
          <Stack id="discovery-preferences" spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {tr(
                'Job family and tech stacks filter results, and on-site roles outside Vietnam are excluded. Location and work mode only prioritize new candidates under the 50-new limit; unknown values stay eligible. The Queue keeps previous runs and is not reordered.',
              )}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                },
                gap: 1.5,
                pt: 0.5,
              }}
            >
              <TextField
                size="small"
                select
                fullWidth
                label={tr('Preferred location')}
                helperText={tr(
                  'Vietnam scope, including unspecified and global remote locations.',
                )}
                value={location}
                disabled={busy}
                onChange={(event) => setLocation(event.target.value)}
              >
                {['Ho Chi Minh City', 'Vietnam'].map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                select
                fullWidth
                label={tr('Job family')}
                helperText={tr(
                  'Filters by job title. Titles that are unclear or fit several families only appear under All.',
                )}
                value={family}
                disabled={busy}
                onChange={(event) => {
                  setFamily(event.target.value);
                  if (event.target.value !== 'IT') setStacks([]);
                }}
              >
                {['All', 'IT', 'Marketing', 'Sales'].map((value) => (
                  <MenuItem key={value} value={value}>
                    {familyLabel(value)}
                  </MenuItem>
                ))}
              </TextField>
              {family === 'IT' && (
                <TextField
                  size="small"
                  select
                  fullWidth
                  label={tr('Tech stack (optional)')}
                  helperText={tr(
                    'Leave empty for all IT roles. Matches any selected keyword in job text, including descriptions and preferred skills; not necessarily required skills.',
                  )}
                  value={stacks}
                  disabled={busy}
                  slotProps={{ select: { multiple: true } }}
                  onChange={(event) =>
                    setStacks(
                      typeof event.target.value === 'string'
                        ? event.target.value.split(',')
                        : event.target.value,
                    )
                  }
                >
                  {['Java', 'Spring Boot', 'Node.js', 'React'].map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                size="small"
                select
                fullWidth
                label={tr('Preferred work mode')}
                helperText={tr(
                  'Ranking only. All favors local onsite/hybrid roles.',
                )}
                value={workMode}
                disabled={busy}
                onChange={(event) => setWorkMode(event.target.value)}
              >
                {['All', 'Onsite', 'Hybrid', 'Remote'].map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          </Stack>
        )}
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', minHeight: 36 }}
        >
          <Button
            variant="outlined"
            disabled={!summary}
            onClick={(event) => setDetailsAnchor(event.currentTarget)}
            aria-haspopup="dialog"
            aria-expanded={Boolean(detailsAnchor)}
            aria-controls={detailsAnchor ? 'discovery-run-details' : undefined}
          >
            {tr('Run details')}
          </Button>
          <Typography variant="body2" role="status">
            {busy ? tr('Discovering public jobs…') : ''}
          </Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <Popover
          open={Boolean(detailsAnchor)}
          anchorEl={detailsAnchor}
          onClose={() => setDetailsAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{
            paper: { sx: { p: 2, maxWidth: 'min(32rem, calc(100vw - 32px))' } },
          }}
        >
          {summary && (
            <Stack
              id="discovery-run-details"
              spacing={1}
              role="dialog"
              aria-label={tr('Discovery run details')}
              sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
            >
              <Button
                variant="outlined"
                onClick={() => setDetailsAnchor(null)}
                sx={{ alignSelf: 'flex-end' }}
              >
                {tr('Close run details')}
              </Button>
              <Typography variant="subtitle2" component="h2">
                {tr('Latest discovery run')}
              </Typography>
              <Box
                component="dl"
                sx={{
                  m: 0,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  columnGap: 2,
                  rowGap: 0.5,
                }}
              >
                {[
                  [tr('Fetched listings'), summary.fetched],
                  [tr('Valid / normalized listings'), summary.normalized],
                  [tr('Eligible candidates (unique)'), summary.eligible],
                  [tr('Added candidates'), summary.added],
                  [tr('Known candidates'), summary.refreshed],
                  [tr('Not queued: 50-new limit'), summary.remaining],
                  [tr('Source failures'), summary.sourceFailures],
                  [tr('Normalization warnings'), summary.warnings.length],
                ].map(([label, count]) => (
                  <Box key={label} sx={{ display: 'contents' }}>
                    <Typography component="dt" variant="body2">
                      {label}
                    </Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                      {count}
                    </Typography>
                  </Box>
                ))}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {tr(
                  'Known means previously queued, including saved or dismissed candidates; snapshots and review states are unchanged. Listing totals may include repeated posts; eligible candidates are unique identities.',
                )}
              </Typography>
              {allFailed ? (
                <Typography variant="body2">
                  {tr(
                    'No sources available. Retry later; source cooldowns may apply. Your existing Queue is unchanged.',
                  )}
                </Typography>
              ) : summary.eligible === 0 ? (
                <Typography variant="body2">
                  {tr(
                    'No eligible candidates in this run. Try different preferences or add a job from its JD or URL. Your Queue includes previous runs and is unchanged.',
                  )}
                </Typography>
              ) : null}
              {summary.remaining > 0 && (
                <Typography variant="body2">
                  {tr('Run again to discover the remaining candidates.')}
                </Typography>
              )}
              <Typography variant="subtitle2" component="h3">
                {tr('Sources')}
              </Typography>
              {summary.sources.map((source) => (
                <Box
                  key={source.sourceKey}
                  component="section"
                  aria-label={source.sourceName}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {source.sourceName}
                  </Typography>
                  <Typography variant="body2">
                    {source.status === 'failed'
                      ? tr('Unavailable · listing counts unavailable')
                      : tr('{v0} fetched · {v1} valid · {v2} invalid', {
                          v0: source.fetched ?? 'Unavailable',
                          v1: source.normalized ?? 'Unavailable',
                          v2: source.invalid ?? 'Unavailable',
                        })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {source.cacheHit
                      ? tr('Cached data')
                      : source.fetchedAt
                        ? tr('Live fetch')
                        : tr('No successful fetch available')}
                    {source.fetchedAt
                      ? tr(' · Fetched {v0}', {
                          v0: new Date(source.fetchedAt).toLocaleString(
                            dateLocale(),
                          ),
                        })
                      : ''}
                  </Typography>
                  {source.failure && (
                    <Typography variant="body2" color="text.secondary">
                      {source.failure.message}
                    </Typography>
                  )}
                </Box>
              ))}
              {summary.warnings.map((message, index) => (
                <Typography key={index} variant="body2" color="text.secondary">
                  {message}
                </Typography>
              ))}
              <Typography variant="caption" color="text.secondary">
                {tr(
                  'Totals cover available feeds only. Source responses may be cached for five minutes. Fetch time is not a listing update time. Retry later after source failures.',
                )}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button component={Link} to="/jobs" variant="outlined">
                  {tr('View Jobs')}
                </Button>
                {summary.eligible === 0 && (
                  <Button
                    startIcon={<AddIcon />}
                    component={Link}
                    to="/jobs/new"
                    variant="outlined"
                  >
                    {tr('Add job from JD or URL')}
                  </Button>
                )}
              </Stack>
            </Stack>
          )}
        </Popover>
      </Stack>
    </Paper>
  );
}
