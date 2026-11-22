import { tr } from '../../app/i18n';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

// Compare exact token sequences; never normalize or alter either source string.
function wordingDiff(original: string, suggestion: string) {
  const a = original.match(/\S+\s*|\s+/gu) ?? [];
  const b = suggestion.match(/\S+\s*|\s+/gu) ?? [];
  const width = b.length + 1;
  const lengths = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i * width + j] =
        a[i] === b[j]
          ? 1 + lengths[(i + 1) * width + j + 1]!
          : Math.max(
              lengths[(i + 1) * width + j]!,
              lengths[i * width + j + 1]!,
            );
  const removed = new Set<number>(),
    added = new Set<number>();
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length ||
        lengths[i * width + j + 1]! >= lengths[(i + 1) * width + j]!)
    )
      added.add(j++);
    else removed.add(i++);
  }
  return {
    original: a.map((text, index) => ({ text, changed: removed.has(index) })),
    suggestion: b.map((text, index) => ({ text, changed: added.has(index) })),
  };
}

const textBox = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  m: 0,
} as const;

export function ProposalComparison({
  original,
  suggestion,
  proposal,
  manuallyEdited,
  where,
  why,
  needsCheck,
  reviewNote,
  evidence,
  disabled,
  onDecision,
  requiresConfirmation = false,
  confirmationAssertion,
}: {
  original: string;
  suggestion: string;
  proposal: 'pending' | 'accepted' | 'rejected' | 'none';
  manuallyEdited: boolean;
  /** Human-readable location, e.g. "Experience 2 · Description". */
  where: string;
  why?: string;
  /** Reason this rewrite needs the user's check; never hidden when present. */
  needsCheck?: string;
  /** Standing meaning-review reminder from the backend; shown, never hidden. */
  reviewNote?: string;
  evidence?: ReactNode;
  disabled: boolean;
  requiresConfirmation?: boolean;
  /** The claim the user must confirm before accepting. */
  confirmationAssertion?: string;
  onDecision: (decision: 'accept' | 'reject', confirmed?: boolean) => void;
}) {
  const [changing, setChanging] = useState(false);
  // Never preselected; a new suggestion text needs a new confirmation.
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const isConfirmed = confirmed === suggestion && !!confirmationAssertion;
  const diff = useMemo(
    () => wordingDiff(original, suggestion),
    [original, suggestion],
  );
  const deciding = proposal === 'pending' || changing;
  const status =
    proposal === 'pending'
      ? needsCheck
        ? tr('Needs your check')
        : tr('Waiting for you')
      : manuallyEdited
        ? tr('Edited by you')
        : proposal === 'accepted'
          ? tr('Accepted')
          : tr('Original kept');
  const decide = (decision: 'accept' | 'reject') => {
    onDecision(
      decision,
      decision === 'accept' && requiresConfirmation ? isConfirmed : undefined,
    );
    setChanging(false);
    setConfirmed(null);
  };
  return (
    <Paper
      component="article"
      variant="outlined"
      aria-label={tr('Suggestion for {where}', { where: where })}
      sx={{
        p: { xs: 2, sm: 2.5 },
        minWidth: 0,
        borderColor:
          proposal === 'pending' && needsCheck ? 'warning.main' : undefined,
      }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography
            variant="subtitle1"
            component="h4"
            sx={{ fontWeight: 600 }}
          >
            {where}
          </Typography>
          <Chip
            size="small"
            label={status}
            color={
              proposal === 'pending'
                ? needsCheck
                  ? 'warning'
                  : 'default'
                : 'success'
            }
            variant={
              proposal === 'pending' && needsCheck ? 'filled' : 'outlined'
            }
          />
        </Stack>
        {deciding ? (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  md: 'repeat(2, minmax(0, 1fr))',
                },
                gap: 1.5,
              }}
            >
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Typography variant="caption" color="text.secondary">
                  {tr('Your original')}
                </Typography>
                <Typography sx={textBox}>{original}</Typography>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.selected' }}>
                <Typography variant="caption" color="text.secondary">
                  {tr('Suggested')}
                </Typography>
                <Typography sx={textBox}>{suggestion}</Typography>
              </Box>
            </Box>
            {why && (
              <Typography variant="body2">
                <Box component="strong">{tr('Why:')}</Box> {why}
              </Typography>
            )}
            {reviewNote && (
              <Typography variant="body2" color="text.secondary">
                {reviewNote}
              </Typography>
            )}
            {requiresConfirmation ? (
              <Alert severity="warning" variant="outlined">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {tr(
                    'This suggestion includes a detail your CV does not show.',
                  )}
                </Typography>
                {confirmationAssertion && (
                  <Typography variant="body2" sx={textBox}>
                    {tr('Detail to check: {assertion}', {
                      assertion: confirmationAssertion,
                    })}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {tr(
                    'If it is true, confirm and accept. If it is partly true, use Edit wording to remove or correct the detail. If it is not true, keep your original.',
                  )}
                </Typography>
                {confirmationAssertion && (
                  <FormControlLabel
                    sx={{ mt: 0.5 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={isConfirmed}
                        disabled={disabled}
                        onChange={(event) =>
                          setConfirmed(event.target.checked ? suggestion : null)
                        }
                      />
                    }
                    label={tr(
                      'I confirm this information is true to my actual experience.',
                    )}
                  />
                )}
              </Alert>
            ) : (
              needsCheck && (
                <Alert severity="warning" variant="outlined">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {tr('Check this before accepting.')}
                  </Typography>
                  <Typography variant="body2">{needsCheck}</Typography>
                </Alert>
              )
            )}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <Button
                variant="outlined"
                disabled={disabled || (requiresConfirmation && !isConfirmed)}
                aria-label={
                  requiresConfirmation
                    ? tr('Confirm and accept suggestion for {where}', {
                        where: where,
                      })
                    : tr('Accept suggestion for {where}', { where: where })
                }
                onClick={() => decide('accept')}
              >
                {requiresConfirmation
                  ? tr('Confirm and accept')
                  : tr('Accept suggestion')}
              </Button>
              <Button
                variant="outlined"
                disabled={disabled}
                aria-label={tr('Keep original for {where}', { where: where })}
                onClick={() => decide('reject')}
              >
                {tr('Keep original')}
              </Button>
              {changing && (
                <Button disabled={disabled} onClick={() => setChanging(false)}>
                  {tr('Cancel change')}
                </Button>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {tr(
                'Accept uses the suggested wording. Keep original keeps your CV wording unchanged. Either one counts as your decision.',
              )}
            </Typography>
          </>
        ) : (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{
              alignItems: { sm: 'center' },
              justifyContent: 'space-between',
            }}
          >
            <Typography variant="body2" color="text.secondary" sx={textBox}>
              {/* Edited wording wins: it is what the draft and exports use. */}
              {manuallyEdited
                ? tr('Using your own edited wording.')
                : proposal === 'accepted'
                  ? tr('Using the suggestion: {suggestion}', {
                      suggestion: suggestion,
                    })
                  : tr('Using your original: {original}', {
                      original: original,
                    })}
            </Typography>
            <Button
              disabled={disabled}
              aria-label={tr('Change decision for {where}', { where: where })}
              onClick={() => setChanging(true)}
              sx={{ flexShrink: 0 }}
            >
              {tr('Change decision')}
            </Button>
          </Stack>
        )}
        <Box component="details" sx={{ '& summary': { cursor: 'pointer' } }}>
          <Typography
            component="summary"
            variant="body2"
            color="primary"
            sx={{ py: 1 }}
          >
            {tr('Show evidence and word changes')}
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {tr(
                'AI wording for your review, not independently verified evidence. Removed words are struck through; added words are underlined.',
              )}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: {
                  xs: 'minmax(0, 1fr)',
                  md: 'repeat(2, minmax(0, 1fr))',
                },
                gap: 2,
              }}
            >
              {(['original', 'suggestion'] as const).map((kind) => (
                <Box key={kind} sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {kind === 'original' ? tr('Original') : tr('AI suggestion')}
                  </Typography>
                  <Typography variant="body2" sx={textBox}>
                    {diff[kind].map((part, index) => (
                      <Box
                        key={index}
                        component={
                          part.changed
                            ? kind === 'original'
                              ? 'del'
                              : 'ins'
                            : 'span'
                        }
                        sx={
                          part.changed
                            ? {
                                bgcolor: 'action.selected',
                                fontWeight: 600,
                                textDecorationStyle:
                                  kind === 'original' ? 'solid' : 'double',
                              }
                            : undefined
                        }
                      >
                        {part.text}
                      </Box>
                    ))}
                  </Typography>
                </Box>
              ))}
            </Box>
            {evidence}
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
