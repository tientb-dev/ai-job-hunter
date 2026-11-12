import { AutoAwesomeIcon, RefreshIcon } from '../../components/icons';
import { Link, useInRouterContext } from 'react-router-dom';
import { validSourceDate } from './cv-suggestions.contract';
import { type MatchResult, statusLabel } from './cv-match.types';
import { matchStatusMessages, type CvMatchState } from './useCvMatch';
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
  LinearProgress,
  Paper,
  Stack,
  SvgIcon,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

const requirementColors = {
  EVIDENCED: 'success.dark',
  PARTIAL: 'text.primary',
  NOT_EVIDENCED: 'text.secondary',
  CONFLICT: 'error.dark',
} as const;

export interface MatchInspection {
  inspect: (parentId: string) => boolean;
}

/** CV Match tab panel (id job-panel-1), shared by Job Detail and Tailored CV. */
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
  const { analyze, upload, reload } = match;
  return (
    <Box
      role="tabpanel"
      id="job-panel-1"
      aria-labelledby={labelledBy}
      hidden={hidden}
    >
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
                CV–JD match
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                Your documented experience, compared with this opportunity.
              </Typography>
            </Box>
            <Button
              variant={result || preferSecondary ? 'outlined' : 'contained'}
              disableElevation
              disabled={
                busy || analyzeBlocked || !cv || matchStatus === 'CHECKING'
              }
              onClick={() => void analyze()}
              sx={{
                textTransform: 'none',
                flexShrink: 0,
                alignSelf: 'flex-start',
              }}
            >
              {result ||
              ['EXPIRED', 'STALE_CV', 'STALE_JOB'].includes(matchStatus)
                ? 'Reanalyze CV Match'
                : 'Analyze CV Match'}
            </Button>
          </Stack>
          <Box>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
              >
                {cv ? `Saved CV: ${cv.fileName}` : 'No saved CV yet.'}
              </Typography>
              <Button
                component="label"
                size="small"
                disabled={busy || uploadBlocked}
                sx={{ textTransform: 'none', flexShrink: 0 }}
              >
                {cv ? 'Replace CV' : 'Save CV'}
                <input
                  disabled={busy || uploadBlocked}
                  hidden
                  type="file"
                  accept=".pdf,.docx"
                  aria-label="Save CV for matching"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void upload(file);
                  }}
                />
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Uses the latest saved CV and job, not unsaved edits. Files parse
              locally; analysis sends them to local Ollama.
            </Typography>
          </Box>
          {matchStatus === 'CHECKING' && (
            <Typography role="status">Checking the saved CV Match…</Typography>
          )}
          {!busy && matchStatusMessages[matchStatus] && (
            <Alert severity="info" role="status">
              {matchStatusMessages[matchStatus]}
              {result &&
                ' The previous result below is retained for reference; it is not a current match.'}
            </Alert>
          )}
          {matchReadError && (
            <Alert severity="warning">
              {matchReadError}
              <Button
                startIcon={<RefreshIcon />}
                disabled={busy}
                onClick={() => reload()}
              >
                Retry loading match
              </Button>
            </Alert>
          )}
          {!busy && matchStatus === 'VALID' && (
            <Typography role="status">
              Saved match
              {result && validSourceDate(result.analyzedAt)
                ? ` from ${new Date(result.analyzedAt).toLocaleString()}`
                : ''}
              . No new analysis is needed.
            </Typography>
          )}
          {busy && (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>Processing locally…</Typography>
            </Stack>
          )}
          {error && (
            <Alert severity="error">
              {error}
              {result &&
                ' The last successful result is retained below; it does not reflect this failed attempt.'}
            </Alert>
          )}
          {busy && result && (
            <Typography variant="caption">
              Previous successful result shown while reanalysis is running.
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
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [target, setTarget] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const inspect = useCallback((index: number) => {
    setSelected(index);
    setFilter('all');
    setExpanded((previous) => new Set(previous).add(index));
    setTarget(index);
  }, []);
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
      <MatchOverview result={result} onInspect={inspect} />
      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Not evidenced in this CV does not mean you do not possess the
          qualification.
        </Typography>
        <RequirementsList
          requirements={result.requirements}
          filter={filter}
          onFilter={setFilter}
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
      <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
        <Typography
          variant="subtitle1"
          component="h3"
          sx={{ fontWeight: 600, mb: 1 }}
        >
          Application advice
        </Typography>
        <Typography variant="body2">{result.advice}</Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        This match is shared with Tailored CV while its server context remains
        valid. Reanalyze after saving CV or job changes. Review all evidence
        before relying on this advice.
      </Typography>
    </Stack>
  );
}

type PreviewRequirement = {
  item: MatchResult['requirements'][number];
  index: number;
};
function MatchOverview({
  result,
  onInspect,
}: {
  result: MatchResult;
  onInspect: (index: number) => void;
}) {
  const rows = result.requirements.map((item, index) => ({ item, index }));
  const matched = rows.filter(({ item }) => item.status === 'EVIDENCED');
  const gaps = rows.filter(({ item }) => item.status !== 'EVIDENCED');
  const requiredGaps = gaps.filter(({ item }) => item.priority === 'required');
  const preferredGaps = gaps.filter(
    ({ item }) => item.priority === 'preferred',
  );
  const strengths = [...matched].sort(
    (a, b) =>
      Number(b.item.priority === 'required') -
      Number(a.item.priority === 'required'),
  );
  const explanationId = useId();
  return (
    <Stack spacing={3}>
      <Box sx={{ bgcolor: 'action.selected', borderRadius: 1, p: 2 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'minmax(0, 1fr) minmax(0, 1fr)',
            },
            gap: 2,
            alignItems: 'center',
          }}
        >
          <Box>
            <Typography
              variant="subtitle1"
              component="h3"
              sx={{ fontWeight: 600 }}
            >
              Documented fit
            </Typography>
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}
            >
              <Typography
                variant="h3"
                component="p"
                sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                aria-label={`Fit score: ${result.score === null ? 'Not enough evidence' : `${result.score}/100`} (heuristic)`}
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
              <Chip
                size="small"
                variant="outlined"
                label={result.recommendation}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Heuristic evidence coverage · Not a hiring probability
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Requirement coverage
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              aria-label="Requirement counts"
              sx={{ flexWrap: 'wrap', mb: 1.5 }}
            >
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, color: requirementColors.EVIDENCED }}
              >
                Matched: {matched.length}
              </Typography>
              {(['PARTIAL', 'NOT_EVIDENCED', 'CONFLICT'] as const).map(
                (status) => (
                  <Typography
                    key={status}
                    variant="body2"
                    sx={{ color: requirementColors[status], fontWeight: 500 }}
                  >
                    {statusLabel(status)}:{' '}
                    {rows.filter(({ item }) => item.status === status).length}
                  </Typography>
                ),
              )}
              <Typography variant="body2" color="text.secondary">
                Total: {rows.length}
              </Typography>
            </Stack>
            {result.score === null ? (
              <Typography variant="body2" color="text.secondary">
                Not enough evidence
              </Typography>
            ) : (
              <LinearProgress
                variant="determinate"
                value={result.score}
                aria-label="Heuristic fit score"
                color="inherit"
                sx={{
                  height: 6,
                  borderRadius: 1,
                  color: 'text.secondary',
                  bgcolor: 'action.disabledBackground',
                }}
              />
            )}
          </Box>
        </Box>
        <Typography variant="body2" sx={{ mt: 1.5 }}>
          This score reflects evidence in the saved CV, not the full extent of
          your skills.
        </Typography>
        <Accordion
          disableGutters
          elevation={0}
          square
          sx={{
            bgcolor: 'transparent',
            mt: 1,
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary
            id={`${explanationId}-summary`}
            aria-controls={`${explanationId}-details`}
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
            <Typography variant="body2" color="text.secondary">
              How to read this analysis
            </Typography>
          </AccordionSummary>
          <AccordionDetails
            id={`${explanationId}-details`}
            sx={{ px: 0, pt: 0, pb: 0 }}
          >
            <Typography variant="body2" color="text.secondary">
              {result.explanation}
            </Typography>
          </AccordionDetails>
        </Accordion>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: 'repeat(2, minmax(0, 1fr))',
          },
          gap: 3,
        }}
      >
        <RequirementPreview
          title="Key strengths"
          items={strengths}
          empty="No verified matches yet."
          hint="Verified in your CV"
          onInspect={onInspect}
        />
        <RequirementPreview
          title={requiredGaps.length ? 'Required gaps' : 'Preferred gaps'}
          items={requiredGaps.length ? requiredGaps : preferredGaps}
          empty="No unknown requirements reported."
          hint={
            requiredGaps.length
              ? requiredGaps.some(({ item }) => item.status === 'PARTIAL')
                ? 'Required qualifications needing more evidence'
                : 'Required qualifications not evidenced in your CV'
              : 'No required gaps reported. Preferred qualifications to review.'
          }
          onInspect={onInspect}
        />
      </Box>
    </Stack>
  );
}

function RequirementPreview({
  title,
  hint,
  items,
  empty,
  onInspect,
}: {
  title: string;
  hint: string;
  items: PreviewRequirement[];
  empty: string;
  onInspect: (index: number) => void;
}) {
  return (
    <Box component="section" aria-label={title} sx={{ minWidth: 0 }}>
      <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {hint}
      </Typography>
      {items.length ? (
        <Box component="ul" sx={{ listStyle: 'none', p: 0, mb: 0, mt: 1 }}>
          {items.slice(0, 3).map(({ item, index }) => (
            <Box component="li" key={index}>
              <Button
                fullWidth
                onClick={() => onInspect(index)}
                aria-label={`View evidence: ${item.requirement}`}
                sx={{
                  textTransform: 'none',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  color: 'text.primary',
                  px: 0.5,
                  py: 1,
                  gap: 1,
                  alignItems: 'flex-start',
                }}
              >
                <MatchIcon
                  kind={item.status === 'EVIDENCED' ? 'matched' : 'gap'}
                />
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
                >
                  {item.requirement}
                </Typography>
              </Button>
            </Box>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {empty}
        </Typography>
      )}
      {items.length > 3 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          First 3 of {items.length} · Full evidence below
        </Typography>
      )}
    </Box>
  );
}

function RequirementsList({
  requirements,
  filter,
  onFilter,
  expanded,
  onExpand,
  selected,
  target,
  onNavigated,
}: {
  requirements: MatchResult['requirements'];
  filter: string;
  onFilter: (filter: string) => void;
  expanded: Set<number>;
  onExpand: (index: number, open: boolean) => void;
  selected: number | null;
  target: number | null;
  onNavigated: () => void;
}) {
  const items = requirements
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        filter === 'all' ||
        item.status ===
          (
            {
              matched: 'EVIDENCED',
              partial: 'PARTIAL',
              unknown: 'NOT_EVIDENCED',
              conflict: 'CONFLICT',
            } as Record<string, string>
          )[filter],
    )
    .sort(
      (a, b) =>
        Number(b.item.priority === 'required') -
          Number(a.item.priority === 'required') ||
        Number(b.item.status !== 'EVIDENCED') -
          Number(a.item.status !== 'EVIDENCED') ||
        a.index - b.index,
    );
  return (
    <Box component="section" aria-label="Requirements" sx={{ minWidth: 0 }}>
      <Typography
        component="h3"
        variant="subtitle1"
        sx={{ fontWeight: 700, mb: 1 }}
      >
        Requirements
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Review every match and gap. Open a requirement to compare the original
        CV and JD evidence.
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={filter}
        aria-label="Filter requirements"
        onChange={(_event, value: string | null) => {
          if (value) onFilter(value);
        }}
        sx={{
          mb: 1.5,
          flexWrap: 'wrap',
          gap: 0.5,
          '& .MuiToggleButton-root': {
            textTransform: 'none',
            minHeight: 44,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '6px',
          },
          '& .MuiToggleButton-root.Mui-selected': {
            bgcolor: 'action.selected',
            color: 'primary.main',
            fontWeight: 600,
          },
          '& .Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -3,
          },
        }}
      >
        <ToggleButton value="all" aria-label="All">
          All ({requirements.length})
        </ToggleButton>
        <ToggleButton value="matched" aria-label="Matched">
          Matched (
          {requirements.filter((item) => item.status === 'EVIDENCED').length})
        </ToggleButton>
        {(
          [
            ['partial', 'PARTIAL'],
            ['unknown', 'NOT_EVIDENCED'],
            ['conflict', 'CONFLICT'],
          ] as const
        ).map(([value, status]) => (
          <ToggleButton
            key={value}
            value={value}
            aria-label={statusLabel(status)}
          >
            {statusLabel(status)} (
            {requirements.filter((item) => item.status === status).length})
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {items.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No {filter} requirements reported.
        </Typography>
      )}
      <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
        {items.map(({ item, index }) => (
          <RequirementCard
            key={index}
            item={item}
            expanded={expanded.has(index)}
            onExpand={(open) => onExpand(index, open)}
            selected={selected === index}
            targeted={target === index}
            onNavigated={onNavigated}
          />
        ))}
      </Box>
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
                {item.priority === 'required' ? 'Required' : 'Preferred'}
                {item.category !== 'skill' && (
                  <>
                    {' '}
                    · {item.category === 'experience' ? 'Experience' : 'Domain'}
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
            <EvidenceQuote source="CV evidence" quote={item.cvQuote} />
          ) : item.coverage?.components.some(
              (component) => component.observations?.length,
            ) ? (
            <Typography variant="body2">
              Relevant CV evidence is shown below; proficiency is not fully
              verified.
            </Typography>
          ) : (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Your CV
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Not evidenced in CV
              </Typography>
            </Box>
          )}
        </Box>
        {item.coverage && (
          <Box
            component="section"
            aria-label={`Component coverage: ${item.requirement}`}
            sx={{ mt: 2 }}
          >
            <Typography variant="subtitle2">
              {item.coverage.mode} ·{' '}
              {
                item.coverage.components.filter(
                  (component) => component.status === 'EVIDENCED',
                ).length
              }
              /{item.coverage.components.length}{' '}
              {item.coverage.components.some(
                (component) => component.status === 'PARTIAL',
              )
                ? 'components fully supported'
                : 'components supported'}
              {item.coverage.components.some(
                (component) => component.status === 'PARTIAL',
              ) && ' · Partial evidence available'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {item.coverage.reason}
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
                  label={`JD evidence: ${component.label}`}
                  quote={component.jdQuote}
                />
                {component.qualificationReason && (
                  <Typography variant="body2">
                    {component.qualificationReason}
                  </Typography>
                )}
                {component.observations?.map((observation, index) => (
                  <Box key={index} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      {observation.kind === 'experience'
                        ? 'Verified professional experience'
                        : 'Verified technology mention'}
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
                    label={`CV evidence: ${component.label}`}
                    quote={component.cvQuote}
                  />
                ) : component.observations?.length ? null : (
                  <Typography variant="body2" color="text.secondary">
                    Not evidenced in CV
                  </Typography>
                )}
                {component.conflictingQuotes.map((quote, index) => (
                  <EvidenceQuote
                    key={index}
                    source="CV evidence"
                    label={`Conflicting CV evidence: ${component.label}`}
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
}: {
  label?: string;
  source: 'CV evidence' | 'JD evidence' | 'Original parsed CV passage';
  quote: string;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {source === 'CV evidence'
          ? 'Your CV'
          : source === 'JD evidence'
            ? 'Job description'
            : source}
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
          aria-label="CV Match summary"
          sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, minWidth: 0 }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 2 }}
            useFlexGap
            sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
          >
            <Chip
              aria-label={`Fit score: ${result.score === null ? 'Not enough evidence' : `${result.score}/100`} (heuristic)`}
              color={result.recommendation === 'Apply' ? 'success' : 'default'}
              label={`${result.recommendation} · ${result.score === null ? 'not enough evidence' : `${result.score}/100`}`}
              sx={{ alignSelf: 'flex-start' }}
            />
            <Typography
              role="status"
              variant="body2"
              color="text.secondary"
              sx={{ flex: 1, minWidth: 0 }}
            >
              Saved match
              {validSourceDate(result.analyzedAt)
                ? ` from ${new Date(result.analyzedAt).toLocaleString()}`
                : ''}
              . No new analysis is needed.
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap' }}
            >
              <Button {...assessmentLink}>View full assessment</Button>
              <Button
                startIcon={<AutoAwesomeIcon />}
                variant="outlined"
                disabled={analyzeBlocked || !cv}
                onClick={() => void match.analyze()}
              >
                Reanalyze CV Match
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
            Tailoring uses the saved CV Match for this job. The full evidence
            and advice stay on the job page.
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {cv ? `Saved CV: ${cv.fileName}` : 'No saved CV yet.'}
          </Typography>
          {matchStatus === 'CHECKING' && (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>Checking the saved CV Match…</Typography>
            </Stack>
          )}
          {busy && (
            <Stack direction="row" spacing={1} role="status">
              <CircularProgress size={20} />
              <Typography>Processing locally…</Typography>
            </Stack>
          )}
          {!busy && current && (
            <Stack spacing={1.5}>
              <Typography role="status">
                Saved match
                {validSourceDate(result.analyzedAt)
                  ? ` from ${new Date(result.analyzedAt).toLocaleString()}`
                  : ''}
                . No new analysis is needed.
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Chip
                  aria-label={`Fit score: ${result.score === null ? 'Not enough evidence' : `${result.score}/100`} (heuristic)`}
                  color={
                    result.recommendation === 'Apply' ? 'success' : 'default'
                  }
                  label={`${result.recommendation} · ${result.score === null ? 'not enough evidence' : `${result.score}/100`}`}
                />
                {counts && (
                  <Typography variant="body2" color="text.secondary">
                    {counts.matched} evidenced, {counts.partial} partial,{' '}
                    {counts.missing} not evidenced
                  </Typography>
                )}
              </Stack>
            </Stack>
          )}
          {!busy && matchStatusMessages[matchStatus] && (
            <Alert severity="info" role="status">
              {matchStatusMessages[matchStatus]}
              {hasDraft &&
                ' Your saved draft below stays available; only a new draft needs a current match.'}
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
                  Retry loading match
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
                busy || analyzeBlocked || !cv || matchStatus === 'CHECKING'
              }
              onClick={() => void match.analyze()}
            >
              {reanalyze ? 'Reanalyze CV Match' : 'Analyze CV Match'}
            </Button>
            <Button
              {...(routing
                ? { component: Link, to: `/jobs/${jobId}/match` }
                : { component: 'a', href: `/jobs/${jobId}/match` })}
              disabled={!result}
            >
              View full assessment
            </Button>
          </Stack>
          {!cv && (
            <Typography variant="body2" color="text.secondary">
              Save a source CV in step 1 before analyzing.
            </Typography>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
