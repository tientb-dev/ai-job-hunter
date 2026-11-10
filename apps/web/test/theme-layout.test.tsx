import { expect, test } from 'vitest';
import { theme } from '../src/app/theme';

test('page reserves scrollbar space so content does not shift when it appears', () => {
  const overrides = theme.components?.MuiCssBaseline?.styleOverrides as {
    html?: { scrollbarGutter?: string };
  };
  expect(overrides.html?.scrollbarGutter).toBe('stable');
});
