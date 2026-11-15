import { tr } from '../../app/i18n';
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import type { PartialFact } from './partial.types';

// Browser-only user decisions. Never an AI fact or a matching input.
export type UserFactReview =
  { status: 'confirmed' | 'edited'; value: string } | { status: 'rejected' };
const MAX_VALUE_LENGTH = 1000;
interface Props {
  original: PartialFact;
  label: string;
  review: UserFactReview | undefined;
  canUndo: boolean;
  onReview: (review: UserFactReview) => void;
  onUndo: () => void;
}
export function FactReviewControls({
  original,
  label,
  review,
  canUndo,
  onReview,
  onUndo,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);
  const accepted =
    review?.status === 'confirmed' || review?.status === 'edited';
  return (
    <Stack
      role="group"
      aria-label={tr('{label} review', { label: label })}
      spacing={1}
    >
      <Box role="status" aria-live="polite">
        {!review && (
          <Typography>
            {tr('Not user-confirmed. Excluded from accepted user facts.')}
          </Typography>
        )}
        {review && (
          <Chip
            label={
              review.status === 'confirmed'
                ? tr('User confirmed')
                : review.status === 'edited'
                  ? tr('User edited')
                  : tr('User rejected')
            }
            color={review.status === 'rejected' ? 'default' : 'primary'}
            size="small"
          />
        )}
        {accepted && (
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {tr('Accepted value:')} {review.value}
          </Typography>
        )}
        {review?.status === 'edited' && (
          <Typography variant="body2">
            {tr(
              'Accepted by you. This edited value is not claimed to be supported by the original AI quote.',
            )}
          </Typography>
        )}
        {review?.status === 'confirmed' && (
          <Typography variant="body2">
            {tr(
              'You accepted the original AI value. Its original validation and evidence are unchanged.',
            )}
          </Typography>
        )}
        {review?.status === 'rejected' && (
          <Typography variant="body2">
            {tr(
              'Excluded from accepted user facts. The original AI proposal and evidence remain above.',
            )}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          disabled={editing || accepted || !original.value?.trim()}
          onClick={() => {
            if (original.value?.trim())
              onReview({ status: 'confirmed', value: original.value });
          }}
        >
          {tr('Confirm')}
        </Button>
        <Button
          ref={editButton}
          disabled={editing}
          onClick={() => {
            setDraft(accepted ? review.value : (original.value ?? ''));
            setError('');
            restoreFocus.current = true;
            setEditing(true);
          }}
        >
          {tr('Edit')}
        </Button>
        <Button
          disabled={editing || review?.status === 'rejected'}
          onClick={() => onReview({ status: 'rejected' })}
        >
          {tr('Reject')}
        </Button>
        <Button disabled={editing || !canUndo} onClick={onUndo}>
          {tr('Undo')}
        </Button>
      </Stack>
      {editing && (
        <Box
          component="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) {
              setError(tr('Enter a nonempty value.'));
              return;
            }
            if (draft.length > MAX_VALUE_LENGTH) {
              setError(tr('Use at most 1,000 characters.'));
              return;
            }
            onReview({
              status: draft === original.value ? 'confirmed' : 'edited',
              value: draft,
            });
            setEditing(false);
          }}
        >
          <Stack spacing={1}>
            <TextField
              autoFocus
              fullWidth
              multiline
              label={tr('Value for {label}', { label: label })}
              value={draft}
              error={Boolean(error)}
              helperText={
                error ||
                tr(
                  'Saving explicitly accepts your value. The original AI proposal and evidence are preserved.',
                )
              }
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
            />
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained">
                {tr('Save')}
              </Button>
              <Button type="button" onClick={() => setEditing(false)}>
                {tr('Cancel')}
              </Button>
            </Stack>
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
