import { tr } from '../../app/i18n';
import { HOSTED } from '../../app/hosted';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowBackIcon,
  ArrowForwardIcon,
  AutoAwesomeIcon,
  ExpandMoreIcon,
  MicIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
} from '../../components/icons';
import { Link, useBlocker } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  LinearProgress,
  List,
  ListItemButton,
  Paper,
  Stack,
  SvgIcon,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { PageHeader } from '../../components/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import {
  AnswerConflictError,
  MAX_ANSWER_CHARS,
  MAX_REFERENCE_ANSWER,
  PracticeError,
  answerLength,
  fetchQuestions,
  listAnswers,
  removeAnswer,
  requestFeedback,
  saveAnswer,
  type SavedAnswer,
  type PracticeFeedback,
  type PracticeMode,
  type PracticeQuestion,
  type PracticeTopic,
  type Withheld,
} from './interview-prep-api';
import { useRecorder } from './useRecorder';
import { TranscriptPanel } from './Transcript';
import { useTranscript } from './useTranscript';

/** Dirty = changed since the editor opened (an AI pre-fill alone is not an edit). */
const isDirty = (editor: AnswerEditor | null) =>
  !!editor && editor.text !== editor.initial;
import {
  Editor,
  ReferenceAnswer,
  SavedPrompt,
  Step,
  UnsavedAnswerDialog,
  type AnswerEditor,
  type PracticeView,
} from './ReferenceAnswer';

const TOPICS: Record<
  PracticeTopic,
  { label: string; description: string; icon: string }
> = {
  hr: {
    // chat bubble
    icon: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H5.17L4 17.17V4h16z',
    get label() {
      return tr('HR communication');
    },
    get description() {
      return tr(
        'Introduce yourself, talk about strengths, motivation, goals and teamwork.',
      );
    },
  },
  technical: {
    // code brackets
    icon: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6z',
    get label() {
      return tr('Technical communication');
    },
    get description() {
      return tr(
        'Explain concepts, decisions, trade-offs and how you solve problems.',
      );
    },
  },
};
const MODES: Record<
  PracticeMode,
  { label: string; field: string; action: string; helper: string }
> = {
  express: {
    get label() {
      return tr('Help me express it');
    },
    get field() {
      return tr('Your ideas (Vietnamese, English or both)');
    },
    get action() {
      return tr('Help me say it');
    },
    get helper() {
      return tr('Short notes are fine. AI only uses what you write.');
    },
  },
  review: {
    get label() {
      return tr('Review my English');
    },
    get field() {
      return tr('Your answer in English');
    },
    get action() {
      return tr('Review my English');
    },
    get helper() {
      return tr('Write it the way you would say it.');
    },
  },
};
// Safety withholds share one reassuring message; the guard itself is unchanged.
const NOT_SAFE =
  "I couldn't safely rewrite your full answer without possibly changing your meaning. This doesn't mean your answer is wrong.";
const WITHHELD: Record<Withheld, string> = {
  CHANGED_FACTS: NOT_SAFE,
  CHANGED_MEANING: NOT_SAFE,
  UNCLEAR: NOT_SAFE,
  get TOO_LONG() {
    return tr(
      "I couldn't make a version that is short enough to say comfortably. This doesn't mean your answer is wrong.",
    );
  },
  get OFF_TOPIC() {
    return tr(
      "Your answer doesn't answer this question yet. Use the questions below to refocus, then try again.",
    );
  },
  get NOT_ENOUGH_DETAIL() {
    return tr(
      "There wasn't enough detail to suggest an answer. Answer the questions below first.",
    );
  },
};
const NEXT_WITH_CORRECTIONS =
  'You can still use the corrections above and try again.';
const NEXT_WITHOUT_CORRECTIONS =
  'You can still use the questions and sentence starters below and try again.';
const ANSWERS = {
  get yes() {
    return tr('Answers the question');
  },
  get partly() {
    return tr('Partly answers the question');
  },
  get no() {
    return tr("Doesn't answer the question yet");
  },
};

type Status =
  | { kind: 'idle'; cancelled?: boolean }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'done';
      feedback: PracticeFeedback;
      /** The exact text that was sent, for "Keep my original". */
      answer: string;
      mode: PracticeMode;
    };
interface Attempt {
  mode: PracticeMode;
  text: string;
  feedback: PracticeFeedback;
}

const shuffle = <T,>(items: T[]) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};
const pick = (n: number) => Math.floor(Math.random() * n);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

// Case, spacing, curly quotes and final punctuation are not a rewrite.
const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, ' ')
    .replace(/[\s.!?]+$/u, '')
    .trim();
/** The review returned the submitted answer itself: nothing was rewritten. */
const unchangedSuggestion = (
  feedback: PracticeFeedback,
  answer: string | undefined,
) =>
  feedback.mode === 'review' &&
  !!feedback.suggestion &&
  answer !== undefined &&
  fold(feedback.suggestion) === fold(answer);

function Suggestion({
  feedback,
  answer,
  shown,
  onToggle,
}: {
  feedback: PracticeFeedback;
  /** The exact answer sent for this feedback, not later edits. */
  answer?: string;
  shown: boolean;
  onToggle: () => void;
}) {
  if (unchangedSuggestion(feedback, answer))
    return (
      <Section title={tr('Simpler spoken version')}>
        <Typography variant="body2" color="text.secondary">
          {tr(
            'Your answer is already simple and clear, so no rewrite was needed. Practise saying it as written.',
          )}
        </Typography>
      </Section>
    );
  if (!feedback.suggestion)
    return feedback.suggestionWithheld ? (
      <Alert severity="info">
        {tr(WITHHELD[feedback.suggestionWithheld])}
        {feedback.suggestionWithheld !== 'OFF_TOPIC' &&
          feedback.suggestionWithheld !== 'NOT_ENOUGH_DETAIL' &&
          ` ${tr(feedback.corrections.length ? NEXT_WITH_CORRECTIONS : NEXT_WITHOUT_CORRECTIONS)}`}
      </Alert>
    ) : null;
  return (
    <Section title={tr('Simpler spoken version')}>
      <Typography variant="body2" color="text.secondary">
        {tr(
          'AI suggestion based only on what you wrote. Read it, hide it, then say it in your own words.',
        )}
      </Typography>
      <Box>
        <Button variant="text" onClick={onToggle} aria-expanded={shown}>
          {shown ? tr('Hide suggestion') : tr('Show suggestion')}
        </Button>
      </Box>
      <Collapse in={shown} unmountOnExit>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography>{feedback.suggestion}</Typography>
        </Paper>
      </Collapse>
    </Section>
  );
}

export function Feedback({
  feedback,
  answer,
  shown,
  onToggle,
}: {
  feedback: PracticeFeedback;
  /** The exact answer sent for this feedback, not later edits. */
  answer?: string;
  shown: boolean;
  onToggle: () => void;
}) {
  const { cvCheck } = feedback;
  return (
    <Stack spacing={3}>
      {feedback.answersQuestion && (
        <Stack spacing={1}>
          <Box>
            <Chip
              label={ANSWERS[feedback.answersQuestion]}
              color={feedback.answersQuestion === 'yes' ? 'success' : 'default'}
              variant="outlined"
            />
          </Box>
          {feedback.mainIssue && <Typography>{feedback.mainIssue}</Typography>}
        </Stack>
      )}
      {feedback.corrections.length > 0 && (
        <Section title={tr('Corrections')}>
          <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
            {feedback.corrections.map((c) => (
              <li key={c.original}>
                <Typography
                  component="span"
                  sx={{ textDecoration: 'line-through' }}
                  color="text.secondary"
                >
                  {c.original}
                </Typography>
                <Typography component="span" aria-hidden="true">
                  {' → '}
                </Typography>
                <Typography component="span" sx={{ fontWeight: 600 }}>
                  <Box
                    component="span"
                    sx={{ position: 'absolute', left: -9999 }}
                  >
                    {tr('better:')}{' '}
                  </Box>
                  {c.better}
                </Typography>
              </li>
            ))}
          </Stack>
        </Section>
      )}
      <Suggestion
        feedback={feedback}
        answer={answer}
        shown={shown}
        onToggle={onToggle}
      />
      {feedback.followUpQuestions.length > 0 && (
        <Section title={tr('Questions to add your own details')}>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {feedback.followUpQuestions.map((q) => (
              <li key={q}>
                <Typography>{q}</Typography>
              </li>
            ))}
          </Stack>
        </Section>
      )}
      {feedback.phrases.length > 0 && (
        <Section title={tr('Useful sentence starters')}>
          <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
            {feedback.phrases.map((p) => (
              <li key={p.text}>
                <Typography>{p.text}</Typography>
                {p.noteVi && (
                  <Typography variant="body2" color="text.secondary" lang="vi">
                    {p.noteVi}
                  </Typography>
                )}
              </li>
            ))}
          </Stack>
        </Section>
      )}
      {feedback.technicalNote && (
        <Paper
          variant="outlined"
          component="aside"
          aria-label={tr('Technical learning hint')}
          sx={{ p: 2, borderStyle: 'dashed' }}
        >
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" component="h3">
              {tr('Technical learning hint (AI, not verified)')}
            </Typography>
            <Typography variant="body2">{feedback.technicalNote}</Typography>
            <Typography variant="body2" color="text.secondary">
              {tr(
                'Separate from the English feedback, which keeps what you said. AI can be wrong about technical details — check them yourself.',
              )}
            </Typography>
          </Stack>
        </Paper>
      )}
      {cvCheck.notices.length > 0 && (
        <Alert severity="info">
          <Typography variant="subtitle2" component="p">
            {tr('Details to double-check')}
          </Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
            {cvCheck.notices.map((n) => (
              <li key={n}>
                <Typography variant="body2">{n}</Typography>
              </li>
            ))}
          </Stack>
        </Alert>
      )}
      {cvCheck.status === 'checked' && !cvCheck.notices.length && (
        <Typography variant="body2" color="text.secondary">
          {tr(
            'Nothing to flag against your reviewed CV. This only checks numbers and tools — it is not full fact verification.',
          )}
        </Typography>
      )}
      {cvCheck.status === 'unavailable' && (
        <Typography variant="body2" color="text.secondary">
          {tr(
            'CV fact check is off because there is no reviewed CV. Feedback uses only what you wrote.',
          )}
        </Typography>
      )}
    </Stack>
  );
}

export function Recorder({
  recorder,
  title,
  prominent = false,
  transcript,
}: {
  recorder: ReturnType<typeof useRecorder>;
  title: string;
  /** PR16: optional local transcription, shown in step 3 only. */
  transcript?: ReactNode;
  /** Step 3: the main action, so a filled button. */
  prominent?: boolean;
}) {
  const { state, url, start, stop } = recorder;
  // Hosted builds have no speech-to-text: no recording controls, typing only.
  if (HOSTED)
    return transcript ? (
      <Stack spacing={1}>
        <Typography variant="subtitle2" component="h3">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {tr('Type what you would say, then get AI feedback.')}
        </Typography>
        {transcript}
      </Stack>
    ) : null;
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" component="h3">
        {title}
      </Typography>
      {transcript && state !== 'unavailable' && (
        <Typography variant="body2" color="text.secondary">
          {tr(
            'Record your answer, transcribe it locally, or type it yourself. Review the text before requesting AI feedback.',
          )}
        </Typography>
      )}
      {!transcript && url && state === 'ready' && (
        <Typography variant="body2" role="status">
          {tr(
            'Listen to your recording, then record again to practise. For AI feedback, type your answer in the text field below.',
          )}
        </Typography>
      )}
      {!transcript &&
        state !== 'unavailable' &&
        !(url && state === 'ready') && (
          <Typography variant="body2" color="text.secondary">
            {tr(
              'Record yourself speaking, then listen back. Audio is not analysed by AI.',
            )}
          </Typography>
        )}
      {state === 'unavailable' ? (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary" role="status">
            {tr(
              "Recording isn't available (no microphone, permission denied, or browser support). You can keep practising by typing.",
            )}
          </Typography>
          <Button
            startIcon={<MicIcon />}
            variant="text"
            onClick={() => void start()}
          >
            {tr('Try recording again')}
          </Button>
        </Stack>
      ) : (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          useFlexGap
          sx={{ alignItems: { sm: 'center' }, flexWrap: 'wrap' }}
        >
          {state === 'recording' ? (
            <Button variant="outlined" onClick={stop} startIcon={<StopIcon />}>
              {tr('Stop recording')}
            </Button>
          ) : (
            <Button
              variant={prominent ? 'contained' : 'outlined'}
              onClick={() => void start()}
              disabled={state === 'requesting'}
              startIcon={<MicIcon />}
            >
              {url ? tr('Record again') : tr('Record')}
            </Button>
          )}
          <Typography variant="body2" color="text.secondary" role="status">
            {state === 'requesting'
              ? tr('Waiting for microphone permission…')
              : state === 'recording'
                ? tr('Recording… speak now.')
                : ''}
          </Typography>
          {url && state === 'ready' && (
            <Box
              component="audio"
              controls
              src={url}
              aria-label={tr('Your recording')}
              sx={{ width: { xs: '100%', sm: 320 }, maxWidth: '100%' }}
            />
          )}
        </Stack>
      )}
      {transcript ?? (
        <Typography variant="caption" color="text.secondary">
          {tr(
            'Recordings stay in this browser only and are never uploaded or saved. AI feedback uses only the text you type.',
          )}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * PR15 job mode: one generated question set, in stored order. The parent keys
 * this component by the current question and owns `?q=`, so every question
 * change is a router navigation guarded by the single blocker below.
 */
const mockLink = (query: string) => (
  <Button
    startIcon={<PlayIcon />}
    component={Link}
    to={`/interview-prep/mock${query}`}
    variant="outlined"
  >
    {tr('Mock interview')}
  </Button>
);

export interface JobPracticeMode {
  jobId: string;
  jobTitle: string;
  /** e.g. "Current set" or "Previous set · Nov 9, 2026". */
  setLabel: string;
  questions: PracticeQuestion[];
  /** Why each generated question was asked, with its JD excerpt. */
  context: Record<string, { why: string; evidence: string }>;
  questionId: string;
  onSelect: (questionId: string) => void;
  /** PR17: entry to a mock interview over this set. */
  setId: string;
}

export function InterviewPrep({ job }: { job?: JobPracticeMode } = {}) {
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(
    job?.questions ?? null,
  );
  const [loadError, setLoadError] = useState(false);
  const [topic, setTopic] = useState<PracticeTopic | null>(
    job ? 'technical' : null,
  );
  const [topicOrder, setOrder] = useState<PracticeQuestion[]>([]);
  // Job mode reads the set from props (not a mount-time copy) so localized
  // category labels follow a language switch; IDs and position are unchanged.
  const order = job?.questions ?? topicOrder;
  const [index, setIndex] = useState(() =>
    job
      ? Math.max(
          0,
          job.questions.findIndex((q) => q.id === job.questionId),
        )
      : 0,
  );
  const [variant, setVariant] = useState(0);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [mode, setMode] = useState<PracticeMode>('express');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [shown, setShown] = useState(true);
  const [previous, setPrevious] = useState<Attempt | null>(null);
  const [previousShown, setPreviousShown] = useState(false);
  // PR14: saved reference answers. 'error' never means "not prepared".
  const [answersStatus, setAnswersStatus] = useState<
    'loading' | 'error' | 'ready'
  >('loading');
  const [answers, setAnswers] = useState<Record<string, SavedAnswer>>({});
  const [answersAttempt, setAnswersAttempt] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [listFilter, setListFilter] = useState<'all' | 'prepared'>('all');
  const [editor, setEditor] = useState<AnswerEditor | null>(null);
  const [view, setView] = useState<PracticeView>('read');
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Question id whose answer was just saved: shows "Start speaking practice".
  const [justSaved, setJustSaved] = useState<{
    questionId: string;
    origin: AnswerEditor['origin'];
  } | null>(null);
  const [tryOpen, setTryOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const recorder = useRecorder();
  const transcript = useTranscript();
  const [transcriptShown, setTranscriptShown] = useState(true);
  const cancelTranscript = transcript.cancel;
  // A new take (or a cleared one) must never receive the old take's transcript.
  useEffect(() => cancelTranscript(), [recorder.blob, cancelTranscript]);
  const request = useRef<AbortController | null>(null);
  // Only the latest request may update the screen.
  const sequence = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);

  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    if (job) return; // job mode: questions come from the generated set
    const controller = new AbortController();
    fetchQuestions(controller.signal).then(setQuestions, () => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [loadAttempt, job]);
  const reload = () => {
    setLoadError(false);
    setQuestions(null);
    setLoadAttempt((n) => n + 1);
  };
  useEffect(() => () => request.current?.abort(), []);
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
  }, [answersAttempt]);
  const retryAnswers = () => {
    setAnswersStatus('loading');
    setAnswersAttempt((n) => n + 1);
  };
  // PR16: a non-empty practice transcript is unsaved work too.
  const transcriptDirty = !!transcript.text.trim();
  const dirty = isDirty(editor) || transcriptDirty;
  // Route changes inside the app.
  const blocker = useBlocker(dirty);
  // Refresh or tab close: the browser's own native warning, no custom dialog.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  /** Run an in-page navigation now, or after "Discard changes" if the editor is dirty. */
  const guard = (action: () => void) => {
    if (isDirty(editor)) setPendingLeave(() => action);
    else action();
  };
  /** Leaving the question also loses a practice transcript (PR16). */
  const leave = (action: () => void) => {
    if (isDirty(editor) || transcriptDirty) setPendingLeave(() => action);
    else action();
  };

  const abandon = () => {
    sequence.current++;
    request.current?.abort();
    request.current = null;
  };
  const freshQuestion = () => {
    abandon();
    recorder.reset();
    transcript.reset();
    setText('');
    setStatus({ kind: 'idle' });
    setPrevious(null);
    setPreviousShown(false);
    setHintsOpen(false);
    setEditor(null);
    setView('read');
    setRevealed(false);
    setNotice(null);
    setJustSaved(null);
    setTryOpen(false);
  };
  const chooseTopic = (next: PracticeTopic, preparedOnly = false) => {
    const list = shuffle((questions ?? []).filter((q) => q.topic === next));
    // "Practice prepared answers": open the filtered list on a prepared question.
    const first = preparedOnly
      ? Math.max(
          0,
          list.findIndex((q) => answers[q.id]),
        )
      : 0;
    freshQuestion();
    setTopic(next);
    setOrder(list);
    setIndex(first);
    setVariant(pick(list[first]?.variants.length ?? 1));
    setListOpen(preparedOnly);
    setListFilter(preparedOnly ? 'prepared' : 'all');
  };
  const goTo = (nextIndex: number) => {
    freshQuestion();
    setIndex(nextIndex);
    setVariant(pick(order[nextIndex]?.variants.length ?? 1));
  };
  // Next question ignores the list filter: it walks the whole topic.
  // Job mode navigates (?q=); the router blocker guards unsaved answers.
  const nextQuestion = () =>
    job
      ? job.onSelect(order[(index + 1) % order.length]!.id)
      : leave(() => goTo((index + 1) % order.length));
  const previousQuestion = () =>
    job ? job.onSelect(order[index - 1]!.id) : leave(() => goTo(index - 1));
  const selectQuestion = (id: string) =>
    job
      ? job.onSelect(id)
      : leave(() =>
          goTo(
            Math.max(
              0,
              order.findIndex((q) => q.id === id),
            ),
          ),
        );
  const changeTopic = () =>
    leave(() => {
      freshQuestion();
      setTopic(null);
    });
  const changeMode = (next: PracticeMode | null) => {
    if (!next || next === mode) return;
    abandon(); // a result for the other mode would be stale
    setMode(next);
    setStatus({ kind: 'idle' });
  };
  const question = order[index];
  const submit = async () => {
    const answer = text.trim();
    if (!question || !answer || status.kind === 'loading') return;
    abandon();
    const ticket = sequence.current;
    const controller = new AbortController();
    request.current = controller;
    setStatus({ kind: 'loading' });
    try {
      const feedback = await requestFeedback(
        {
          questionId: question.id,
          mode,
          answer,
          variant: question.variants[variant] ? variant : 0,
        },
        controller.signal,
      );
      if (ticket !== sequence.current) return;
      setShown(true);
      setStatus({ kind: 'done', feedback, answer, mode });
      // New feedback: offer the choices again, drop a stale post-save prompt.
      setJustSaved((cur) => (cur?.origin === 'feedback' ? null : cur));
    } catch (error) {
      if (ticket !== sequence.current || controller.signal.aborted) return;
      setStatus({
        kind: 'error',
        message:
          error instanceof PracticeError
            ? error.message
            : tr(
                'Feedback is unavailable right now. Your text is kept — try again.',
              ),
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  };
  const cancel = () => {
    abandon();
    setStatus({ kind: 'idle', cancelled: true });
  };
  const tryAgain = () => {
    if (status.kind !== 'done') return;
    setPrevious({ mode, text: status.answer, feedback: status.feedback });
    setPreviousShown(false);
    setText('');
    setStatus({ kind: 'idle' });
    recorder.reset();
    setTimeout(() => input.current?.focus(), 0);
  };

  // ------------------------------------------- PR14 reference answer actions
  // One editor for both entry points; a dirty draft is never replaced silently.
  const openEditor = (origin: AnswerEditor['origin'], chosen?: string) =>
    guard(() => {
      if (!question || answersStatus !== 'ready') return;
      const saved = answers[question.id];
      const shownSuggestion =
        status.kind === 'done' ? status.feedback.suggestion : null;
      // Step 2 pre-fill: saved answer → displayed safe suggestion → typed English (review) → empty.
      const prefill =
        chosen ??
        saved?.answer ??
        shownSuggestion ??
        (mode === 'review' ? text.trim() : '');
      setNotice(null);
      setJustSaved(null);
      setEditor({
        origin,
        questionId: question.id,
        text: prefill,
        initial: prefill,
        baseVersion: saved?.version ?? null,
        saving: false,
        error: null,
        conflict: null,
      });
    });
  const storeAnswer = (id: string, value: SavedAnswer | null) =>
    setAnswers((all) => {
      const next = { ...all };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  const save = async (base?: number | null) => {
    if (!editor || editor.saving || answersStatus !== 'ready') return;
    const target = editor;
    const expectedVersion = base === undefined ? target.baseVersion : base;
    const length = answerLength(target.text);
    if (!length || length > MAX_REFERENCE_ANSWER) return;
    setEditor({
      ...target,
      saving: true,
      error: null,
      baseVersion: expectedVersion,
    });
    try {
      const saved = await saveAnswer(
        target.questionId,
        target.text.trim(),
        expectedVersion,
      );
      storeAnswer(saved.questionId, saved);
      // Saved: close the editor and open Speaking practice in Read Along.
      setEditor((cur) => (cur?.questionId === saved.questionId ? null : cur));
      setView('read');
      setRevealed(false);
      // No auto-scroll: the user chooses when to practise.
      setJustSaved({ questionId: saved.questionId, origin: target.origin });
    } catch (error) {
      if (error instanceof AnswerConflictError) {
        storeAnswer(target.questionId, error.current);
        setEditor((cur) =>
          cur?.questionId === target.questionId
            ? {
                ...cur,
                saving: false,
                conflict: { current: error.current, showSaved: false },
              }
            : cur,
        );
        return;
      }
      setEditor((cur) =>
        cur?.questionId === target.questionId
          ? {
              ...cur,
              saving: false,
              error:
                error instanceof PracticeError
                  ? error.message
                  : tr(
                      'Your answer could not be saved. Your text is kept — try again.',
                    ),
            }
          : cur,
      );
    }
  };
  const useSaved = () =>
    setEditor((cur) =>
      cur?.conflict?.current
        ? {
            ...cur,
            text: cur.conflict.current.answer,
            initial: cur.conflict.current.answer,
            baseVersion: cur.conflict.current.version,
            conflict: null,
            error: null,
          }
        : cur,
    );
  // Explicit overwrite: still guarded by the latest known version (or a create).
  const saveMine = () => void save(editor?.conflict?.current?.version ?? null);
  const remove = async () => {
    const saved = question ? answers[question.id] : undefined;
    if (!saved || answersStatus !== 'ready') return;
    setNotice(null);
    setJustSaved(null);
    try {
      await removeAnswer(saved.questionId, saved.version);
      storeAnswer(saved.questionId, null);
    } catch (error) {
      if (error instanceof AnswerConflictError) {
        storeAnswer(saved.questionId, error.current);
        setNotice(
          tr(
            'This answer changed in another tab, so nothing was removed. The latest saved state is shown.',
          ),
        );
      } else
        setNotice(
          error instanceof PracticeError
            ? error.message
            : tr('The answer could not be removed. Try again.'),
        );
    }
  };

  const header = job ? (
    <PageHeader
      title={tr('Interview practice')}
      description={`${job.jobTitle} · ${job.setLabel}`}
      actions={mockLink(`?jobId=${job.jobId}&setId=${job.setId}`)}
    />
  ) : (
    <PageHeader
      title={tr('Interview Prep')}
      description={tr(
        'Practise saying your own experience in simple English — one question at a time.',
      )}
      actions={mockLink('')}
    />
  );
  if (loadError)
    return (
      <Stack spacing={3}>
        {header}
        <Alert
          severity="error"
          action={
            <Button
              startIcon={<RefreshIcon />}
              color="inherit"
              onClick={reload}
            >
              {tr('Retry')}
            </Button>
          }
        >
          {tr('Practice questions could not be loaded.')}
        </Alert>
      </Stack>
    );
  if (!questions)
    return (
      <Stack spacing={3}>
        {header}
        <Typography role="status" color="text.secondary">
          {tr('Loading questions…')}
        </Typography>
      </Stack>
    );
  if (!topic || !question)
    return (
      <Stack spacing={3}>
        <PageHeader title={tr('Interview Prep')} actions={mockLink('')} />
        <Box>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
            {tr('Get comfortable speaking about your experience.')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {tr(
              'One question at a time. Simple English, real experience, your own words.',
            )}
          </Typography>
        </Box>
        {answersStatus === 'error' && (
          <Alert
            severity="error"
            action={
              <Button
                startIcon={<RefreshIcon />}
                color="inherit"
                onClick={retryAnswers}
              >
                {tr('Retry')}
              </Button>
            }
          >
            {tr(
              "Your saved answers couldn't be loaded. You can still practise with AI help.",
            )}
          </Alert>
        )}
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          }}
        >
          {(Object.keys(TOPICS) as PracticeTopic[]).map((key) => (
            <Paper
              key={key}
              variant="outlined"
              sx={{
                p: 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center' }}
              >
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'action.hover',
                    color: 'primary.main',
                  }}
                >
                  <SvgIcon>
                    <path d={TOPICS[key].icon} />
                  </SvgIcon>
                </Box>
                <Typography
                  variant="subtitle1"
                  component="h3"
                  sx={{ fontWeight: 600 }}
                >
                  {TOPICS[key].label}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flex: 1 }}
              >
                {TOPICS[key].description}
              </Typography>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <Button
                  startIcon={<PlayIcon />}
                  variant="contained"
                  onClick={() => chooseTopic(key)}
                  aria-label={tr('Practise {label}', {
                    label: TOPICS[key].label,
                  })}
                >
                  {tr('Start')}
                </Button>
                {(() => {
                  const n = questions.filter(
                    (q) => q.topic === key && answers[q.id],
                  ).length;
                  return (
                    <Button
                      variant="outlined"
                      onClick={() => chooseTopic(key, true)}
                      disabled={answersStatus !== 'ready' || n === 0}
                    >
                      {answersStatus === 'ready'
                        ? tr('Practice prepared answers ({n})', { n: n })
                        : answersStatus === 'loading'
                          ? tr('Practice prepared answers (…)')
                          : tr('Practice prepared answers (unavailable)')}
                    </Button>
                  );
                })()}
              </Stack>
            </Paper>
          ))}
        </Box>
      </Stack>
    );

  const startPractice = () => {
    setJustSaved(null);
    setView('read'); // the recording is kept, as for any mode switch
    setRevealed(false);
    const heading = document.getElementById('speaking-practice');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  };
  const editorProps = {
    onChange: (value: string) =>
      setEditor((cur) => (cur ? { ...cur, text: value, error: null } : cur)),
    onSave: () => void save(),
    onCancel: () => guard(() => setEditor(null)),
    onShowSaved: () =>
      setEditor((cur) =>
        cur?.conflict
          ? {
              ...cur,
              conflict: { ...cur.conflict, showSaved: !cur.conflict.showSaved },
            }
          : cur,
      ),
    onUseSaved: useSaved,
    onSaveMine: saveMine,
  };
  const savedFromFeedback =
    justSaved?.origin === 'feedback' && justSaved.questionId === question.id;
  const loading = status.kind === 'loading';
  const preparedCount = order.filter((q) => answers[q.id]).length;
  const feedback = status.kind === 'done' ? status.feedback : null;
  // Saved and not editing: the saved answer and speaking practice replace the Prepare workspace.
  const practising =
    answersStatus === 'ready' && !!answers[question.id] && !editor;
  const prepareStep = (
    <>
      <Step
        id="prepare-answer"
        title={tr('Prepare your answer')}
        intro={tr('Write it yourself or get help expressing it in English.')}
      >
        <Stack
          spacing={2}
          component="form"
          aria-label={tr('Your answer')}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Stack spacing={1}>
            <Typography
              variant="subtitle2"
              component="h3"
              id="practice-mode-label"
            >
              {tr('How should AI help?')}
            </Typography>
            <ToggleButtonGroup
              exclusive
              value={mode}
              onChange={(_e, value: PracticeMode | null) => changeMode(value)}
              aria-labelledby="practice-mode-label"
              sx={{ flexWrap: 'wrap' }}
            >
              {(Object.keys(MODES) as PracticeMode[]).map((key) => (
                <ToggleButton
                  key={key}
                  value={key}
                  sx={{ textTransform: 'none', minHeight: 44 }}
                >
                  {MODES[key].label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          <TextField
            inputRef={input}
            label={MODES[mode].field}
            multiline
            minRows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            helperText={tr(
              '{helper} {length}/{MAX_ANSWER_CHARS} · Ctrl+Enter to send',
              {
                helper: MODES[mode].helper,
                length: text.length,
                MAX_ANSWER_CHARS: MAX_ANSWER_CHARS,
              },
            )}
            slotProps={{
              htmlInput: {
                maxLength: MAX_ANSWER_CHARS,
                lang: mode === 'review' ? 'en' : undefined,
              },
            }}
            fullWidth
          />
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Button
              startIcon={<AutoAwesomeIcon />}
              type="submit"
              variant="contained"
              disabled={loading || !text.trim()}
            >
              {MODES[mode].action}
            </Button>
            {loading && (
              <Button variant="outlined" onClick={cancel}>
                {tr('Cancel')}
              </Button>
            )}
          </Stack>
          {loading && (
            <Stack spacing={1} role="status">
              <LinearProgress aria-label={tr('Waiting for feedback')} />
              <Typography variant="body2" color="text.secondary">
                {tr('Checking with the AI… usually under 10 seconds.')}
              </Typography>
            </Stack>
          )}
          {status.kind === 'idle' && status.cancelled && (
            <Typography variant="body2" color="text.secondary" role="status">
              {tr(
                'Stopped waiting. Your text is kept. The AI may still finish in the background.',
              )}
            </Typography>
          )}
          {status.kind === 'error' && (
            <Alert
              severity="error"
              action={
                <Button
                  startIcon={<RefreshIcon />}
                  color="inherit"
                  onClick={() => void submit()}
                >
                  {tr('Retry')}
                </Button>
              }
            >
              {status.message}
            </Alert>
          )}
        </Stack>

        {/* One recorder: in step 3 when the answer is prepared or saved answers failed to load, otherwise here (collapsed). */}
        {!HOSTED &&
          answersStatus !== 'error' &&
          !(answersStatus === 'ready' && answers[question.id] && !editor) && (
            <Box>
              <Button
                variant="text"
                onClick={() => setTryOpen((v) => !v)}
                aria-expanded={tryOpen}
                aria-controls="try-speaking"
              >
                {tr('Want to try speaking first?')}
              </Button>
              <Collapse in={tryOpen} id="try-speaking">
                <Box sx={{ mt: 1 }}>
                  <Recorder
                    recorder={recorder}
                    title={tr('Try speaking (optional)')}
                  />
                </Box>
              </Collapse>
            </Box>
          )}
      </Step>

      {feedback && (
        <Box component="section" aria-labelledby="practice-feedback">
          <Stack spacing={3}>
            <Typography
              id="practice-feedback"
              variant="h6"
              component="h2"
              tabIndex={-1}
            >
              {tr('Feedback')}
            </Typography>
            <Feedback
              feedback={feedback}
              answer={status.kind === 'done' ? status.answer : undefined}
              shown={shown}
              onToggle={() => setShown((v) => !v)}
            />
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {feedback.suggestion &&
                !unchangedSuggestion(
                  feedback,
                  status.kind === 'done' ? status.answer : undefined,
                )
                  ? tr(
                      'Now hide the suggestion and say your answer out loud again.',
                    )
                  : tr(
                      'Now say your answer out loud again, using the feedback above.',
                    )}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  startIcon={<RefreshIcon />}
                  variant="contained"
                  onClick={tryAgain}
                >
                  {tr('Try again')}
                </Button>
              </Stack>
            </Stack>
            {/* Hidden once this feedback's choice was saved: one next action remains. */}
            {answersStatus === 'ready' &&
              !savedFromFeedback &&
              (feedback.suggestion ||
                (status.kind === 'done' && status.mode === 'review')) && (
                <Stack spacing={1}>
                  <Typography
                    variant="subtitle1"
                    component="h3"
                    sx={{ fontWeight: 600 }}
                  >
                    {tr('Choose your reference answer')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {feedback.suggestion
                      ? tr(
                          'Start from the AI suggestion or your own words. You can edit it before saving.',
                        )
                      : tr(
                          'No safe rewrite is available. Start from your own words and edit them before saving.',
                        )}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    {/* suggestion is non-null only when PR13's meaning guards passed */}
                    {feedback.suggestion && (
                      <Button
                        variant="contained"
                        onClick={() =>
                          openEditor('feedback', feedback.suggestion!)
                        }
                      >
                        {tr('Use suggested answer')}
                      </Button>
                    )}
                    {status.kind === 'done' && status.mode === 'review' && (
                      <Button
                        variant="outlined"
                        onClick={() => openEditor('feedback', status.answer)}
                      >
                        {tr('Keep my original')}
                      </Button>
                    )}
                  </Stack>
                </Stack>
              )}
          </Stack>
        </Box>
      )}

      {/* The editor under Feedback; it stays even if new feedback arrives or the mode changes. */}
      {answersStatus === 'ready' &&
        (editor?.origin === 'feedback' && editor.questionId === question.id ? (
          <Box
            component="section"
            aria-label={tr('Edit your reference answer')}
          >
            <Editor {...editorProps} editor={editor} />
          </Box>
        ) : savedFromFeedback ? (
          <Box component="section">
            <SavedPrompt onStart={startPractice} />
          </Box>
        ) : null)}

      {previous && (
        <Accordion disableGutters variant="outlined">
          <AccordionSummary
            aria-controls="previous-attempt"
            id="previous-attempt-header"
          >
            <Typography variant="subtitle2">
              {tr('Your previous attempt')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails id="previous-attempt">
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {MODES[previous.mode].label}
              </Typography>
              <Typography
                sx={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {previous.text}
              </Typography>
              <Suggestion
                feedback={previous.feedback}
                answer={previous.text}
                shown={previousShown}
                onToggle={() => setPreviousShown((v) => !v)}
              />
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </>
  );
  const referenceStep = (
    <ReferenceAnswer
      key={question.id}
      status={answersStatus}
      saved={answers[question.id]}
      editor={editor?.questionId === question.id ? editor : null}
      view={view}
      revealed={revealed}
      recorder={
        <Recorder
          recorder={recorder}
          title={tr('Say it out loud')}
          prominent
          transcript={
            <TranscriptPanel
              transcript={transcript}
              recording={recorder.blob}
              questionId={question.id}
              variant={question.variants[variant] ? variant : 0}
              renderFeedback={(f, sent) => (
                <Feedback
                  feedback={f}
                  answer={sent}
                  shown={transcriptShown}
                  onToggle={() => setTranscriptShown((v) => !v)}
                />
              )}
            />
          }
        />
      }
      notice={notice}
      onRetryLoad={retryAnswers}
      onFinalize={() => openEditor('step2')}
      onEditorChange={editorProps.onChange}
      onSave={editorProps.onSave}
      onCancel={editorProps.onCancel}
      onShowSaved={editorProps.onShowSaved}
      onUseSaved={useSaved}
      onSaveMine={saveMine}
      onView={(next) => {
        setView(next); // the recording is kept across modes
        setRevealed(false);
      }}
      onReveal={() => setRevealed((v) => !v)}
      onRemove={remove}
      justSaved={justSaved?.questionId === question.id}
      onStartPractice={startPractice}
    />
  );
  return (
    <Stack spacing={3} sx={{ maxWidth: 1400, minWidth: 0 }}>
      {header}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        {job ? (
          <Button
            startIcon={<ArrowBackIcon />}
            component={Link}
            to={`/jobs/${job.jobId}/interview`}
            variant="text"
            sx={{ overflowWrap: 'anywhere', textAlign: 'left' }}
          >
            {tr('Back to')} {job.jobTitle} {tr('interview')}
          </Button>
        ) : (
          <>
            <Chip label={TOPICS[topic].label} variant="outlined" />
            <Button variant="text" onClick={changeTopic}>
              {tr('Change topic')}
            </Button>
          </>
        )}
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          alignItems: 'start',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: 'minmax(0, 65fr) minmax(0, 35fr)',
          },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <Paper
            variant="outlined"
            component="section"
            aria-labelledby="practice-question"
            sx={{ p: { xs: 2, sm: 3 } }}
          >
            {/* Mobile: question first, Next last. Desktop: Next sits top right. DOM order = reading order. */}
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
                '& > *': { gridColumn: '1 / -1', minWidth: 0 },
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  gridColumn: { sm: '1 / 2 !important' },
                  alignSelf: 'center',
                }}
              >
                {question.category} {tr('· Question')} {index + 1} {tr('of')}{' '}
                {order.length}
              </Typography>
              <Typography id="practice-question" variant="h6" component="h2">
                {question.variants[variant] ?? question.variants[0]}
              </Typography>
              {question.kind === 'general' && (
                <Typography variant="body2" color="text.secondary">
                  {tr(
                    'Explain the idea in general terms. Personal experience is optional.',
                  )}
                </Typography>
              )}
              {question.kind === 'hypothetical' && (
                <Typography variant="body2" color="text.secondary">
                  {tr(
                    'This is a "what would you do" question — you don\'t need past experience with it.',
                  )}
                </Typography>
              )}
              {job?.context[question.id] && (
                <Box>
                  <Button
                    variant="text"
                    onClick={() => setWhyOpen((v) => !v)}
                    aria-expanded={whyOpen}
                    aria-controls="practice-why"
                  >
                    {tr('Why was this asked?')}
                  </Button>
                  <Collapse in={whyOpen}>
                    <Stack id="practice-why" spacing={1.5} sx={{ mt: 1 }}>
                      <Typography
                        variant="body2"
                        sx={{ overflowWrap: 'anywhere' }}
                      >
                        {job.context[question.id]!.why}
                      </Typography>
                      <Box
                        component="figure"
                        sx={{
                          m: 0,
                          pl: 1.5,
                          borderLeft: 3,
                          borderColor: 'divider',
                        }}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="figcaption"
                        >
                          {tr('From the job description')}
                        </Typography>
                        <Typography
                          variant="body2"
                          component="blockquote"
                          sx={{ m: 0, overflowWrap: 'anywhere' }}
                        >
                          “{job.context[question.id]!.evidence}”
                        </Typography>
                      </Box>
                    </Stack>
                  </Collapse>
                </Box>
              )}
              {question.hints.length > 0 && (
                <Box>
                  <Button
                    variant="text"
                    onClick={() => setHintsOpen((v) => !v)}
                    aria-expanded={hintsOpen}
                    aria-controls="practice-hints"
                  >
                    {hintsOpen ? tr('Hide ideas') : tr('Ideas to mention')}
                  </Button>
                  <Collapse in={hintsOpen}>
                    <Stack
                      id="practice-hints"
                      component="ul"
                      spacing={0.5}
                      sx={{ m: 0, mt: 1, pl: 2.5 }}
                    >
                      {question.hints.map((h) => (
                        <li key={h}>
                          <Typography variant="body2">{h}</Typography>
                        </li>
                      ))}
                    </Stack>
                  </Collapse>
                </Box>
              )}
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  gridColumn: { sm: '2 / 3 !important' },
                  gridRow: { sm: 1 },
                  justifySelf: { sm: 'end' },
                  '& > *': { flex: { xs: 1, sm: 'none' } },
                }}
              >
                <Button
                  startIcon={<ArrowBackIcon />}
                  variant="outlined"
                  onClick={previousQuestion}
                  disabled={index === 0}
                  aria-label={tr('Previous')}
                  sx={{
                    flex: { xs: 'none', sm: 'none' },
                    minWidth: 48,
                    '& .MuiButton-startIcon': {
                      mr: { xs: 0, sm: 1 },
                      ml: { xs: 0, sm: -0.5 },
                    },
                  }}
                >
                  <Box
                    component="span"
                    sx={{ display: { xs: 'none', sm: 'inline' } }}
                  >
                    {tr('Previous')}
                  </Box>
                </Button>
                <Button
                  endIcon={<ArrowForwardIcon />}
                  variant="outlined"
                  onClick={nextQuestion}
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {tr('Next question')}
                </Button>
              </Stack>
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack
              spacing={3}
              sx={{
                // one card, steps separated by dividers instead of separate cards
                '& > section + section': {
                  borderTop: 1,
                  borderColor: 'divider',
                  pt: 3,
                },
              }}
            >
              {!practising && prepareStep}
              {referenceStep}
            </Stack>
          </Paper>
        </Stack>

        <Stack
          spacing={3}
          component="aside"
          aria-label={tr('Your preparation')}
        >
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Typography variant="h6" component="h2">
                {tr('Your preparation')}
              </Typography>
              {answersStatus === 'ready' && (
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center' }}
                >
                  <LinearProgress
                    variant="determinate"
                    value={
                      order.length ? (preparedCount / order.length) * 100 : 0
                    }
                    aria-label={tr('Prepared answers')}
                    sx={{ flex: 1, height: 8, borderRadius: 4 }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {preparedCount}/{order.length}
                  </Typography>
                </Stack>
              )}
              <Box>
                <ButtonBase
                  onClick={() => setListOpen((v) => !v)}
                  aria-expanded={listOpen}
                  aria-controls="question-list"
                  sx={{
                    width: '100%',
                    minHeight: 48,
                    px: 2,
                    py: 1,
                    gap: 1.5,
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&.Mui-focusVisible': {
                      outline: (t) => `2px solid ${t.palette.primary.main}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Typography
                    sx={{ fontWeight: 600, flex: 1, whiteSpace: 'nowrap' }}
                  >
                    {tr('Browse questions')}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {answersStatus === 'ready' ? (
                      <>
                        <Box
                          component="span"
                          sx={{ display: { xs: 'none', sm: 'inline' } }}
                        >
                          {preparedCount} {tr('prepared ·')} {order.length}{' '}
                          {tr('questions')}
                        </Box>
                        <Box
                          component="span"
                          sx={{ display: { xs: 'inline', sm: 'none' } }}
                        >
                          {preparedCount} / {order.length} {tr('prepared')}
                        </Box>
                      </>
                    ) : (
                      tr('{length} questions', { length: order.length })
                    )}
                  </Typography>
                  <ExpandMoreIcon
                    sx={{
                      color: 'text.secondary',
                      transition: 'transform 150ms',
                      transform: listOpen ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </ButtonBase>
                <Collapse in={listOpen} id="question-list">
                  <Paper
                    variant="outlined"
                    sx={{ mt: 1, p: { xs: 1.5, sm: 2 } }}
                  >
                    <Stack spacing={1.5}>
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={listFilter}
                        onChange={(_e, v: 'all' | 'prepared' | null) =>
                          v && setListFilter(v)
                        }
                        aria-label={tr('Filter questions')}
                      >
                        <ToggleButton
                          value="all"
                          sx={{ textTransform: 'none', minHeight: 44 }}
                        >
                          {tr('All')}
                        </ToggleButton>
                        <ToggleButton
                          value="prepared"
                          sx={{ textTransform: 'none', minHeight: 44 }}
                          disabled={answersStatus !== 'ready'}
                        >
                          {tr('Prepared')}
                        </ToggleButton>
                      </ToggleButtonGroup>
                      {(() => {
                        // Job sets keep their stored position order.
                        const rows = (
                          job
                            ? order
                            : [...order].sort((a, b) =>
                                a.id.localeCompare(b.id),
                              )
                        ).filter((q) => listFilter === 'all' || answers[q.id]);
                        if (!rows.length)
                          return (
                            <Typography variant="body2" color="text.secondary">
                              {tr('No prepared answers in this topic yet.')}
                            </Typography>
                          );
                        return (
                          <List
                            dense
                            disablePadding
                            aria-label={tr('Questions in this topic')}
                          >
                            {rows.map((q) => (
                              <ListItemButton
                                key={q.id}
                                selected={q.id === question.id}
                                aria-current={
                                  q.id === question.id ? 'true' : undefined
                                }
                                onClick={() => selectQuestion(q.id)}
                                sx={{
                                  gap: 1.5,
                                  alignItems: 'flex-start',
                                  flexWrap: 'wrap',
                                  minHeight: 44,
                                }}
                              >
                                <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{ overflowWrap: 'anywhere' }}
                                  >
                                    {q.variants[0]}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                  >
                                    {q.category}
                                  </Typography>
                                </Box>
                                <StatusChip
                                  status={
                                    answersStatus === 'ready'
                                      ? answers[q.id]
                                        ? 'PREPARED'
                                        : 'NOT_PREPARED'
                                      : answersStatus === 'loading'
                                        ? 'LOADING'
                                        : 'UNKNOWN'
                                  }
                                />
                              </ListItemButton>
                            ))}
                          </List>
                        );
                      })()}
                    </Stack>
                  </Paper>
                </Collapse>
              </Box>
              <Button
                variant="text"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() =>
                  document
                    .getElementById('reference-answer')
                    ?.scrollIntoView({ block: 'start' })
                }
              >
                {answersStatus === 'ready' && answers[question.id]
                  ? tr('View saved answer')
                  : tr('Go to reference answer')}
              </Button>
            </Stack>
          </Paper>
          {!job && (
            <Alert severity="info" icon={false}>
              <Typography variant="subtitle2" component="h2">
                {tr('About this topic')}
              </Typography>
              {TOPICS[topic].description}
            </Alert>
          )}
        </Stack>
      </Box>

      <UnsavedAnswerDialog
        open={!!pendingLeave || blocker.state === 'blocked'}
        transcript={!isDirty(editor)}
        onStay={() => {
          setPendingLeave(null);
          if (blocker.state === 'blocked') blocker.reset();
        }}
        onDiscard={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          setEditor(null);
          transcript.reset();
          if (blocker.state === 'blocked') blocker.proceed();
          action?.();
        }}
      />
    </Stack>
  );
}
