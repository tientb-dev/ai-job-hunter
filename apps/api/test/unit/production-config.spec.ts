import type { IncomingMessage } from 'node:http';
import { afterEach, expect, test } from '@jest/globals';
import { validateEnvironment } from '../../src/config/environment.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { publicSecurity } from '../../src/analysis/analysis-security.js';
import { clientAddress } from '../../src/auth/auth.http.js';
import { localOpportunitySecurity } from '../../src/opportunities/opportunities.security.js';

const prod = {
  NODE_ENV: 'production',
  API_HOST: '0.0.0.0',
  TRUST_PROXY: '1',
  DB_ENV: 'production',
  DB_HOST: 'postgres',
  DB_PORT: '5432',
  DB_NAME: 'ai_job_hunter',
  DB_USER: 'ai_job_hunter',
  DB_PASSWORD: 'synthetic-production-password',
  PUBLIC_ORIGIN: 'https://beta.example.com',
  AI_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'synthetic-placeholder-key-0000',
};
afterEach(() => {
  delete process.env.PUBLIC_ORIGIN;
});

test('accepts the production stack settings', () => {
  const config = validateEnvironment(prod);
  expect(config).toMatchObject({ host: '0.0.0.0', trustProxy: true });
  expect(databaseOptions('production', prod)).toMatchObject({
    host: 'postgres',
    synchronize: false,
    migrationsRun: false,
  });
  expect(() =>
    validateEnvironment({ ...prod, PUBLIC_ORIGIN: 'http://localhost:8080' }),
  ).not.toThrow();
});

test.each([
  ['plain http on a real host', { PUBLIC_ORIGIN: 'http://beta.example.com' }],
  ['a path', { PUBLIC_ORIGIN: 'https://beta.example.com/app' }],
  ['no origin', { PUBLIC_ORIGIN: undefined }],
  ['Ollama', { AI_PROVIDER: 'ollama' }],
  ['PII diagnostics', { CV_MATCH_DIAGNOSTICS: '1' }],
  [
    'NODE_ENV other than production',
    { NODE_ENV: 'development', DB_ENV: 'development' },
  ],
  [
    'the dev database identity',
    { DB_NAME: 'ai_job_hunter_dev', DB_USER: 'ai_job_hunter_dev' },
  ],
  ['another database host', { DB_HOST: 'db.example.com' }],
  [
    'a placeholder password',
    { DB_PASSWORD: 'replace-with-a-long-random-password' },
  ],
])('refuses production with %s', (_name, change) => {
  expect(() => validateEnvironment({ ...prod, ...change })).toThrow();
});

test('development cannot opt into proxy trust, a public bind or PUBLIC_ORIGIN', () => {
  const dev = {
    NODE_ENV: 'development',
    DB_ENV: 'development',
    DB_HOST: '127.0.0.1',
    DB_PORT: '5432',
    DB_NAME: 'ai_job_hunter_dev',
    DB_USER: 'ai_job_hunter_dev',
    DB_PASSWORD: 'synthetic-dev-password',
  };
  expect(() => validateEnvironment(dev)).not.toThrow();
  for (const change of [
    { TRUST_PROXY: '1' },
    { API_HOST: '0.0.0.0' },
    { PUBLIC_ORIGIN: 'https://beta.example.com' },
  ])
    expect(() => validateEnvironment({ ...dev, ...change })).toThrow();
  expect(() => databaseOptions('production', dev)).toThrow();
});

test('hosted Host/Origin policy is exactly PUBLIC_ORIGIN, with no local aliases', () => {
  expect(publicSecurity({})).toBeNull();
  process.env.PUBLIC_ORIGIN = 'https://beta.example.com';
  expect(localOpportunitySecurity(3000)).toEqual({
    hosts: ['beta.example.com'],
    origins: ['https://beta.example.com'],
  });
});

test('client address trusts only the proxy-appended X-Forwarded-For entry, and only when enabled', () => {
  const req = (xff?: string) =>
    ({
      headers: xff ? { 'x-forwarded-for': xff } : {},
      socket: { remoteAddress: '172.18.0.5' },
    }) as unknown as IncomingMessage;
  expect(clientAddress(req('1.2.3.4, 203.0.113.7'), true)).toBe('203.0.113.7');
  expect(clientAddress(req('203.0.113.7'), false)).toBe('172.18.0.5');
  expect(clientAddress(req(), true)).toBe('172.18.0.5');
});
