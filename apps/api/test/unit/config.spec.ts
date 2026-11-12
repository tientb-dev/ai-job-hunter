import { expect, test } from '@jest/globals';
import { databaseOptions } from '../../src/database/database.config.js';
import { validateEnvironment } from '../../src/config/environment.js';

const env = {
  NODE_ENV: 'test',
  DB_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5433',
  DB_NAME: 'ai_job_hunter_test',
  DB_USER: 'ai_job_hunter_test',
  DB_PASSWORD: 'synthetic-test-password',
};
test('accepts isolated test settings and disables schema automation', () => {
  const options = databaseOptions('test', env);
  expect(options.synchronize).toBe(false);
  expect(options.migrationsRun).toBe(false);
  expect(validateEnvironment(env).port).toBe(3000);
  expect(validateEnvironment(env).pdfParserDiagnostics).toBe(false);
  expect(validateEnvironment(env).aiGenerationDiagnostics).toBe(false);
});
test('enables PDF parser diagnostics only for the literal opt-in value', () => {
  expect(
    validateEnvironment({ ...env, PDF_PARSER_DIAGNOSTICS: '1' })
      .pdfParserDiagnostics,
  ).toBe(true);
  expect(
    validateEnvironment({ ...env, PDF_PARSER_DIAGNOSTICS: 'true' })
      .pdfParserDiagnostics,
  ).toBe(false);
});
test('enables AI generation diagnostics only for the literal opt-in value', () => {
  expect(
    validateEnvironment({ ...env, AI_GENERATION_DIAGNOSTICS: '1' })
      .aiGenerationDiagnostics,
  ).toBe(true);
  expect(
    validateEnvironment({ ...env, AI_GENERATION_DIAGNOSTICS: 'true' })
      .aiGenerationDiagnostics,
  ).toBe(false);
});
test.each(['0', '65536', 'abc', '3000.5', ''])(
  'rejects invalid API_PORT %s',
  (port) => {
    expect(() => validateEnvironment({ ...env, API_PORT: port })).toThrow(
      'API_PORT',
    );
  },
);
test.each(['', 'invalid'])('rejects invalid NODE_ENV %s', (value) => {
  expect(() => validateEnvironment({ ...env, NODE_ENV: value })).toThrow(
    'NODE_ENV',
  );
});
test.each([
  ['DB_ENV', 'development'],
  ['NODE_ENV', 'development'],
  ['DB_NAME', 'ai_job_hunter_dev'],
  ['DB_USER', 'ai_job_hunter_dev'],
  ['DB_HOST', 'remote.example'],
  ['DB_PORT', '5432'],
  ['DB_PORT', '0'],
  ['DB_PORT', 'abc'],
  ['DB_PASSWORD', ''],
  ['DB_PASSWORD', 'replace-with-password'],
])('rejects unsafe test setting %s=%s', (key, value) => {
  expect(() => databaseOptions('test', { ...env, [key]: value })).toThrow();
});
test('rejects test processes using the development entry point', () => {
  expect(() =>
    databaseOptions('development', { ...env, DB_ENV: 'development' }),
  ).toThrow('Test processes');
});
test('reserves test port from development', () => {
  expect(() =>
    databaseOptions('development', {
      ...env,
      NODE_ENV: 'development',
      DB_ENV: 'development',
      DB_NAME: 'ai_job_hunter_dev',
      DB_USER: 'ai_job_hunter_dev',
    }),
  ).toThrow('reserved');
});

test('application startup validation rejects invalid AI settings', () => {
  expect(() => validateEnvironment({ ...env, AI_PROVIDER: 'openai' })).toThrow(
    'AI_PROVIDER',
  );
  expect(() => validateEnvironment({ ...env, AI_PROVIDER: 'gemini' })).toThrow(
    'GEMINI_API_KEY',
  );
  expect(() =>
    validateEnvironment({ ...env, AI_REQUEST_TIMEOUT_MS: '0' }),
  ).toThrow('AI_REQUEST_TIMEOUT_MS');
});
