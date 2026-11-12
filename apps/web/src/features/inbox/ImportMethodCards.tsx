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
const methods = [
  {
    value: 'url',
    title: 'Job URL',
    subtitle: 'ITviec',
    path: 'M3 3h7v2H5v14h14v-5h2v7H3V3zm10 0h8v8h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H13V3z',
  },
  {
    value: 'bookmarklet',
    title: 'Bookmarklet',
    subtitle: 'TopCV · VietnamWorks',
    path: 'M6 3h12v18l-6-4-6 4V3zm2 2v12.3l4-2.7 4 2.7V5H8z',
  },
  {
    value: 'paste',
    title: 'Paste JD',
    subtitle: 'Recruiter post or text',
    path: 'M8 2h8v2h4v18H4V4h4V2zm2 2v2h4V4h-4zM6 6v14h12V6h-2v2H8V6H6zm2 5h8v2H8v-2zm0 4h8v2H8v-2z',
  },
  {
    value: 'upload',
    title: 'Upload JD',
    subtitle: 'PDF · DOCX',
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
      aria-label="Choose an import method"
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
