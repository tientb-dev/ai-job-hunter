import { PageHeader } from '../../components/PageHeader';
import {
  AddIcon,
  ExploreIcon,
  OpenInNewIcon,
  RefreshIcon,
} from '../../components/icons';
import { StatusChip } from '../../components/StatusChip';
import { dueFollowUp, useLocalCalendarDate } from './follow-ups';
import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TablePagination,
  Typography,
  Link as MuiLink,
} from '@mui/material';
import { Link } from 'react-router-dom';
import { jobUrlInfo, opportunityRequest } from './opportunities-api';
import type { Opportunity } from './opportunities-api';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed. Retry manually.';
export function JobInbox() {
  const today = useLocalCalendarDate();
  const [dueOnly, setDueOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
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
  const visibleRows = dueOnly
    ? rows.filter((row) => dueFollowUp(row.followUpDate, row.status, today))
    : rows;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visibleRows.length / 10) - 1),
  );
  const pageRows = visibleRows.slice(currentPage * 10, currentPage * 10 + 10);
  return (
    <Stack
      spacing={2}
      sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto' }}
    >
      <PageHeader
        title="Jobs"
        description="Your opportunities, conversations, and next steps."
        actions={
          <Button
            component={Link}
            to="/jobs/new"
            variant="contained"
            startIcon={<AddIcon />}
          >
            Add job
          </Button>
        }
      />
      <Paper
        component="section"
        aria-labelledby="saved-jobs-heading"
        variant="outlined"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: '0 1 auto',
          minHeight: 0,
        }}
      >
        <Stack
          spacing={1}
          sx={{
            px: 2,
            py: 1.5,
            flexShrink: 0,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
            }}
          >
            <Typography id="saved-jobs-heading" component="h2" variant="h6">
              Saved jobs{!loading && !error ? ` (${rows.length})` : ''}
            </Typography>
            <ToggleButtonGroup
              sx={{
                '& .MuiToggleButton-root': { px: 1.5, minHeight: 44 },
                '& .Mui-selected': {
                  bgcolor: 'action.selected',
                  color: 'primary.main',
                  fontWeight: 600,
                },
                '& .Mui-focusVisible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                  zIndex: 1,
                },
              }}
              exclusive
              size="small"
              value={dueOnly ? 'due' : 'all'}
              aria-label="Saved jobs filter"
              onChange={(_, value: string | null) => {
                if (value === null) return;
                setDueOnly(value === 'due');
                setPage(0);
              }}
            >
              <ToggleButton value="all">All jobs</ToggleButton>
              <ToggleButton value="due">Due follow-ups</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
        {error && (
          <Alert
            severity="error"
            action={
              <Button
                startIcon={<RefreshIcon />}
                onClick={() => {
                  setLoading(true);
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        )}
        {loading ? (
          <Stack direction="row" spacing={1} sx={{ p: 3 }} role="status">
            <CircularProgress size={20} aria-label="Loading opportunities" />
            <Typography variant="body2">Loading jobs…</Typography>
          </Stack>
        ) : (
          !error && (
            <TableContainer
              tabIndex={0}
              role="region"
              aria-label="Scrollable saved jobs"
              sx={{
                flex: '0 1 auto',
                minHeight: 0,
                overflow: 'auto',
                overflowAnchor: 'none',
              }}
            >
              <Table
                size="small"
                aria-label="Saved opportunities"
                sx={{
                  tableLayout: 'fixed',
                  '& tr:last-child td': { borderBottom: 0 },
                  '& td, & th': {
                    overflowWrap: 'anywhere',
                    verticalAlign: 'top',
                    py: 1.5,
                    px: 2,
                  },
                }}
              >
                <TableBody>
                  {pageRows.map((row) => {
                    const urgency = dueFollowUp(
                      row.followUpDate,
                      row.status,
                      today,
                    );
                    const source =
                      row.discovery?.sourceName ??
                      [row.source, jobUrlInfo(row.originalLink).platform]
                        .filter(Boolean)
                        .join(' · ');
                    return (
                      <TableRow
                        key={row.id}
                        hover
                        sx={{
                          '&:focus-within': { bgcolor: 'action.selected' },
                          '& .MuiLink-root:focus-visible': {
                            outline: '2px solid',
                            outlineColor: 'primary.main',
                            outlineOffset: 2,
                            borderRadius: 0.5,
                          },
                        }}
                      >
                        <TableCell>
                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: {
                                xs: 'minmax(0, 1fr) auto',
                                sm: 'minmax(0, 1fr) minmax(0, 12rem) auto',
                              },
                              columnGap: 2,
                              rowGap: 1,
                              alignItems: 'center',
                            }}
                          >
                            <Box sx={{ minWidth: 0 }}>
                              <MuiLink
                                component={Link}
                                to={`/jobs/${row.id}`}
                                underline="hover"
                                color="text.primary"
                                variant="body1"
                                sx={{
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  minHeight: { xs: 44, sm: 24 },
                                  lineHeight: 1.5,
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {row.title}
                              </MuiLink>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mt: { xs: 0, sm: 0.5 }, lineHeight: 1.5 }}
                              >
                                <Box
                                  component="span"
                                  sx={{
                                    color: 'text.primary',
                                    fontWeight: 500,
                                  }}
                                >
                                  {row.company || 'Unknown company'}
                                </Box>
                                {' · '}
                                <Box component="span">{source}</Box>
                              </Typography>
                            </Box>
                            <Stack
                              direction={{ xs: 'row', sm: 'column' }}
                              useFlexGap
                              spacing={0.5}
                              sx={{
                                gridColumn: { xs: 1, sm: 2 },
                                flexWrap: 'wrap',
                                alignItems: {
                                  xs: 'center',
                                  sm: 'flex-end',
                                },
                              }}
                            >
                              <StatusChip status={row.status} />
                              {row.followUpDate &&
                                (urgency ? (
                                  <MuiLink
                                    component={Link}
                                    to={`/jobs/${row.id}/application`}
                                    aria-label={`${urgency}: open Application for ${row.title}`}
                                    title={row.followUpDate}
                                    color="text.primary"
                                    underline="hover"
                                    sx={{
                                      typography: 'caption',
                                      fontWeight: 600,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      minHeight: { xs: 44, sm: 24 },
                                    }}
                                  >
                                    {urgency}
                                  </MuiLink>
                                ) : (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    aria-label={`Follow-up ${row.followUpDate}`}
                                  >
                                    {row.followUpDate}
                                  </Typography>
                                ))}
                            </Stack>
                            {row.originalLink &&
                              jobUrlInfo(row.originalLink).valid && (
                                <Tooltip title="Open original job / apply">
                                  <IconButton
                                    component="a"
                                    href={row.originalLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Original job / apply for ${row.title}`}
                                    size="small"
                                    sx={{
                                      width: 44,
                                      height: 44,
                                      color: 'text.secondary',
                                      gridColumn: { xs: 2, sm: 3 },
                                      gridRow: { xs: '1 / 3', sm: 1 },
                                    }}
                                  >
                                    <OpenInNewIcon sx={{ fontSize: 20 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!visibleRows.length && (
                    <TableRow>
                      <TableCell sx={{ '&&': { py: 3 } }}>
                        <Typography
                          variant="h6"
                          component="h3"
                          sx={{ fontWeight: 600, mb: 0.5 }}
                        >
                          {dueOnly
                            ? 'No due follow-ups'
                            : 'No saved opportunities yet'}
                        </Typography>
                        <Typography
                          color="text.secondary"
                          sx={{ maxWidth: '52ch', mb: 2 }}
                        >
                          {dueOnly
                            ? 'No active jobs have a follow-up due today or earlier. Clear the filter to see all jobs.'
                            : 'Add a job from a website, recruiter conversation, or email to start tracking it.'}
                        </Typography>
                        {dueOnly ? (
                          <Button
                            onClick={() => {
                              setDueOnly(false);
                              setPage(0);
                            }}
                          >
                            Clear filter
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
                              Discover jobs
                            </Button>
                            <Button
                              startIcon={<AddIcon />}
                              component={Link}
                              to="/jobs/new"
                              variant="outlined"
                            >
                              Add job
                            </Button>
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )
        )}
        {!loading && !error && (
          <TablePagination
            component="div"
            aria-label="Jobs pagination"
            count={visibleRows.length}
            page={currentPage}
            rowsPerPage={10}
            rowsPerPageOptions={[]}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            labelDisplayedRows={({ from, to, count }) =>
              `${from}–${to} of ${count} jobs`
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
    </Stack>
  );
}
