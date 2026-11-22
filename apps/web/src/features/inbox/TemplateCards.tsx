import { Box, Stack, Typography } from '@mui/material';
import { useId } from 'react';
import { tr } from '../../app/i18n';
import { CheckIcon } from '../../components/icons';
import { CV_TEMPLATES, type CvTemplate } from './tailored-cv.contract';

const name = (t: CvTemplate) =>
  t === 'modern'
    ? tr('Modern')
    : t === 'compact'
      ? tr('Compact')
      : tr('Classic');
const description = (t: CvTemplate) =>
  t === 'modern'
    ? tr('Coloured header and section headings in a side column.')
    : t === 'compact'
      ? tr('Tighter spacing and smaller text to fit more content.')
      : tr('Simple single-column layout, easy to read and print.');

const hidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  border: 0,
} as const;

// Schematic of each PDF theme (THEMES in the API export): an illustration,
// not an export preview.
function Sketch({ template }: { template: CvTemplate }) {
  const line = (width: string, color = '#c9d3cf', height = 3) => (
    <Box sx={{ width, height, bgcolor: color, borderRadius: 0.5 }} />
  );
  return (
    <Box
      aria-hidden
      sx={{
        width: 64,
        height: 84,
        flexShrink: 0,
        p: 0.75,
        bgcolor: '#ffffff',
        border: 1,
        borderColor: 'divider',
        borderRadius: 0.5,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      {template === 'modern' ? (
        <>
          <Box sx={{ m: -0.75, mb: 0.25, p: 0.75, bgcolor: '#1F4E79' }}>
            {line('70%', '#ffffff', 4)}
          </Box>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ display: 'flex', gap: 0.5 }}>
              <Box sx={{ width: 14 }}>{line('100%', '#1F4E79')}</Box>
              <Stack spacing={0.4} sx={{ flex: 1 }}>
                {line('100%')}
                {line('80%')}
              </Stack>
            </Box>
          ))}
        </>
      ) : template === 'compact' ? (
        <>
          <Box sx={{ alignSelf: 'center', width: '60%' }}>
            {line('100%', '#222222', 4)}
          </Box>
          {[0, 1, 2].map((i) => (
            <Stack key={i} spacing={0.3}>
              <Box sx={{ bgcolor: '#F3ECE4', px: 0.25, py: 0.2 }}>
                {line('45%', '#7A3E00', 2)}
              </Box>
              {line('100%', '#c9c3bb', 2)}
              {line('90%', '#c9c3bb', 2)}
            </Stack>
          ))}
        </>
      ) : (
        <>
          {line('65%', '#172B2A', 4)}
          {[0, 1, 2].map((i) => (
            <Stack key={i} spacing={0.4}>
              <Box sx={{ borderBottom: 1, borderColor: '#C9D3CF', pb: 0.25 }}>
                {line('40%', '#172B2A')}
              </Box>
              {line('100%')}
            </Stack>
          ))}
        </>
      )}
    </Box>
  );
}

/**
 * Single-choice template cards (native radios: arrow keys, focus and labels
 * come from the platform). Choosing a card only reports the value; the caller
 * persists it and updates the shared preview in place.
 */
export function TemplateCards({
  value,
  onChange,
  saving,
  disabled = false,
  approximatePreview = false,
}: {
  value: CvTemplate;
  onChange: (template: CvTemplate) => void;
  saving: boolean;
  disabled?: boolean;
  /** The preview below is HTML, not the exported PDF. */
  approximatePreview?: boolean;
}) {
  const id = useId();
  return (
    <Box
      component="fieldset"
      disabled={disabled}
      aria-describedby={`${id}-note`}
      sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}
    >
      <Typography
        component="legend"
        variant="subtitle1"
        sx={{ fontWeight: 600, p: 0 }}
      >
        {tr('CV template')}
      </Typography>
      <Typography
        id={`${id}-note`}
        variant="body2"
        color="text.secondary"
        sx={{ mb: 1.5 }}
      >
        {tr(
          'Choose a template to preview your CV. Templates apply to PDF only; DOCX always uses the Classic layout.',
        )}
        {approximatePreview &&
          ` ${tr('The browser preview may differ slightly from the exported PDF.')}`}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        {CV_TEMPLATES.map((t) => {
          const selected = t === value;
          return (
            <Box
              key={t}
              component="label"
              sx={{
                position: 'relative',
                display: 'flex',
                gap: 1.5,
                alignItems: 'flex-start',
                p: 1.5,
                border: 2,
                borderColor: selected ? 'primary.main' : 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                transition:
                  'border-color 150ms ease-out, background-color 150ms ease-out',
                '&:hover': disabled ? {} : { borderColor: 'primary.main' },
                '&:has(input:focus-visible)': {
                  outline: 2,
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
              }}
            >
              <Box
                component="input"
                type="radio"
                name={`${id}-template`}
                value={t}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(t)}
                sx={hidden}
              />
              <Sketch template={t} />
              <Box sx={{ minWidth: 0, flex: 1, pr: 3 }}>
                <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {name(t)}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  {description(t)}
                </Typography>
              </Box>
              {/* Always laid out, so selecting never shifts the card content. */}
              <CheckIcon
                aria-hidden
                color="primary"
                fontSize="small"
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  visibility: selected ? 'visible' : 'hidden',
                }}
              />
            </Box>
          );
        })}
      </Box>
      {/* Reserved line: the saving message never changes the height. */}
      <Typography
        role="status"
        variant="body2"
        color="text.secondary"
        sx={{ minHeight: '1.5em', mt: 0.5 }}
      >
        {saving ? tr('Saving template…') : ''}
      </Typography>
    </Box>
  );
}
