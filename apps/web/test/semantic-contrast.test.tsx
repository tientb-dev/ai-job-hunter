import { Alert, Chip, ThemeProvider, createTheme } from '@mui/material';
import { expect, test, vi } from 'vitest';
import { render, screen } from './render';
import { theme } from '../src/app/theme';
import { ApiReadiness } from '../src/features/health/ApiReadiness';

// WCAG sRGB relative luminance, computed from actual opaque DOM style pairs.
function contrast(foreground: string, background: string) {
  const luminance = (rgb: string) => {
    const channels = rgb.match(/[\d.]+/g)!.map(Number);
    expect(channels).toHaveLength(3);
    const [r, g, b] = channels.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}
const chip = (label: string) =>
  screen.getByText(label).closest('.MuiChip-root')!;

test('filled warning Chips retain orange with normal-text contrast; other variants and standard Alerts retain defaults', () => {
  const baseline = createTheme({
    palette: {
      primary: { main: '#2f5bd3', dark: '#2447a8', contrastText: '#ffffff' },
      background: { default: '#f6f6f3' },
    },
  });
  const paletteAlternative = createTheme(baseline, {
    palette: { warning: { contrastText: baseline.palette.grey[900] } },
  });
  const options = (prefix: string) => (
    <>
      <Chip color="warning" label={prefix + ' filled'} />
      <Chip color="warning" variant="outlined" label={prefix + ' outlined'} />
      <Chip color="success" label={prefix + ' success'} />
      <Alert severity="warning">{prefix + ' alert'}</Alert>
    </>
  );
  render(
    <>
      <ThemeProvider theme={theme}>{options('chosen')}</ThemeProvider>
      <ThemeProvider theme={baseline}>{options('baseline')}</ThemeProvider>
      <ThemeProvider theme={paletteAlternative}>
        {options('palette alternative')}
      </ThemeProvider>
    </>,
  );
  const chosen = getComputedStyle(chip('chosen filled'));
  const old = getComputedStyle(chip('baseline filled'));
  const alternative = getComputedStyle(chip('palette alternative filled'));
  expect([chosen.color, chosen.backgroundColor]).toEqual([
    alternative.color,
    alternative.backgroundColor,
  ]);
  expect(chosen.backgroundColor).toBe(old.backgroundColor);
  expect(chosen.backgroundColor).toBe('rgb(237, 108, 2)');
  expect(chosen.color).toBe('rgb(33, 33, 33)');
  expect(contrast(chosen.color, chosen.backgroundColor)).toBeGreaterThanOrEqual(
    4.5,
  );
  expect(contrast(old.color, old.backgroundColor)).toBeLessThan(4.5);
  for (const variant of ['outlined', 'success']) {
    const current = getComputedStyle(chip('chosen ' + variant));
    const previous = getComputedStyle(chip('baseline ' + variant));
    expect([current.color, current.backgroundColor]).toEqual([
      previous.color,
      previous.backgroundColor,
    ]);
  }
  const currentAlert = getComputedStyle(
    screen.getByText('chosen alert').closest('.MuiAlert-root')!,
  );
  const previousAlert = getComputedStyle(
    screen.getByText('baseline alert').closest('.MuiAlert-root')!,
  );
  expect([currentAlert.color, currentAlert.backgroundColor]).toEqual([
    previousAlert.color,
    previousAlert.backgroundColor,
  ]);
  expect(
    contrast(currentAlert.color, currentAlert.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);
  expect(theme.palette.primary).toEqual(baseline.palette.primary);
  expect(theme.palette.warning).toEqual(baseline.palette.warning);
});

test('API unavailable uses the corrected actual indicator colors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 })),
  );
  render(
    <ThemeProvider theme={theme}>
      <ApiReadiness />
    </ThemeProvider>,
  );
  await screen.findByText('API unavailable');
  const styles = getComputedStyle(chip('API unavailable'));
  expect(styles.backgroundColor).toBe('rgb(237, 108, 2)');
  expect(styles.color).toBe('rgb(33, 33, 33)');
  expect(contrast(styles.color, styles.backgroundColor)).toBeGreaterThanOrEqual(
    4.5,
  );
});
