import { expect, test } from 'vitest';
import { MenuItem, Paper, ThemeProvider, TextField } from '@mui/material';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/app/App';
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

test('desktop sidebar stays in view and scrolls its own overflowing navigation', () => {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={['/unknown']}>
        <App />
      </MemoryRouter>
    </ThemeProvider>,
  );
  const sidebar = getComputedStyle(document.querySelector('aside')!);
  expect(sidebar.position).toBe('sticky');
  expect(sidebar.top).toBe('0px');
  expect(sidebar.height).toBe('100dvh');
  expect(sidebar.overflowY).toBe('auto');
});

test('outlined panels stand out from the tinted page without shadows', () => {
  render(
    <ThemeProvider theme={theme}>
      <Paper variant="outlined" data-testid="panel">
        <Paper variant="outlined" data-testid="nested" />
      </Paper>
    </ThemeProvider>,
  );
  expect(theme.palette.background.default).not.toBe(
    theme.palette.background.paper,
  );
  const panel = getComputedStyle(screen.getByTestId('panel'));
  expect(panel.borderColor).toBe('rgb(220, 220, 213)'); // surface.panelBorder
  expect(panel.boxShadow).toBe('none');
  // Nested panels fall back to the lighter divider so borders don't stack up.
  expect(getComputedStyle(screen.getByTestId('nested')).borderColor).toBe(
    'rgb(227, 227, 221)', // palette.divider
  );
});
