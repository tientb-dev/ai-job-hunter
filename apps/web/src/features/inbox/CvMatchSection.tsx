import { surface } from '../../app/theme';
import { JdStructureReview } from './JdStructureReview';
import { dateLocale, tr } from '../../app/i18n';
import {
  ArrowForwardIcon,
  AutoAwesomeIcon,
  BoltIcon,
  DescriptionIcon,
  SearchIcon,
  RefreshIcon,
  CheckCircleOutlineIcon,
  ErrorOutlineIcon,
  ExpandMoreIcon,
  VisibilityIcon,
} from '../../components/icons';
import { Link, Navigate, useInRouterContext } from 'react-router-dom';
import { validSourceDate } from './cv-suggestions.contract';
import type {
  CvOrigin,
  EvidenceReview,
  MatchCondition,
  MatchResult,
  SkillMatch,
} from './cv-match.types';
import { statusLabel } from './cv-match.types';
import { JobCvPicker } from './JobCvPicker';
import {
  matchStatusMessages,
  reviewHref,
  type CvMatchState,
} from './useCvMatch';
import {
  assessedComparisons,
  compareRequirements,
  containsSpan,
  type Comparison,
  type JdSpan,
} from './requirement-comparison';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Chip,
  Collapse,
  Divider,
  useMediaQuery,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
// Disclosure headers: subtle hover and a visible keyboard ring, no resting fill.
const disclosureSummarySx = {
  borderRadius: 1,
  transition: 'background-color 160ms ease-out',
  '&:hover': { bgcolor: 'action.hover' },
  '&.Mui-focusVisible': {
    bgcolor: 'action.hover',
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: -2,
  },
} as const;

export function CvMatchSection({
  match,
  labelledBy,
  hidden,
  preferSecondary = false,
  analyzeBlocked = false,
  uploadBlocked = false,
  onGoToTailored,
}: {
  match: CvMatchState;
  labelledBy: string;
  hidden: boolean;
  /** Show Analyze as secondary when another step is the primary action. */
  preferSecondary?: boolean;
  analyzeBlocked?: boolean;
  uploadBlocked?: boolean;
  onGoToTailored?: () => void;
}) {
  const { cv, busy, error, result, matchStatus, matchReadError, skillMatch } =
    match;
  const { analyze, reload } = match;
  const showFindings =
    !!skillMatch?.findings || (matchStatus === 'VALID' && !!result);
  const savedHandoff = matchStatus === 'VALID' && !!result && onGoToTailored;
  const preAnalysis = matchStatus !== 'VALID' || !result;
  const previewId = useId();
  const analysisAction = (
    <Button
      startIcon={<AutoAwesomeIcon />}
      variant={
        !preAnalysis && (preferSecondary || savedHandoff)
          ? 'outlined'
          : 'contained'
      }
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
        width: preAnalysis ? { xs: '100%', sm: 'auto' } : undefined,
      }}
    >
      {result || ['EXPIRED', 'STALE_CV', 'STALE_JOB'].includes(matchStatus)
        ? tr('Reanalyze CV Match')
        : tr('Analyze CV Match')}
    </Button>
  );
  const aboutAnalysis = (
    <Box component="details">
      <Box
        component="summary"
        sx={{ cursor: 'pointer', typography: 'caption' }}
      >
        {tr('About this analysis')}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {tr(
          'Uses the CV selected for this job and the saved job, not unsaved edits. Files parse locally; analysis sends them to the configured AI provider.',
        )}{' '}
        {tr(
          'A new CV opens Source CV Review first; you return here to start CV Match.',
        )}
      </Typography>
    </Box>
  );
  const routing = useInRouterContext();
  // A CV uploaded here opens its Source CV Review next.
  const [uploaded, setUploaded] = useState('');
  const findingsOverview = (
    <FindingsOverview
      preliminary={preAnalysis}
      onGoToTailored={savedHandoff ? undefined : onGoToTailored}
      key={JSON.stringify([
        match.jobId,
        cv?.id,
        cv?.updatedAt,
        result?.evidenceReview?.profileRevisionId,
        result?.evidenceReview?.jobRevision,
        match.attempt,
        result?.analyzedAt,
      ])}
      scored={skillMatch?.rows}
      requirements={matchStatus === 'VALID' ? result?.requirements : undefined}
      coverageLimited={
        matchStatus === 'VALID' && result?.coverageHidden === 'UNVERIFIED_JD'
      }
      review={matchStatus === 'VALID' ? result?.evidenceReview : undefined}
      findings={skillMatch?.findings ?? []}
      conditions={matchStatus === 'VALID' ? result?.conditions : undefined}
    />
  );
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
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
              {tr('Compare CV with JD')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {tr('Compare job skills with your reviewed CV.')}
            </Typography>
          </Box>
          <Paper
            variant={preAnalysis ? 'elevation' : 'outlined'}
            elevation={0}
            sx={
              preAnalysis
                ? { bgcolor: 'transparent' }
                : // Saved state: grouped by the divider below, not a tinted box.
                  { border: 0, bgcolor: 'transparent' }
            }
          >
            <Stack spacing={preAnalysis ? 2 : 1}>
              {/* The selector shows the job's CV; text only when none exists. */}
              {!cv && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  {tr('No saved CV yet.')}
                </Typography>
              )}
              <JobCvPicker
                match={match}
                disabled={busy || uploadBlocked}
                analysisAction={preAnalysis ? undefined : analysisAction}
                onUploaded={setUploaded}
              />
              {preAnalysis && (
                <Paper
                  component="section"
                  aria-labelledby={previewId + '-intro'}
                  variant="outlined"
                  sx={{
                    bgcolor: surface.primaryTint,
                    borderColor: surface.panelBorder,
                    p: { xs: 2, sm: 3 },
                    borderRadius: `${surface.radius}px`,
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 1.5, sm: 3 }}
                    sx={{ alignItems: { sm: 'center' } }}
                  >
                    <Box
                      aria-hidden="true"
                      sx={{
                        position: 'relative',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                        width: { xs: 72, sm: 144 },
                        height: { xs: 64, sm: 124 },
                        color: 'primary.main',
                        bgcolor: 'action.selected',
                        borderRadius: '50%',
                      }}
                    >
                      <DescriptionIcon
                        sx={{
                          fontSize: { xs: 48, sm: 96 },
                          opacity: 0.45,
                          transform: 'rotate(-8deg)',
                        }}
                      />
                      <SearchIcon
                        sx={{
                          position: 'absolute',
                          right: '12%',
                          bottom: '6%',
                          fontSize: { xs: 34, sm: 64 },
                          bgcolor: 'background.paper',
                          borderRadius: '50%',
                        }}
                      />
                    </Box>
                    <Stack
                      spacing={1.5}
                      sx={{
                        minWidth: 0,
                        borderLeft: { sm: 1 },
                        borderColor: { sm: 'divider' },
                        pl: { sm: 3 },
                      }}
                    >
                      <Typography
                        id={previewId + '-intro'}
                        component="h3"
                        variant="h4"
                      >
                        {tr('Your CV Match assessment is not ready yet')}
                      </Typography>
                      <Typography variant="body1" color="text.secondary">
                        {tr(
                          'Analyze your CV against this job to see requirement-by-requirement results and get personalized suggestions for Tailored CV.',
                        )}
                      </Typography>
                      {analysisAction}
                    </Stack>
                  </Stack>
                </Paper>
              )}
              {aboutAnalysis}
              {matchStatus === 'CHECKING' && (
                <Typography role="status">
                  {tr('Checking the saved CV Match…')}
                </Typography>
              )}
              {!busy &&
                (!preAnalysis || matchStatus !== 'MISSING') &&
                matchStatusMessages[matchStatus] && (
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
                          startIcon={<VisibilityIcon />}
                          sx={{ minHeight: 44, flexShrink: 0 }}
                        >
                          {tr('Review CV')}
                        </Button>
                      ) : undefined
                    }
                  >
                    {matchStatusMessages[matchStatus]}
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
                  {tr('Saved CV Match result')}
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
                result?.evidenceUncertain && (
                  <Typography variant="body2" color="text.secondary">
                    {tr(
                      'Some evidence passages could not be verified. Open individual requirements to see available evidence and verification details.',
                    )}
                  </Typography>
                )}
              {savedHandoff && (
                <Button
                  variant="contained"
                  endIcon={<ArrowForwardIcon />}
                  onClick={savedHandoff}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                >
                  {tr('Open Tailored CV')}
                </Button>
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
            </Stack>
          </Paper>
          {!preAnalysis && showFindings && <Divider />}
          {!showFindings && onGoToTailored && (
            <Button
              variant="outlined"
              endIcon={<ArrowForwardIcon />}
              onClick={onGoToTailored}
              sx={{ alignSelf: 'flex-start' }}
            >
              {tr('Open Tailored CV')}
            </Button>
          )}
          {preAnalysis ? (
            <Accordion
              disableGutters
              elevation={0}
              variant="outlined"
              slotProps={{
                region: { 'aria-labelledby': previewId + '-label' },
              }}
              sx={{
                '&&': { borderRadius: `${surface.radius}px` },
                '&::before': { display: 'none' },
              }}
            >
              <AccordionSummary
                id={previewId + '-summary'}
                aria-controls={previewId + '-content'}
                aria-labelledby={previewId + '-label'}
                aria-describedby={previewId + '-description'}
                expandIcon={<ExpandMoreIcon />}
              >
                <Stack
                  component="span"
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', minWidth: 0, mr: 1 }}
                >
                  <BoltIcon color="primary" sx={{ flexShrink: 0 }} />
                  <Box component="span" sx={{ minWidth: 0 }}>
                    <Stack
                      component="span"
                      direction="row"
                      useFlexGap
                      spacing={1}
                      sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      <Typography
                        id={previewId + '-label'}
                        component="span"
                        variant="subtitle1"
                        sx={{ fontWeight: 600 }}
                      >
                        {tr('Quick skill preview')}
                      </Typography>
                      <Chip
                        component="span"
                        size="small"
                        label={tr('Preview only')}
                        sx={{
                          bgcolor: surface.primaryTint,
                          color: 'primary.dark',
                        }}
                      />
                    </Stack>
                    <Typography
                      id={previewId + '-description'}
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      sx={{ display: 'block' }}
                    >
                      {tr(
                        'A quick keyword-based comparison of the job requirements and your reviewed CV. This is not a full assessment.',
                      )}
                    </Typography>
                  </Box>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                {skillMatch ? (
                  <Stack spacing={2}>
                    {skillMatch.findings && findingsOverview}
                    <SkillMatchSummary
                      preliminary
                      match={skillMatch}
                      jobId={match.jobId}
                      onSaved={reload}
                    />
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {tr(
                      'No keyword comparison is available for the selected CV.',
                    )}
                  </Typography>
                )}
              </AccordionDetails>
            </Accordion>
          ) : (
            showFindings && findingsOverview
          )}
          {!preAnalysis &&
            skillMatch &&
            (skillMatch.findings ? (
              <Accordion disableGutters elevation={0}>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                  sx={disclosureSummarySx}
                >
                  {tr('Preliminary skill score and JD structure')}
                </AccordionSummary>
                <AccordionDetails>
                  <SkillMatchSummary
                    embedded
                    match={skillMatch}
                    jobId={match.jobId}
                    onSaved={reload}
                  />
                </AccordionDetails>
              </Accordion>
            ) : (
              <SkillMatchSummary
                match={skillMatch}
                jobId={match.jobId}
                onSaved={reload}
              />
            ))}
          {result && !skillMatch && matchStatus === 'VALID' && (
            <Typography variant="body2">
              {tr(
                'JD–CV Skill Match is unavailable for this saved assessment.',
              )}
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

const findingReasons = {
  skill: 'The preliminary comparison found evidence for this named skill.',
  related:
    'The reviewed CV shows related experience. The specific requirement still needs clarification.',
  clause:
    'The JD groups several skills together. Individual matches leave the full requirement open.',
  requirement:
    'The reviewed CV does not establish this requirement. Add a concrete example if it reflects your work.',
} as const;
export function FindingsOverview({
  findings,
  preliminary = false,
  scored = [],
  requirements,
  coverageLimited,
  review,
  conditions = [],
  onGoToTailored,
}: {
  findings: NonNullable<SkillMatch['findings']>;
  preliminary?: boolean;
  scored?: SkillMatch['rows'];
  requirements?: MatchResult['requirements'];
  coverageLimited?: boolean;
  review?: EvidenceReview;
  conditions?: MatchCondition[];
  onGoToTailored?: () => void;
}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [direct, setDirect] = useState(false);
  const [selection, setSelection] = useState<string>();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const entered = useRef<string | undefined>(undefined);
  const pendingReveal = useRef<string | undefined>(undefined);
  const frame = useRef(0);
  const [highlight, setHighlight] = useState<string>();
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(highlightTimer.current);
    },
    [],
  );
  const id = useId();

  function positionDetails(key: string) {
    if (pendingReveal.current !== key) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (pendingReveal.current !== key || entered.current !== key) return;
      pendingReveal.current = undefined;
      const button = refs.current.get(key);
      if (!button) return;
      const header = document.querySelector('header');
      button.style.scrollMarginTop =
        (header?.getBoundingClientRect().height ?? 0) + 12 + 'px';
      button.scrollIntoView?.({ block: 'start', behavior: 'instant' });
      button.focus({ preventScroll: true });
      setHighlight(key);
      clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlight(undefined), 1400);
    });
  }

  function reveal(key: string) {
    pendingReveal.current = key;
    setDirect(false);
    setSelection(key);
    if (entered.current === key) positionDetails(key);
  }
  const unique = [
    ...new Map(conditions.map((c) => [JSON.stringify(c), c])).values(),
  ];
  const skills = findings.filter((f) => f.kind === 'skill');
  const all = compareRequirements(findings, [], scored, review);
  const comparisons = all.filter((r) => !r.unmapped);
  const assessed = coverageLimited
    ? undefined
    : assessedComparisons(requirements, all, unique, review);
  const evidenceKey = (finding: (typeof findings)[number]) =>
    JSON.stringify([finding.label.toLowerCase(), finding.evidence]);
  const presented = new Set(
    (assessed ?? comparisons).flatMap((row) => row.findings.map(evidenceKey)),
  );
  const fallback = new Map<string, NonNullable<SkillMatch['findings']>>();
  for (const row of all.filter((r) => assessed || r.unmapped))
    for (const finding of row.findings) {
      if (
        presented.has(evidenceKey(finding)) ||
        (assessed && !finding.evidence)
      )
        continue;
      const key = finding.label.toLocaleLowerCase();
      const entries = fallback.get(key) ?? [];
      if (!entries.includes(finding)) entries.push(finding);
      fallback.set(key, entries);
    }
  const supported = comparisons.filter((row) => row.supported);
  const pending = comparisons.filter((row) => !row.supported);
  const priorities = [
    pending.find((r) => r.findings.some((f) => f.kind === 'requirement')),
    pending.find((r) =>
      r.conditions.some(
        (c) => c.kind === 'EXPERIENCE' && c.status === 'UNKNOWN',
      ),
    ),
    pending.find((r) => r.conditions.some((c) => c.status === 'NOT_MET')),
  ];
  const important = [
    ...new Set(
      [...priorities, ...pending].filter((r): r is Comparison => Boolean(r)),
    ),
  ].slice(0, 3);
  function explanation(row: Comparison) {
    if (preliminary) {
      return row.findings.some((f) => f.kind === 'skill')
        ? tr('Keywords found: {skills}', {
            skills: row.findings
              .filter((f) => f.kind === 'skill')
              .map((f) => f.label)
              .join(', '),
          })
        : tr('Review this requirement against your CV.');
    }
    const c =
      row.conditions.find((c) => c.status === 'NOT_MET') ??
      row.conditions.find((c) => c.status === 'UNKNOWN') ??
      row.conditions[0];
    if (c?.kind === 'EXPERIENCE' && c.status === 'UNKNOWN') {
      const names = row.findings
        .filter((f) => f.kind === 'skill')
        .map((f) => f.label);
      return [
        names.length &&
          tr('Skills documented here: {skills}', { skills: names.join(', ') }),
        tr(
          'The duration is unverified. Check dates for the relevant role or project.',
        ),
      ]
        .filter(Boolean)
        .join(' ');
    }
    if (c) return tr(conditionStatusLabel[c.status]);
    if (row.supported)
      return tr('Skills documented here: {skills}', {
        skills: row.findings
          .filter((f) => f.kind === 'skill')
          .map((f) => f.label)
          .join(', '),
      });
    if (row.findings.some((f) => f.kind === 'requirement'))
      return tr(findingReasons.requirement);
    return tr(
      'Check the required scope against the experience documented in your CV.',
    );
  }
  function summaryRow(row: Comparison) {
    return (
      <Box
        key={row.key}
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          alignItems: 'baseline',
          columnGap: 1,
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box component="span">
          <Typography
            component="span"
            sx={{ display: 'block' }}
            variant="subtitle2"
          >
            {row.title}
          </Typography>
          <Typography
            component="span"
            sx={{ display: 'block' }}
            variant="body2"
            color="text.secondary"
          >
            {explanation(row)}
          </Typography>
          {row.supported && !preliminary && (
            <Typography
              component="span"
              variant="caption"
              color={
                row.status === 'Evidence supports part of this requirement'
                  ? 'info.dark'
                  : 'success.dark'
              }
            >
              {tr(row.status)}
            </Typography>
          )}
        </Box>
        <Button
          size="small"
          aria-label={tr('View details for {requirement}', {
            requirement: row.title,
          })}
          aria-controls={id + '-req-' + comparisons.indexOf(row)}
          onClick={() => reveal(row.key)}
        >
          {tr('View details')}
        </Button>
      </Box>
    );
  }
  function renderComparison(row: Comparison, i: number) {
    const open = selection === row.key;
    const evidence = [
      ...new Map(
        row.findings.flatMap((f) =>
          f.evidence ? [[JSON.stringify(f.evidence), f.evidence] as const] : [],
        ),
      ).values(),
    ];
    const directNames = row.findings
      .filter((f) => f.kind === 'skill')
      .map((f) => f.label);
    const duration = row.conditions.some(
      (c) => c.kind === 'EXPERIENCE' && c.status === 'UNKNOWN',
    );
    const assessment = row.assessment;
    const badge = preliminary
      ? directNames.length
        ? 'Keywords found'
        : 'Check scope'
      : assessment
        ? coverageCategories[assessment.status][0]
        : duration
          ? 'Experience duration needs verification'
          : row.status;
    const gap = row.findings.some((f) => f.kind === 'requirement');
    const next = duration
      ? 'Check role dates and project periods against each quoted requirement before editing your CV.'
      : assessment
        ? assessmentNextSteps[assessment.status]
        : gap
          ? 'If accurate, describe the task you performed in the relevant role or project.'
          : row.status === 'Evidence supports part of this requirement'
            ? 'Check which parts the employer requires before updating your CV.'
            : !row.supported
              ? 'Check the required scope against the experience documented in your CV.'
              : undefined;
    const spans = row.findings
      .filter((f) => f.kind === 'skill')
      .flatMap((f) => f.sources);
    return (
      <Paper
        key={row.key}
        variant="outlined"
        sx={{
          my: 1,
          overflow: 'hidden',
          borderRadius: 2,
          borderColor: open ? 'primary.main' : 'divider',
          transition: 'border-color 240ms ease-out',
        }}
      >
        <Button
          fullWidth
          aria-expanded={open}
          aria-label={assessment ? `${tr(badge)}: ${row.title}` : undefined}
          onClick={() => {
            pendingReveal.current = undefined;
            setDirect(true);
            setHighlight(undefined);
            setSelection(open ? undefined : row.key);
          }}
          sx={{
            textAlign: 'start',
            justifyContent: 'space-between',
            px: 2,
            py: 1.5,
            borderRadius: 0,
            // White header open or closed; only the evidence-jump highlight tints it.
            bgcolor:
              highlight === row.key ? 'action.selected' : 'background.paper',
            borderBottom: open ? '1px solid' : 0,
            borderColor: 'divider',
            transition: 'background-color 160ms ease-out',
            '&:hover': {
              bgcolor:
                highlight === row.key ? 'action.selected' : 'action.hover',
            },
            '&.Mui-focusVisible, &:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: -3,
            },

            color: 'text.primary',
            textTransform: 'none',
          }}
          endIcon={
            <ExpandMoreIcon
              sx={{ transform: open ? 'rotate(180deg)' : 'none' }}
            />
          }
          id={id + '-req-' + i}
          aria-controls={id + '-body-' + i}
          ref={(node: HTMLButtonElement | null) => {
            if (node) refs.current.set(row.key, node);
            else refs.current.delete(row.key);
          }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {row.title}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}
            >
              <Chip
                size="small"
                variant="outlined"
                color={
                  preliminary
                    ? 'default'
                    : assessment
                      ? assessmentColors[assessment.status]
                      : duration || gap
                        ? 'warning'
                        : row.supported &&
                            row.status !==
                              'Evidence supports part of this requirement'
                          ? 'success'
                          : 'info'
                }
                label={tr(badge)}
                sx={{
                  height: 'auto',
                  minHeight: 24,
                  '& .MuiChip-label': { whiteSpace: 'normal' },
                }}
              />
              {!open && (
                <Typography variant="body2" color="text.secondary">
                  {assessment
                    ? tr(assessmentReasons[assessment.status])
                    : explanation(row)}
                </Typography>
              )}
            </Stack>
          </Box>
        </Button>
        <Collapse
          in={open}
          timeout={{
            enter: reduced ? 0 : 170,
            exit: direct && !reduced ? 170 : 0,
          }}
          mountOnEnter
          unmountOnExit
          onEntered={() => {
            entered.current = row.key;
            positionDetails(row.key);
          }}
          onExit={() => {
            if (entered.current === row.key) entered.current = undefined;
          }}
          sx={
            !open && !direct
              ? { height: '0 !important', transition: 'none !important' }
              : undefined
          }
        >
          <Box
            role="region"
            aria-labelledby={id + '-req-' + i}
            id={id + '-body-' + i}
            sx={{ p: 2 }}
          >
            <Stack spacing={1.5}>
              {(row.source || assessment) && (
                <Box
                  sx={{
                    pb: 1.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="subtitle2" color="text.secondary">
                    {tr('Job description')}
                  </Typography>
                  <Typography component="blockquote" sx={{ m: 0, mt: 0.5 }}>
                    {row.source
                      ? highlightedQuote(row.source, spans)
                      : row.title}
                  </Typography>
                </Box>
              )}
              {assessment && (
                <SavedRequirementDetails
                  assessment={assessment}
                  reviewEvidence={
                    review?.rows.find(
                      (item) =>
                        row.source &&
                        containsSpan(item, row.source) &&
                        containsSpan(row.source, item),
                    )?.evidence
                  }
                />
              )}
              {directNames.length > 0 && (
                <Box>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 600, mb: 0.75 }}
                  >
                    {tr(
                      preliminary
                        ? 'CV passages mentioning these skills'
                        : assessment
                          ? 'Preliminary skill evidence'
                          : 'CV evidence',
                    )}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={0.75}
                    useFlexGap
                    sx={{ flexWrap: 'wrap' }}
                  >
                    {directNames.map((name) => (
                      <Chip
                        key={name}
                        label={name}
                        size="small"
                        color={preliminary ? 'default' : 'success'}
                        variant="outlined"
                      />
                    ))}
                  </Stack>
                </Box>
              )}
              {row.findings
                .filter((f) => f.kind === 'related')
                .map((f) => (
                  <Typography key={f.label} variant="body2">
                    {f.label} ·{' '}
                    {tr(
                      preliminary
                        ? 'Related terms found. Review the specific requirement.'
                        : findingReasons.related,
                    )}
                  </Typography>
                ))}
              {!assessment && gap && (
                <Typography variant="body2">
                  {tr(
                    preliminary
                      ? 'No direct keyword match was found for this requirement.'
                      : 'The reviewed CV does not establish this requirement.',
                  )}
                </Typography>
              )}
              {row.status === 'Evidence supports part of this requirement' && (
                <Typography variant="body2">
                  {tr(
                    preliminary
                      ? 'These keyword matches do not establish that the whole requirement is met.'
                      : 'Individual skills are documented. The full requirement remains unverified.',
                  )}
                </Typography>
              )}
              {row.conditions.length > 0 && (
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {tr('Review of the condition')}
                </Typography>
              )}
              {row.conditions.map((c, index) => (
                <Box key={JSON.stringify([c.parentId, c.componentId, index])}>
                  {(row.conditions.length > 1 || c.jdQuote !== row.title) && (
                    <Typography variant="subtitle2">{c.jdQuote}</Typography>
                  )}
                  <Typography variant="body2">
                    {tr(
                      c.status === 'UNKNOWN'
                        ? 'More CV evidence is needed'
                        : conditionStatusLabel[c.status],
                    )}
                    {c.mode === 'OR' &&
                      ' · ' + tr('Alternative in the job description')}
                    {c.reason === 'DATED_PROGRAMMING' &&
                      ' · ' +
                        tr(
                          'Reviewed work dates and programming roles do not establish the required duration.',
                        )}
                    {c.reason === 'IT_QUALIFICATION' &&
                      ' · ' +
                        tr(
                          'Reviewed education does not establish the required IT degree.',
                        )}
                    {c.unknownExperience &&
                      ' · ' + unknownExperienceText(c.unknownExperience)}
                  </Typography>
                </Box>
              ))}
              {!assessment && !row.source && row.conditions.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {tr(
                    'Shown separately because its JD source could not be linked uniquely.',
                  )}
                </Typography>
              )}
              {next && (
                <Box>
                  <Typography variant="subtitle2">{tr('Next step')}</Typography>
                  <Typography variant="body2">{tr(next)}</Typography>
                </Box>
              )}
              {(evidence.length > 0 ||
                row.conditions.some((c) => c.evidence.length)) && (
                <details>
                  <summary>
                    {tr(
                      preliminary
                        ? 'View CV passages'
                        : assessment
                          ? 'Preliminary and condition evidence'
                          : 'Original CV evidence',
                    )}
                  </summary>
                  {evidence.map((e) => (
                    <EvidenceQuote
                      key={JSON.stringify(e)}
                      source="CV evidence"
                      title={
                        preliminary
                          ? tr('CV passage')
                          : assessment
                            ? tr('Preliminary CV evidence')
                            : undefined
                      }
                      label={preliminary ? tr('CV passage') : undefined}
                      quote={e.quote}
                      origin={e.origin}
                      detail={[
                        e.factId && tr('CV fact: {id}', { id: e.factId }),
                        e.sectionKind &&
                          tr(reviewedSectionLabels[e.sectionKind]),
                        e.origin === 'source' && tr('From reviewed source'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  ))}
                  {row.conditions
                    .flatMap((c) => c.evidence)
                    .map((e, index) => (
                      <EvidenceQuote
                        key={index}
                        source="CV evidence"
                        quote={e.cvQuote}
                        origin={e.cvOrigin}
                      />
                    ))}
                </details>
              )}
            </Stack>
          </Box>
        </Collapse>
      </Paper>
    );
  }
  const tailoredAction = onGoToTailored && (
    <Button
      variant="outlined"
      endIcon={<ArrowForwardIcon />}
      onClick={onGoToTailored}
      sx={{ alignSelf: { xs: 'stretch', sm: 'flex-end' } }}
    >
      {tr('Open Tailored CV')}
    </Button>
  );
  const headline = skills.length
    ? tr(
        preliminary
          ? 'Skills mentioned in the CV: {skills}'
          : 'Preliminary skill evidence: {skills}',
        {
          skills: skills
            .slice(0, 2)
            .map((f) => f.label)
            .join(', '),
        },
      )
    : tr(
        preliminary
          ? 'Compare job requirements with the CV'
          : 'Preliminary CV and JD comparison',
      );
  return (
    <Stack
      component="section"
      spacing={1.5}
      sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
    >
      {assessed ? (
        <RequirementCoverage
          rows={assessed}
          renderComparison={renderComparison}
        />
      ) : (
        <>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: `${surface.radius}px`,
              p: 2,
            }}
          >
            <Typography variant="overline" color="text.secondary">
              {tr(preliminary ? 'Keyword comparison' : 'CV evidence summary')}
            </Typography>
            <Typography component="h3" variant="h5" sx={{ fontWeight: 600 }}>
              {headline}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {!preliminary &&
                skills.length > 0 &&
                tr(
                  'The preliminary comparison links named skills to your reviewed CV. Full requirements are evaluated in the saved assessment.',
                )}
              {!findings.length &&
                !unique.length &&
                tr(
                  preliminary
                    ? 'No keyword comparison is available for the selected CV.'
                    : 'No findings available for this review.',
                )}
            </Typography>
            {!preliminary && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {tr(
                  requirements || coverageLimited
                    ? 'Requirement coverage is unavailable. The assessment does not provide trustworthy requirement counts.'
                    : 'Analyze CV Match to see saved assessment coverage.',
                )}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0,1fr)',
                sm: 'repeat(2,minmax(0,1fr))',
              },
              gap: 1.5,
            }}
          >
            <Paper
              component="section"
              variant="outlined"
              sx={{ p: 2, minWidth: 0 }}
            >
              <Typography
                component="h4"
                variant="subtitle1"
                sx={{ fontWeight: 600 }}
              >
                {!preliminary && (
                  <CheckCircleOutlineIcon
                    sx={{
                      fontSize: 19,
                      color: 'success.main',
                      verticalAlign: 'text-bottom',
                      mr: 1,
                    }}
                  />
                )}
                {tr(
                  preliminary
                    ? 'Requirements with keywords found'
                    : 'JD requirements with preliminary evidence',
                )}
              </Typography>
              {supported.slice(0, 4).map(summaryRow)}
              {!supported.length && (
                <Typography variant="body2">
                  {tr(
                    preliminary
                      ? 'No direct keywords found.'
                      : 'No preliminary evidence found for these requirements.',
                  )}
                </Typography>
              )}
            </Paper>
            <Paper
              component="section"
              variant="outlined"
              sx={{ p: 2, minWidth: 0 }}
            >
              <Typography
                component="h4"
                variant="subtitle1"
                sx={{ fontWeight: 600 }}
              >
                {!preliminary && (
                  <ErrorOutlineIcon
                    sx={{
                      fontSize: 19,
                      color: 'warning.main',
                      verticalAlign: 'text-bottom',
                      mr: 1,
                    }}
                  />
                )}
                {tr('Points to review')}
              </Typography>
              {important.map(summaryRow)}
              {!pending.length && (
                <Typography variant="body2">
                  {tr('No items flagged in this comparison.')}
                </Typography>
              )}
            </Paper>
          </Box>
          <Box component="section">
            <Typography
              component="h4"
              variant="subtitle1"
              sx={{ fontWeight: 600, mb: 1 }}
            >
              {tr('Compare individual JD requirements')}
            </Typography>
            {comparisons.map(renderComparison)}
          </Box>
        </>
      )}
      {assessed && (
        <MatchConditions
          conditions={unique.filter(
            (condition) =>
              !assessed.some((row) => row.conditions.includes(condition)),
          )}
        />
      )}
      {fallback.size > 0 && (
        <Box
          component="details"
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            '&[open] > summary .chevron': { transform: 'rotate(180deg)' },
          }}
        >
          <Box
            component="summary"
            sx={{
              ...disclosureSummarySx,
              cursor: 'pointer',
              listStyle: 'none',
              '&::-webkit-details-marker': { display: 'none' },
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              px: 2,
              py: 1.5,
              '&:focus-visible': disclosureSummarySx['&.Mui-focusVisible'],
            }}
          >
            {tr(
              preliminary
                ? 'Other related CV passages'
                : 'Other relevant CV experience',
            )}
            <ExpandMoreIcon
              className="chevron"
              aria-hidden="true"
              sx={{ color: 'action.active', transition: 'transform 150ms' }}
            />
          </Box>
          {[...fallback].map(([key, entries]) => (
            <Box component="details" key={key} sx={{ ml: 2, py: 0.5 }}>
              <Box component="summary" sx={{ cursor: 'pointer' }}>
                {entries[0]!.label}
              </Box>
              {[
                ...new Map(
                  entries.flatMap((f) =>
                    f.evidence
                      ? [[JSON.stringify(f.evidence), f.evidence] as const]
                      : [],
                  ),
                ).values(),
              ].map((e) => (
                <EvidenceQuote
                  key={JSON.stringify(e)}
                  source="CV evidence"
                  title={preliminary ? tr('CV passage') : undefined}
                  label={preliminary ? tr('CV passage') : undefined}
                  quote={e.quote}
                  origin={e.origin}
                  detail={[
                    e.sectionKind && tr(reviewedSectionLabels[e.sectionKind]),
                    e.origin === 'source' && tr('From reviewed source'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ))}
            </Box>
          ))}
        </Box>
      )}
      {tailoredAction}
    </Stack>
  );
}

const assessmentReasons = {
  EVIDENCED: 'The saved assessment found sufficient supporting evidence.',
  PARTIAL: 'The saved evidence supports part of the requirement.',
  NOT_EVIDENCED:
    'The assessment did not establish sufficient evidence in the reviewed CV.',
  CONFLICT: 'The saved assessment flagged an evidence issue for review.',
  UNDECOMPOSED: 'The saved assessment could not make a reliable determination.',
} as const;

const assessmentNextSteps = {
  EVIDENCED: undefined,
  PARTIAL: 'Check which parts the employer requires before updating your CV.',
  NOT_EVIDENCED:
    'If accurate, describe the task you performed in the relevant role or project.',
  CONFLICT:
    'Compare the saved evidence with the original requirement and reviewed CV.',
  UNDECOMPOSED:
    'Check the required scope against the experience documented in your CV.',
} as const;

const assessmentColors = {
  EVIDENCED: 'success',
  PARTIAL: 'info',
  NOT_EVIDENCED: 'default',
  CONFLICT: 'error',
  UNDECOMPOSED: 'warning',
} as const;

function SavedRequirementDetails({
  assessment: { requirement, status },
  reviewEvidence = [],
}: {
  assessment: NonNullable<Comparison['assessment']>;
  reviewEvidence?: EvidenceReview['rows'][number]['evidence'];
}) {
  const components = requirement.coverage?.components ?? [];
  const supporting = new Map<string, { origin?: CvOrigin; title: string }>();
  for (const component of components) {
    for (const passage of Array.isArray(component.strength?.quotes)
      ? component.strength.quotes
      : []) {
      if (typeof passage?.quote === 'string' && passage.quote.trim())
        supporting.set(passage.quote, {
          title: tr('Evidence strength passage'),
        });
    }
    for (const quote of component.conflictingQuotes)
      supporting.set(quote, { title: tr('Conflicting CV evidence') });
    if (component.cvQuote.trim())
      supporting.set(component.cvQuote, {
        origin: component.cvOrigin,
        title: tr('Evidence selected in the assessment'),
      });
  }
  if (requirement.cvQuote.trim() && !supporting.has(requirement.cvQuote))
    supporting.set(requirement.cvQuote, {
      origin: requirement.cvOrigin,
      title: tr('Evidence selected in the assessment'),
    });

  const reason = requirement.coverage?.reason;
  const hasReason =
    reason && !/^Review the selected (?:component )?evidence\.$/u.test(reason);
  return (
    <Stack spacing={1}>
      <Typography variant="body2">{tr(assessmentReasons[status])}</Typography>
      {hasReason && <Typography variant="body2">{tr(reason)}</Typography>}
      {requirement.evidence?.modelQuote === 'REJECTED' && (
        <Typography variant="body2">
          {tr(
            'An assessment passage was rejected during evidence verification.',
          )}
        </Typography>
      )}
      {components.map((component) => (
        <Box key={component.id}>
          {components.length > 1 && (
            <Typography variant="subtitle2">
              {component.label} · {statusLabel(component.status)}
            </Typography>
          )}
          {component.qualificationReason && (
            <Typography variant="body2">
              {tr(component.qualificationReason)}
            </Typography>
          )}
          {component.observations?.map(({ kind, cvQuote }) => (
            <EvidenceQuote
              key={JSON.stringify([kind, cvQuote])}
              source="CV evidence"
              title={tr(
                kind === 'experience'
                  ? 'Verified professional experience'
                  : 'Verified technology mention',
              )}
              label={tr(
                kind === 'experience'
                  ? 'Professional experience: {label}'
                  : 'Technology mention: {label}',
                { label: component.label },
              )}
              quote={cvQuote}
            />
          ))}
        </Box>
      ))}
      {supporting.size > 0 ? (
        <details>
          <summary>{tr('Original CV evidence')}</summary>
          {[...supporting].map(([quote, evidence]) => {
            const refs = new Set(
              reviewEvidence
                .filter(
                  (item) =>
                    item.quote === quote &&
                    (!evidence.origin || item.origin === evidence.origin),
                )
                .map((item) => item.entryId),
            );
            const entryId = refs.size === 1 ? [...refs][0] : undefined;
            return (
              <EvidenceQuote
                key={quote}
                source="CV evidence"
                quote={quote}
                detail={
                  entryId ? tr('CV entry: {id}', { id: entryId }) : undefined
                }
                {...evidence}
              />
            );
          })}
        </details>
      ) : (
        !components.some((component) => component.observations?.length) && (
          <Typography variant="body2" color="text.secondary">
            {tr('No evidence passages were saved for this requirement.')}
          </Typography>
        )
      )}
      {!hasReason &&
        !components.some((component) => component.qualificationReason) && (
          <Typography variant="body2" color="text.secondary">
            {tr('No further assessment rationale was saved.')}
          </Typography>
        )}
    </Stack>
  );
}

const coverageCategories = {
  EVIDENCED: ['Matched', 'success.main'],
  PARTIAL: ['Partial', 'info.main'],
  NOT_EVIDENCED: ['Not evidenced in reviewed CV', 'grey.600'],
  CONFLICT: ['Conflict / Needs review', 'error.main'],
  UNDECOMPOSED: ['Unable to assess', 'warning.main'],
} as const;

function RequirementCoverage({
  rows,
  renderComparison,
}: {
  rows: Comparison[];
  renderComparison: (row: Comparison, index: number) => React.ReactNode;
}) {
  const id = useId();
  const categories = (
    Object.keys(coverageCategories) as (keyof typeof coverageCategories)[]
  ).map((status) => {
    const [label, color] = coverageCategories[status];
    const members = rows.filter((row) => row.assessment?.status === status);
    return { status, label, color, count: members.length, members };
  });
  return (
    <Box component="section" aria-label={tr('Saved assessment coverage')}>
      <Stack
        direction="row"
        useFlexGap
        sx={{
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 0.5,
        }}
      >
        <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
          {tr('CV Match assessment')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {tr('{count} JD requirements', { count: rows.length })}
        </Typography>
      </Stack>
      <Box
        aria-hidden="true"
        sx={{
          display: 'flex',
          height: 12,
          mt: 1,
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        {categories
          .filter(({ count }) => count > 0)
          .map(({ label, color, count }) => (
            <Box key={label} sx={{ flex: count, bgcolor: color }} />
          ))}
      </Box>
      <Box
        component="dl"
        sx={{
          m: 0,
          mt: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 1,
        }}
      >
        {categories.map(({ label, color, count }) => (
          <Box
            key={label}
            sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}
          >
            <Box
              aria-hidden="true"
              sx={{
                width: 8,
                height: 8,
                borderRadius: 0.5,
                flexShrink: 0,
                bgcolor: color,
              }}
            />
            <Typography component="dt" variant="body2" sx={{ order: 1 }}>
              {tr(label)}
            </Typography>
            <Typography
              component="dd"
              variant="body2"
              sx={{ m: 0, fontWeight: 600 }}
            >
              {count}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography
        component="p"
        variant="caption"
        color="text.secondary"
        sx={{ mt: 1, mb: 0 }}
      >
        {tr('Missing CV evidence leaves real-world ability unverified.')}
      </Typography>
      <Box
        sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Typography component="h4" variant="subtitle2" sx={{ mb: 1 }}>
          {tr('Requirements by assessment result')}
        </Typography>
        {categories
          .filter(({ count }) => count > 0)
          .map(({ status, label, color, count, members }) => (
            <Accordion
              key={status}
              disableGutters
              elevation={0}
              // Open group: header and list share one light surface.
              sx={{
                '&.Mui-expanded': {
                  my: 1,
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: `${surface.radius}px`,
                  '&::before': { opacity: 0 },
                },
                '&.Mui-expanded + .MuiAccordion-root::before': { opacity: 0 },
              }}
            >
              <AccordionSummary
                id={id + status}
                aria-controls={id + status + '-requirements'}
                expandIcon={<ExpandMoreIcon />}
                sx={disclosureSummarySx}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Box
                    aria-hidden="true"
                    sx={{
                      width: 8,
                      height: 8,
                      bgcolor: color,
                      borderRadius: '50%',
                    }}
                  />
                  <Typography
                    component="span"
                    variant="subtitle1"
                    sx={{ fontWeight: 700 }}
                  >
                    {tr(label)} ({count})
                  </Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails
                sx={{
                  px: { xs: 1, sm: 1.5 },
                  pt: 0.5,
                  pb: 1,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {members.map((row) => renderComparison(row, rows.indexOf(row)))}
              </AccordionDetails>
            </Accordion>
          ))}
      </Box>
    </Box>
  );
}

function highlightedQuote(source: JdSpan, spans: JdSpan[]) {
  const parts: React.ReactNode[] = [];
  let cursor = source.start;
  for (const span of spans
    .filter((s) => containsSpan(source, s))
    .sort((a, b) => a.start - b.start)) {
    if (span.start < cursor) continue;
    parts.push(
      source.quote.slice(cursor - source.start, span.start - source.start),
      <Box
        component="mark"
        key={span.start}
        sx={{
          bgcolor: (theme) => theme.alpha(theme.palette.success.main, 0.14),
          color: 'text.primary',
          fontWeight: 600,
        }}
      >
        {span.quote}
      </Box>,
    );
    cursor = span.end;
  }
  return [...parts, source.quote.slice(cursor - source.start)];
}

function SkillMatchSummary({
  match,
  jobId,
  onSaved,
  preliminary = false,
  embedded = false,
}: {
  match: SkillMatch;
  jobId: string;
  onSaved: () => void;
  preliminary?: boolean;
  /** Inside a disclosure: plain content, no second bordered tinted box. */
  embedded?: boolean;
}) {
  const id = useId();
  const partial = match.partialScore != null;
  const score = match.partialScore ?? match.score;
  const matched = match.rows.filter(({ skills }) =>
    skills.some(({ evidence }) => evidence),
  );
  const missing = match.rows.filter(({ skills }) =>
    skills.every(({ evidence }) => !evidence),
  );
  return (
    <Stack
      component="section"
      aria-labelledby={id}
      spacing={1.5}
      sx={{ minWidth: 0 }}
    >
      <Stack
        spacing={1}
        sx={
          embedded
            ? undefined
            : {
                p: { xs: 2, sm: 3 },
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: `${surface.radius}px`,
                bgcolor: surface.primaryTint,
              }
        }
      >
        <Typography
          id={id}
          component="h3"
          variant="subtitle1"
          sx={{ fontWeight: 600 }}
        >
          {tr(
            preliminary
              ? 'Skill group keyword comparison'
              : 'JD–CV Skill Match',
          )}
        </Typography>
        <Box role="status" aria-atomic="true">
          <Typography component="p" variant="h5" sx={{ fontWeight: 600 }}>
            {tr(
              preliminary
                ? 'Keywords found for {matched}/{total} skill groups'
                : '{matched}/{total} assessed skill groups matched',
              {
                matched: match.matchedCount,
                total: match.totalCount,
              },
            )}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {score === null
              ? tr(
                  preliminary
                    ? 'No weighted keyword score available.'
                    : 'No skill score available.',
                )
              : tr(
                  preliminary
                    ? '{score}% weighted keyword score'
                    : '{score}% weighted match across assessed requirements',
                  {
                    score: Math.round(score),
                  },
                )}
          </Typography>
        </Box>
        {(partial || match.limitation === 'INCOMPLETE_INVENTORY') && (
          <Alert severity="warning">
            {tr(
              preliminary
                ? 'The keyword score covers only the skill groups shown here.'
                : 'The score covers only the requirements assessed here.',
            )}
          </Alert>
        )}
      </Stack>
      {match.fieldConflict && (
        <Alert severity="info">
          {tr(
            preliminary
              ? 'Original JD and saved skills differ. The comparison uses the original JD priorities.'
              : 'Original JD and saved skills differ. Assessed groups use the original JD priorities.',
          )}
        </Alert>
      )}
      {(
        [
          [
            preliminary ? 'Skills with keywords found' : 'Matched skills',
            matched,
            true,
            preliminary ? 'No direct keywords found.' : 'No matches found.',
          ],
          [
            preliminary
              ? 'Skills without keywords found'
              : 'No evidence found in CV Review',
            missing,
            false,
            'None among the identified requirements.',
          ],
        ] as const
      ).map(([heading, rows, found, empty]) => (
        <Box key={heading}>
          <Typography
            component="h4"
            variant="subtitle2"
            sx={{ fontWeight: 600 }}
          >
            {tr(heading)}
          </Typography>
          {rows.length ? (
            <Box
              component="ul"
              sx={{ my: 0.5, pl: 3, overflowWrap: 'anywhere' }}
            >
              {rows.map(({ skills, priority }) => (
                <Typography
                  component="li"
                  variant="body2"
                  key={skills.map(({ name }) => name).join('|')}
                >
                  {skills
                    .filter(({ evidence }) => Boolean(evidence) === found)
                    .map(({ name }) => name)
                    .join(found ? ', ' : ` ${tr('or')} `)}
                  {' · '}
                  {tr(priority === 'required' ? 'Required' : 'Preferred')}
                </Typography>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {tr(empty)}
            </Typography>
          )}
        </Box>
      ))}
      <Stack
        component="section"
        spacing={1}
        aria-label={tr('Unresolved JD requirements')}
        sx={{ minWidth: 0 }}
      >
        <Typography component="h4" variant="subtitle2" sx={{ fontWeight: 600 }}>
          {tr('Unresolved JD requirements')}
        </Typography>
        {!!(match.unresolved?.length || match.fallbackReview?.length) && (
          <Accordion disableGutters elevation={0}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={disclosureSummarySx}
            >
              {tr(
                preliminary
                  ? 'View unresolved requirements'
                  : 'View unassessed requirements',
              )}
            </AccordionSummary>
            <AccordionDetails>
              <Stack
                component="ul"
                spacing={1.25}
                sx={{ m: 0, pl: 2.5, overflowWrap: 'anywhere' }}
              >
                {match.unresolved?.map((item, index) => (
                  <Box component="li" key={index}>
                    <Typography variant="body2">{item}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {tr(
                        match.mixedGroups?.includes(item)
                          ? 'The required skills and alternatives could not be separated reliably.'
                          : preliminary
                            ? 'This requirement could not be compared reliably.'
                            : 'This requirement could not be assessed reliably.',
                      )}
                    </Typography>
                  </Box>
                ))}
                {match.fallbackReview?.map(({ source, skills }) => (
                  <Box
                    component="li"
                    key={skills.map(({ name }) => name).join('|')}
                  >
                    <Typography variant="body2">
                      {tr('Permitted fallback needs review')} ·{' '}
                      {skills.map(({ name }) => name).join(' / ')}
                    </Typography>
                    <Typography variant="body2">{source.quote}</Typography>
                  </Box>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}
        {(!!match.unresolved?.length ||
          ['MISSING', 'STALE', 'FAILED'].includes(
            match.inventoryStatus ?? '',
          )) && <JdStructureReview jobId={jobId} onSaved={onSaved} />}
      </Stack>
      {match.rows.length > 0 && (
        <Accordion disableGutters elevation={0}>
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={disclosureSummarySx}
          >
            {tr('View skill sources')}
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              {match.rows.map(({ source, skills }) => (
                <Stack
                  key={skills.map(({ name }) => name).join('|')}
                  spacing={1}
                >
                  <EvidenceQuote source="JD evidence" quote={source.quote} />
                  {skills.map(({ name, evidence }) =>
                    evidence ? (
                      <EvidenceQuote
                        key={name}
                        source="CV evidence"
                        title={name}
                        label={preliminary ? tr('CV passage') : undefined}
                        detail={[
                          evidence.sectionKind &&
                            tr(reviewedSectionLabels[evidence.sectionKind]),
                          evidence.origin === 'source' &&
                            tr('From reviewed source'),
                          evidence.relationship
                            ? tr(
                                preliminary
                                  ? 'Related term from {skill}'
                                  : 'Directional evidence from {skill}',
                                {
                                  skill: evidence.relationship.from,
                                },
                              )
                            : evidence.sectionKind &&
                              tr(
                                preliminary
                                  ? 'Direct term or alias'
                                  : 'Direct or alias evidence',
                              ),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        quote={evidence.quote}
                        origin={evidence.origin}
                      />
                    ) : (
                      <Typography key={name} variant="body2">
                        {tr(
                          preliminary
                            ? 'No keyword found in the reviewed CV for {skill}.'
                            : 'No CV Review evidence found for {skill}.',
                          {
                            skill: name,
                          },
                        )}
                      </Typography>
                    ),
                  )}
                </Stack>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}

const conditionStatusLabel = {
  MET: 'Evidence meets the condition',
  UNKNOWN: 'Evidence not established',
  NOT_MET: 'Evidence falls short of the condition',
} as const;

function MatchConditions({ conditions }: { conditions?: MatchCondition[] }) {
  const id = useId();
  if (!conditions?.length) return null;
  return (
    <Box component="section" aria-labelledby={id} sx={{ minWidth: 0 }}>
      <Typography
        id={id}
        component="h3"
        variant="subtitle1"
        sx={{ fontWeight: 600, mb: 1 }}
      >
        {tr('Conditions')}
      </Typography>
      <Stack
        component="ul"
        spacing={1.5}
        sx={{ p: 0, m: 0, listStyle: 'none' }}
      >
        {conditions?.map((condition, index) => (
          <Paper
            component="li"
            variant="outlined"
            key={`${condition.parentId}-${condition.componentId}-${index}`}
            sx={{ p: 1.5, minWidth: 0 }}
          >
            <Stack spacing={1}>
              <Typography
                component="h4"
                variant="subtitle2"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {condition.jdQuote}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {condition.reason === 'DATED_PROGRAMMING'
                  ? tr(
                      'Reviewed work dates and programming roles do not establish the required duration.',
                    )
                  : condition.reason === 'IT_QUALIFICATION'
                    ? tr(
                        'Reviewed education does not establish the required IT degree.',
                      )
                    : condition.unknownExperience
                      ? unknownExperienceText(condition.unknownExperience)
                      : tr(conditionStatusLabel[condition.status])}
                {condition.mode === 'OR' &&
                  ` · ${tr('Alternative in the job description')}`}
              </Typography>
              {condition.evidence.map((item, index) => (
                <EvidenceQuote
                  key={`${item.start}-${item.end}-${index}`}
                  source="CV evidence"
                  label={tr('CV evidence')}
                  quote={item.cvQuote}
                  origin={item.cvOrigin}
                />
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}

const reviewedSectionLabels = {
  skills: 'Skills',
  experience: 'Work Experience',
  projects: 'Projects',
} as const;

function EvidenceQuote({
  source,
  quote,
  label,
  title,
  origin,
  detail,
}: {
  detail?: string;
  label?: string;
  title?: string;
  origin?: CvOrigin;
  source: 'CV evidence' | 'JD evidence' | 'Original parsed CV passage';
  quote: string;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {title ?? tr(source === 'JD evidence' ? 'Job description' : source)}
        {origin === 'user_entered' && <> · {tr('Added by you in CV review')}</>}
      </Typography>
      {detail && (
        <Typography variant="body2" color="text.secondary">
          {detail}
        </Typography>
      )}
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
  const reanalyze =
    !!result || ['EXPIRED', 'STALE_CV', 'STALE_JOB'].includes(matchStatus);
  // A current match is context, not the task: one row with freshness
  // and actions. Missing, stale, checking and error states keep the full card.
  const compact = current && !busy && !error && !matchReadError;
  const assessmentLink = routing
    ? { component: Link, to: `/jobs/${jobId}/match` }
    : { component: 'a', href: `/jobs/${jobId}/match` };
  if (compact)
    return (
      <Box
        role="tabpanel"
        id="tailored-match-panel"
        aria-labelledby="tailored-step-1"
        hidden={hidden}
        sx={{ mb: 1.5 }}
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
            <Typography
              role="status"
              variant="body2"
              color="text.secondary"
              sx={{ flex: 1, minWidth: 0 }}
            >
              {tr('Saved CV Match result')}
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
      id="tailored-match-panel"
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
                {tr('Saved CV Match result')}
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

function unknownExperienceText(
  explanation: NonNullable<MatchCondition['unknownExperience']>,
) {
  if (explanation.evidence === 'NONE')
    return tr('No relevant evidence was found in the reviewed CV.');
  if (explanation.evidence === 'UNDATED')
    return tr(
      'Relevant experience appears in the reviewed CV, but its duration is unclear.',
    );
  return tr(
    explanation.javaFullStack
      ? 'The reviewed CV shows related experience, but does not establish {n} years in Java full-stack development.'
      : 'The reviewed CV shows relevant experience, but does not establish the required {n} years.',
    { n: explanation.years },
  );
}
