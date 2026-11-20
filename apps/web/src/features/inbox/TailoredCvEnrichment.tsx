import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { tr } from '../../app/i18n';
import { useNotify } from '../../components/useNotify';
import {
  draftRequest,
  type ClarificationOperation,
  type DraftFact,
  type SavedDraft,
} from './tailored-cv.contract';

export function ClarificationCard({
  fact,
  original,
  where,
  disabled,
  wording = 'reviewed_profile',
  proposalPending = false,
  requirements,
  onDecision,
}: {
  fact: DraftFact;
  original: string;
  where: string;
  disabled: boolean;
  wording?: 'reviewed_profile' | 'user_edited' | 'ai_accepted';
  proposalPending?: boolean;
  requirements?: string[];
  onDecision: (operation: ClarificationOperation) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const question = fact.clarification!;
  const [answer, setAnswer] = useState(question.answer ?? '');
  const prompt = {
    impact: /\b(?:workflows?|automation|automat\w*)\b/iu.test(original)
      ? tr(
          'Did this change the time or manual steps involved? Share what you observed, if anything.',
        )
      : /\b(?:reports?|reporting)\b/iu.test(original)
        ? tr('What changed in the reporting process, if anything you observed?')
        : tr('What changed after this work, if anything you can substantiate?'),
    scale: tr(
      'What was the scale of this work, such as users, customers, or records, if known?',
    ),
    ownership: tr('What part of this work did you personally handle?'),
  }[question.kind];
  const replacing =
    question.status === 'confirmed' && wording !== 'reviewed_profile';
  const invalid = /[[\]\p{Cc}\p{Cf}]/u.test(answer.trim());
  return (
    <Paper variant="outlined" sx={{ p: 2, overflowWrap: 'anywhere' }}>
      <Stack spacing={1}>
        <Typography variant="subtitle2" component="h4">
          {where}
        </Typography>
        <Typography variant="subtitle2">{tr('Documented wording')}</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {original}
        </Typography>
        <Typography>{question.question ?? prompt}</Typography>
        {question.explanation && (
          <Typography variant="body2">{question.explanation}</Typography>
        )}
        {!!requirements?.length && (
          <Typography variant="body2" color="text.secondary">
            {tr('Related job requirement: {requirement}', {
              requirement: requirements.join(' · '),
            })}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {tr(
            'A detail from your experience can help the employer understand this work. Qualitative results are welcome.',
          )}
        </Typography>
        {question.status === 'skipped' && (
          <Typography variant="body2">{tr('Skipped')}</Typography>
        )}
        {question.status === 'no_metrics' && (
          <Typography variant="body2">{tr('No metrics available')}</Typography>
        )}
        {question.answer && (
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">
              {tr('Confirmed by you for this draft')}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {question.answer}
            </Typography>
            {replacing && (
              <>
                <Typography variant="subtitle2">
                  {wording === 'ai_accepted'
                    ? tr('Current accepted rewrite')
                    : tr('Current edited wording')}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {fact.acceptedText}
                </Typography>
              </>
            )}
            <Typography variant="subtitle2">
              {tr('Proposed wording')}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {`${original.trimEnd()}\n${question.addition ?? question.answer}`}
            </Typography>
            {question.status === 'confirmed' && proposalPending && (
              <Typography variant="body2">
                {tr('Decide the rewrite suggestion before using this detail.')}
              </Typography>
            )}
            {question.status === 'included' && (
              <Typography variant="body2" color="success.main">
                {tr('Included in draft wording')}
              </Typography>
            )}
          </Stack>
        )}
        {editing && (
          <TextField
            label={tr('Your factual detail')}
            autoFocus
            multiline
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            slotProps={{
              htmlInput: {
                maxLength: Math.min(600, 3998 - original.trimEnd().length),
              },
            }}
            error={invalid}
            helperText={
              invalid
                ? tr('Remove brackets and enter only details you can confirm.')
                : tr(
                    'A short factual answer is enough. Say what changed, what was counted, or what you did.',
                  )
            }
            disabled={disabled}
          />
        )}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {editing ? (
            <>
              <Button
                variant="contained"
                disabled={disabled || invalid || !answer.trim()}
                onClick={async () => {
                  if (
                    await onDecision({
                      action: 'confirm_answer',
                      factId: fact.id,
                      text: answer.trim(),
                    })
                  )
                    setEditing(false);
                }}
              >
                {tr('Confirm this fact')}
              </Button>
              <Button disabled={disabled} onClick={() => setEditing(false)}>
                {tr('Cancel')}
              </Button>
            </>
          ) : (
            <>
              {question.status === 'confirmed' && (
                <Button
                  variant="contained"
                  disabled={disabled || proposalPending}
                  onClick={() =>
                    void onDecision({
                      action: replacing ? 'replace_with_answer' : 'use_answer',
                      factId: fact.id,
                    })
                  }
                >
                  {replacing
                    ? tr('Replace current wording and use this detail')
                    : tr('Use this wording')}
                </Button>
              )}
              <Button
                variant="outlined"
                disabled={disabled}
                onClick={() => {
                  setAnswer(question.answer ?? '');
                  setEditing(true);
                }}
              >
                {question.answer
                  ? tr('Edit confirmed detail')
                  : tr('Provide details')}
              </Button>
              {!question.question &&
                question.status !== 'no_metrics' &&
                question.status !== 'included' && (
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      void onDecision({ action: 'no_metrics', factId: fact.id })
                    }
                  >
                    {tr('No metrics available')}
                  </Button>
                )}
              {question.status !== 'skipped' && (
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void onDecision({
                      action: 'skip_question',
                      factId: fact.id,
                    })
                  }
                >
                  {question.answer ? tr('Discard detail') : tr('Skip')}
                </Button>
              )}
            </>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

interface SourceDiff {
  profileRevision: number;
  changes: { factId: string; before: string; after: string }[];
}

function decodeSourceDiff(value: unknown): SourceDiff {
  const diff = value as SourceDiff | null;
  if (
    !diff ||
    !Number.isSafeInteger(diff.profileRevision) ||
    !Array.isArray(diff.changes) ||
    diff.changes.some(
      (change) =>
        !change ||
        typeof change.factId !== 'string' ||
        typeof change.before !== 'string' ||
        typeof change.after !== 'string',
    )
  )
    throw new Error(tr('Could not load source CV changes.'));
  return diff;
}

export function SourceCvUpdate({
  draft,
  disabled,
  onUpdated,
}: {
  draft: SavedDraft;
  disabled: boolean;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [diff, setDiff] = useState<SourceDiff | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const notify = useNotify();
  const path = `/drafts/${draft.id}/source-update`;
  async function load() {
    setError('');
    setBusy(true);
    setSelected([]);
    try {
      setDiff(
        decodeSourceDiff(
          await draftRequest(`${path}/preview`, {
            expectedDraftRevision: draft.revision,
          }),
        ),
      );
    } catch {
      setDiff(null);
      setError(
        tr(
          'Could not load source CV changes. Refresh the comparison to check the current source review.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!diff || !selected.length) return;
    setBusy(true);
    try {
      await draftRequest(path, {
        expectedDraftRevision: draft.revision,
        expectedProfileRevision: diff.profileRevision,
        factIds: selected,
      });
      setOpen(false);
      setDiff(null);
      onUpdated();
      notify({
        severity: 'success',
        text: tr('Selected improvements saved to your source CV review.'),
      });
    } catch {
      setDiff(null);
      setError(
        tr('Refresh and review the source comparison before trying again.'),
      );
      notify({
        severity: 'error',
        title: tr('Could not update the source CV review.'),
        text: tr(
          'Refresh and review the source comparison before trying again.',
        ),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1} sx={{ overflowWrap: 'anywhere' }}>
      <FormControlLabel
        label={tr('Also update my source CV')}
        control={
          <Checkbox
            checked={open}
            disabled={disabled || busy}
            onChange={(event) => {
              setOpen(event.target.checked);
              if (event.target.checked) void load();
            }}
          />
        }
      />
      {open && (
        <>
          {busy && (
            <Typography role="status" variant="body2">
              {tr('Checking source CV…')}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {error && (
            <Button disabled={disabled || busy} onClick={() => void load()}>
              {tr('Refresh source comparison')}
            </Button>
          )}
          {diff?.changes.length === 0 && (
            <Typography>
              {tr('No eligible changes for the current source CV review.')}
            </Typography>
          )}
          {diff?.changes.map(({ factId, before, after }) => (
            <Paper key={factId} variant="outlined" sx={{ p: 2 }}>
              <FormControlLabel
                label={tr('Apply this improvement')}
                control={
                  <Checkbox
                    checked={selected.includes(factId)}
                    disabled={disabled || busy}
                    onChange={(event) =>
                      setSelected((old) =>
                        event.target.checked
                          ? [...old, factId]
                          : old.filter((id) => id !== factId),
                      )
                    }
                  />
                }
              />
              <Typography variant="subtitle2">{tr('Before')}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {before}
              </Typography>
              <Typography variant="subtitle2" sx={{ mt: 1 }}>
                {tr('After')}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {after}
              </Typography>
            </Paper>
          ))}
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
          >
            {!!diff?.changes.length && (
              <Button
                variant="contained"
                disabled={disabled || busy || !selected.length}
                onClick={() => void apply()}
              >
                {tr('Confirm source CV update')}
              </Button>
            )}
            <Button disabled={busy} onClick={() => setOpen(false)}>
              {tr('Cancel')}
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}
