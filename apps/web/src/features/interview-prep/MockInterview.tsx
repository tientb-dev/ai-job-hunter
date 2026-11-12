import {
  ArrowBackIcon,
  ArrowForwardIcon,
  CheckIcon,
  DeleteIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
} from '../../components/icons';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { PageHeader } from '../../components/PageHeader';
import { useNotify } from '../../components/useNotify';
import { Feedback, Recorder } from './InterviewPrep';
import { SessionSummary } from './SessionSummary';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TranscriptPanel } from './Transcript';
import { MAX_ANSWER_CHARS, PracticeError } from './interview-prep-api';
import type { PracticeFeedback } from './interview-prep-api';
import {
  SESSION_COUNTS,
  SessionConflictError,
  activeSession,
  completeSession,
  createSession,
  readSession,
  removeSession,
  saveSessionItem,
  type MockSession,
} from './mock-interview-api';
import { useRecorder } from './useRecorder';
import { useTranscript } from './useTranscript';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const message = (error: unknown) =>
  error instanceof PracticeError
    ? error.message
    : 'Something went wrong. Try again.';

/**
 * /interview-prep/mock[?jobId=&setId=]: 5–8 questions in a row. Progress lives
 * in the server session, so a refresh resumes at the current question. Only
 * the confirmed answer text and optional feedback are saved; never audio.
 */
export function MockInterview() {
  const [params, setParams] = useSearchParams();
  // A finished interview is addressed by id, so its summary survives a refresh.
  const sessionParam = params.get('session') ?? '';
  const viewId = UUID.test(sessionParam) ? sessionParam : null;
  const jobId = params.get('jobId') ?? '';
  const setId = params.get('setId') ?? '';
  const job = UUID.test(jobId) && UUID.test(setId) ? { jobId, setId } : null;
  const notify = useNotify();
  const [session, setSession] = useState<MockSession | null | undefined>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [count, setCount] = useState<number>(5);
  const [confirm, setConfirm] = useState<'discard' | 'end' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (viewId
      ? readSession(viewId, controller.signal)
      : activeSession(controller.signal)
    ).then(
      (s) => {
        setSession(s);
        setLoadError(null);
      },
      (e: unknown) => {
        if (!controller.signal.aborted) setLoadError(message(e));
      },
    );
    return () => controller.abort();
    // viewId changes reload from the server (summary link, delete, new).
  }, [attempt, viewId]);

  /** Every write: one at a time; a 409 reloads the server's latest state. */
  const run = useCallback(async (work: () => Promise<MockSession | null>) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const next = await work();
      setSession(next);
      return next;
    } catch (e) {
      if (e instanceof SessionConflictError) {
        setNotice(
          'This interview changed in another tab. Showing the latest progress.',
        );
        setSession(
          await activeSession(new AbortController().signal).catch(() => null),
        );
      } else setError(message(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  const showSummary = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('session', id);
        else next.delete('session');
        return next;
      },
      { replace: true },
    );
  const finish = async (s: MockSession) => {
    const done = await run(() => completeSession(s));
    if (done) showSummary(done.id);
  };

  const save = async (
    answer: string | null,
    feedback: PracticeFeedback | null,
  ) => {
    if (!session) return;
    const next = await run(() => saveSessionItem(session, answer, feedback));
    // Last question saved: end the interview without an extra click.
    if (next && next.currentIndex === next.items.length) await finish(next);
  };

  const header = (
    <PageHeader
      title="Mock interview"
      description="Answer 5–8 questions in a row, like a real interview. AI feedback is optional."
    />
  );
  const back = job ? `/jobs/${job.jobId}/interview` : '/interview-prep';

  if (loadError)
    return (
      <Stack spacing={3}>
        {header}
        <Alert
          severity="error"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                startIcon={<RefreshIcon />}
                color="inherit"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </Button>
              {viewId && (
                // The summary may have been deleted in another tab.
                <Button
                  color="inherit"
                  onClick={() => {
                    showSummary(null);
                    setLoadError(null);
                    setSession(undefined);
                  }}
                >
                  Start page
                </Button>
              )}
            </Stack>
          }
        >
          {loadError}
        </Alert>
      </Stack>
    );
  if (session === undefined)
    return (
      <Stack spacing={1} role="status">
        <LinearProgress aria-label="Loading mock interview" />
        <Typography variant="body2" color="text.secondary">
          Loading mock interview…
        </Typography>
      </Stack>
    );

  const alerts = (
    <>
      {notice && <Alert severity="warning">{notice}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </>
  );

  // ------------------------------------------------------------ summary
  if (session?.status === 'completed')
    return (
      <Stack spacing={3}>
        {header}
        {alerts}
        <SessionSummary
          session={session}
          pending={pending}
          onNew={() => {
            setSession(null);
            showSummary(null);
          }}
          onDelete={() =>
            void run(async () => {
              await removeSession(session);
              notify({ severity: 'success', text: 'Interview deleted.' });
              showSummary(null);
              return null;
            })
          }
        />
      </Stack>
    );

  // ------------------------------------------------------------ start
  if (!session) {
    return (
      <Stack spacing={3}>
        {header}
        {alerts}
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Typography variant="h6" component="h2">
              Start an interview
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {job
                ? 'Questions come from this job’s question set, in order. Shorter sets use all their questions.'
                : 'Questions are picked at random from the Interview Prep questions.'}{' '}
              Your progress is saved, so you can come back after a refresh.
              Audio is never saved.
            </Typography>
            <TextField
              select
              label="Number of questions"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              sx={{ minWidth: 200 }}
            >
              {SESSION_COUNTS.map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              <Button
                variant="contained"
                disabled={pending}
                startIcon={<PlayIcon />}
                onClick={() =>
                  void run(() =>
                    createSession(
                      job
                        ? { source: 'job', count, ...job }
                        : { source: 'curated', count },
                    ),
                  )
                }
              >
                Start interview
              </Button>
              <Button
                startIcon={<ArrowBackIcon />}
                component={Link}
                to={back}
                variant="outlined"
              >
                {job ? 'Back to job questions' : 'Back to Interview Prep'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Stack>
    );
  }

  // ------------------------------------------------------------ in progress
  const total = session.items.length;
  const index = Math.min(session.currentIndex, total - 1);
  const current = session.items[index]!;
  const allAnswered = session.currentIndex >= total;
  return (
    <Stack spacing={3}>
      {header}
      {alerts}
      <Stack spacing={1}>
        <Stack
          direction="row"
          sx={{
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="subtitle2" component="p" aria-live="polite">
            Question {allAnswered ? total : index + 1} of {total}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<DeleteIcon />}
              variant="text"
              disabled={pending}
              onClick={() => setConfirm('discard')}
            >
              Discard
            </Button>
            <Button
              startIcon={<StopIcon />}
              variant="outlined"
              disabled={pending}
              onClick={() => setConfirm('end')}
            >
              End interview
            </Button>
          </Stack>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={(session.currentIndex / total) * 100}
          aria-label="Interview progress"
        />
      </Stack>
      {allAnswered ? (
        // Saved the last answer but completing failed (e.g. network): retry here.
        <Alert
          severity="info"
          action={
            <Button
              startIcon={<CheckIcon />}
              color="inherit"
              disabled={pending}
              onClick={() => void finish(session)}
            >
              Finish
            </Button>
          }
        >
          All questions are done. Finish the interview to see your results.
        </Alert>
      ) : (
        <QuestionStep
          // Remount per question: a fresh recorder and transcript, like PR14.
          key={`${session.id}-${session.currentIndex}`}
          questionId={current.questionId}
          questionText={current.questionText}
          last={session.currentIndex === total - 1}
          pending={pending}
          onNext={(answer, feedback) => void save(answer, feedback)}
          onSkip={() => void save(null, null)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'discard'
            ? 'Discard this interview?'
            : 'End the interview now?'
        }
        text={
          confirm === 'discard'
            ? 'All answers and feedback from this interview are deleted. This can’t be undone.'
            : 'Questions you haven’t reached are marked unanswered. Text you haven’t saved with Next is not kept.'
        }
        safeLabel="Keep practising"
        confirmLabel={confirm === 'discard' ? 'Discard' : 'End interview'}
        destructive={confirm === 'discard'}
        confirmIcon={confirm === 'discard' ? <DeleteIcon /> : <StopIcon />}
        onSafe={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action === 'end') void finish(session);
          else
            void run(async () => {
              await removeSession(session);
              notify({ severity: 'success', text: 'Interview discarded.' });
              return null;
            });
        }}
      />
    </Stack>
  );
}

function QuestionStep({
  questionId,
  questionText,
  last,
  pending,
  onNext,
  onSkip,
}: {
  questionId: string;
  questionText: string;
  last: boolean;
  pending: boolean;
  onNext: (answer: string, feedback: PracticeFeedback | null) => void;
  onSkip: () => void;
}) {
  const recorder = useRecorder();
  const transcript = useTranscript();
  const [shown, setShown] = useState(false);
  const { cancel } = transcript;
  // A new take drops any in-flight transcription (same rule as Interview Prep).
  useEffect(() => cancel(), [recorder.blob, cancel]);
  const text = transcript.text.trim();
  const ready =
    !!text &&
    transcript.text.length <= MAX_ANSWER_CHARS &&
    !transcript.busy &&
    transcript.feedback.kind !== 'loading';
  // Only feedback for exactly this text is kept with the answer.
  const feedback =
    transcript.feedback.kind === 'done' && !transcript.outdated
      ? transcript.feedback.feedback
      : null;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={3}>
        <Typography variant="h6" component="h2" lang="en">
          {questionText}
        </Typography>
        <Recorder
          recorder={recorder}
          title="Your answer"
          prominent
          transcript={
            <TranscriptPanel
              transcript={transcript}
              recording={recorder.blob}
              questionId={questionId}
              variant={0}
              renderFeedback={(f) => (
                <Feedback
                  feedback={f}
                  shown={shown}
                  onToggle={() => setShown((v) => !v)}
                />
              )}
            />
          }
        />
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {feedback
              ? 'Next saves your answer with this feedback.'
              : 'Next saves your answer. AI feedback is optional.'}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              endIcon={last ? <CheckIcon /> : <ArrowForwardIcon />}
              variant="contained"
              disabled={!ready || pending}
              onClick={() => onNext(text, feedback)}
            >
              {last ? 'Save and finish' : 'Next'}
            </Button>
            <Button variant="outlined" disabled={pending} onClick={onSkip}>
              Skip question
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
