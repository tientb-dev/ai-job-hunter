import { AddIcon, SearchIcon } from '../../components/icons';
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
  const [stacks, setStacks] = useState([
    'Java',
    'Spring Boot',
    'Node.js',
    'React',
  ]);
  const [workMode, setWorkMode] = useState('All');
  const [seniority, setSeniority] = useState('Senior');
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
        body: JSON.stringify({ location, stacks, workMode, seniority }),
      });
      setSummary(result);
      notify({
        severity:
          result.sourceFailures || result.warnings.length
            ? 'warning'
            : 'success',
        text:
          result.sources.length > 0 &&
          result.sourceFailures === result.sources.length
            ? 'No sources available. Retry later; see Run details.'
            : `${result.eligible} eligible · ${result.added} added · ${result.refreshed} known · ${result.remaining} over limit${result.sourceFailures ? ` · ${result.sourceFailures} source unavailable` : ''}`,
      });
      onDiscovered();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Discovery failed. Retry later.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <Paper
      component="section"
      aria-label="Discovery run"
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
              Up to 50 new candidates per run. Review before saving to Jobs.
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ overflowWrap: 'anywhere' }}
            >
              {location} ·{' '}
              {stacks.length ? stacks.join(', ') : 'Select a tech stack'} ·{' '}
              {workMode === 'All' ? 'Any work mode' : workMode} ·{' '}
              {seniority === 'All' ? 'Any seniority' : seniority}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            aria-expanded={expanded}
            aria-controls="discovery-preferences"
            onClick={() => setExpanded((value) => !value)}
            sx={{ minHeight: { xs: 44, sm: 36 } }}
          >
            {expanded ? 'Hide preferences' : 'Edit preferences'}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !stacks.length}
            onClick={() => void discover()}
            startIcon={<SearchIcon />}
            sx={{ flexShrink: 0, minHeight: { xs: 44, sm: 36 } }}
          >
            Run discovery
          </Button>
        </Stack>
        {expanded && (
          <Stack id="discovery-preferences" spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Greenhouse searches Axon, Backbase, Temus, and Go1 Vietnam.
              Location, work mode, and level prioritize new candidates under the
              50-new limit; they do not filter or reorder the Queue. The Queue
              includes candidates from previous runs.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Unknown location, work mode, or level may remain eligible under
              existing rules. A selected stack must still match job text.
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  lg: 'repeat(4, minmax(0, 1fr))',
                },
                gap: 2,
              }}
            >
              <TextField
                size="small"
                select
                fullWidth
                label="Preferred location"
                helperText="Vietnam scope, including unspecified and global remote locations."
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
                label="Must mention any selected stack"
                helperText="Matches any selected keyword in job text, including descriptions and preferred skills; not necessarily required skills."
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
              <TextField
                size="small"
                select
                fullWidth
                label="Preferred work mode"
                helperText="Ranking only. All favors local onsite/hybrid roles."
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
              <TextField
                size="small"
                select
                fullWidth
                label="Preferred level"
                helperText="Ranking only. Senior includes technical leads."
                value={seniority}
                disabled={busy}
                onChange={(event) => setSeniority(event.target.value)}
              >
                {['Senior', 'Technical Lead', 'All'].map((value) => (
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
            Run details
          </Button>
          <Typography variant="body2" role="status">
            {busy ? 'Discovering public jobs…' : ''}
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
              aria-label="Discovery run details"
              sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
            >
              <Button
                variant="outlined"
                onClick={() => setDetailsAnchor(null)}
                sx={{ alignSelf: 'flex-end' }}
              >
                Close run details
              </Button>
              <Typography variant="subtitle2" component="h2">
                Latest discovery run
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
                  ['Fetched listings', summary.fetched],
                  ['Valid / normalized listings', summary.normalized],
                  ['Eligible candidates (unique)', summary.eligible],
                  ['Added candidates', summary.added],
                  ['Known candidates', summary.refreshed],
                  ['Not queued: 50-new limit', summary.remaining],
                  ['Source failures', summary.sourceFailures],
                  ['Normalization warnings', summary.warnings.length],
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
                Known means previously queued, including saved or dismissed
                candidates; snapshots and review states are unchanged. Listing
                totals may include repeated posts; eligible candidates are
                unique identities.
              </Typography>
              {allFailed ? (
                <Typography variant="body2">
                  No sources available. Retry later; source cooldowns may apply.
                  Your existing Queue is unchanged.
                </Typography>
              ) : summary.eligible === 0 ? (
                <Typography variant="body2">
                  No eligible candidates in this run. Try different selected
                  stacks or Add job. Your Queue includes previous runs and is
                  unchanged.
                </Typography>
              ) : null}
              {summary.remaining > 0 && (
                <Typography variant="body2">
                  Run again to discover the remaining candidates.
                </Typography>
              )}
              <Typography variant="subtitle2" component="h3">
                Sources
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
                      ? 'Unavailable · listing counts unavailable'
                      : `${source.fetched ?? 'Unavailable'} fetched · ${source.normalized ?? 'Unavailable'} valid · ${source.invalid ?? 'Unavailable'} invalid`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {source.cacheHit
                      ? 'Cached data'
                      : source.fetchedAt
                        ? 'Live fetch'
                        : 'No successful fetch available'}
                    {source.fetchedAt
                      ? ` · Fetched ${new Date(source.fetchedAt).toLocaleString()}`
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
                Totals cover available feeds only. Source responses may be
                cached for five minutes. Fetch time is not a listing update
                time. Retry later after source failures.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button component={Link} to="/jobs" variant="outlined">
                  View Jobs
                </Button>
                {summary.eligible === 0 && (
                  <Button
                    startIcon={<AddIcon />}
                    component={Link}
                    to="/jobs/new"
                    variant="outlined"
                  >
                    Add job
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
