import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { PageHeader } from '../../components/PageHeader';
import {
  MAX_ANSWER_CHARS,
  PracticeError,
  fetchQuestions,
  requestFeedback,
  type PracticeFeedback,
  type PracticeMode,
  type PracticeQuestion,
  type PracticeTopic,
  type Withheld,
} from './interview-prep-api';
import { useRecorder } from './useRecorder';

const TOPICS: Record<PracticeTopic, { label: string; description: string }> = {
  hr: {
    label: 'HR communication',
    description:
      'Introduce yourself, talk about strengths, motivation, goals and teamwork.',
  },
  technical: {
    label: 'Technical communication',
    description:
      'Explain concepts, decisions, trade-offs and how you solve problems.',
  },
};
const MODES: Record<
  PracticeMode,
  { label: string; field: string; action: string; helper: string }
> = {
  express: {
    label: 'Help me express it',
    field: 'Your ideas (Vietnamese, English or both)',
    action: 'Help me say it',
    helper: 'Short notes are fine. AI only uses what you write.',
  },
  review: {
    label: 'Review my English',
    field: 'Your answer in English',
    action: 'Review my English',
    helper: 'Write it the way you would say it.',
  },
};
// Safety withholds share one reassuring message; the guard itself is unchanged.
const NOT_SAFE =
  "I couldn't safely rewrite your full answer without possibly changing your meaning. This doesn't mean your answer is wrong.";
const WITHHELD: Record<Withheld, string> = {
  CHANGED_FACTS: NOT_SAFE,
  CHANGED_MEANING: NOT_SAFE,
  UNCLEAR: NOT_SAFE,
  TOO_LONG:
    "I couldn't make a version that is short enough to say comfortably. This doesn't mean your answer is wrong.",
  OFF_TOPIC:
    "Your answer doesn't answer this question yet. Use the questions below to refocus, then try again.",
  NOT_ENOUGH_DETAIL:
    "There wasn't enough detail to suggest an answer. Answer the questions below first.",
};
const NEXT_WITH_CORRECTIONS =
  'You can still use the corrections above and try again.';
const NEXT_WITHOUT_CORRECTIONS =
  'You can still use the questions and sentence starters below and try again.';
const ANSWERS = {
  yes: 'Answers the question',
  partly: 'Partly answers the question',
  no: "Doesn't answer the question yet",
};

type Status =
  | { kind: 'idle'; cancelled?: boolean }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; feedback: PracticeFeedback };
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

function Suggestion({
  feedback,
  shown,
  onToggle,
}: {
  feedback: PracticeFeedback;
  shown: boolean;
  onToggle: () => void;
}) {
  if (!feedback.suggestion)
    return feedback.suggestionWithheld ? (
      <Alert severity="info">
        {WITHHELD[feedback.suggestionWithheld]}
        {feedback.suggestionWithheld !== 'OFF_TOPIC' &&
          feedback.suggestionWithheld !== 'NOT_ENOUGH_DETAIL' &&
          ` ${feedback.corrections.length ? NEXT_WITH_CORRECTIONS : NEXT_WITHOUT_CORRECTIONS}`}
      </Alert>
    ) : null;
  return (
    <Section title="Simpler spoken version">
      <Typography variant="body2" color="text.secondary">
        AI suggestion based only on what you wrote. Read it, hide it, then say
        it in your own words.
      </Typography>
      <Box>
        <Button variant="text" onClick={onToggle} aria-expanded={shown}>
          {shown ? 'Hide suggestion' : 'Show suggestion'}
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

function Feedback({
  feedback,
  shown,
  onToggle,
}: {
  feedback: PracticeFeedback;
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
        <Section title="Corrections">
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
                    better:{' '}
                  </Box>
                  {c.better}
                </Typography>
              </li>
            ))}
          </Stack>
        </Section>
      )}
      <Suggestion feedback={feedback} shown={shown} onToggle={onToggle} />
      {feedback.followUpQuestions.length > 0 && (
        <Section title="Questions to add your own details">
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
        <Section title="Useful sentence starters">
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
          aria-label="Technical learning hint"
          sx={{ p: 2, borderStyle: 'dashed' }}
        >
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" component="h3">
              Technical learning hint (AI, not verified)
            </Typography>
            <Typography variant="body2">{feedback.technicalNote}</Typography>
            <Typography variant="body2" color="text.secondary">
              Separate from the English feedback, which keeps what you said. AI
              can be wrong about technical details — check them yourself.
            </Typography>
          </Stack>
        </Paper>
      )}
      {cvCheck.notices.length > 0 && (
        <Alert severity="info">
          <Typography variant="subtitle2" component="p">
            Details to double-check
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
          Nothing to flag against your reviewed CV. This only checks numbers and
          tools — it is not full fact verification.
        </Typography>
      )}
      {cvCheck.status === 'unavailable' && (
        <Typography variant="body2" color="text.secondary">
          CV fact check is off because there is no reviewed CV. Feedback uses
          only what you wrote.
        </Typography>
      )}
    </Stack>
  );
}

function Recorder({ recorder }: { recorder: ReturnType<typeof useRecorder> }) {
  const { state, url, start, stop } = recorder;
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" component="h3">
        Say it out loud (optional)
      </Typography>
      {url && state === 'ready' && (
        <Typography variant="body2" role="status">
          Listen to your recording, then record again to practise. For AI
          feedback, type your answer in the text field below.
        </Typography>
      )}
      {state !== 'unavailable' && !(url && state === 'ready') && (
        <Typography variant="body2" color="text.secondary">
          Record yourself speaking, then listen back. Audio is not analysed by
          AI.
        </Typography>
      )}
      {state === 'unavailable' ? (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary" role="status">
            Recording isn't available (no microphone, permission denied, or
            browser support). You can keep practising by typing.
          </Typography>
          <Button variant="text" onClick={() => void start()}>
            Try recording again
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
            <Button variant="outlined" color="error" onClick={stop}>
              Stop recording
            </Button>
          ) : (
            <Button
              variant="outlined"
              onClick={() => void start()}
              disabled={state === 'requesting'}
            >
              {url ? 'Record again' : 'Record'}
            </Button>
          )}
          <Typography variant="body2" color="text.secondary" role="status">
            {state === 'requesting'
              ? 'Waiting for microphone permission…'
              : state === 'recording'
                ? 'Recording… speak now.'
                : ''}
          </Typography>
          {url && state === 'ready' && (
            <Box
              component="audio"
              controls
              src={url}
              aria-label="Your recording"
              sx={{ width: { xs: '100%', sm: 320 }, maxWidth: '100%' }}
            />
          )}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary">
        Recordings stay in this browser only and are never uploaded or saved. AI
        feedback uses only the text you type.
      </Typography>
    </Stack>
  );
}

export function InterviewPrep() {
  const [questions, setQuestions] = useState<PracticeQuestion[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [topic, setTopic] = useState<PracticeTopic | null>(null);
  const [order, setOrder] = useState<PracticeQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [variant, setVariant] = useState(0);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [mode, setMode] = useState<PracticeMode>('express');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [shown, setShown] = useState(true);
  const [previous, setPrevious] = useState<Attempt | null>(null);
  const [previousShown, setPreviousShown] = useState(false);
  const recorder = useRecorder();
  const request = useRef<AbortController | null>(null);
  // Only the latest request may update the screen.
  const sequence = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);

  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchQuestions(controller.signal).then(setQuestions, () => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [loadAttempt]);
  const reload = () => {
    setLoadError(false);
    setQuestions(null);
    setLoadAttempt((n) => n + 1);
  };
  useEffect(() => () => request.current?.abort(), []);

  const abandon = () => {
    sequence.current++;
    request.current?.abort();
    request.current = null;
  };
  const freshQuestion = () => {
    abandon();
    recorder.reset();
    setText('');
    setStatus({ kind: 'idle' });
    setPrevious(null);
    setPreviousShown(false);
    setHintsOpen(false);
  };
  const chooseTopic = (next: PracticeTopic) => {
    const list = shuffle((questions ?? []).filter((q) => q.topic === next));
    freshQuestion();
    setTopic(next);
    setOrder(list);
    setIndex(0);
    setVariant(pick(list[0]?.variants.length ?? 1));
  };
  const nextQuestion = () => {
    const nextIndex = (index + 1) % order.length;
    freshQuestion();
    setIndex(nextIndex);
    setVariant(pick(order[nextIndex]?.variants.length ?? 1));
  };
  const changeTopic = () => {
    freshQuestion();
    setTopic(null);
  };
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
      setStatus({ kind: 'done', feedback });
    } catch (error) {
      if (ticket !== sequence.current || controller.signal.aborted) return;
      setStatus({
        kind: 'error',
        message:
          error instanceof PracticeError
            ? error.message
            : 'Feedback is unavailable right now. Your text is kept — try again.',
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
    setPrevious({ mode, text, feedback: status.feedback });
    setPreviousShown(false);
    setText('');
    setStatus({ kind: 'idle' });
    recorder.reset();
    setTimeout(() => input.current?.focus(), 0);
  };

  const header = (
    <PageHeader
      title="Interview Prep"
      description="Practise saying your own experience in simple English — one question at a time."
    />
  );
  if (loadError)
    return (
      <Stack spacing={3}>
        {header}
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={reload}>
              Retry
            </Button>
          }
        >
          Practice questions could not be loaded.
        </Alert>
      </Stack>
    );
  if (!questions)
    return (
      <Stack spacing={3}>
        {header}
        <Typography role="status" color="text.secondary">
          Loading questions…
        </Typography>
      </Stack>
    );
  if (!topic || !question)
    return (
      <Stack spacing={3}>
        {header}
        <Typography variant="h6" component="h2">
          Choose a topic
        </Typography>
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
                p: 2.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
              }}
            >
              <Typography
                variant="subtitle1"
                component="h3"
                sx={{ fontWeight: 600 }}
              >
                {TOPICS[key].label}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ flex: 1 }}
              >
                {TOPICS[key].description}
              </Typography>
              <Box>
                <Button
                  variant="contained"
                  onClick={() => chooseTopic(key)}
                  aria-label={`Practise ${TOPICS[key].label}`}
                >
                  Start
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>
      </Stack>
    );

  const loading = status.kind === 'loading';
  const feedback = status.kind === 'done' ? status.feedback : null;
  return (
    <Stack spacing={3} sx={{ maxWidth: 760, minWidth: 0 }}>
      {header}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Chip label={TOPICS[topic].label} variant="outlined" />
        <Button variant="text" onClick={changeTopic}>
          Change topic
        </Button>
      </Stack>

      <Paper
        variant="outlined"
        component="section"
        aria-labelledby="practice-question"
        sx={{ p: { xs: 2, sm: 3 } }}
      >
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{
              justifyContent: 'space-between',
              alignItems: { sm: 'center' },
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {question.category} · Question {index + 1} of {order.length}
            </Typography>
            <Button variant="outlined" onClick={nextQuestion}>
              Next question
            </Button>
          </Stack>
          <Typography id="practice-question" variant="h6" component="h2">
            {question.variants[variant] ?? question.variants[0]}
          </Typography>
          {question.kind === 'general' && (
            <Typography variant="body2" color="text.secondary">
              Explain the idea in general terms. Personal experience is
              optional.
            </Typography>
          )}
          {question.kind === 'hypothetical' && (
            <Typography variant="body2" color="text.secondary">
              This is a "what would you do" question — you don't need past
              experience with it.
            </Typography>
          )}
          {question.hints.length > 0 && (
            <Box>
              <Button
                variant="text"
                onClick={() => setHintsOpen((v) => !v)}
                aria-expanded={hintsOpen}
                aria-controls="practice-hints"
              >
                {hintsOpen ? 'Hide ideas' : 'Ideas to mention'}
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
        </Stack>
      </Paper>

      <Recorder recorder={recorder} />

      <Stack
        spacing={2}
        component="form"
        aria-label="Your answer"
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
            How should AI help?
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
          helperText={`${MODES[mode].helper} ${text.length}/${MAX_ANSWER_CHARS} · Ctrl+Enter to send`}
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
            type="submit"
            variant="contained"
            disabled={loading || !text.trim()}
          >
            {MODES[mode].action}
          </Button>
          {loading && (
            <Button variant="outlined" onClick={cancel}>
              Cancel
            </Button>
          )}
        </Stack>
        {loading && (
          <Stack spacing={1} role="status">
            <LinearProgress aria-label="Waiting for feedback" />
            <Typography variant="body2" color="text.secondary">
              Checking with the local AI… usually under 10 seconds.
            </Typography>
          </Stack>
        )}
        {status.kind === 'idle' && status.cancelled && (
          <Typography variant="body2" color="text.secondary" role="status">
            Stopped waiting. Your text is kept. The local AI may still finish in
            the background.
          </Typography>
        )}
        {status.kind === 'error' && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" onClick={() => void submit()}>
                Retry
              </Button>
            }
          >
            {status.message}
          </Alert>
        )}
      </Stack>

      {feedback && (
        <Paper
          variant="outlined"
          component="section"
          aria-labelledby="practice-feedback"
          sx={{ p: { xs: 2, sm: 3 } }}
        >
          <Stack spacing={3}>
            <Typography
              id="practice-feedback"
              variant="h6"
              component="h2"
              tabIndex={-1}
            >
              Feedback
            </Typography>
            <Feedback
              feedback={feedback}
              shown={shown}
              onToggle={() => setShown((v) => !v)}
            />
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {feedback.suggestion
                  ? 'Now hide the suggestion and say your answer out loud again.'
                  : 'Now say your answer out loud again, using the feedback above.'}
              </Typography>
              <Box>
                <Button variant="contained" onClick={tryAgain}>
                  Try again
                </Button>
              </Box>
            </Stack>
          </Stack>
        </Paper>
      )}

      {previous && (
        <Accordion disableGutters variant="outlined">
          <AccordionSummary
            aria-controls="previous-attempt"
            id="previous-attempt-header"
          >
            <Typography variant="subtitle2">Your previous attempt</Typography>
          </AccordionSummary>
          <AccordionDetails id="previous-attempt">
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {MODES[previous.mode].label}
              </Typography>
              <Typography
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {previous.text}
              </Typography>
              <Suggestion
                feedback={previous.feedback}
                shown={previousShown}
                onToggle={() => setPreviousShown((v) => !v)}
              />
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}
