import { render as renderUi, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { NotificationProvider } from '../src/components/Notifications';
export * from '@testing-library/react';
export function render(ui: ReactElement, options?: RenderOptions) {
  // A wrapper (not inline JSX) so rerender keeps the provider.
  return renderUi(ui, { wrapper: NotificationProvider, ...options });
}
