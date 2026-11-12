import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExpandMoreIcon } from '../../components/icons';
import { Link } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { DialogCloseButton } from '../../components/DialogCloseButton';
import { StatusChip } from '../../components/StatusChip';
import { useNotify } from '../../components/useNotify';
import {
  PracticeError,
  listAnswers,
  type SavedAnswer,
} from '../interview-prep/interview-prep-api';
import {
  CATEGORY_LABELS,
  generateJobQuestionSet,
  listJobQuestionSets,
  type JobQuestion,
  type JobQuestionSet,
  type JobQuestionSets,
} from '../interview-prep/job-interview-api';

type AnswersStatus = 'loading' | 'error' | 'ready';
// Another tab generated a set, or the JD changed mid-generation: refresh, not an error.
const REFRESH_CODES = new Set([
  'INTERVIEW_SET_OUTDATED',
  'INTERVIEW_JD_CHANGED',
]);

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function prepared(
  set: JobQuestionSet,
  answers: Record<string, SavedAnswer>,
  status: AnswersStatus,
) {
  if (status !== 'ready') return null;
  return set.questions.filter((q) => answers[q.id]).length;
}
function preparedText(n: number | null, total: number) {
  return n === null ? `${total} questions` : `${n} of ${total} prepared`;
}

function QuestionCard({
  question,
  status,
  href,
}: {
  question: JobQuestion;
  status: string;
  href: string;
}) {
  return (
    <Paper
      component="li"
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, listStyle: 'none', minWidth: 0 }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            Question {question.position} · {CATEGORY_LABELS[question.category]}
          </Typography>
          <StatusChip status={status} />
        </Stack>
        <Typography
          variant="subtitle1"
          component="h4"
          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
        >
          {question.question}
        </Typography>
        <Box>
          <Typography variant="subtitle2" component="p">
            Why this question?
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {question.why}
          </Typography>
        </Box>
        <Box
          component="figure"
          sx={{ m: 0, pl: 1.5, borderLeft: 3, borderColor: 'divider' }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            component="figcaption"
          >
            From the job description
          </Typography>
          <Typography
            variant="body2"
            component="blockquote"
            sx={{ m: 0, overflowWrap: 'anywhere' }}
          >
            “{question.evidence}”
          </Typography>
        </Box>
        <Box>
          <Button
            component={Link}
            to={href}
            variant="text"
            aria-label={`Practise this question, question ${question.position}`}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Practise this question
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

function QuestionList({
  jobId,
  set,
  answers,
  status,
  label,
}: {
  jobId: string;
  set: JobQuestionSet;
  answers: Record<string, SavedAnswer>;
  status: AnswersStatus;
  label: string;
}) {
  return (
    <Stack component="ol" spacing={2} aria-label={label} sx={{ m: 0, p: 0 }}>
      {set.questions.map((q) => (
        <QuestionCard
          key={q.id}
          question={q}
          href={`/interview-prep/jobs/${jobId}/sets/${set.id}?q=${encodeURIComponent(q.id)}`}
          status={
            status === 'ready'
              ? answers[q.id]
                ? 'PREPARED'
                : 'NOT_PREPARED'
              : status === 'loading'
                ? 'LOADING'
                : 'UNKNOWN'
          }
        />
      ))}
    </Stack>
  );
}

const partialNote = (set: JobQuestionSet) =>
  set.partial
    ? `Fewer questions than usual (${set.questions.length}). The job description may not have enough technical detail for more.`
    : null;

/**
 * JD-grounded technical questions for one saved job. Sets are append-only:
 * generating a new set never removes earlier questions or saved answers.
 */
export function JobInterviewTab({
  jobId,
  jobDirty,
}: {
  jobId: string;
  /** Unsaved Edit JD changes: generation would use the saved JD, so block it. */
  jobDirty: boolean;
}) {
  const notify = useNotify();
  const [data, setData] = useState<JobQuestionSets | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SavedAnswer>>({});
  const [answersStatus, setAnswersStatus] = useState<AnswersStatus>('loading');
  const [generating, setGenerating] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<{
    severity: 'error' | 'info';
    text: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // A reload keeps the last list on screen (no flash); only the first load shows progress.
  useEffect(() => {
    const controller = new AbortController();
    listJobQuestionSets(jobId, controller.signal).then(
      (next) => {
        setData(next);
        setLoadFailed(false);
      },
      () => {
        if (!controller.signal.aborted) setLoadFailed(true);
      },
    );
    return () => controller.abort();
  }, [jobId, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    listAnswers(controller.signal).then(
      (rows) => {
        setAnswers(Object.fromEntries(rows.map((a) => [a.questionId, a])));
        setAnswersStatus('ready');
      },
      () => {
        if (!controller.signal.aborted) setAnswersStatus('error');
      },
    );
    return () => controller.abort();
  }, []);
  const reload = () => {
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  };

  const generate = async () => {
    // The ref blocks a second click before React re-renders the disabled button.
    if (inFlight.current || !data) return;
    inFlight.current = true;
    setConfirmOpen(false);
    setGenerating(true);
    setMessage(null);
    try {
      const set = await generateJobQuestionSet(jobId, data.sets[0]?.id ?? null);
      notify({
        severity: 'success',
        text: `Generated ${set.questions.length} interview questions.`,
      });
      reload();
    } catch (error) {
      const code = error instanceof PracticeError ? error.code : '';
      const text =
        error instanceof PracticeError
          ? error.message
          : 'Questions could not be generated. Try again.';
      if (REFRESH_CODES.has(code)) {
        setMessage({
          severity: 'info',
          text: `${text} The list was refreshed.`,
        });
        reload();
      } else setMessage({ severity: 'error', text });
    } finally {
      inFlight.current = false;
      setGenerating(false);
    }
  };

  const panel = (children: ReactNode) => (
    <Box role="tabpanel" id="job-panel-4" aria-labelledby="job-tab-4">
      <Stack spacing={3} sx={{ maxWidth: 840, minWidth: 0 }}>
        <Box>
          <Typography variant="h6" component="h2">
            Interview questions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Technical questions based on this job description. They ask about
            the role&apos;s requirements and never assume you have used a
            technology.
          </Typography>
        </Box>
        {children}
      </Stack>
    </Box>
  );

  if (!data)
    return panel(
      loadFailed ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={reload}>
              Retry
            </Button>
          }
        >
          Interview questions could not be loaded.
        </Alert>
      ) : (
        <Stack spacing={1} role="status">
          <LinearProgress aria-label="Loading interview questions" />
          <Typography variant="body2" color="text.secondary">
            Loading interview questions…
          </Typography>
        </Stack>
      ),
    );

  const [active, ...previous] = data.sets;
  const blocked = data.jdEmpty || jobDirty;
  const activePrepared = active
    ? prepared(active, answers, answersStatus)
    : null;
  const editJd = (
    <Button component={Link} to={`/jobs/${jobId}/edit`} color="inherit">
      Edit JD
    </Button>
  );

  return panel(
    <>
      {loadFailed && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={reload}>
              Retry
            </Button>
          }
        >
          The latest questions could not be loaded. Showing the last loaded
          list.
        </Alert>
      )}
      {jobDirty ? (
        <Alert severity="info">
          Save job changes in Edit JD before generating questions.
        </Alert>
      ) : data.jdEmpty ? (
        <Alert severity="info" action={editJd}>
          This job doesn&apos;t have enough job description to generate
          questions from. Add the requirements or responsibilities in Edit JD.
        </Alert>
      ) : (
        active &&
        data.jdChanged && (
          <Alert
            severity="info"
            action={
              <Button
                color="inherit"
                disabled={generating}
                onClick={() => setConfirmOpen(true)}
              >
                Generate new set
              </Button>
            }
          >
            The job description changed after these questions were generated.
          </Alert>
        )
      )}
      {answersStatus === 'error' && (
        <Alert severity="warning">
          Saved answers couldn&apos;t be loaded, so preparation status is
          unknown.
        </Alert>
      )}

      {!active ? (
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">
            Generate 5–8 technical questions grounded in this job description.
            The local AI usually takes under 30 seconds.
          </Typography>
          <Button
            variant="contained"
            onClick={() => void generate()}
            disabled={blocked || generating}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Generate interview questions
          </Button>
        </Stack>
      ) : (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle1"
              component="h3"
              sx={{ fontWeight: 600 }}
            >
              Current set
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {when(active.createdAt)} ·{' '}
              {preparedText(activePrepared, active.questions.length)}
            </Typography>
            <Typography
              id="regenerate-note"
              component="p"
              variant="caption"
              color="text.secondary"
            >
              New question sets may revisit the same job requirements from
              different angles.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            onClick={() => setConfirmOpen(true)}
            disabled={blocked || generating}
            aria-describedby="regenerate-note"
            sx={{ flexShrink: 0, width: { xs: '100%', sm: 'auto' } }}
          >
            Generate new set
          </Button>
        </Stack>
      )}

      {generating && (
        <Stack spacing={1} role="status">
          <LinearProgress aria-label="Generating interview questions" />
          <Typography variant="body2" color="text.secondary">
            Generating questions from this job description with the local AI…
          </Typography>
        </Stack>
      )}
      {message && (
        <Alert severity={message.severity} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {active && (
        <>
          {partialNote(active) && (
            <Typography variant="body2" color="text.secondary">
              {partialNote(active)}
            </Typography>
          )}
          <QuestionList
            jobId={jobId}
            set={active}
            answers={answers}
            status={answersStatus}
            label="Current interview questions"
          />
        </>
      )}

      {previous.length > 0 && (
        <Accordion disableGutters variant="outlined">
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="previous-sets"
            id="previous-sets-header"
          >
            <Typography
              variant="subtitle1"
              component="h3"
              sx={{ fontWeight: 600 }}
            >
              Previous question sets ({previous.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails id="previous-sets">
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                Earlier sets and their saved answers stay available.
              </Typography>
              {previous.map((set) => (
                <Accordion key={set.id} disableGutters variant="outlined">
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    aria-controls={`set-${set.id}`}
                    id={`set-${set.id}-header`}
                  >
                    <Typography variant="body2">
                      <Box component="span" sx={{ fontWeight: 600 }}>
                        {when(set.createdAt)}
                      </Box>{' '}
                      ·{' '}
                      {preparedText(
                        prepared(set, answers, answersStatus),
                        set.questions.length,
                      )}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails id={`set-${set.id}`}>
                    <Stack spacing={1.5}>
                      {partialNote(set) && (
                        <Typography variant="body2" color="text.secondary">
                          {partialNote(set)}
                        </Typography>
                      )}
                      <QuestionList
                        jobId={jobId}
                        set={set}
                        answers={answers}
                        status={answersStatus}
                        label={`Questions from ${when(set.createdAt)}`}
                      />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="regenerate-title"
        aria-describedby="regenerate-description"
        maxWidth="xs"
        fullWidth
      >
        <DialogCloseButton onClick={() => setConfirmOpen(false)} />
        <DialogTitle id="regenerate-title" sx={{ pr: 7 }}>
          Generate a new question set?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="regenerate-description">
            The new set becomes the current one. Your current questions and
            saved answers stay available under Previous question sets — nothing
            is deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => void generate()}>
            Generate new set
          </Button>
        </DialogActions>
      </Dialog>
    </>,
  );
}
