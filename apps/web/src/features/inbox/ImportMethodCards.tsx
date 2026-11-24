import { tr } from '../../app/i18n';
import { CheckIcon } from '../../components/icons';
import {
  Box,
  CardActionArea,
  Paper,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';
export type ImportMethod = 'url' | 'bookmarklet' | 'paste' | 'upload';
// Three equal ways to add a JD. The bookmarklet result shows in the link panel.
const methods = [
  {
    value: 'url',
    get title() {
      return tr('Paste link');
    },
    get subtitle() {
      return tr('Get it from a job website');
    },
    path: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  },
  {
    value: 'paste',
    get title() {
      return tr('Paste content');
    },
    get subtitle() {
      return tr('Copy the job post text');
    },
    path: 'M8 2h8v2h4v18H4V4h4V2zm2 2v2h4V4h-4zM6 6v14h12V6h-2v2H8V6H6zm2 5h8v2H8v-2zm0 4h8v2H8v-2z',
  },
  {
    value: 'upload',
    get title() {
      return tr('Upload document');
    },
    get subtitle() {
      return tr('PDF or DOCX file');
    },
    path: 'M11 16V7.8l-3.6 3.6L6 10l6-6 6 6-1.4 1.4L13 7.8V16h-2zM4 18h16v3H4v-3z',
  },
] as const;
export function ImportMethodCards({
  value,
  onChange,
  panelId,
  disabled,
}: {
  value: ImportMethod;
  onChange: (method: ImportMethod) => void;
  panelId: string;
  disabled: boolean;
}) {
  const selected = value === 'bookmarklet' ? 'url' : value;
  return (
    <Box
      role="group"
      aria-label={tr('How to add the job')}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          md: 'repeat(3, minmax(0, 1fr))',
        },
        gap: { xs: 1, md: 1.5 },
      }}
    >
      {methods.map((method) => (
        <Paper
          key={method.value}
          variant="outlined"
          sx={{
            minWidth: 0,
            borderColor: selected === method.value ? 'primary.main' : 'divider',
            bgcolor:
              selected === method.value
                ? 'action.selected'
                : 'background.paper',
            transition: 'border-color 150ms, background-color 150ms',
          }}
        >
          <CardActionArea
            type="button"
            disabled={disabled}
            aria-pressed={selected === method.value}
            aria-controls={panelId}
            onClick={() => onChange(method.value)}
            sx={{
              height: '100%',
              borderRadius: 'inherit',
              px: 2,
              py: { xs: 1.25, md: 2 },
              '&.Mui-focusVisible': {
                outline: '3px solid',
                outlineColor: 'primary.main',
                outlineOffset: 2,
              },
            }}
          >
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center', minWidth: 0 }}
            >
              <SvgIcon aria-hidden="true" color="primary">
                <path d={method.path} />
              </SvgIcon>
              <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {method.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {method.subtitle}
                </Typography>
              </Box>
              {selected === method.value && (
                <CheckIcon aria-hidden="true" color="primary" />
              )}
            </Stack>
          </CardActionArea>
        </Paper>
      ))}
    </Box>
  );
}
