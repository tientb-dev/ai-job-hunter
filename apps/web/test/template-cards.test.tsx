import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { act, render, screen } from './render';
import { setLocale, useI18n } from '../src/app/i18n';
import { theme } from '../src/app/theme';
import { TemplateCards } from '../src/features/inbox/TemplateCards';
import type { CvTemplate } from '../src/features/inbox/tailored-cv.contract';

function Harness(props: {
  saving?: boolean;
  disabled?: boolean;
  spy?: (t: CvTemplate) => void;
}) {
  useI18n();
  const [value, setValue] = useState<CvTemplate>('classic');
  return (
    <ThemeProvider theme={theme}>
      <TemplateCards
        value={value}
        onChange={(t) => {
          props.spy?.(t);
          setValue(t);
        }}
        saving={props.saving ?? false}
        disabled={props.disabled}
        approximatePreview
      />
    </ThemeProvider>
  );
}

test('three cards form one labelled single-choice group with plain explanations', () => {
  render(<Harness />);
  const group = screen.getByRole('group', { name: 'CV template' });
  expect(group).toHaveAccessibleDescription(
    'Choose a template to preview your CV. Templates apply to PDF only; DOCX always uses the Classic layout. The browser preview may differ slightly from the exported PDF.',
  );
  const radios = screen.getAllByRole('radio');
  expect(radios.map((r) => r.getAttribute('value'))).toEqual([
    'classic',
    'modern',
    'compact',
  ]);
  // The sketches are decorative: names come from the text only.
  expect(radios[0]).toHaveAccessibleName(
    'Classic Simple single-column layout, easy to read and print.',
  );
  expect(radios[1]).toHaveAccessibleName(
    'Modern Coloured header and section headings in a side column.',
  );
  expect(radios[2]).toHaveAccessibleName(
    'Compact Tighter spacing and smaller text to fit more content.',
  );
  expect(radios[0]).toBeChecked();
  // Names wrap; nothing is truncated with an ellipsis.
  expect(document.querySelector('.MuiTypography-noWrap')).toBeNull();
});

test('click and arrow keys select a card, keep focus on it and report each choice once', async () => {
  const spy = vi.fn();
  const user = userEvent.setup();
  render(<Harness spy={spy} />);
  await user.click(screen.getByRole('radio', { name: /^Modern/ }));
  expect(screen.getByRole('radio', { name: /^Modern/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Modern/ })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: /^Compact/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Compact/ })).toHaveFocus();
  expect(spy.mock.calls).toEqual([['modern'], ['compact']]);
});

test('the saving line is always laid out, and a disabled group cannot change', async () => {
  const { rerender } = render(<Harness />);
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('');
  rerender(<Harness saving />);
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toHaveTextContent('Saving template…');
  rerender(<Harness disabled />);
  for (const radio of screen.getAllByRole('radio'))
    expect(radio).toBeDisabled();
});

test('cards and the note are translated', () => {
  render(<Harness />);
  act(() => setLocale('vi-VN'));
  expect(
    screen.getByRole('group', { name: 'Mẫu CV' }),
  ).toHaveAccessibleDescription(
    'Chọn mẫu để xem trước CV. Mẫu chỉ áp dụng cho PDF; DOCX luôn dùng bố cục Cổ điển. Bản xem trước trên trình duyệt có thể khác đôi chút so với tệp PDF xuất ra.',
  );
  expect(screen.getByRole('radio', { name: /^Cổ điển/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /^Hiện đại/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /^Gọn/ })).toBeInTheDocument();
  act(() => setLocale('en-US'));
});
