import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { tr } from '../../app/i18n';
import {
  BODY,
  isSafeOrder,
  type DraftDocument,
  type OrderDecision,
} from './tailored-cv.contract';

type Entry = DraftDocument['sections'][number]['entries'][number];

/** Role or project title of an entry, for the card heading. */
function entryTitle(entry: Entry) {
  const pick = (field: string) =>
    entry.facts.find((f) => f.field === field)?.acceptedText.trim();
  return [pick('role') ?? pick('project'), pick('employer')]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One card per Experience/Projects entry with a safe stored order suggestion.
 * Decisions go through the shared `order` review operation; nothing here
 * changes text, and the suggestion never blocks approval.
 */
export function OrderSuggestions({
  document,
  disabled,
  onDecide,
}: {
  /** The draft with queued (unsaved) operations already applied. */
  document: DraftDocument;
  disabled: boolean;
  onDecide: (entryId: string, decision: OrderDecision) => void;
}) {
  const entries = document.sections
    .filter((s) => s.kind === 'experience' || s.kind === 'projects')
    .flatMap((s) => s.entries)
    .filter(
      (e) =>
        e.orderProposal &&
        isSafeOrder(e.facts, e.orderProposal.factIds) &&
        isSafeOrder(e.facts, e.orderProposal.originalFactIds),
    );
  if (!entries.length) return null;
  return (
    <Box
      component="section"
      aria-labelledby="order-suggestions-title"
      sx={{ mt: 2 }}
    >
      <Typography id="order-suggestions-title" variant="h6" component="h3">
        {tr('Suggested bullet order')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {tr(
          'Optional. Moves your most job-relevant bullets up within a role. Wording, roles and dates stay the same.',
        )}
      </Typography>
      <Stack spacing={2}>
        {entries.map((entry, index) => (
          <OrderCard
            key={entry.id}
            entry={entry}
            index={index}
            decision={document.review.orders?.[entry.id]}
            disabled={disabled}
            onDecide={(d) => onDecide(entry.id, d)}
          />
        ))}
      </Stack>
    </Box>
  );
}

function OrderCard({
  entry,
  index,
  decision,
  disabled,
  onDecide,
}: {
  entry: Entry;
  index: number;
  decision: 'accepted' | 'rejected' | undefined;
  disabled: boolean;
  onDecide: (decision: OrderDecision) => void;
}) {
  const proposal = entry.orderProposal!;
  const text = new Map(entry.facts.map((f) => [f.id, f.acceptedText]));
  const field = new Map(entry.facts.map((f) => [f.id, f.field]));
  const bullets = (ids: string[]) =>
    ids.filter((id) => BODY.has(field.get(id)!));
  const original = bullets(proposal.originalFactIds);
  const proposed = bullets(proposal.factIds);
  const title = entryTitle(entry) || tr('Entry {n}', { n: index + 1 });
  const id = `order-${entry.id}`;
  const status =
    decision === 'accepted'
      ? tr('Suggested order applied.')
      : decision === 'rejected'
        ? tr('Original order kept.')
        : tr('Not decided. The original order is used until you choose.');
  const list = (ids: string[], label: string, mark: boolean) => (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        variant="subtitle2"
        component="h5"
        id={`${id}-${mark ? 'new' : 'old'}`}
      >
        {label}
      </Typography>
      <Box
        component="ol"
        aria-labelledby={`${id}-${mark ? 'new' : 'old'}`}
        sx={{ pl: 3, my: 0.5 }}
      >
        {ids.map((factId, i) => {
          const up = mark && i < original.indexOf(factId);
          const why = proposal.reasons[factId] ?? [];
          return (
            <Box component="li" key={factId} sx={{ mb: 1 }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {text.get(factId)}
              </Typography>
              {up && (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={tr('Moved up')}
                  />
                  {why.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {tr('Matches: {reasons}', { reasons: why.join(', ') })}
                    </Typography>
                  )}
                </Stack>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
  return (
    <Paper
      variant="outlined"
      component="article"
      aria-labelledby={`${id}-title`}
      sx={{ p: { xs: 2, sm: 2.5 } }}
    >
      <Typography
        id={`${id}-title`}
        variant="subtitle1"
        component="h4"
        sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
      >
        {title}
      </Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1 }}>
        {list(original, tr('Original order'), false)}
        {list(proposed, tr('Suggested order'), true)}
      </Stack>
      <Typography variant="body2" role="status" sx={{ mt: 1 }}>
        {status}
      </Typography>
      {/* Both buttons always render so the card keeps its size between states. */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
        {decision === 'accepted' ? (
          <Button
            variant="outlined"
            disabled={disabled}
            onClick={() => onDecide('restore')}
          >
            {tr('Restore original order')}
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={disabled}
            onClick={() => onDecide('accept')}
          >
            {tr('Apply suggested order')}
          </Button>
        )}
        <Button
          variant="text"
          disabled={disabled || decision !== undefined}
          onClick={() => onDecide('reject')}
        >
          {tr('Keep original order')}
        </Button>
      </Stack>
    </Paper>
  );
}
