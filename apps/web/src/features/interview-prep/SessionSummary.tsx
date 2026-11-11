import { useState } from 'react';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { ConfirmDialog } from './ConfirmDialog';
import { useNotify } from '../../components/useNotify';
import {
  AnswerConflictError,
  PracticeError,
  saveAnswer,
} from './interview-prep-api';
import type { MockSession, SessionItem } from './mock-interview-api';

const VERDICT = { yes: 'Yes', partly: 'Partly', no: 'No' } as const;

/** End-of-interview review: answers, optional feedback, save, delete. */
export function SessionSummary({
  session,
  pending,
  onNew,
  onDelete,
}: {
  session: MockSession;
  pending: boolean;
  onNew: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const { total, answered, skipped, unanswered, withFeedback } =
    session.summary;
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            Interview summary
          </Typography>
          <Typography>
            {answered} of {total} answered · {skipped} skipped · {unanswered}{' '}
            unanswered · {withFeedback} with AI feedback
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ alignItems: { sm: 'center' } }}
          >
            <Button variant="contained" onClick={onNew} disabled={pending}>
              Start another interview
            </Button>
            <Button
              variant="outlined"
              color="error"
              onClick={() => setConfirm(true)}
              disabled={pending}
            >
              Delete interview
            </Button>
          </Stack>
        </Stack>
      </Paper>
      {session.items.map((item, i) => (
        <SummaryItem key={item.questionId} item={item} number={i + 1} />
      ))}
      <ConfirmDialog
        open={confirm}
        title="Delete this interview?"
        text="Its answers and feedback are deleted. Reference answers you already saved are kept. This can’t be undone."
        safeLabel="Keep interview"
        confirmLabel="Delete"
        destructive
        onSafe={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          onDelete();
        }}
      />
    </Stack>
  );
}

type SaveState =
  | { kind: 'idle' | 'saving' | 'saved' }
  | { kind: 'conflict'; version: number | null }
  | { kind: 'error'; message: string };

function SummaryItem({ item, number }: { item: SessionItem; number: number }) {
  const notify = useNotify();
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const f = item.feedback;
  const save = async (expectedVersion: number | null) => {
    if (item.answer === null) return;
    setState({ kind: 'saving' });
    try {
      await saveAnswer(item.questionId, item.answer, expectedVersion);
      setState({ kind: 'saved' });
      notify({ severity: 'success', text: 'Saved as reference answer.' });
    } catch (e) {
      setState(
        e instanceof AnswerConflictError
          ? { kind: 'conflict', version: e.current?.version ?? null }
          : {
              kind: 'error',
              message:
                e instanceof PracticeError
                  ? e.message
                  : 'The answer could not be saved. Try again.',
            },
      );
    }
  };
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby={`q-${number}`}
      sx={{ p: { xs: 2, sm: 3 } }}
    >
      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          Question {number}
        </Typography>
        <Typography
          id={`q-${number}`}
          variant="subtitle1"
          component="h3"
          lang="en"
          sx={{ fontWeight: 600 }}
        >
          {item.questionText}
        </Typography>
        {item.answer === null ? (
          <Typography variant="body2" color="text.secondary">
            {item.skipped ? 'Skipped' : 'Not answered (interview ended early)'}
          </Typography>
        ) : (
          <Typography lang="en" sx={{ whiteSpace: 'pre-wrap' }}>
            {item.answer}
          </Typography>
        )}
        {f && (
          <Stack spacing={0.5}>
            {f.answersQuestion && (
              <Typography variant="body2">
                <strong>Answers the question:</strong>{' '}
                {VERDICT[f.answersQuestion]}
              </Typography>
            )}
            {f.mainIssue && (
              <Typography variant="body2">
                <strong>Main issue:</strong> {f.mainIssue}
              </Typography>
            )}
            {f.suggestion && (
              <Typography variant="body2" lang="en">
                <strong>Suggested wording:</strong> {f.suggestion}
              </Typography>
            )}
          </Stack>
        )}
        {item.answer !== null && (
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            {state.kind === 'saved' ? (
              <Typography variant="body2" color="success.main" role="status">
                Saved as your reference answer.
              </Typography>
            ) : (
              state.kind !== 'conflict' && (
                <Button
                  variant="text"
                  disabled={state.kind === 'saving'}
                  onClick={() => void save(null)}
                >
                  Save as reference answer
                </Button>
              )
            )}
            {state.kind === 'conflict' && (
              <Alert
                severity="warning"
                action={
                  <Stack direction="row" spacing={1}>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => void save(state.version)}
                    >
                      Replace
                    </Button>
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => setState({ kind: 'idle' })}
                    >
                      Keep saved
                    </Button>
                  </Stack>
                }
              >
                You already have a reference answer for this question.
              </Alert>
            )}
            {state.kind === 'error' && (
              <Alert severity="error">{state.message}</Alert>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
