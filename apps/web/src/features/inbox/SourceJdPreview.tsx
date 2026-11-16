import { tr } from '../../app/i18n';
import { HOSTED } from '../../app/hosted';
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
  // Collapsed by default: the job summary is the primary view; the raw text
  // stays one click away. Errors open it so the message is not hidden.
  const [expanded, setExpanded] = useState(false);
  const [previousError, setPreviousError] = useState(error);
  if (error !== previousError) {
    setPreviousError(error);
    if (error) setExpanded(true);
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
          <Typography>{tr('Preview source JD')}</Typography>
          <Chip
            size="small"
            label={
              loading
                ? tr('Reading source…')
                : error
                  ? tr('Preview error')
                  : text
                    ? tr('Loaded')
                    : tr('Empty')
            }
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {source} {tr('· Original source text, before AI extraction.')}
          </Typography>
          {loading && (
            <Typography role="status">
              {tr('Loading source text. No AI extraction is running.')}
            </Typography>
          )}
          {error && (
            <Alert severity="warning">
              {error} {tr('Your source inputs are retained.')}
            </Alert>
          )}
          {text ? (
            <TextField
              label={tr('Source JD text (read-only)')}
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
                {HOSTED
                  ? tr(
                      'No source text available yet. Fetch a job page, paste the JD, or upload a supported document.',
                    )
                  : tr(
                      'No source text available yet. Fetch a job page, use the bookmarklet, or upload a supported document.',
                    )}
              </Typography>
            )
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
