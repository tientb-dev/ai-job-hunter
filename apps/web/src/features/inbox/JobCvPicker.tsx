import { Box, Button, MenuItem, Stack, TextField } from '@mui/material';
import { tr } from '../../app/i18n';
import { UploadIcon } from '../../components/icons';
import type { CvMatchState } from './useCvMatch';

/** Chooses which saved CV this job uses, or uploads one for this job only. */
export function JobCvPicker({
  match,
  disabled,
  emptyLabel = tr('Save CV'),
  inputLabel = tr('Save CV for matching'),
  onUploaded,
  analysisAction,
}: {
  match: Pick<CvMatchState, 'cv' | 'cvs' | 'select' | 'upload'>;
  disabled: boolean;
  analysisAction?: React.ReactNode;
  /** Job Detail: opens the new CV's Source CV Review. */
  onUploaded?: (cvId: string) => void;
  /** Button text before any CV exists. */
  emptyLabel?: string;
  inputLabel?: string;
}) {
  const { cv, select, upload } = match;
  // The job's CV is always listed, even if the list failed to load.
  const cvs =
    cv && !match.cvs.some((row) => row.id === cv.id)
      ? [cv, ...match.cvs]
      : match.cvs;
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      useFlexGap
      sx={{ alignItems: { sm: 'center' }, minWidth: 0, flexWrap: 'wrap' }}
    >
      {cvs.length > 0 && (
        <TextField
          select
          size="small"
          label={tr('CV for this job')}
          value={cv?.id ?? ''}
          disabled={disabled}
          onChange={(event) => void select(event.target.value)}
          sx={{
            minWidth: 0,
            width: { xs: '100%', sm: 320 },
            maxWidth: '100%',
          }}
        >
          {cvs.map((row) => (
            <MenuItem key={row.id} value={row.id} sx={{ whiteSpace: 'normal' }}>
              {row.isDefault
                ? tr('{name} (default)', { name: row.name || row.fileName })
                : row.name || row.fileName}
            </MenuItem>
          ))}
        </TextField>
      )}
      <Button
        variant={analysisAction ? 'outlined' : 'text'}
        startIcon={<UploadIcon />}
        component="label"
        size="small"
        disabled={disabled}
        sx={{ textTransform: 'none', flexShrink: 0, minHeight: 44 }}
      >
        {cvs.length ? tr('Upload new CV') : emptyLabel}
        <input
          disabled={disabled}
          hidden
          type="file"
          accept=".pdf,.docx"
          aria-label={inputLabel}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file).then((id) => id && onUploaded?.(id));
          }}
        />
      </Button>
      {analysisAction && (
        <Box
          sx={{
            marginInlineStart: { sm: 'auto' },
            mt: { xs: 0.5, sm: 0 },
            '& > button': { width: { xs: '100%', sm: 'auto' }, minHeight: 44 },
          }}
        >
          {analysisAction}
        </Box>
      )}
    </Stack>
  );
}
