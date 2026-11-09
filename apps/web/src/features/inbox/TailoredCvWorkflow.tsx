import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { type DraftReadiness, readinessReasons } from './tailored-cv-readiness';
import { TailoredCvReview } from './TailoredCvReview';
import { SourceCvReview } from './SourceCvReview';
import { MatchGate } from './CvMatchSection';
import { useCvMatch } from './useCvMatch';

/**
 * Tailored CV workspace: Source CV → Tailor & Review → Approve & Export.
 * Tailor & Review opens with a compact gate over the same persisted CV Match
 * Job Detail uses; a missing/stale match blocks only new drafts.
 */
const STEPS = ['Source CV', 'Tailor & Review', 'Approve & Export'] as const;

export function TailoredCvWorkflow({
  jobId,
  revision,
  jobUpdatedAt,
  jobDirty = false,
  onReviewDirtyChange,
}: {
  jobId: string;
  revision: string;
  jobUpdatedAt?: string;
  jobDirty?: boolean;
  onReviewDirtyChange?: (dirty: boolean) => void;
}) {
  const match = useCvMatch(jobId, revision, jobUpdatedAt);
  const { cv, cvLoaded, busy, error, result, matchStatus, matchReadError } =
    match;
  const { analyze, upload, reload } = match;
  const [step, setStep] = useState(0);
  const wideSteps = useMediaQuery('(min-width:600px)');
  const [entryResolved, setEntryResolved] = useState(false);
  const [readinessError, setReadinessError] = useState('');
  const [checkedReadiness, setCheckedReadiness] = useState<{
    value: DraftReadiness;
    matchId?: string;
  } | null>(null);
  function goToStep(next: number) {
    setEntryResolved(true);
    setStep(next);
  }
  const [readinessReason, setReadinessReason] = useState<string | null>(null);
  const previousStep = useRef(step);
  // Focus the heading only for navigation after the opening step is known;
  // the automatic restoration on load/reload must not steal focus.
  const resolvedBefore = useRef(entryResolved);
  useEffect(() => {
    if (previousStep.current !== step && resolvedBefore.current)
      document.getElementById('wizard-step-title')?.focus();
    previousStep.current = step;
    resolvedBefore.current = entryResolved;
  }, [step, entryResolved]);
  const [ready, setReady] = useState(false);
  const [sourceReady, setSourceReady] = useState(false);
  const resumeDraft = useRef<(() => void) | null>(null);
  const [draftDiscovery, setDraftDiscovery] = useState<
    'loading' | 'empty' | 'loaded' | 'error'
  >('loading');
  const [hasDrafts, setHasDrafts] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [approved, setApproved] = useState(false);
  const [approvalReady, setApprovalReady] = useState(false);
  const rereadStaleMatch = useRef<string | undefined>(undefined);
  const readinessChanged = useCallback(
    (value: DraftReadiness | null, checkedMatchId?: string, failure = '') => {
      // An in-flight preflight is not evidence that saved source review became
      // incomplete. Keep navigation/status stable; the child blocks generation
      // until its authoritative readiness check has completed.
      if (!value && !failure) return;
      setReadinessError(failure);
      // A replacement can land between the match read and P8 preflight.
      // Read the server's latest snapshot once; never invoke analysis here.
      if (
        value?.reason === 'CV_DRAFT_STALE_MATCH' &&
        checkedMatchId &&
        rereadStaleMatch.current !== checkedMatchId
      ) {
        rereadStaleMatch.current = checkedMatchId;
        reload(true);
      }
      setCheckedReadiness(value ? { value, matchId: checkedMatchId } : null);
      setReady(value?.ready ?? false);
      setReadinessReason(value?.reason ?? null);
      setSourceReady(
        !!value &&
          (value.ready ||
            ['CV_DRAFT_MATCH_REQUIRED', 'CV_DRAFT_STALE_MATCH'].includes(
              value.reason ?? '',
            )),
      );
    },
    [reload],
  );
  const draftChanged = useCallback((loaded: boolean, isApproved: boolean) => {
    setDraftLoaded(loaded);
    setApproved(isApproved);
  }, []);
  const [reviewEpoch, setReviewEpoch] = useState(0);
  const [continueEpoch, setContinueEpoch] = useState(0);
  const sourceSaved = useCallback(() => setReviewEpoch((n) => n + 1), []);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  useEffect(() => {
    onReviewDirtyChange?.(reviewDirty || draftDirty);
  }, [reviewDirty, draftDirty, onReviewDirtyChange]);
  const reviewChanged = useCallback((dirty: boolean) => {
    setReviewDirty(dirty);
  }, []);
  // Initial entry resolves once after draft discovery. Every explicit action uses
  // goToStep, so async match/draft completions cannot override manual navigation.
  if (
    !entryResolved &&
    draftDiscovery !== 'loading' &&
    !reviewDirty &&
    !draftDirty &&
    !reviewBusy &&
    !draftBusy &&
    !busy
  ) {
    // Saved drafts are history: they never stand in for current readiness.
    // Open Source CV until the source review is complete; otherwise Tailor &
    // Review, whose match gate explains a missing or stale match. Earlier
    // drafts stay resumable with their own approval state unchanged.
    const readinessKnown =
      checkedReadiness &&
      checkedReadiness.matchId ===
        (matchStatus === 'VALID' ? result?.matchId : undefined);
    if (draftDiscovery === 'error') {
      goToStep(1);
    } else if (
      (draftDiscovery === 'empty' || draftLoaded) &&
      matchStatus !== 'CHECKING'
    ) {
      if (
        matchStatus === 'CV_UNAVAILABLE' ||
        (cvLoaded && !cv) ||
        readinessError
      ) {
        // Without a current CV or readiness answer, a saved draft can still be
        // resumed; otherwise start at Source CV.
        goToStep(draftLoaded ? 1 : 0);
      } else if (readinessKnown) {
        const value = checkedReadiness.value;
        goToStep(
          value.ready ||
            ['CV_DRAFT_MATCH_REQUIRED', 'CV_DRAFT_STALE_MATCH'].includes(
              value.reason ?? '',
            )
            ? 1
            : 0,
        );
      }
    }
  }
  // One sentence naming the single next required action for the current state.
  const matchCurrent = matchStatus === 'VALID';
  const nextStep =
    reviewDirty || draftDirty
      ? 'Save or discard your local edits before changing steps.'
      : !cv
        ? 'Save your CV in Source CV to start.'
        : !sourceReady
          ? readinessReason && readinessReasons[readinessReason]
            ? readinessReasons[readinessReason].text
            : 'Review your CV facts in Source CV and save the review.'
          : draftLoaded
            ? // An open draft keeps its own pins; match state only gates new drafts.
              approved
              ? step === 2
                ? 'This draft is approved. Download it below.'
                : 'This draft is approved. Download it in Approve & Export.'
              : step === 2
                ? 'Confirm your review and approve this draft to download it.'
                : approvalReady
                  ? 'Review finished. Continue to Approve & Export.'
                  : 'Decide each suggestion and save, then continue to Approve & Export.'
            : hasDrafts
              ? matchCurrent
                ? 'Resume your latest draft, or generate a new one.'
                : 'Resume your latest draft. A new draft needs a current CV Match.'
              : matchCurrent
                ? 'Generate a tailored draft from your reviewed CV.'
                : 'Analyze CV Match for this job to start tailoring.';
  return (
    <>
      <Stack spacing={2} sx={{ mb: 3 }}>
        <Stepper
          nonLinear
          alternativeLabel
          activeStep={entryResolved ? step : -1}
          aria-label="Tailored CV steps"
          sx={{
            '& .MuiStep-root': {
              minWidth: 0,
              flex: 1,
              px: { xs: 0.5, sm: 1 },
              position: 'relative',
            },
            '& .MuiStepButton-root': {
              minHeight: 44,
              m: 0,
              p: { xs: 0.5, sm: 1 },
              width: '100%',
            },
            '& .MuiStepLabel-root, & .MuiStepLabel-labelContainer': {
              minWidth: 0,
            },
            '& .MuiStepLabel-label': {
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
              fontSize: { xs: '0.8125rem', sm: undefined },
              mt: { xs: 0.5, sm: undefined },
            },
          }}
        >
          {STEPS.map((label, index) => {
            const complete =
              entryResolved &&
              (index === 0
                ? sourceReady
                : index === 1
                  ? draftLoaded && approved
                  : false);
            const unavailable = index === 2 && !draftLoaded;
            const state = !entryResolved
              ? 'Checking…'
              : index === 0
                ? sourceReady
                  ? 'Complete'
                  : 'To do'
                : index === 1
                  ? // Saved drafts are history, never current readiness.
                    hasDrafts
                    ? approved
                      ? 'Earlier draft approved'
                      : 'Earlier draft available'
                    : matchStatus === 'CHECKING'
                      ? 'Checking match…'
                      : matchCurrent
                        ? 'Saved match'
                        : 'Match needed'
                  : unavailable
                    ? 'Unavailable until a draft is open'
                    : approved
                      ? 'Ready to download'
                      : 'Needs approval';
            return (
              <Step key={label} completed={complete} disabled={unavailable}>
                <StepButton
                  id={`tailored-step-${index}`}
                  aria-controls={
                    index === 0
                      ? 'source-wizard-panel'
                      : 'tailored-review-panel'
                  }
                  aria-current={
                    entryResolved && step === index ? 'step' : undefined
                  }
                  disabled={
                    unavailable ||
                    reviewDirty ||
                    // Unsaved draft edits live in the shared review component, so
                    // returning to Tailor & Review keeps them; other steps wait.
                    (draftDirty && index !== 1) ||
                    reviewBusy ||
                    draftBusy ||
                    busy
                  }
                  onClick={() => goToStep(index)}
                  optional={
                    // Status stays in the accessible name; on phones it is
                    // visually hidden so three steps fit on one row.
                    <Typography
                      component="span"
                      variant="caption"
                      sx={wideSteps ? undefined : visuallyHidden}
                    >
                      {entryResolved && step === index ? 'Current' : state}
                    </Typography>
                  }
                >
                  {label}
                </StepButton>
              </Step>
            );
          })}
        </Stepper>
        {readinessError && (
          <Alert severity="warning">
            {readinessError}
            <Button
              disabled={reviewDirty || draftDirty || busy}
              onClick={() => setReviewEpoch((n) => n + 1)}
            >
              Retry readiness check
            </Button>
          </Alert>
        )}
        {matchReadError && step !== 1 && (
          <Alert severity="warning">
            {matchReadError}
            <Button disabled={busy} onClick={() => reload()}>
              Retry loading match
            </Button>
          </Alert>
        )}
        {!entryResolved && (
          <Box role="status" sx={{ minHeight: 240 }}>
            <Typography>
              Finding your next step from saved source review and current match…
            </Typography>
          </Box>
        )}
        {entryResolved && (
          <>
            <Typography
              component="h2"
              variant="h6"
              tabIndex={-1}
              id="wizard-step-title"
            >
              Step {step + 1} of 3 · {STEPS[step]}
            </Typography>
            <NextStep
              text={nextStep}
              action={
                hasDrafts && !draftLoaded ? (
                  <Button
                    variant="contained"
                    disabled={
                      reviewDirty ||
                      draftDirty ||
                      reviewBusy ||
                      draftBusy ||
                      busy
                    }
                    onClick={() => resumeDraft.current?.()}
                  >
                    Resume latest draft
                  </Button>
                ) : null
              }
            />
            {step === 0 && (
              <Stack spacing={1}>
                <Typography>
                  {cv
                    ? `Saved source CV: ${cv.fileName}`
                    : 'Save a source CV, then review its facts below.'}
                </Typography>
                <Button
                  component="label"
                  variant={cv || hasDrafts ? 'outlined' : 'contained'}
                  disabled={
                    busy || reviewBusy || reviewDirty || draftBusy || draftDirty
                  }
                  sx={{ minHeight: 44, alignSelf: 'flex-start' }}
                >
                  {cv ? 'Replace source CV' : 'Save source CV'}
                  <input
                    hidden
                    type="file"
                    accept=".pdf,.docx"
                    aria-label="Save source CV"
                    disabled={
                      busy ||
                      reviewBusy ||
                      reviewDirty ||
                      draftBusy ||
                      draftDirty
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void upload(file);
                    }}
                  />
                </Button>
                {busy && (
                  <Typography role="status">
                    Saving source CV locally…
                  </Typography>
                )}
                {error && <Alert severity="error">{error}</Alert>}
              </Stack>
            )}
            {step === 0 && sourceReady && (
              <Button
                variant={hasDrafts && !draftLoaded ? 'outlined' : 'contained'}
                disabled={
                  reviewDirty || draftDirty || reviewBusy || draftBusy || busy
                }
                onClick={() => goToStep(1)}
              >
                Continue with reviewed source
              </Button>
            )}
          </>
        )}
      </Stack>
      <MatchGate
        match={match}
        jobId={jobId}
        hidden={!entryResolved || step !== 1}
        preferSecondary={ready || hasDrafts || draftLoaded}
        hasDraft={draftLoaded}
        analyzeBlocked={reviewBusy}
      />
      <Box id="job-panel-2" hidden={!entryResolved}>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
          <Box
            id="source-wizard-panel"
            role="tabpanel"
            aria-labelledby="tailored-step-0"
            hidden={step !== 0 || !entryResolved}
          >
            <SourceCvReview
              wizardEntry={!sourceReady && !hasDrafts}
              cv={cv}
              disabled={busy || draftBusy || draftDirty}
              onDirtyChange={reviewChanged}
              onBusyChange={setReviewBusy}
              onSaved={sourceSaved}
              onContinue={() => {
                setContinueEpoch((n) => n + 1);
                // Tailor & Review opens with the match gate; it never skips it.
                goToStep(1);
              }}
            />
          </Box>
          <Box
            id="tailored-review-panel"
            role="tabpanel"
            aria-labelledby={`tailored-step-${step === 2 ? 2 : 1}`}
            hidden={!entryResolved || step < 1}
          >
            <TailoredCvReview
              key={jobId}
              jobId={jobId}
              jobRevision={jobUpdatedAt ?? ''}
              cv={cv}
              matchId={matchStatus === 'VALID' ? result?.matchId : undefined}
              matchRefreshError={error}
              active={matchStatus !== 'CHECKING'}
              // TailoredCvReview's own contract: 2 = review, 3 = export.
              wizardStep={step === 0 ? 0 : step + 1}
              resumeRef={resumeDraft}
              onDraftAvailability={setHasDrafts}
              onDraftDiscovery={setDraftDiscovery}
              onReadinessChange={readinessChanged}
              onDraftChange={draftChanged}
              onApprovalReadyChange={setApprovalReady}
              onContinueToApproval={() => goToStep(2)}
              onContinueDraft={() => goToStep(1)}
              readinessRevision={reviewEpoch + continueEpoch}
              continued={continueEpoch > 0}
              onRefreshMatch={() => void analyze()}
              onReviewSource={() => {
                goToStep(0);
                const heading = document.getElementById(
                  'source-cv-review-title',
                );
                heading?.scrollIntoView({ block: 'start' });
                heading?.focus();
              }}
              blockedReason={
                jobDirty
                  ? 'Save job changes in Edit JD before generating.'
                  : reviewDirty
                    ? 'Save Source CV Review changes before generating.'
                    : reviewBusy
                      ? 'Wait for Source CV Review to finish.'
                      : busy
                        ? 'CV Match is analyzing. Readiness will update when it finishes.'
                        : undefined
              }
              disabled={busy || reviewBusy || reviewDirty || jobDirty}
              onDirtyChange={setDraftDirty}
              onBusyChange={setDraftBusy}
            />
          </Box>
        </Paper>
      </Box>
      {/* Continue to Approve & Export lives in the review action bar. */}
    </>
  );
}

const visuallyHidden = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function NextStep({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <Paper
      variant="outlined"
      role="status"
      aria-label="Next step"
      sx={{
        p: 2,
        borderLeft: 4,
        borderLeftColor: 'primary.main',
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 1.5,
        alignItems: { sm: 'center' },
        justifyContent: 'space-between',
      }}
    >
      <Typography>
        <Box component="span" sx={{ fontWeight: 600 }}>
          Next:
        </Box>{' '}
        {text}
      </Typography>
      {action}
    </Paper>
  );
}
