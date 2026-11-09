import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import type { SavedDraft } from './tailored-cv.contract';

interface DraftItem {
  id: string;
  revision: number;
  updatedAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/**
 * The open draft at a glance, plus a compact list to switch drafts.
 * Drafts are numbered oldest-first ("Draft 1") instead of showing raw ids.
 */
export function DraftPanel({
  items,
  saved,
  opening,
  latestReview,
  canSwitch,
  onGoToSwitch,
  disabled,
  dirty,
  hasMore,
  onLoadMore,
  onOpen,
}: {
  items: DraftItem[];
  saved: SavedDraft | null;
  opening: string | null;
  /** true: built from the current CV review; false: an earlier one; null: unknown. */
  latestReview: boolean | null;
  canSwitch: boolean;
  onGoToSwitch?: () => void;
  disabled: boolean;
  dirty: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onOpen: (item: DraftItem, label: string) => void;
}) {
  // shortcut: numbers count the loaded page (newest first), exact up to 20 drafts.
  const label = (index: number) => `Draft ${items.length - index}`;
  const openIndex = saved ? items.findIndex((i) => i.id === saved.id) : -1;
  const approved =
    !!saved && saved.document.review.approval?.revision === saved.revision;
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Current draft"
      sx={{ p: { xs: 2, sm: 2.5 } }}
    >
      <Stack spacing={1}>
        {saved ? (
          <>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ flexWrap: 'wrap', alignItems: 'center' }}
            >
              <Typography
                variant="subtitle1"
                component="h2"
                sx={{ fontWeight: 600 }}
              >
                {openIndex >= 0 ? label(openIndex) : 'Draft'} of {items.length}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={dirty ? 'warning' : approved ? 'success' : 'default'}
                label={
                  dirty
                    ? 'Unsaved changes'
                    : approved
                      ? 'Approved'
                      : 'Not approved'
                }
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Saved version {saved.revision} · last saved{' '}
              {when(saved.updatedAt)}
              {latestReview === true && ' · uses your latest CV review'}
              {latestReview === false && ' · uses an earlier CV review'}
            </Typography>
          </>
        ) : (
          <Typography variant="body2">
            {items.length} saved draft{items.length === 1 ? '' : 's'}. Open one
            to continue.
          </Typography>
        )}
        {!canSwitch && items.length > 1 && onGoToSwitch && (
          <Box>
            <Button size="small" onClick={onGoToSwitch}>
              Switch drafts in Tailor &amp; Review
            </Button>
            <Typography variant="body2" color="text.secondary">
              Drafts are switched and reviewed in Tailor &amp; Review; this step
              only approves and downloads the open draft.
            </Typography>
          </Box>
        )}
        {canSwitch && (items.length > 1 || !saved) && (
          <Box
            component="details"
            open={!saved}
            sx={{ '& summary': { cursor: 'pointer' } }}
          >
            <Typography
              component="summary"
              variant="body2"
              color="primary"
              sx={{ py: 0.5 }}
            >
              Switch draft ({items.length})
            </Typography>
            {dirty && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Save or discard your changes before switching drafts.
              </Typography>
            )}
            <Box
              component="ul"
              aria-label="Saved drafts"
              sx={{ listStyle: 'none', m: 0, mt: 1, p: 0 }}
            >
              {items.map((item, index) => {
                const current = item.id === saved?.id;
                return (
                  <li key={item.id}>
                    <Button
                      fullWidth
                      disabled={disabled || current}
                      aria-current={current ? 'true' : undefined}
                      onClick={() => onOpen(item, label(index))}
                      sx={{
                        justifyContent: 'space-between',
                        textAlign: 'left',
                        color: 'text.primary',
                        px: 1.5,
                        bgcolor: current ? 'action.selected' : undefined,
                        '&.Mui-disabled': { color: 'text.primary' },
                      }}
                    >
                      <Box component="span" sx={{ minWidth: 0 }}>
                        <Box component="span" sx={{ fontWeight: 600 }}>
                          {label(index)}
                        </Box>{' '}
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          · last saved {when(item.updatedAt)} · version{' '}
                          {item.revision}
                        </Box>
                      </Box>
                      <Box
                        component="span"
                        sx={{ flexShrink: 0, ml: 1, color: 'text.secondary' }}
                      >
                        {current
                          ? 'Open now'
                          : opening === item.id
                            ? 'Opening…'
                            : 'Open'}
                      </Box>
                    </Button>
                  </li>
                );
              })}
            </Box>
            {hasMore && (
              <Button size="small" disabled={disabled} onClick={onLoadMore}>
                Show older drafts
              </Button>
            )}
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
