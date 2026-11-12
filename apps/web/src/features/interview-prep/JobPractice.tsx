import { ArrowBackIcon, RefreshIcon } from '../../components/icons';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { PageHeader } from '../../components/PageHeader';
import { InterviewPrep } from './InterviewPrep';
import type { PracticeQuestion } from './interview-prep-api';
import {
  CATEGORY_LABELS,
  listJobQuestionSets,
  type JobQuestionSets,
} from './job-interview-api';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * /interview-prep/jobs/:jobId/sets/:setId?q=jd-<uuid>
 * Loads the job's sets through the owner-scoped API, checks that the set
 * belongs to this job and `q` to this set, then reuses the PR14 workspace.
 */
export function JobPractice() {
  const { jobId = '', setId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const valid = UUID.test(jobId) && UUID.test(setId);
  const [state, setState] = useState<
    { jobId: string; data: JobQuestionSets } | 'error' | null
  >(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    listJobQuestionSets(jobId, controller.signal).then(
      (data) => setState({ jobId, data }),
      () => {
        if (!controller.signal.aborted) setState('error');
      },
    );
    return () => controller.abort();
  }, [jobId, valid, attempt]);

  const loaded =
    state && state !== 'error' && state.jobId === jobId ? state.data : null;
  const index = loaded?.sets.findIndex((s) => s.id === setId) ?? -1;
  const set = index >= 0 ? loaded!.sets[index]! : null;
  const questions = useMemo<PracticeQuestion[]>(
    () =>
      (set?.questions ?? []).map((q) => ({
        id: q.id,
        topic: 'technical',
        category: CATEGORY_LABELS[q.category],
        kind: q.kind,
        variants: [q.question],
        hints: [],
      })),
    [set],
  );

  const back = valid ? `/jobs/${jobId}/interview` : '/jobs';
  const unavailable = (text: string, retry = false) => (
    <Stack spacing={3}>
      <PageHeader title="Interview practice" />
      <Alert
        severity={retry ? 'error' : 'info'}
        action={
          retry ? (
            <Button
              startIcon={<RefreshIcon />}
              color="inherit"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </Button>
          ) : undefined
        }
      >
        {text}
      </Alert>
      <Button
        startIcon={<ArrowBackIcon />}
        component={Link}
        to={back}
        variant="outlined"
        sx={{ alignSelf: 'flex-start' }}
      >
        {valid ? 'Back to job interview questions' : 'Back to Jobs'}
      </Button>
    </Stack>
  );

  if (!valid) return unavailable('This question set link is not valid.');
  if (state === 'error')
    return unavailable(
      'This question set could not be loaded. It may belong to a job that no longer exists.',
      true,
    );
  if (!loaded)
    return (
      <Stack spacing={1} role="status">
        <LinearProgress aria-label="Loading interview questions" />
        <Typography variant="body2" color="text.secondary">
          Loading interview questions…
        </Typography>
      </Stack>
    );
  if (!set || !questions.length)
    return unavailable("This question set isn't available for this job.");

  const q = params.get('q');
  // Missing or foreign ?q= opens the first question without a history entry.
  if (!questions.some((x) => x.id === q))
    return (
      <Navigate to={`?q=${encodeURIComponent(questions[0]!.id)}`} replace />
    );

  return (
    <InterviewPrep
      // A new question remounts the workspace, exactly like PR14's fresh state.
      key={q}
      job={{
        jobId,
        jobTitle: loaded.job.title,
        setLabel: set.active
          ? 'Current question set'
          : `Previous question set · ${new Date(set.createdAt).toLocaleString(
              undefined,
              { dateStyle: 'medium', timeStyle: 'short' },
            )}`,
        questions,
        context: Object.fromEntries(
          set.questions.map((x) => [
            x.id,
            { why: x.why, evidence: x.evidence },
          ]),
        ),
        questionId: q!,
        setId,
        onSelect: (id) => setParams({ q: id }),
      }}
    />
  );
}
