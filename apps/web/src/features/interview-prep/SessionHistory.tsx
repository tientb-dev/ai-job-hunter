import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { RefreshIcon } from '../../components/icons';
import { PracticeError } from './interview-prep-api';
import { listSessions, type PastSession } from './mock-interview-api';

/** Finished interviews; each row opens the existing summary via ?session=. */
export function SessionHistory() {
  const [items, setItems] = useState<PastSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    listSessions(controller.signal).then(setItems, (e: unknown) => {
      if (!controller.signal.aborted)
        setError(
          e instanceof PracticeError
            ? e.message
            : 'Something went wrong. Try again.',
        );
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-labelledby="past-interviews"
      sx={{ p: { xs: 2, sm: 3 } }}
    >
      <Stack spacing={2}>
        <Typography id="past-interviews" variant="h6" component="h2">
          Past interviews
        </Typography>
        {error ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                startIcon={<RefreshIcon />}
                onClick={() => {
                  setError(null);
                  setItems(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Retry
              </Button>
            }
          >
            {error}
          </Alert>
        ) : items === null ? (
          <LinearProgress aria-label="Loading past interviews" />
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No finished interviews yet.
          </Typography>
        ) : (
          <List disablePadding aria-labelledby="past-interviews">
            {items.map((s) => (
              <ListItemButton
                key={s.id}
                component={Link}
                to={`/interview-prep/mock?session=${s.id}`}
                divider
                sx={{ px: 1, minHeight: 44 }}
              >
                <ListItemText
                  primary={
                    s.source === 'job'
                      ? (s.jobTitle ?? 'Job interview')
                      : 'Interview Prep questions'
                  }
                  secondary={`${new Date(s.updatedAt).toLocaleString(
                    undefined,
                    {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    },
                  )} · ${s.summary.answered} of ${s.summary.total} answered · ${s.summary.withFeedback} with AI feedback`}
                  slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Stack>
    </Paper>
  );
}
