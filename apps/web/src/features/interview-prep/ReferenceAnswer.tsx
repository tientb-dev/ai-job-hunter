import {
  CheckIcon,
  DeleteIcon,
  EditIcon,
  MicIcon,
  RefreshIcon,
  SaveIcon,
} from '../../components/icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  MAX_REFERENCE_ANSWER,
  answerLength,
  type SavedAnswer,
} from './interview-prep-api';

export type PracticeView = 'read' | 'free';
export interface AnswerEditor {
  questionId: string;
  text: string;
  /** Text when the editor opened: dirty means "changed since opening". */
  initial: string;
  /** Where the one editor renders: under Feedback, or in Step 2. */
  origin: 'feedback' | 'step2';
  /** null = create; otherwise the version this edit is based on. */
  baseVersion: number | null;
  saving: boolean;
  error: string | null;
  /** Present after a 409; `current` null means it was deleted elsewhere. */
  conflict: { current: SavedAnswer | null; showSaved: boolean } | null;
}

const pre = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;

/** Inline editor for the one English reference answer of a question. */
export function Editor({
  editor,
  onChange,
  onSave,
  onCancel,
  onShowSaved,
  onUseSaved,
  onSaveMine,
}: {
  editor: AnswerEditor;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onShowSaved: () => void;
  onUseSaved: () => void;
  onSaveMine: () => void;
}) {
  const length = answerLength(editor.text);
  const tooLong = length > MAX_REFERENCE_ANSWER;
  const { conflict } = editor;
  return (
    <Stack spacing={2}>
      <TextField
        label="Your English reference answer"
        multiline
        minRows={5}
        autoFocus
        value={editor.text}
        onChange={(e) => onChange(e.target.value)}
        error={tooLong}
        helperText={`${length}/${MAX_REFERENCE_ANSWER}`}
        fullWidth
        slotProps={{ htmlInput: { lang: 'en' } }}
      />
      {conflict && (
        <Alert severity="warning" role="alert">
          <Stack spacing={1}>
            <Typography variant="body2">
              {conflict.current
                ? 'This answer was changed in another tab. Your text below is kept.'
                : 'This answer was removed in another tab. Your text below is kept.'}
            </Typography>
            {conflict.current && conflict.showSaved && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" component="p">
                  Saved version
                </Typography>
                <Typography variant="body2" sx={pre}>
                  {conflict.current.answer}
                </Typography>
              </Paper>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              {conflict.current && (
                <>
                  <Button
                    variant="text"
                    onClick={onShowSaved}
                    aria-expanded={conflict.showSaved}
                  >
                    {conflict.showSaved
                      ? 'Hide saved version'
                      : 'Show saved version'}
                  </Button>
                  <Button variant="outlined" onClick={onUseSaved}>
                    Use saved version
                  </Button>
                </>
              )}
              <Button
                variant="outlined"
                onClick={onSaveMine}
                disabled={editor.saving || !length || tooLong}
              >
                {conflict.current
                  ? 'Save mine instead'
                  : 'Save mine as a new answer'}
              </Button>
            </Stack>
          </Stack>
        </Alert>
      )}
      {editor.error && (
        <Alert
          severity="error"
          action={
            <Button
              startIcon={<RefreshIcon />}
              color="inherit"
              onClick={onSave}
            >
              Retry
            </Button>
          }
        >
          {editor.error}
        </Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button
          startIcon={<SaveIcon />}
          variant="contained"
          onClick={onSave}
          disabled={editor.saving || !!conflict || !length || tooLong}
        >
          {editor.saving ? 'Saving…' : 'Save answer'}
        </Button>
        <Button variant="outlined" onClick={onCancel} disabled={editor.saving}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  );
}

function RemoveDialog({
  open,
  onKeep,
  onRemove,
}: {
  open: boolean;
  onKeep: () => void;
  onRemove: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Remove prepared answer?"
      text="Your saved answer for this question will be removed. This can't be undone. The question stays in the list as Not prepared."
      safeLabel="Keep answer"
      confirmLabel="Remove"
      destructive
      onSafe={onKeep}
      onConfirm={onRemove}
    />
  );
}

export function UnsavedAnswerDialog({
  open,
  onStay,
  onDiscard,
  transcript = false,
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
  /** PR16: only an unsaved practice transcript is at stake. */
  transcript?: boolean;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={
        transcript ? 'Discard your transcript?' : 'Discard your unsaved answer?'
      }
      text={
        transcript
          ? "Your practice transcript isn't saved anywhere. Leaving this question clears it."
          : "You changed your reference answer but didn't save it. Your saved answer, if any, stays as it was."
      }
      safeLabel="Stay and edit"
      confirmLabel="Discard changes"
      destructive
      onSafe={onStay}
      onConfirm={onDiscard}
    />
  );
}

/** One numbered step of the Prepare → Save → Practice flow. */
export function Step({
  n,
  id,
  title,
  intro,
  children,
}: {
  n: number;
  id: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={id}
      sx={{ p: { xs: 2, sm: 3 } }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box
            aria-hidden="true"
            sx={{
              flexShrink: 0,
              width: 28,
              height: 28,
              mt: 0.25,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 14,
              fontWeight: 600,
              color: 'primary.main',
              border: 1,
              borderColor: 'primary.main',
            }}
          >
            {n}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              id={id}
              variant="h6"
              component="h2"
              tabIndex={-1}
              sx={{ '&:focus': { outline: 'none' }, scrollMarginTop: 16 }}
            >
              <Box
                component="span"
                sx={{ position: 'absolute', left: -9999 }}
              >{`Step ${n}: `}</Box>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {intro}
            </Typography>
          </Box>
        </Stack>
        {children}
      </Stack>
    </Paper>
  );
}

/**
 * Steps 2 and 3 for one question: Save your reference answer (load state,
 * Finalize/Edit, inline editor) and Practice speaking (Read Along / Speak Freely).
 */
export function ReferenceAnswer(props: {
  status: 'loading' | 'error' | 'ready';
  saved: SavedAnswer | undefined;
  editor: AnswerEditor | null;
  view: PracticeView;
  revealed: boolean;
  recorder: ReactNode;
  notice: string | null;
  onRetryLoad: () => void;
  onFinalize: () => void;
  onEditorChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onShowSaved: () => void;
  onUseSaved: () => void;
  onSaveMine: () => void;
  onView: (view: PracticeView) => void;
  onReveal: () => void;
  onRemove: () => Promise<void>;
  justSaved: boolean;
  onStartPractice: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { status, saved, editor } = props;
  const practising = status === 'ready' && !!saved && !editor;
  let body: ReactNode;
  if (status === 'loading')
    body = (
      <Typography role="status" color="text.secondary">
        Loading your saved answers…
      </Typography>
    );
  else if (status === 'error')
    body = (
      <Alert
        severity="error"
        action={
          <Button
            startIcon={<RefreshIcon />}
            color="inherit"
            onClick={props.onRetryLoad}
          >
            Retry
          </Button>
        }
      >
        Your saved answers couldn't be loaded, so saving is paused. AI help
        above and speaking practice below still work.
      </Alert>
    );
  else if (editor?.origin === 'feedback')
    body = (
      <Typography color="text.secondary" role="status">
        You're editing your answer under Feedback above.
      </Typography>
    );
  else if (editor)
    body = (
      <Editor
        editor={editor}
        onChange={props.onEditorChange}
        onSave={props.onSave}
        onCancel={props.onCancel}
        onShowSaved={props.onShowSaved}
        onUseSaved={props.onUseSaved}
        onSaveMine={props.onSaveMine}
      />
    );
  else if (!saved)
    body = (
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography color="text.secondary">
          Start from your own words or the AI suggestion. Nothing is saved until
          you choose Save.
        </Typography>
        <Button
          startIcon={<CheckIcon />}
          variant="contained"
          onClick={props.onFinalize}
        >
          Finalize answer
        </Button>
      </Stack>
    );
  else
    body = (
      <Stack spacing={1.5}>
        {props.justSaved ? (
          <SavedPrompt onStart={props.onStartPractice} />
        ) : (
          <Typography color="text.secondary">
            Saved. Practise it below, or edit it any time.
          </Typography>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            startIcon={<EditIcon />}
            variant="outlined"
            onClick={props.onFinalize}
          >
            Edit answer
          </Button>
          <Button
            startIcon={<DeleteIcon />}
            variant="text"
            color="inherit"
            onClick={() => setConfirming(true)}
          >
            Remove prepared answer
          </Button>
        </Stack>
        <RemoveDialog
          open={confirming}
          onKeep={() => setConfirming(false)}
          onRemove={() => {
            setConfirming(false);
            void props.onRemove();
          }}
        />
      </Stack>
    );
  return (
    <>
      <Step
        n={2}
        id="reference-answer"
        title="Save your reference answer"
        intro="Keep a version you feel comfortable saying."
      >
        {props.notice && (
          <Alert severity="info" role="status">
            {props.notice}
          </Alert>
        )}
        {body}
      </Step>
      <Step
        n={3}
        id="speaking-practice"
        title="Practice speaking"
        intro="Read along first, then try without looking."
      >
        {practising ? (
          <Stack spacing={2}>
            <ToggleButtonGroup
              exclusive
              value={props.view}
              onChange={(_e, v: PracticeView | null) => v && props.onView(v)}
              aria-label="Practice mode"
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton
                value="read"
                sx={{ textTransform: 'none', minHeight: 44 }}
              >
                Read Along
              </ToggleButton>
              <ToggleButton
                value="free"
                sx={{ textTransform: 'none', minHeight: 44 }}
              >
                Speak Freely
              </ToggleButton>
            </ToggleButtonGroup>
            {props.view === 'read' || props.revealed ? (
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'action.hover' }}>
                <Typography sx={pre} lang="en">
                  {saved.answer}
                </Typography>
              </Paper>
            ) : (
              <Typography color="text.secondary">
                Your answer is hidden. Say it in your own words — paraphrasing
                is fine.
              </Typography>
            )}
            {props.view === 'free' && (
              <Box>
                <Button
                  variant="text"
                  onClick={props.onReveal}
                  aria-expanded={props.revealed}
                >
                  {props.revealed ? 'Hide answer' : 'Show answer'}
                </Button>
              </Box>
            )}
            {props.recorder}
          </Stack>
        ) : status === 'error' ? (
          // PR16: speaking needs only the question, never the saved-answer list.
          // No saved text is shown, so nothing stale can appear.
          <Stack spacing={2}>
            <Typography color="text.secondary">
              Read Along is unavailable until your saved answers load. You can
              still record, transcribe or type your answer, and get AI feedback.
            </Typography>
            {props.recorder}
          </Stack>
        ) : (
          <Typography color="text.secondary">
            Saving a reference answer unlocks Read Along and Speak Freely. You
            can already try speaking in step 1.
          </Typography>
        )}
      </Step>
    </>
  );
}

/** After Save: focus the button without scrolling; only activating it starts practice. */
export function SavedPrompt({ onStart }: { onStart: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus({ preventScroll: true }), []);
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
      <Typography role="status" sx={{ fontWeight: 600 }}>
        Answer saved. Ready to practise?
      </Typography>
      <Button
        startIcon={<MicIcon />}
        ref={button}
        variant="contained"
        onClick={onStart}
      >
        Start speaking practice
      </Button>
    </Stack>
  );
}
