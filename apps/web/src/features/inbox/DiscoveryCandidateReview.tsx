import {
  ArrowForwardIcon,
  CheckIcon,
  CloseIcon,
  RefreshIcon,
  SaveIcon,
} from '../../components/icons';
import { DialogCloseButton } from '../../components/DialogCloseButton';
import { StatusChip } from '../../components/StatusChip';
import { useNotify } from '../../components/useNotify';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router-dom';
import {
  discoveryRequest,
  DiscoveryRequestError,
  sourceLink,
  type CandidateDetail,
  type SaveResult,
} from './discovery-api';

export function DiscoveryCandidateReview({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notify = useNotify();
  const [conflict, setConflict] = useState<DiscoveryRequestError | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    discoveryRequest<CandidateDetail>(`/candidates/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (active) setCandidate(value);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Could not load this candidate. Retry.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [id, attempt]);
  async function act(
    action: 'SEEN' | 'DISMISSED' | 'SAVE',
    confirmSeparate = false,
  ) {
    if (running.current || !candidate) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'SAVE') {
        const result = await discoveryRequest<SaveResult>(
          `/candidates/${encodeURIComponent(id)}/save`,
          {
            method: 'POST',
            body: JSON.stringify(
              confirmSeparate ? { confirmSeparate: true } : {},
            ),
          },
        );
        onChanged();
        if (!mounted.current) return;
        setCandidate((current) =>
          current
            ? {
                ...current,
                status: 'SAVED',
                opportunityId: result.opportunityId,
              }
            : current,
        );
        setConflict(null);
        notify({
          severity: 'success',
          text:
            result.outcome === 'created'
              ? 'Job saved to Jobs.'
              : 'Linked to the existing job. Its details and application history are unchanged.',
        });
      } else {
        const result = await discoveryRequest<CandidateDetail>(
          `/candidates/${encodeURIComponent(id)}/status`,
          { method: 'PATCH', body: JSON.stringify({ status: action }) },
        );
        onChanged();
        if (!mounted.current) return;
        setCandidate(result);
        notify({
          severity: 'success',
          text:
            action === 'SEEN'
              ? 'Marked as seen.'
              : 'Candidate dismissed. You can still save it from the Dismissed filter.',
        });
      }
    } catch (reason) {
      if (!mounted.current) return;
      if (reason instanceof DiscoveryRequestError && reason.code) {
        setConflict(reason);
        setError('');
      } else {
        setConflict(null);
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not update this candidate. Retry.',
        );
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const link = candidate && sourceLink(candidate.originalLink);
  return (
    <>
      <Dialog
        open
        onClose={() => {
          if (!busy) onClose();
        }}
        maxWidth="md"
        fullWidth
        aria-labelledby="candidate-review-title"
        aria-busy={busy}
      >
        <DialogTitle
          id="candidate-review-title"
          sx={{ overflowWrap: 'anywhere' }}
        >
          {candidate?.title ?? 'Review candidate'}
        </DialogTitle>
        <DialogContent
          dividers
          sx={{ overflowWrap: 'anywhere', '& h3': { fontWeight: 600 } }}
        >
          <Stack spacing={2}>
            {loading && (
              <Typography role="status">Loading candidate…</Typography>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {!loading && !candidate && (
              <Button
                startIcon={<RefreshIcon />}
                variant="outlined"
                onClick={() => {
                  setLoading(true);
                  setError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Retry candidate
              </Button>
            )}
            {candidate && (
              <>
                <Box sx={{ alignSelf: 'flex-start' }}>
                  <StatusChip status={candidate.status} />
                </Box>
                <Typography>
                  {[
                    candidate.company,
                    candidate.location,
                    candidate.workMode,
                    candidate.seniority,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {candidate.sourceName} · Opening details does not mark this
                  candidate as seen.
                </Typography>
                {link && (
                  <MuiLink
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ alignSelf: 'flex-start', overflowWrap: 'anywhere' }}
                  >
                    Original source job
                  </MuiLink>
                )}
                <Typography variant="subtitle1" component="h3">
                  Job description
                </Typography>
                <Typography
                  sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {candidate.description || 'No description available.'}
                </Typography>
                {candidate.skills && (
                  <>
                    <Typography variant="subtitle1" component="h3">
                      Requirements
                    </Typography>
                    <Typography
                      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {candidate.skills}
                    </Typography>
                  </>
                )}
                {candidate.preferredSkills && (
                  <>
                    <Typography variant="subtitle1" component="h3">
                      Preferred qualifications
                    </Typography>
                    <Typography
                      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {candidate.preferredSkills}
                    </Typography>
                  </>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            flexWrap: 'wrap',
            gap: 1,
            p: 2,
            '& .MuiButton-root': { minHeight: { xs: 44, sm: 36 } },
          }}
        >
          <Button disabled={busy} onClick={onClose}>
            Close review
          </Button>
          {candidate && !loading && (
            <>
              {candidate.status === 'NEW' && (
                <Button
                  variant="outlined"
                  startIcon={<CheckIcon />}
                  disabled={busy}
                  onClick={() => void act('SEEN')}
                >
                  Mark as seen
                </Button>
              )}
              {['NEW', 'SEEN'].includes(candidate.status) && (
                <Button
                  disabled={busy}
                  variant="outlined"
                  // Neutral until hovered or focused: dismissing is a negative action.
                  color="error"
                  startIcon={<CloseIcon />}
                  onClick={() => void act('DISMISSED')}
                >
                  Dismiss
                </Button>
              )}
              {candidate.opportunityId ? (
                <Button
                  component={Link}
                  to={`/jobs/${candidate.opportunityId}`}
                  variant="outlined"
                  endIcon={<ArrowForwardIcon />}
                >
                  Open in Jobs
                </Button>
              ) : (
                <Button
                  startIcon={<SaveIcon />}
                  disabled={busy}
                  variant="contained"
                  onClick={() => void act('SAVE')}
                >
                  Save to Jobs
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(conflict)}
        onClose={() => {
          if (!busy) setConflict(null);
        }}
        maxWidth="sm"
        fullWidth
        aria-labelledby="duplicate-confirm-title"
      >
        <DialogCloseButton disabled={busy} onClick={() => setConflict(null)} />
        <DialogTitle id="duplicate-confirm-title" sx={{ pr: 7 }}>
          {conflict?.code === 'POSSIBLE_DUPLICATE'
            ? 'Possible duplicate job'
            : 'Multiple exact matches in Jobs'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Alert severity="warning">{conflict?.message}</Alert>
            {conflict?.matches.map((match) => (
              <Stack key={match.id}>
                <MuiLink
                  component={Link}
                  to={`/jobs/${match.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {match.title}
                </MuiLink>
                <Typography variant="body2">
                  {[match.company, match.location].filter(Boolean).join(' · ')}
                </Typography>
              </Stack>
            ))}
            <Typography>
              {conflict?.code === 'POSSIBLE_DUPLICATE'
                ? 'Create a separate job only if these are different openings. Existing jobs will not be changed.'
                : 'No job was created or linked. Review the existing jobs; this candidate remains in the queue.'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => setConflict(null)}
            autoFocus
          >
            {conflict?.code === 'POSSIBLE_DUPLICATE' ? 'Cancel' : 'Close'}
          </Button>
          {conflict?.code === 'POSSIBLE_DUPLICATE' && (
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              disabled={busy}
              onClick={() => void act('SAVE', true)}
            >
              Save as separate job
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
