import { dateLocale, tr } from '../../app/i18n';
import { AutoAwesomeIcon, RefreshIcon } from '../../components/icons';
import { Link, Navigate, useInRouterContext } from 'react-router-dom';
import { validSourceDate } from './cv-suggestions.contract';
import {
  type CvOrigin,
  coverageModeLabel,
  guidanceLabel,
  type MatchResult,
  recommendationLabel,
  statusLabel,
} from './cv-match.types';
import { GuidanceActions, GuidanceVerdict } from './ApplicationGuidance';
import { JobCvPicker } from './JobCvPicker';
import {
  matchStatusMessages,
  reviewHref,
  type CvMatchState,
} from './useCvMatch';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  LinearProgress,
  Paper,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

const requirementColors = {
  EVIDENCED: 'success.dark',
  PARTIAL: 'text.primary',
  NOT_EVIDENCED: 'text.secondary',
  CONFLICT: 'error.dark',
  UNDECOMPOSED: 'warning.dark',
} as const;

export interface MatchInspection {
  inspect: (parentId: string) => boolean;
}

/** CV Match tab panel (id job-panel-1), shared by Job Detail and Tailored CV. */
// A withheld score is either thin evidence or a requirement set the server could
// not verify as complete; say which.
const incompleteLabel = (result: MatchResult, fallback: string) =>
  result.evaluability?.low && result.guidance
    ? 'insufficient information to assess reliably'
    : result.recommendation === 'Review requirements'
      ? 'requirements may be incomplete'
      : fallback;
// Backend reasons are English; show one only when it has a UI translation,
// otherwise a localized sentence for the status (no untranslated diagnostics).
function coverageReason(
  coverage: NonNullable<MatchResult['requirements'][number]['coverage']>,
  rowStatus: MatchResult['requirements'][number]['status'],
): string {
  const generic = [
    'Review the selected evidence.',
    'Review the selected component evidence.',
    'Compound meaning needs review.',
  ].includes(coverage.reason);
  if (
    !generic &&
    (dateLocale() === 'en-US' || tr(coverage.reason) !== coverage.reason)
  )
    return tr(coverage.reason);
  const status = coverage.status ?? rowStatus;
  return status === 'UNDECOMPOSED'
    ? tr(
        'The system could not analyze this requirement. Check it against your experience yourself.',
      )
    : status === 'EVIDENCED'
      ? tr('Supported by the CV evidence shown.')
      : status === 'PARTIAL'
        ? tr('Partly supported; the CV could show this more clearly.')
        : status === 'CONFLICT'
          ? tr('Contradictory CV statements need review.')
          : tr(
              'Not clearly shown in this CV yet. If you have this experience, add it.',
            );
}
export function CvMatchSection({
  match,
  labelledBy,
  hidden,
  inspection,
  preferSecondary = false,
  analyzeBlocked = false,
  uploadBlocked = false,
}: {
  match: CvMatchState;
  labelledBy: string;
  hidden: boolean;
  inspection: Ref<MatchInspection>;
  /** Show Analyze as secondary when another step is the primary action. */
  preferSecondary?: boolean;
  analyzeBlocked?: boolean;
  uploadBlocked?: boolean;
}) {
  const { cv, busy, error, result, matchStatus, matchReadError } = match;
  const { analyze, reload } = match;
  const routing = useInRouterContext();
  // A CV uploaded here opens its Source CV Review next.
  const [uploaded, setUploaded] = useState('');
  return (
    <Box
      role="tabpanel"
      id="job-panel-1"
      aria-labelledby={labelledBy}
      hidden={hidden}
    >
      {routing && uploaded && (
        <Navigate to={reviewHref(uploaded, match.jobId)} />
      )}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{
              justifyContent: 'space-between',
              alignItems: { sm: 'flex-start' },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
                {tr('CV–JD match')}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {tr(
                  'Your documented experience, compared with this opportunity.',
                )}
              </Typography>
            </Box>
            <Button
              startIcon={<AutoAwesomeIcon />}
              variant={result || preferSecondary ? 'outlined' : 'contained'}
              disableElevation
              loading={busy}
              loadingPosition="start"
              disabled={
                analyzeBlocked ||
                !cv ||
                matchStatus === 'CHECKING' ||
                matchStatus === 'CV_REVIEW_REQUIRED'
              }
              onClick={() => void analyze()}
              sx={{
                flexShrink: 0,
                alignSelf: 'flex-start',
              }}
            >
              {result ||
              ['EXPIRED', 'STALE_CV', 'STALE_JOB'].includes(matchStatus)
                ? tr('Reanalyze CV Match')
                : tr('Analyze CV Match')}
            </Button>
          </Stack>
          <Box>
            {/* The selector shows the job's CV; text only when none exists. */}
            {!cv && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {tr('No saved CV yet.')}
              </Typography>
            )}
            <JobCvPicker
              match={match}
              disabled={busy || uploadBlocked}
              onUploaded={setUploaded}
            />
            <Typography variant="caption" color="text.secondary">
              {tr(
                'Uses the CV selected for this job and the saved job, not unsaved edits. Files parse locally; analysis sends them to the configured AI provider.',
              )}{' '}
              {tr(
                'A new CV opens Source CV Review first; you return here to start CV Match.',
              )}
            </Typography>
          </Box>
          {matchStatus === 'CHECKING' && (
            <Typography role="status">
              {tr('Checking the saved CV Match…')}
            </Typography>
          )}
          {!busy && matchStatusMessages[matchStatus] && (
            <Alert
              severity={
                matchStatus === 'CV_REVIEW_REQUIRED' ? 'warning' : 'info'
              }
              role="status"
              action={
                routing &&
                matchStatus === 'CV_REVIEW_REQUIRED' &&
                match.reviewCvId ? (
                  <Button
                    color="inherit"
                    size="small"
                    component={Link}
                    to={reviewHref(match.reviewCvId, match.jobId)}
                    sx={{ minHeight: 44, flexShrink: 0 }}
                  >
                    {tr('Review CV')}
                  </Button>
                ) : undefined
              }
            >
              {matchStatusMessages[matchStatus]}
              {result &&
                tr(
                  ' The previous result below is retained for reference; it is not a current match.',
                )}
            </Alert>
          )}
          {matchReadError && (
            <Alert
              severity="warning"
              action={
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<RefreshIcon />}
                  disabled={busy}
                  onClick={() => reload()}
                >
                  {tr('Retry loading match')}
                </Button>
              }
            >
              {matchReadError}
            </Alert>
          )}
          {!busy && matchStatus === 'VALID' && (
            <Typography role="status">
              {tr('Saved match')}
              {result && validSourceDate(result.analyzedAt)
                ? tr(' from {v0}', {
                    v0: new Date(result.analyzedAt).toLocaleString(
                      dateLocale(),
                    ),
                  })
                : ''}
              {result?.evidenceUncertain
                ? '.'
                : tr('. No new analysis is needed.')}
            </Typography>
          )}
          {!busy && matchStatus === 'VALID' && result?.keptPrevious && (
            <Alert severity="info" role="status">
              {tr(
                'The new analysis may have missed CV evidence, so your previous saved match was kept.',
              )}
            </Alert>
          )}
          {!busy &&
            matchStatus === 'VALID' &&
            result?.evidenceUncertain &&
            !result.keptPrevious && (
              <Alert severity="warning">
                {tr(
                  'The AI may have missed CV evidence for some required items. Check items marked "Evidence needs review" before relying on this score.',
                )}
              </Alert>
            )}
          {busy && (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>{tr('Processing locally…')}</Typography>
            </Stack>
          )}
          {error && (
            <Alert severity="error">
              {error}
              {result &&
                tr(
                  ' The last successful result is retained below; it does not reflect this failed attempt.',
                )}
            </Alert>
          )}
          {busy && result && (
            <Typography variant="caption">
              {tr(
                'Previous successful result shown while reanalysis is running.',
              )}
            </Typography>
          )}
          {result && (
            <MatchContent
              key={result.matchId ?? result.analyzedAt}
              result={result}
              inspection={inspection}
            />
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

function MatchIcon({ kind }: { kind: 'matched' | 'gap' | 'expand' }) {
  return (
    <SvgIcon
      fontSize="small"
      sx={{
        flexShrink: 0,
        color: kind === 'matched' ? 'success.main' : 'text.secondary',
      }}
    >
      <path
        d={
          kind === 'matched'
            ? 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 15-5-5 1.4-1.4 3.6 3.6 7.6-7.6L19 8l-9 9z'
            : kind === 'expand'
              ? 'm7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6z'
              : 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-4-9h8v2H8z'
        }
      />
    </SvgIcon>
  );
}

function MatchContent({
  result,
  inspection,
}: {
  result: MatchResult;
  inspection: Ref<MatchInspection>;
}) {
  const [openGroups, setOpenGroups] = useState<Set<RequirementGroup>>(
    () => new Set(['clarify', 'review']),
  );
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [target, setTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const inspect = useCallback(
    (index: number) => {
      const status = result.requirements[index]?.status;
      setSelected(index);
      if (status)
        setOpenGroups((previous) =>
          new Set(previous).add(requirementGroup(status)),
        );
      setExpanded((previous) => new Set(previous).add(index));
      setTarget(index);
    },
    [result.requirements],
  );
  useImperativeHandle(
    inspection,
    () => ({
      inspect(parentId: string) {
        const index = result.requirements.findIndex(
          (row) => row.parentId === parentId,
        );
        if (index < 0) return false;
        inspect(index);
        return true;
      },
    }),
    [result.requirements, inspect],
  );
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      <MatchOverview result={result} />
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {tr(
            'Not evidenced in this CV does not mean you do not possess the qualification.',
          )}
        </Typography>
        <RequirementsList
          requirements={result.requirements}
          openGroups={openGroups}
          onToggleGroup={(group) =>
            setOpenGroups((previous) => {
              const next = new Set(previous);
              if (!next.delete(group)) next.add(group);
              return next;
            })
          }
          expanded={expanded}
          onExpand={(index, open) =>
            setExpanded((previous) => {
              const next = new Set(previous);
              if (open) next.add(index);
              else next.delete(index);
              return next;
            })
          }
          selected={selected}
          target={target}
          onNavigated={() => setTarget(null)}
        />
      </Box>
      <TechnicalDetails result={result} />
    </Stack>
  );
}

const COVERAGE_STATUSES = [
  'EVIDENCED',
  'PARTIAL',
  'NOT_EVIDENCED',
  'CONFLICT',
  'UNDECOMPOSED',
] as const;
// Bar fills; text keeps requirementColors so labels stay readable.
const coverageFill = {
  EVIDENCED: 'success.main',
  PARTIAL: 'info.main',
  NOT_EVIDENCED: 'action.disabled',
  CONFLICT: 'error.main',
  UNDECOMPOSED: 'warning.main',
} as const;

/** Plain status counts of the returned requirements; not the weighted score. */
function RequirementCoverage({
  requirements,
}: {
  requirements: MatchResult['requirements'];
}) {
  const counts = COVERAGE_STATUSES.map(
    (status) =>
      [
        status,
        requirements.filter((item) => item.status === status).length,
      ] as const,
  ).filter(([status, count]) => count > 0 || status !== 'UNDECOMPOSED');
  const required = requirements.filter((item) => item.priority === 'required');
  const summary = counts
    .map(([status, count]) => `${statusLabel(status)}: ${count}`)
    .join(', ');
  return (
    <Box component="section" aria-label={tr('Requirement coverage')}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {tr('Requirement coverage')}
      </Typography>
      <Box
        role="img"
        aria-label={`${summary}. ${tr('Total:')} ${requirements.length}`}
        sx={{
          display: 'flex',
          height: 10,
          mt: 1.5,
          borderRadius: 1,
          overflow: 'hidden',
          bgcolor: 'action.disabledBackground',
        }}
      >
        {counts.map(([status, count]) =>
          count ? (
            <Box
              key={status}
              sx={{ flexGrow: count, bgcolor: coverageFill[status] }}
            />
          ) : null,
        )}
      </Box>
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        aria-label={tr('Requirement counts')}
        sx={{ flexWrap: 'wrap', mt: 1 }}
      >
        {counts.map(([status, count]) => (
          <Stack
            key={status}
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center' }}
          >
            <Box
              aria-hidden
              sx={{
                width: 10,
                height: 10,
                borderRadius: '2px',
                bgcolor: coverageFill[status],
              }}
            />
            <Typography
              variant="body2"
              sx={{ color: requirementColors[status], fontWeight: 500 }}
            >
              {statusLabel(status)}: {count}
            </Typography>
          </Stack>
        ))}
        <Typography variant="body2" color="text.secondary">
          {tr('Total:')} {requirements.length}
        </Typography>
      </Stack>
      {required.length > 0 && (
        <Typography variant="subtitle2" component="p" sx={{ mt: 1 }}>
          {tr('Required requirements matched: {v0} of {v1}', {
            v0: String(
              required.filter((item) => item.status === 'EVIDENCED').length,
            ),
            v1: String(required.length),
          })}
        </Typography>
      )}
    </Box>
  );
}

function MatchOverview({ result }: { result: MatchResult }) {
  const count = (group: RequirementGroup) =>
    result.requirements.filter(
      (item) => requirementGroup(item.status) === group,
    ).length;
  const unevaluated = count('review');
  return (
    <Stack spacing={3}>
      <Box sx={{ bgcolor: 'action.selected', borderRadius: 1, p: 2 }}>
        {result.guidance ? (
          <GuidanceVerdict result={result} />
        ) : (
          // Saved before structured guidance: show only the stored recommendation.
          <Box component="section" aria-label={tr('Overall assessment')}>
            <Typography variant="overline" color="text.secondary" component="p">
              {tr('Overall assessment')}
            </Typography>
            <Typography variant="h5" component="h3" sx={{ fontWeight: 600 }}>
              {recommendationLabel(result.recommendation)}
            </Typography>
          </Box>
        )}
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          aria-label={tr('At a glance')}
          sx={{ flexWrap: 'wrap', mt: 1.5 }}
        >
          <Chip
            size="small"
            color="success"
            variant="outlined"
            label={tr('Strengths: {v0}', { v0: String(count('matched')) })}
          />
          <Chip
            size="small"
            variant="outlined"
            label={tr('To clarify: {v0}', { v0: String(count('clarify')) })}
          />
        </Stack>
        {result.guidance && (
          <Box sx={{ mt: 2 }}>
            <GuidanceActions guidance={result.guidance} />
          </Box>
        )}
        {result.score !== null ? (
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            sx={{ mt: 1.5 }}
          >
            {tr('Reference score: {v0}/100 · see Technical details', {
              v0: String(result.score),
            })}
          </Typography>
        ) : (
          result.guidance &&
          result.evaluability?.low && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ mt: 1.5 }}
            >
              {tr(
                'Insufficient information to assess reliably, so no score is shown.',
              )}
            </Typography>
          )
        )}
        {unevaluated > 0 && (
          <Typography variant="caption" color="text.secondary" component="p">
            {tr(
              'The system could not analyze {v0} requirement(s); they are not counted in the score.',
              { v0: String(unevaluated) },
            )}
          </Typography>
        )}
      </Box>
      <RequirementCoverage requirements={result.requirements} />
    </Stack>
  );
}

/** Heuristic score, evaluability, explanations and disclaimers, collapsed. */
function TechnicalDetails({ result }: { result: MatchResult }) {
  const id = useId();
  const evaluability = result.evaluability;
  return (
    <Accordion
      disableGutters
      elevation={0}
      square
      sx={{
        bgcolor: 'transparent',
        borderTop: 1,
        borderColor: 'divider',
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary
        id={`${id}-summary`}
        aria-controls={`${id}-details`}
        expandIcon={<MatchIcon kind="expand" />}
        sx={{
          px: 0,
          minHeight: 44,
          '&.Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          },
        }}
      >
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {tr('Technical details')}
        </Typography>
      </AccordionSummary>
      <AccordionDetails id={`${id}-details`} sx={{ px: 0, pt: 0 }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="subtitle2" component="h4">
              {tr('Documented CV evidence coverage')}
            </Typography>
            <Typography
              variant="h4"
              component="p"
              sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              aria-label={tr('Fit score: {v0} (heuristic)', {
                v0:
                  result.score === null
                    ? incompleteLabel(result, 'Not enough evidence')
                    : `${result.score}/100`,
              })}
            >
              {result.score === null ? '—' : result.score}
              {result.score !== null && (
                <Typography
                  component="span"
                  variant="body1"
                  color="text.secondary"
                >
                  {' '}
                  / 100
                </Typography>
              )}
            </Typography>
            {result.score === null ? (
              <Typography variant="body2" color="text.secondary">
                {tr('Not enough evidence')}
              </Typography>
            ) : (
              <LinearProgress
                variant="determinate"
                value={result.score}
                aria-label={tr('Heuristic fit score')}
                color="inherit"
                sx={{
                  height: 6,
                  borderRadius: 1,
                  my: 0.5,
                  color: 'text.secondary',
                  bgcolor: 'action.disabledBackground',
                }}
              />
            )}
            <Typography variant="body2" color="text.secondary">
              {tr('Heuristic evidence coverage · Not a hiring probability')}
            </Typography>
          </Box>
          {evaluability && (
            <Typography
              variant="body2"
              color={evaluability.low ? 'warning.dark' : 'text.secondary'}
            >
              {tr('Evaluated: {v0} of {v1} JD requirements', {
                v0: String(evaluability.evaluated),
                v1: String(evaluability.total),
              })}
              {evaluability.low &&
                ` · ${tr('Low confidence: interpret this score with care.')}`}
            </Typography>
          )}
          <Typography variant="body2">
            {tr(
              'This score reflects evidence in the saved CV, not the full extent of your skills.',
            )}
          </Typography>
          <Box>
            <Typography variant="subtitle2" component="h4">
              {tr('How to read this analysis')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {result.explanation}
            </Typography>
          </Box>
          {/* Structured actions replace advice; older matches only have advice. */}
          {!result.guidance && result.advice && (
            <Box>
              <Typography variant="subtitle2" component="h4">
                {tr('Application advice')}
              </Typography>
              <Typography variant="body2">{tr(result.advice)}</Typography>
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" component="p">
            {tr(
              'Advisory only, not a hiring prediction. Add only experience you actually have.',
            )}{' '}
            {tr(
              'This match is shared with Tailored CV while its server context remains valid. Reanalyze after saving CV or job changes. Review all evidence before relying on this advice.',
            )}
          </Typography>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

type RequirementGroup = 'clarify' | 'review' | 'matched';
const requirementGroup = (
  status: MatchResult['requirements'][number]['status'],
): RequirementGroup =>
  status === 'EVIDENCED'
    ? 'matched'
    : status === 'UNDECOMPOSED'
      ? 'review'
      : 'clarify';
const GROUP_TITLES = {
  clarify: () => tr('To clarify'),
  review: () => tr('System could not analyze'),
  matched: () => tr('Already matched'),
} as const;

function RequirementsList({
  requirements,
  openGroups,
  onToggleGroup,
  expanded,
  onExpand,
  selected,
  target,
  onNavigated,
}: {
  requirements: MatchResult['requirements'];
  openGroups: Set<RequirementGroup>;
  onToggleGroup: (group: RequirementGroup) => void;
  expanded: Set<number>;
  onExpand: (index: number, open: boolean) => void;
  selected: number | null;
  target: number | null;
  onNavigated: () => void;
}) {
  const id = useId();
  const rows = requirements
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(b.item.priority === 'required') -
          Number(a.item.priority === 'required') || a.index - b.index,
    );
  return (
    <Box
      component="section"
      aria-label={tr('Requirements')}
      sx={{ minWidth: 0 }}
    >
      <Typography
        component="h3"
        variant="subtitle1"
        sx={{ fontWeight: 600, mb: 1 }}
      >
        {tr('Requirements')}
      </Typography>
      {(['clarify', 'review', 'matched'] as const).map((group) => {
        const items = rows.filter(
          ({ item }) => requirementGroup(item.status) === group,
        );
        if (!items.length) return null;
        const open = openGroups.has(group);
        return (
          <Box key={group} component="section" sx={{ mb: 1.5 }}>
            <Button
              fullWidth
              aria-expanded={open}
              aria-controls={`${id}-${group}`}
              onClick={() => onToggleGroup(group)}
              endIcon={
                <Box
                  component="span"
                  sx={{
                    display: 'flex',
                    transition: 'transform 150ms ease-out',
                    transform: open ? 'rotate(180deg)' : 'none',
                  }}
                >
                  <MatchIcon kind="expand" />
                </Box>
              }
              sx={{
                justifyContent: 'space-between',
                textTransform: 'none',
                color: 'text.primary',
                minHeight: 44,
                px: 1.5,
              }}
            >
              <Typography component="h4" variant="subtitle2">
                {GROUP_TITLES[group]()} ({items.length})
              </Typography>
            </Button>
            {/* Mounted while closed so inspect() can open a row inside it;
                instant when navigating so the scroll target is final. */}
            <Collapse
              in={open}
              id={`${id}-${group}`}
              timeout={target !== null ? 0 : 'auto'}
            >
              <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
                {items.map(({ item, index }) => (
                  <RequirementCard
                    key={index}
                    item={item}
                    expanded={expanded.has(index)}
                    onExpand={(isOpen) => onExpand(index, isOpen)}
                    selected={selected === index}
                    targeted={open && target === index}
                    onNavigated={onNavigated}
                  />
                ))}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
function RequirementCard({
  item,
  expanded,
  onExpand,
  selected,
  targeted,
  onNavigated,
}: {
  item: MatchResult['requirements'][number];
  expanded: boolean;
  onExpand: (open: boolean) => void;
  selected: boolean;
  targeted: boolean;
  onNavigated: () => void;
}) {
  const id = useId();
  const summaryRef = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // MUI's entered callback signals that the evidence has its final height.
    // This also handles clicking an already-open row without a new transition.
    if (!targeted || !expanded || !entered) return;
    summaryRef.current?.scrollIntoView?.({
      block: 'start',
      inline: 'nearest',
      behavior: 'instant',
    });
    summaryRef.current?.focus({ preventScroll: true });
    onNavigated();
  }, [targeted, expanded, entered, onNavigated]);
  const matched = item.status === 'EVIDENCED';
  return (
    <Accordion
      square
      expanded={expanded}
      onChange={(_, open) => onExpand(open)}
      disableGutters
      elevation={0}
      slotProps={{
        transition: {
          unmountOnExit: true,
          appear: true,
          timeout: targeted ? 0 : undefined,
          onEntered: () => setEntered(true),
          onExit: () => setEntered(false),
        },
      }}
      sx={{
        minWidth: 0,
        borderBottom: 1,
        borderColor: 'divider',
        '&.Mui-expanded': { m: 0 },
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary
        ref={(node) => {
          summaryRef.current = node;
        }}
        aria-current={selected ? 'true' : undefined}
        id={`${id}-summary`}
        aria-controls={`${id}-evidence`}
        aria-label={`${statusLabel(item.status)}: ${item.requirement}`}
        expandIcon={<MatchIcon kind="expand" />}
        sx={{
          px: 1.5,
          minHeight: 64,
          bgcolor: selected ? 'action.selected' : undefined,
          boxShadow: selected
            ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}`
            : undefined,
          '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
          '& .MuiAccordionSummary-content, & .MuiAccordionSummary-content.Mui-expanded':
            { my: 1 },
          '&.Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 2,
          },
          '& .MuiAccordionSummary-content': { minWidth: 0 },
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ minWidth: 0, width: '100%', pr: 1, alignItems: 'flex-start' }}
        >
          <Box
            role="img"
            aria-label={statusLabel(item.status)}
            sx={{ display: 'flex', pt: 0.25 }}
          >
            <MatchIcon kind={matched ? 'matched' : 'gap'} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 600,
                overflowWrap: 'anywhere',
                lineHeight: 1.5,
              }}
            >
              {item.requirement}
            </Typography>
            <Stack
              direction="row"
              spacing={2}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }}
            >
              <Typography variant="body2" color="text.secondary">
                {item.priority === 'required'
                  ? tr('Required')
                  : tr('Preferred')}
                {item.category !== 'skill' && (
                  <>
                    {' '}
                    ·{' '}
                    {item.category === 'experience'
                      ? tr('Experience')
                      : tr('Domain')}
                  </>
                )}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: requirementColors[item.status],
                  fontWeight: 600,
                  px: 1,
                  py: 0.25,
                  borderRadius: 0.5,
                  bgcolor: (theme) =>
                    item.status === 'PARTIAL'
                      ? alpha(theme.palette.warning.main, 0.14)
                      : theme.palette.action.hover,
                  ...(item.status === 'PARTIAL' && { color: 'grey.900' }),
                }}
              >
                {statusLabel(item.status)}
              </Typography>
              {item.evidence?.review && (
                <Typography variant="body2" color="warning.dark">
                  {tr('Evidence needs review')}
                </Typography>
              )}
            </Stack>
          </Box>
        </Stack>
      </AccordionSummary>
      <AccordionDetails
        id={`${id}-evidence`}
        sx={{
          minWidth: 0,
          px: { xs: 1.5, sm: 3 },
          py: 1.5,
          bgcolor: 'action.hover',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
            },
            gap: 2,
          }}
        >
          <EvidenceQuote source="JD evidence" quote={item.jdQuote} />
          {item.cvQuote ? (
            <EvidenceQuote
              source="CV evidence"
              quote={item.cvQuote}
              origin={item.cvOrigin}
            />
          ) : item.coverage?.components.some(
              (component) => component.observations?.length,
            ) ? (
            <Typography variant="body2">
              {tr(
                'Relevant CV evidence is shown below; proficiency is not fully verified.',
              )}
            </Typography>
          ) : (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {tr('Your CV')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {item.status === 'UNDECOMPOSED'
                  ? tr('Not analyzed by the system')
                  : tr('Not evidenced in CV')}
              </Typography>
            </Box>
          )}
        </Box>
        {item.coverage && (
          <Box
            component="section"
            aria-label={tr('Component coverage: {requirement}', {
              requirement: item.requirement,
            })}
            sx={{ mt: 2 }}
          >
            <Typography variant="subtitle2">
              {coverageModeLabel(item.coverage.mode) &&
                `${coverageModeLabel(item.coverage.mode)} · `}
              {
                item.coverage.components.filter(
                  (component) => component.status === 'EVIDENCED',
                ).length
              }
              /{item.coverage.components.length}{' '}
              {item.coverage.components.some(
                (component) => component.status === 'PARTIAL',
              )
                ? tr('components fully supported')
                : tr('components supported')}
              {item.coverage.components.some(
                (component) => component.status === 'PARTIAL',
              ) && tr(' · Partial evidence available')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {coverageReason(item.coverage, item.status)}
            </Typography>
            {item.coverage.components.map((component) => (
              <Box
                key={component.id}
                sx={{
                  mt: 2,
                  pt: 1.5,
                  borderTop: 1,
                  borderColor: 'divider',
                  overflowWrap: 'anywhere',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {component.label} · {statusLabel(component.status)}
                </Typography>
                <EvidenceQuote
                  source="JD evidence"
                  label={tr('JD evidence: {label}', { label: component.label })}
                  quote={component.jdQuote}
                />
                {component.qualificationReason &&
                  (dateLocale() === 'en-US' ||
                    tr(component.qualificationReason) !==
                      component.qualificationReason) && (
                    <Typography variant="body2">
                      {tr(component.qualificationReason)}
                    </Typography>
                  )}
                {component.observations?.map((observation, index) => (
                  <Box key={index} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      {observation.kind === 'experience'
                        ? tr('Verified professional experience')
                        : tr('Verified technology mention')}
                    </Typography>
                    <EvidenceQuote
                      source="Original parsed CV passage"
                      label={`${observation.kind === 'experience' ? 'Professional experience' : 'Technology mention'}: ${component.label}`}
                      quote={observation.cvQuote}
                    />
                  </Box>
                ))}
                {component.cvQuote &&
                !component.observations?.some(
                  (observation) => observation.cvQuote === component.cvQuote,
                ) ? (
                  <EvidenceQuote
                    source="CV evidence"
                    label={tr('CV evidence: {label}', {
                      label: component.label,
                    })}
                    quote={component.cvQuote}
                    origin={component.cvOrigin}
                  />
                ) : component.observations?.length ? null : (
                  <Typography variant="body2" color="text.secondary">
                    {item.status === 'UNDECOMPOSED'
                      ? tr('Not analyzed by the system')
                      : tr('Not evidenced in CV')}
                  </Typography>
                )}
                {component.conflictingQuotes.map((quote, index) => (
                  <EvidenceQuote
                    key={index}
                    source="CV evidence"
                    label={tr('Conflicting CV evidence: {label}', {
                      label: component.label,
                    })}
                    quote={quote}
                  />
                ))}
              </Box>
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
function EvidenceQuote({
  source,
  quote,
  label,
  origin,
}: {
  label?: string;
  origin?: CvOrigin;
  source: 'CV evidence' | 'JD evidence' | 'Original parsed CV passage';
  quote: string;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {source === 'CV evidence'
          ? origin === 'user_entered'
            ? tr('Your CV · added by you in review, not from the uploaded file')
            : tr('Your CV')
          : source === 'JD evidence'
            ? tr('Job description')
            : tr(source)}
      </Typography>
      <Box
        component="blockquote"
        aria-label={label ?? source}
        tabIndex={0}
        sx={{
          m: 0,
          mt: 0.5,
          p: 1.5,
          borderLeft: '2px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.primary',
          maxHeight: '12rem',
          overflowY: 'auto',
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-wrap',
          typography: 'body2',
          lineHeight: 1.6,
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -2,
          },
        }}
      >
        {quote}
      </Box>
    </Box>
  );
}

/**
 * Compact CV Match step for Tailored CV. Reads the same persisted match as Job
 * Detail; the full evidence view stays in Job Detail. Never analyzes on load.
 */
export function MatchGate({
  match,
  jobId,
  hidden,
  analyzeBlocked = false,
  preferSecondary = false,
  hasDraft = false,
}: {
  match: CvMatchState;
  jobId: string;
  /** A saved draft stays usable; the match only gates new drafts. */
  hasDraft?: boolean;
  hidden: boolean;
  analyzeBlocked?: boolean;
  preferSecondary?: boolean;
}) {
  const { cv, busy, error, result, matchStatus, matchReadError } = match;
  const routing = useInRouterContext();
  const current = matchStatus === 'VALID' && !!result;
  const counts = result
    ? {
        matched: result.requirements.filter((r) => r.status === 'EVIDENCED')
          .length,
        partial: result.requirements.filter((r) => r.status === 'PARTIAL')
          .length,
        missing: result.requirements.filter(
          (r) => r.status === 'NOT_EVIDENCED' || r.status === 'CONFLICT',
        ).length,
      }
    : null;
  const reanalyze =
    !!result || ['EXPIRED', 'STALE_CV', 'STALE_JOB'].includes(matchStatus);
  // A current match is context, not the task: one row with score, freshness
  // and actions. Missing, stale, checking and error states keep the full card.
  const compact = current && !busy && !error && !matchReadError;
  const assessmentLink = routing
    ? { component: Link, to: `/jobs/${jobId}/match` }
    : { component: 'a', href: `/jobs/${jobId}/match` };
  if (compact)
    return (
      <Box
        role="tabpanel"
        id="job-panel-1"
        aria-labelledby="tailored-step-1"
        hidden={hidden}
      >
        <Paper
          variant="outlined"
          component="section"
          aria-label={tr('CV Match summary')}
          sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, minWidth: 0 }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 2 }}
            useFlexGap
            sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
          >
            <Chip
              aria-label={tr('Fit score: {v0} (heuristic)', {
                v0:
                  result.score === null
                    ? incompleteLabel(result, 'Not enough evidence')
                    : `${result.score}/100`,
              })}
              color={result.recommendation === 'Apply' ? 'success' : 'default'}
              label={`${result.guidance ? guidanceLabel(result.guidance.recommendation) : recommendationLabel(result.recommendation)} · ${result.score === null ? tr(incompleteLabel(result, 'not enough evidence')) : `${result.score}/100`}`}
              sx={{ alignSelf: 'flex-start' }}
            />
            <Typography
              role="status"
              variant="body2"
              color="text.secondary"
              sx={{ flex: 1, minWidth: 0 }}
            >
              {tr('Saved match')}
              {validSourceDate(result.analyzedAt)
                ? tr(' from {v0}', {
                    v0: new Date(result.analyzedAt).toLocaleString(
                      dateLocale(),
                    ),
                  })
                : ''}
              {result?.evidenceUncertain
                ? '.'
                : tr('. No new analysis is needed.')}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Button {...assessmentLink}>{tr('View full assessment')}</Button>
              <Button
                startIcon={<AutoAwesomeIcon />}
                variant="outlined"
                disabled={analyzeBlocked || !cv}
                loading={match.busy}
                loadingPosition="start"
                onClick={() => void match.analyze()}
              >
                {match.busy
                  ? tr('Analyzing CV Match…')
                  : tr('Reanalyze CV Match')}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
    );
  return (
    <Box
      role="tabpanel"
      id="job-panel-1"
      aria-labelledby="tailored-step-1"
      hidden={hidden}
    >
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {tr(
              'Tailoring uses the saved CV Match for this job. The full evidence and advice stay on the job page.',
            )}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {cv
              ? tr('Saved CV: {fileName}', { fileName: cv.fileName })
              : tr('No saved CV yet.')}
          </Typography>
          {matchStatus === 'CHECKING' && (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>{tr('Checking the saved CV Match…')}</Typography>
            </Stack>
          )}
          {busy && (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>{tr('Processing locally…')}</Typography>
            </Stack>
          )}
          {!busy && current && (
            <Stack spacing={1.5}>
              <Typography role="status">
                {tr('Saved match')}
                {validSourceDate(result.analyzedAt)
                  ? tr(' from {v0}', {
                      v0: new Date(result.analyzedAt).toLocaleString(
                        dateLocale(),
                      ),
                    })
                  : ''}
                {result?.evidenceUncertain
                  ? '.'
                  : tr('. No new analysis is needed.')}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Chip
                  aria-label={tr('Fit score: {v0} (heuristic)', {
                    v0:
                      result.score === null
                        ? incompleteLabel(result, 'Not enough evidence')
                        : `${result.score}/100`,
                  })}
                  color={
                    result.recommendation === 'Apply' ? 'success' : 'default'
                  }
                  label={`${result.guidance ? guidanceLabel(result.guidance.recommendation) : recommendationLabel(result.recommendation)} · ${result.score === null ? tr(incompleteLabel(result, 'not enough evidence')) : `${result.score}/100`}`}
                />
                {counts && (
                  <Typography variant="body2" color="text.secondary">
                    {counts.matched} {tr('evidenced,')} {counts.partial}{' '}
                    {tr('partial,')} {counts.missing} {tr('not evidenced')}
                  </Typography>
                )}
              </Stack>
            </Stack>
          )}
          {!busy && matchStatusMessages[matchStatus] && (
            <Alert severity="info" role="status">
              {matchStatusMessages[matchStatus]}
              {hasDraft &&
                tr(
                  ' Your saved draft below stays available; only a new draft needs a current match.',
                )}
            </Alert>
          )}
          {matchReadError && (
            <Alert
              severity="warning"
              action={
                <Button
                  startIcon={<RefreshIcon />}
                  disabled={busy}
                  onClick={() => match.reload()}
                >
                  {tr('Retry loading match')}
                </Button>
              }
            >
              {matchReadError}
            </Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Button
              startIcon={<AutoAwesomeIcon />}
              variant={current || preferSecondary ? 'outlined' : 'contained'}
              disableElevation
              disabled={
                busy ||
                analyzeBlocked ||
                !cv ||
                matchStatus === 'CHECKING' ||
                matchStatus === 'CV_REVIEW_REQUIRED'
              }
              onClick={() => void match.analyze()}
            >
              {busy
                ? tr('Analyzing CV Match…')
                : reanalyze
                  ? tr('Reanalyze CV Match')
                  : tr('Analyze CV Match')}
            </Button>
            <Button
              {...(routing
                ? { component: Link, to: `/jobs/${jobId}/match` }
                : { component: 'a', href: `/jobs/${jobId}/match` })}
              disabled={!result}
            >
              {tr('View full assessment')}
            </Button>
          </Stack>
          {!cv && (
            <Typography variant="body2" color="text.secondary">
              {tr('Save a source CV in step 1 before analyzing.')}
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
