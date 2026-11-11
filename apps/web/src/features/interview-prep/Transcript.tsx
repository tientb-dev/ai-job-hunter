import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { ReactNode } from 'react';
import { MAX_ANSWER_CHARS, type PracticeFeedback } from './interview-prep-api';
import type { useTranscript } from './useTranscript';

export function TranscriptPanel({
  transcript: t,
  recording,
  questionId,
  variant,
  renderFeedback,
}: {
  transcript: ReturnType<typeof useTranscript>;
  recording: Blob | null;
  questionId: string;
  variant: number;
  /** The page's existing feedback view, so both paths look the same. */
  renderFeedback: (feedback: PracticeFeedback) => ReactNode;
}) {
  const count = t.text.length; // same count as the feedback field
  const over = count > MAX_ANSWER_CHARS;
  return (
    <Stack spacing={1} sx={{ pt: 1 }}>
      <Typography variant="subtitle2" component="h3">
        Transcript
      </Typography>
      {recording && (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          {t.busy ? (
            <Button variant="text" onClick={t.cancel}>
              Stop transcribing
            </Button>
          ) : (
            <Button
              variant="outlined"
              onClick={() => t.run(recording, questionId)}
            >
              Transcribe locally
            </Button>
          )}
          {t.busy && <CircularProgress size={18} aria-hidden="true" />}
          <Typography variant="body2" color="text.secondary" role="status">
            {t.status.kind === 'converting'
              ? 'Preparing audio…'
              : t.status.kind === 'transcribing'
                ? 'Transcribing on this computer…'
                : t.status.kind === 'idle' && t.status.done
                  ? 'Transcript ready. Check it and fix any mistakes.'
                  : ''}
          </Typography>
        </Stack>
      )}
      {recording && t.confirming && (
        <Alert
          severity="warning"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                color="inherit"
                size="small"
                onClick={() => t.replace(recording, questionId)}
              >
                Replace
              </Button>
              <Button color="inherit" size="small" onClick={t.keep} autoFocus>
                Keep my text
              </Button>
            </Stack>
          }
        >
          Replace your edited transcript with a new transcription?
        </Alert>
      )}
      {t.status.kind === 'error' && (
        // Retry is the "Transcribe locally" button above: one path only.
        <Alert severity="info">{t.status.message}</Alert>
      )}
      <TextField
        label="Transcript (edit it, or type your answer)"
        multiline
        minRows={3}
        value={t.text}
        onChange={(e) => t.edit(e.target.value)}
        error={over}
        helperText={
          over
            ? `${count}/${MAX_ANSWER_CHARS} · AI feedback needs ${MAX_ANSWER_CHARS} characters or fewer. Shorten the transcript first; nothing is cut automatically.`
            : `${count}/${MAX_ANSWER_CHARS}`
        }
        slotProps={{ htmlInput: { lang: 'en' } }}
        fullWidth
      />
      <Box>
        <Button
          variant="contained"
          onClick={() => void t.askFeedback(questionId, variant)}
          disabled={
            !t.text.trim() || over || t.busy || t.feedback.kind === 'loading'
          }
        >
          Get AI feedback
        </Button>
      </Box>
      {t.feedback.kind === 'loading' && (
        <Stack spacing={1} role="status">
          <LinearProgress aria-label="Waiting for feedback" />
          <Typography variant="body2" color="text.secondary">
            Checking with the local AI… usually under 10 seconds.
          </Typography>
        </Stack>
      )}
      {t.feedback.kind === 'error' && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              onClick={() => void t.askFeedback(questionId, variant)}
              disabled={!t.text.trim() || over}
            >
              Retry
            </Button>
          }
        >
          {t.feedback.message}
        </Alert>
      )}
      {t.feedback.kind === 'done' && (
        <Stack
          component="section"
          aria-label="Feedback on your transcript"
          spacing={2}
        >
          {/* Old feedback is hidden, never shown beside newer text. */}
          {t.outdated ? (
            <Alert severity="warning">
              Outdated: you changed the transcript after this feedback. Get AI
              feedback again for the current text.
            </Alert>
          ) : (
            renderFeedback(t.feedback.feedback)
          )}
        </Stack>
      )}
      <Box>
        <Typography variant="caption" color="text.secondary">
          Transcribe locally sends this recording to this app&apos;s own server
          on your computer, which turns it into text there. Audio and
          transcripts are not saved.
        </Typography>
      </Box>
    </Stack>
  );
}
