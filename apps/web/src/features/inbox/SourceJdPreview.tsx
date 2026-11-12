import { useState } from 'react';
import { ExpandMoreIcon } from '../../components/icons';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
export function SourceJdPreview({
  text,
  source,
  loading = false,
  error = '',
}: {
  text: string;
  source: string;
  loading?: boolean;
  error?: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const [previousText, setPreviousText] = useState(text);
  if (text !== previousText) {
    setPreviousText(text);
    if (text) setExpanded(true);
  }
  return (
    <Accordion
      variant="outlined"
      disableGutters
      expanded={expanded}
      onChange={(_, open) => setExpanded(open)}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography>Preview source JD</Typography>
          <Chip
            size="small"
            label={
              loading
                ? 'Reading source…'
                : error
                  ? 'Preview error'
                  : text
                    ? 'Loaded'
                    : 'Empty'
            }
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {source} · Original source text, before AI extraction.
          </Typography>
          {loading && (
            <Typography role="status">
              Loading source text. No AI extraction is running.
            </Typography>
          )}
          {error && (
            <Alert severity="warning">
              {error} Your source inputs are retained.
            </Alert>
          )}
          {text ? (
            <TextField
              label="Source JD text (read-only)"
              value={text}
              multiline
              minRows={3}
              maxRows={10}
              fullWidth
              slotProps={{ input: { readOnly: true } }}
            />
          ) : (
            !loading && (
              <Typography variant="body2">
                No source text available yet. Fetch a job page, use the
                bookmarklet, or upload a supported document.
              </Typography>
            )
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
