import { ArrowForwardIcon, AutoAwesomeIcon } from '../../components/icons';
import { useEffect, useId, useRef, useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { statusLabel, type MatchResult } from './cv-match.types';
import {
  hasSuggestionContext,
  isSuggestionsResponse,
  sameSuggestionSource,
  type CvSuggestionsResponse,
  type SuggestionCard,
} from './cv-suggestions.contract';

class SuggestionRequestFailure extends Error {}

export function CvSuggestionsSection({
  result,
  jobId,
  disabled,
  onBusyChange,
  onInspect,
  onGoToMatch,
  onInvalidContext,
  cvSaved,
  jobDirty,
  rejected,
}: {
  result: MatchResult | null;
  jobId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onInspect: (parentId: string) => void;
  onGoToMatch: () => void;
  onInvalidContext: () => void;
  cvSaved: boolean;
  jobDirty: boolean;
  rejected: boolean;
}) {
  const heading = useId();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CvSuggestionsResponse | null>(null);
  const [error, setError] = useState('');
  const stale = rejected;
  const [showAll, setShowAll] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [copying, setCopying] = useState(false);
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
      onBusyChange(false);
    },
    [onBusyChange],
  );
  const ready = !!result && hasSuggestionContext(result) && !stale && !jobDirty;
  async function request() {
    if (
      !result ||
      !hasSuggestionContext(result) ||
      disabled ||
      jobDirty ||
      stale ||
      copying ||
      inFlight.current
    )
      return;
    const request = ++generation.current;
    const controller = new AbortController();
    abort.current = controller;
    inFlight.current = true;
    setLoading(true);
    onBusyChange(true);
    setError('');
    setCopyStatus('');
    try {
      const response = await fetch(
        `/api/v1/opportunities/${jobId}/cv-improvement-suggestions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId: result.matchId }),
          signal: controller.signal,
        },
      );
      const value: unknown = await response.json().catch(() => {
        if (request === generation.current) setData(null);
        throw new SuggestionRequestFailure(
          'The API returned unreadable suggestions. Retry; no new wording is available.',
        );
      });
      if (request !== generation.current) return;
      if (!response.ok) {
        const code =
          value && typeof value === 'object' && 'errorCode' in value
            ? value.errorCode
            : null;
        if (code === 'CV_SUGGESTIONS_STALE_MATCH') {
          onInvalidContext();
          setData(null);
          setError(
            'This match has expired or its sources changed. Reanalyze CV Match before requesting suggestions.',
          );
          return;
        }
        const messages: Record<string, string> = {
          CV_SUGGESTIONS_BUSY:
            'A CV match or suggestions request is already running. Retry after it finishes.',
          CV_SUGGESTIONS_TIMEOUT:
            'Suggestion selection timed out. Check the AI service and retry.',
          CV_SUGGESTIONS_CONTEXT_LIMIT:
            'Suggestion evidence exceeds the local context budget. Use concise saved sources and reanalyze.',
          CV_SUGGESTIONS_JOB_NOT_FOUND:
            'This saved job is unavailable. Reopen a saved job before requesting suggestions.',
        };
        throw new SuggestionRequestFailure(
          typeof code === 'string' && messages[code]
            ? messages[code]
            : 'Could not request suggestions. Check the local API and the AI service, then retry.',
        );
      }
      if (
        value &&
        typeof value === 'object' &&
        'matchId' in value &&
        typeof value.matchId === 'string' &&
        'cvUpdatedAt' in value &&
        typeof value.cvUpdatedAt === 'string' &&
        'jobUpdatedAt' in value &&
        typeof value.jobUpdatedAt === 'string' &&
        !sameSuggestionSource(value, result)
      ) {
        onInvalidContext();
        setData(null);
        setError(
          'The suggestions do not belong to this saved match. Reanalyze CV Match before requesting suggestions.',
        );
        return;
      }
      if (!isSuggestionsResponse(value, result)) {
        setData(null);
        throw new SuggestionRequestFailure(
          'The API returned invalid suggestions. Retry; no new wording is available.',
        );
      }
      setData(value);
      setShowAll(false);
    } catch (error) {
      if (request === generation.current)
        setError(
          error instanceof SuggestionRequestFailure
            ? error.message
            : 'Could not read suggestions. Check the local API and retry.',
        );
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setLoading(false);
        onBusyChange(false);
      }
    }
  }
  async function copy(wording: string) {
    if (disabled || jobDirty || loading || stale || copying) return;
    const request = generation.current;
    setCopying(true);
    setCopyStatus('');
    try {
      await navigator.clipboard.writeText(wording);
      if (request === generation.current)
        setCopyStatus('Wording copied. Review it before updating your CV.');
    } catch {
      if (request === generation.current)
        setCopyStatus(
          'Could not copy. Select the wording and copy it manually.',
        );
    } finally {
      if (request === generation.current) setCopying(false);
    }
  }
  const visible = stale ? null : data;
  const prerequisite = jobDirty
    ? 'Save your job edits, then reanalyze in CV Match.'
    : disabled
      ? 'CV analysis or upload is in progress. Wait for it to finish.'
      : stale
        ? 'Outdated. This match is no longer current. Reanalyze in CV Match before requesting suggestions.'
        : !cvSaved
          ? 'Save a CV in CV Match, then analyze it against this job.'
          : !ready
            ? 'Not analyzed yet. Analyze your saved CV against this job first. Suggestions use the evidence from that analysis.'
            : '';
  return (
    <Box component="section" aria-labelledby={heading} sx={{ minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          useFlexGap
          sx={{
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: { xs: 'stretch', sm: 'flex-start' },
          }}
        >
          <Box sx={{ flex: { xs: '1 1 auto', sm: '1 1 18rem' }, minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'baseline' }}
            >
              <Typography
                id={heading}
                variant="h6"
                component="h2"
                sx={{ fontWeight: 600 }}
              >
                Improve your CV
              </Typography>
              {visible && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  aria-hidden="true"
                >
                  {visible.suggestions.length} suggestions
                </Typography>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Review practical edits backed by your CV–job match. Add only facts
              you can substantiate.
            </Typography>
          </Box>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
          >
            <Button
              startIcon={<AutoAwesomeIcon />}
              variant={visible ? 'outlined' : 'contained'}
              disabled={!ready || disabled || loading || copying}
              onClick={() => void request()}
              sx={{ minHeight: 44 }}
            >
              {loading
                ? 'Requesting suggestions…'
                : error && !stale
                  ? 'Retry suggestions'
                  : visible
                    ? 'Regenerate suggestions'
                    : 'Suggest improvements'}
            </Button>
            {(!ready || stale) && (
              <Button
                endIcon={<ArrowForwardIcon />}
                onClick={onGoToMatch}
                sx={{ minHeight: 44 }}
              >
                Go to CV Match
              </Button>
            )}
          </Stack>
        </Stack>
        {prerequisite && (
          <Typography variant="body2" role="status">
            {prerequisite}
          </Typography>
        )}
        {loading && (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Selecting suggestions…</Typography>
          </Stack>
        )}
        {error && <Alert severity={stale ? 'warning' : 'error'}>{error}</Alert>}
        {visible && (loading || error) && (
          <Typography variant="body2">
            Previous successful suggestions for this match are shown below.
          </Typography>
        )}
        <Typography
          variant="body2"
          role="status"
          aria-live="polite"
          sx={
            copyStatus || visible?.suggestions.length === 0
              ? undefined
              : {
                  position: 'absolute',
                  width: '1px',
                  height: '1px',
                  overflow: 'hidden',
                  clipPath: 'inset(50%)',
                  whiteSpace: 'nowrap',
                }
          }
        >
          {loading
            ? 'Requesting suggestions. Your match is retained.'
            : copyStatus ||
              (visible
                ? visible.suggestions.length
                  ? `${visible.suggestions.length} suggestions ready for review.`
                  : 'No additional evidence-backed suggestions found. Review the requirement evidence.'
                : '')}
        </Typography>
        {visible?.suggestions.slice(0, showAll ? undefined : 4).map((card) => {
          const row = result!.requirements.find(
            ({ parentId }) => parentId === card.parentId,
          )!;
          const summary = suggestionSummary(card, row);
          return (
            <Box
              component="article"
              aria-label={`Suggestion ${card.rank}: ${card.requirement}`}
              key={card.id}
              sx={{
                borderTop: 1,
                borderColor: 'divider',
                pt: 2,
                pb: 0.5,
                minWidth: 0,
                overflowWrap: 'anywhere',
              }}
            >
              <Stack spacing={1}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      sx={{ fontWeight: 600, lineHeight: 1.5 }}
                    >
                      {summary.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {card.priority === 'required' ? 'Required' : 'Preferred'}{' '}
                      · {statusLabel(card.status)}
                    </Typography>
                  </Box>
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{
                      flexShrink: 0,
                      maxWidth: '100%',
                      px: 1,
                      py: 0.5,
                      borderRadius: 0.5,
                      fontWeight: 600,
                      bgcolor: (theme) =>
                        card.wording !== null
                          ? theme.palette.action.selected
                          : card.status === 'NOT_EVIDENCED'
                            ? theme.palette.action.hover
                            : alpha(theme.palette.warning.main, 0.14),
                      color:
                        card.wording !== null ? 'primary.main' : 'text.primary',
                    }}
                  >
                    {card.wording !== null
                      ? 'CV wording available'
                      : card.status === 'NOT_EVIDENCED'
                        ? 'Missing CV evidence'
                        : 'Confirmation needed'}
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ lineHeight: 1.5 }}
                >
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    JD coverage:{' '}
                  </Box>
                  {summary.gap}
                </Typography>
                <Typography variant="body2">
                  <Box component="span" sx={{ fontWeight: 600 }}>
                    Next step:{' '}
                  </Box>
                  {summary.action}
                </Typography>
                {card.wording !== null ? (
                  <Box>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600, mb: 0.5 }}
                    >
                      Verified CV wording
                    </Typography>
                    <Quote
                      label="Supported original wording"
                      quote={card.wording}
                    />
                  </Box>
                ) : null}
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <Button
                    variant="outlined"
                    onClick={() => onInspect(card.parentId)}
                    sx={{ minHeight: 44 }}
                  >
                    Review evidence
                  </Button>
                  {card.wording !== null && (
                    <Button
                      variant="text"
                      disabled={
                        disabled || jobDirty || loading || stale || copying
                      }
                      onClick={() => void copy(card.wording!)}
                      sx={{ minHeight: 44 }}
                    >
                      Copy wording
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Box>
          );
        })}
        {visible && visible.suggestions.length > 4 && (
          <Button
            onClick={() => setShowAll((value) => !value)}
            sx={{ alignSelf: 'flex-start', minHeight: { xs: 44, sm: 36 } }}
          >
            {showAll ? 'Show less' : `Show all (${visible.suggestions.length})`}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
type MatchRow = MatchResult['requirements'][number];

function suggestionSummary(card: SuggestionCard, row: MatchRow) {
  const components = row.coverage!.components;
  const labels = (items: typeof components) =>
    items
      .slice(0, 3)
      .map(({ label }) => label)
      .join(', ') + (items.length > 3 ? ' and other components' : '');
  const pending = components.filter(({ status }) => status !== 'EVIDENCED');
  const proficiency = components.some(
    ({ qualificationReason }) => !!qualificationReason,
  );
  const equivalentExperience = components.some(({ label }) =>
    /\bequivalent\s+(?:(?:practical|professional|work)\s+)?experience\b/iu.test(
      label,
    ),
  );
  const relevantExperience = components.some(({ label }) =>
    /\b(?:related|relevant)\s+(?:professional\s+)?experience\b/iu.test(label),
  );
  const educationAlternative =
    row.coverage!.mode === 'OR' &&
    components.length >= 2 &&
    components.some(({ label }) => /\bdegree\b/iu.test(label)) &&
    (equivalentExperience || relevantExperience);
  const experienceDescription = equivalentExperience
    ? 'equivalent experience'
    : 'relevant experience';
  const professionalInternship =
    components.length === 1 &&
    /\bprofessional(?:\s+(?:software|development|engineering))*\s+internships?\b/iu.test(
      row.requirement,
    );
  const title = educationAlternative
    ? `Education or ${experienceDescription}`
    : professionalInternship
      ? 'Professional internship experience'
      : proficiency
        ? 'Database proficiency'
        : components
            .slice(0, 3)
            .map(({ label }) =>
              label.replace(
                /^(?:Experience (?:with|in|using|designing)|Working knowledge of|Knowledge of|Understanding of)\s+/iu,
                '',
              ),
            )
            .join(row.coverage!.mode === 'OR' ? ' or ' : ' + ') +
          (components.length > 3 ? ' …' : '');
  let gap: string;
  let action: string;
  if (card.status === 'CONFLICT') {
    gap = 'The CV contains contradictory evidence for this requirement.';
    action = 'Resolve the conflicting statements before updating your CV.';
  } else if (card.status === 'EVIDENCED') {
    gap = 'Verified CV evidence supports this requirement.';
    action =
      card.wording !== null
        ? 'Make this verified passage easier to find in your CV.'
        : 'Review the existing passage before deciding how to present it.';
  } else if (proficiency) {
    const work = components.filter(({ observations }) =>
      observations?.some(({ kind }) => kind === 'experience'),
    );
    gap = work.length
      ? `Work with ${labels(work)} is evidenced; proficiency remains unverified.`
      : 'Database mentions are present; the requested proficiency is not yet evidenced.';
    action =
      'If accurate, describe your own database design, tuning or troubleshooting responsibilities.';
  } else if (educationAlternative) {
    gap = `Neither a qualifying degree nor ${experienceDescription} is established by the CV.`;
    action =
      'If accurate, state your degree, field and completion status, or describe relevant work with dates, responsibilities and scope.';
  } else if (professionalInternship) {
    gap =
      'The required professional internship experience is not established by the CV.';
    action =
      'If you completed a relevant internship, include its actual dates, responsibilities and contributions.';
  } else if (row.coverage!.mode === 'UNKNOWN') {
    gap = 'The CV does not establish how this requirement is met.';
    action =
      'Check the JD’s scope, then add only verifiable details about the relevant qualification or work.';
  } else if (row.coverage!.mode === 'OR') {
    gap = 'The CV does not establish a qualifying alternative.';
    action =
      'If applicable, document one qualifying alternative with its scope, dates and supporting facts.';
  } else {
    gap =
      card.status === 'PARTIAL'
        ? `The CV does not yet establish: ${labels(pending)}.`
        : 'This qualification is not established by the CV.';
    action =
      'If accurate, add supporting facts and dates; for work examples, state your role and what you did.';
  }
  // Preserve specific server questions; replace only the known generic prompt.
  if (
    card.kind === 'clarify' &&
    card.status !== 'CONFLICT' &&
    card.clarification &&
    !card.clarification.startsWith('Can you verify an accurate example?')
  )
    action = card.clarification;
  return { title, gap, action };
}

function Quote({ label, quote }: { label: string; quote: string }) {
  return (
    <Typography
      component="blockquote"
      variant="body2"
      aria-label={label}
      tabIndex={0}
      sx={{
        m: 0,
        px: 1.5,
        py: 1,
        bgcolor: 'action.selected',
        borderRadius: 0.5,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: -2,
        },
      }}
    >
      {quote}
    </Typography>
  );
}
