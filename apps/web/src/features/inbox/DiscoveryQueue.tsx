import { RefreshIcon } from '../../components/icons';
import { StatusChip } from '../../components/StatusChip';
import { useEffect, useMemo, useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Alert,
  Button,
  Divider,
  Box,
  Paper,
  Stack,
  TablePagination,
  Typography,
} from '@mui/material';
import { Link, useSearchParams } from 'react-router-dom';
import {
  discoveryRequest,
  queueFilters,
  sourceLink,
  type QueueFilter,
  type QueuePage,
} from './discovery-api';
import { DiscoveryCandidateReview } from './DiscoveryCandidateReview';

export function DiscoveryQueue({
  revision,
  bounded = false,
}: {
  revision: number;
  bounded?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('filter');
  const filter: QueueFilter = queueFilters.some(
    ([value]) => value === rawFilter,
  )
    ? (rawFilter as QueueFilter)
    : 'to-review';
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const id = params.get('candidate');
  const key = `${filter}:${page}`;
  const [data, setData] = useState<{ key: string; value: QueuePage } | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const request = useMemo(
    () => ({ key, revision, refresh }),
    [key, revision, refresh],
  );
  const [completed, setCompleted] = useState<{
    request: typeof request;
    error: string;
  } | null>(null);
  const loading = completed?.request !== request;
  const error = loading ? '' : completed.error;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    discoveryRequest<QueuePage>(`/candidates?filter=${filter}&page=${page}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!active) return;
        setData({ key, value });
        setCompleted({ request, error: '' });
        if (value.page !== page)
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set('filter', filter);
              next.set('page', String(value.page));
              return next;
            },
            { replace: true },
          );
      })
      .catch((reason: unknown) => {
        if (active)
          setCompleted({
            request,
            error:
              reason instanceof Error
                ? reason.message
                : 'Could not load the queue. Retry.',
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [filter, page, key, request, setParams]);
  const visible = data?.key === key ? data.value : null;
  function navigate(nextFilter: QueueFilter, nextPage: number) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('filter', nextFilter);
      next.set('page', String(nextPage));
      next.delete('candidate');
      return next;
    });
  }
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby="discovery-queue-title"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: bounded ? 1 : undefined,
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <Stack data-queue-chrome spacing={2} sx={{ p: 2, flexShrink: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography id="discovery-queue-title" component="h2" variant="h6">
            Discovery queue
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            role="status"
            sx={{ minHeight: 20 }}
          >
            {loading
              ? 'Loading queue…'
              : visible
                ? `${visible.total} candidates`
                : ''}
          </Typography>
        </Stack>
        <Box
          role="group"
          aria-label="Queue filter"
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}
        >
          {queueFilters.map(([value, label]) => (
            <Button
              key={value}
              size="small"
              variant="outlined"
              color="inherit"
              aria-pressed={filter === value}
              onClick={() => navigate(value, 1)}
              sx={(theme) => ({
                minHeight: { xs: 44, sm: 32 },
                color: filter === value ? 'primary.main' : 'text.secondary',
                borderColor:
                  filter === value ? 'primary.main' : 'action.disabled',
                bgcolor:
                  filter === value
                    ? alpha(
                        theme.palette.primary.main,
                        theme.palette.action.selectedOpacity,
                      )
                    : undefined,
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor:
                    filter === value
                      ? alpha(
                          theme.palette.primary.main,
                          theme.palette.action.selectedOpacity,
                        )
                      : 'action.hover',
                },
              })}
            >
              {label}
            </Button>
          ))}
        </Box>
        {error && (
          <Alert
            severity="error"
            action={
              <Button
                startIcon={<RefreshIcon />}
                variant="outlined"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Retry queue
              </Button>
            }
          >
            {error}
          </Alert>
        )}
      </Stack>
      <Box
        role="region"
        aria-label="Discovery candidate rows"
        tabIndex={bounded ? 0 : undefined}
        sx={{
          flex: bounded ? 1 : undefined,
          minHeight: 0,
          minWidth: 0,
          overflowY: bounded ? 'auto' : 'visible',
          scrollbarGutter: bounded ? 'stable' : undefined,
          overflowAnchor: 'none',
          px: 2,
        }}
      >
        {visible && (
          <Stack
            component="ul"
            spacing={0}
            divider={<Divider component="li" role="presentation" />}
            sx={{ listStyle: 'none', p: 0, m: 0 }}
          >
            {visible.items.map((candidate) => (
              <Stack
                component="li"
                key={candidate.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                aria-current={id === candidate.id ? 'true' : undefined}
                sx={{
                  minWidth: 0,
                  px: 1.5,
                  py: 1.5,
                  alignItems: { sm: 'center' },
                  bgcolor: id === candidate.id ? 'action.selected' : undefined,
                  borderLeft: 3,
                  borderColor:
                    id === candidate.id ? 'primary.main' : 'transparent',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    useFlexGap
                  >
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      sx={{ overflowWrap: 'anywhere', fontWeight: 600 }}
                    >
                      {candidate.title}
                    </Typography>
                    <StatusChip status={candidate.status} />
                  </Stack>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {[candidate.company, candidate.location]
                      .filter(Boolean)
                      .join(' · ')}
                    {candidate.sourceName && (
                      <>
                        {' '}
                        ·{' '}
                        {sourceLink(candidate.originalLink) ? (
                          <Box
                            component="a"
                            href={sourceLink(candidate.originalLink)}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              color: 'inherit',
                              textUnderlineOffset: '3px',
                            }}
                          >
                            {candidate.sourceName}
                          </Box>
                        ) : (
                          candidate.sourceName
                        )}
                      </>
                    )}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap' }}
                >
                  <Button
                    // Per-row action stays tertiary so Run discovery leads.
                    variant="text"
                    onClick={() =>
                      setParams((current) => {
                        const next = new URLSearchParams(current);
                        next.set('candidate', candidate.id);
                        return next;
                      })
                    }
                    aria-label={`Review ${candidate.title}`}
                    aria-haspopup="dialog"
                    sx={{ minHeight: { xs: 44, sm: 36 } }}
                  >
                    Review
                  </Button>
                  {candidate.opportunityId && (
                    <Button
                      component={Link}
                      to={`/jobs/${candidate.opportunityId}`}
                      variant="outlined"
                    >
                      Open in Jobs
                    </Button>
                  )}
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
        {!loading && !error && visible?.total === 0 && (
          <Typography sx={{ py: 2 }}>
            {filter === 'to-review'
              ? 'No candidates to review. Run discovery or choose another filter.'
              : 'No candidates in this filter. Choose another filter or run discovery.'}
          </Typography>
        )}
      </Box>
      <TablePagination
        data-queue-chrome
        component="div"
        aria-label="Discovery queue pagination"
        count={data?.value.total ?? 0}
        page={(visible?.page ?? data?.value.page ?? 1) - 1}
        rowsPerPage={10}
        rowsPerPageOptions={[]}
        onPageChange={(_, nextPage) => navigate(filter, nextPage + 1)}
        disabled={loading}
        sx={{
          flexShrink: 0,
          borderTop: 1,
          borderColor: 'divider',
          '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', px: 2 },
        }}
      />
      {id && (
        <DiscoveryCandidateReview
          key={id}
          id={id}
          onChanged={() => setRefresh((value) => value + 1)}
          onClose={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete('candidate');
              return next;
            })
          }
        />
      )}
    </Paper>
  );
}
