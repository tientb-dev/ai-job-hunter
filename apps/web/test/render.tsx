import {
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
  type RenderOptions,
} from '@testing-library/react';
import type { ReactElement } from 'react';
import { NotificationProvider } from '../src/components/Notifications';
export * from '@testing-library/react';
export function render(ui: ReactElement, options?: RenderOptions) {
  // A wrapper (not inline JSX) so rerender keeps the provider.
  return renderUi(ui, { wrapper: NotificationProvider, ...options });
}
/** Acknowledge the persistent failure dialog and wait until the page is usable. */
export async function acknowledge() {
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  // Wait for removal, not just aria-hiding, so the page is usable again.
  await waitFor(() => {
    if (
      document.querySelector('[aria-labelledby="notification-failure-title"]')
    )
      throw new Error('dialog open');
  });
}
/** Close the modal success popup early (Esc) instead of waiting 3.5s. */
export async function closeSuccess() {
  const popup = () =>
    document.querySelector('[aria-labelledby="notification-success-title"]');
  await waitFor(() => {
    if (!popup()) throw new Error('no success popup');
  });
  fireEvent.keyDown(popup()!, { key: 'Escape' });
  await waitFor(() => {
    if (popup()) throw new Error('success open');
  });
}
