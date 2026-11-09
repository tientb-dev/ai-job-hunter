import { test, expect } from 'vitest';
import {
  decodeReadiness,
  generationReadiness,
  readinessReasons,
} from '../src/features/inbox/tailored-cv-readiness';
const base = {
  cv: true,
  jobRevision: true,
  disabled: false,
  dirty: false,
  checking: false,
  error: '',
  server: null,
};
test('explicit local and server prerequisites have actionable states without P7 suggestion context', () => {
  for (const reason of Object.keys(readinessReasons)) {
    const server = decodeReadiness({
      contractVersion: '1',
      ready: false,
      reason,
      pins: null,
      matchValidForMs: 0,
    });
    const result = generationReadiness({ ...base, server });
    expect(result.ready).toBe(false);
    expect(result.text).toBeTruthy();
  }
  for (const change of [
    { cv: false },
    { jobRevision: false },
    { disabled: true, blockedReason: 'Save Source CV Review.' },
    { dirty: true },
    { checking: true },
    { error: 'Check local API' },
  ])
    expect(generationReadiness({ ...base, ...change }).ready).toBe(false);
});
test('invalid pins or expiry cannot enable generation', () => {
  expect(() =>
    decodeReadiness({
      contractVersion: '1',
      ready: true,
      reason: null,
      pins: {},
      matchValidForMs: 1000,
    }),
  ).toThrow();
  expect(() =>
    decodeReadiness({
      contractVersion: '1',
      ready: false,
      reason: 'unknown',
      pins: null,
      matchValidForMs: 0,
    }),
  ).toThrow();
});
