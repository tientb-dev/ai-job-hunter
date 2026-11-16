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
// Alternatives to the recommended link import, which has its own card.
const methods = [
  {
    value: 'paste',
    get title() {
      return tr('Paste JD');
    },
    get subtitle() {
      return tr('Recruiter post or text');
    },
    path: 'M8 2h8v2h4v18H4V4h4V2zm2 2v2h4V4h-4zM6 6v14h12V6h-2v2H8V6H6zm2 5h8v2H8v-2zm0 4h8v2H8v-2z',
  },
  {
    value: 'upload',
    get title() {
      return tr('Upload JD');
    },
    get subtitle() {
      return tr('PDF · DOCX');
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
  return (
    <Box
      role="group"
      aria-label={tr('Other methods')}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
        },
        gap: 1.5,
      }}
    >
      {methods.map((method) => (
        <Paper
          key={method.value}
          variant="outlined"
          sx={{
            minWidth: 0,
            borderColor: value === method.value ? 'primary.main' : 'divider',
            bgcolor:
              value === method.value ? 'action.selected' : 'background.paper',
          }}
        >
          <CardActionArea
            type="button"
            disabled={disabled}
            aria-pressed={value === method.value}
            aria-controls={panelId}
            onClick={() => onChange(method.value)}
            sx={{
              height: '100%',
              borderRadius: 'inherit',
              p: 2,
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
              {value === method.value && <CheckIcon color="primary" />}
            </Stack>
          </CardActionArea>
        </Paper>
      ))}
    </Box>
  );
}
