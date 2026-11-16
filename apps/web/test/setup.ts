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

// Add Job loads enabled link sources on mount; keep that request out of the
// per-test fetch mocks. test/link-sources.test.tsx covers the real request.
vi.mock('../src/features/inbox/link-sources', () => ({
  loadLinkSources: vi.fn(async () => ['ITviec', 'TopCV', 'VietnamWorks']),
}));
