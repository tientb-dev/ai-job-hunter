import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setLocale } from '../src/app/i18n';

// Feature screens are still English-only; their tests use English labels.
// i18n.test.tsx and auth.test.tsx cover the Vietnamese default.
beforeEach(() => setLocale('en-US'));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
