import { expect, test } from 'vitest';
import { MenuItem, ThemeProvider, TextField } from '@mui/material';
import { render, screen } from '@testing-library/react';
import { theme } from '../src/app/theme';

test('page reserves scrollbar space so content does not shift when it appears', () => {
  const overrides = theme.components?.MuiCssBaseline?.styleOverrides as {
    html?: { scrollbarGutter?: string };
  };
  expect(overrides.html?.scrollbarGutter).toBe('stable');
});

test('form controls are compact by default across the app', () => {
  render(
    <ThemeProvider theme={theme}>
      <TextField label="Synthetic text" />
      <TextField label="Synthetic date" type="date" />
      <TextField label="Synthetic notes" multiline minRows={2} />
      <TextField select label="Synthetic status" value="a">
        <MenuItem value="a">A</MenuItem>
      </TextField>
    </ThemeProvider>,
  );
  for (const name of ['Synthetic text', 'Synthetic date', 'Synthetic notes'])
    expect(
      screen.getByLabelText(name).closest('.MuiInputBase-root'),
    ).toHaveClass('MuiInputBase-sizeSmall');
  expect(
    screen.getByRole('combobox').closest('.MuiInputBase-root'),
  ).toHaveClass('MuiInputBase-sizeSmall');
});
