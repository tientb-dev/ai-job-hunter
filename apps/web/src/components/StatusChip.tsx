import { Box, Chip } from '@mui/material';

type Tone = 'success' | 'primary' | 'info' | 'error' | 'neutral';

const tones: Record<string, Tone> = {
  OFFER: 'success',
  INTERVIEW: 'primary',
  APPLIED: 'info',
  CONTACTED: 'info',
  JD_RECEIVED: 'info',
  REJECTED: 'error',
};

const sentence = (value: string) => {
  const text = value.replaceAll('_', ' ').toLowerCase();
  return text === 'jd received'
    ? 'JD received'
    : text.charAt(0).toUpperCase() + text.slice(1);
};

/** Job status as a dot plus a sentence-case label, so color is never the only cue. */
export function StatusChip({ status }: { status: string }) {
  const tone = tones[status] ?? 'neutral';
  return (
    <Chip
      size="small"
      variant="outlined"
      label={sentence(status)}
      icon={
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: tone === 'neutral' ? 'text.secondary' : `${tone}.main`,
          }}
        />
      }
      sx={{
        bgcolor: 'background.paper',
        borderColor: 'divider',
        color: 'text.primary',
        maxWidth: '100%',
        '& .MuiChip-icon': { ml: 1, mr: -0.25 },
      }}
    />
  );
}
