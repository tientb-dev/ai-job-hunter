import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  jest,
  test,
} from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { AI_CONFIG, GEMINI_MODEL } from '../../src/ai/ai.config.js';
import { AiError } from '../../src/ai/ai.errors.js';
import {
  AiUsageService,
  GLOBAL_USAGE_ID,
  aiRequest,
} from '../../src/ai/ai-usage.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { configureAuth } from '../../src/auth/auth.http.js';
import { configureAnalysisHttp } from '../../src/analysis/analysis-http.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { revertThrough } from '../support/migration-revert.js';
import { pdfFixture } from '../support/pdf-fixtures.js';

// Web beta PR 4: hosted (Gemini) limits through real sessions and routes; only
// the provider is fake. Limits are tiny so every boundary is reachable.
const S = 'ai_job_hunter';
const ORIGIN = 'http://127.0.0.1:5173';
const HEADERS = { Origin: ORIGIN, Host: '127.0.0.1:3000' };
const run = randomUUID().slice(0, 8);
const LIMITS = { dailyPerUser: 2, dailyGlobal: 3, concurrent: 1 };
const generate = jest.fn<() => Promise<string>>();
let db: DataSource;
let app: INestApplication;
const users: Record<'a' | 'b', { id: string; cookie: string }> = {} as never;

async function signUp(auth: AuthService, name: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({
      email: `${name}-${run}@example.test`,
      password: 'synthetic-password-1',
      invitationCode: await auth.issueInvite(1),
    })
    .expect(201);
  const [row] = await db.query(`SELECT id FROM ${S}.users WHERE email = $1`, [
    `${name}-${run}@example.test`,
  ]);
  return {
    id: row.id as string,
    cookie: String(res.headers['set-cookie']?.[0]).split(';')[0]!,
  };
}
const feedback = (cookie: string) =>
  request(app.getHttpServer())
    .post('/api/v1/interview-prep/feedback')
    .set(HEADERS)
    .set('Cookie', cookie)
    .send({
      questionId: 'hr-strengths-01',
      mode: 'express',
      answer: 'Synthetic answer about analysing problems.',
    });
const usage = async (ownerId: string) =>
  Number(
    (
      await db.query(
        `SELECT coalesce(sum(requests), 0) AS n FROM ${S}.ai_usage WHERE "ownerId" = $1`,
        [ownerId],
      )
    )[0].n,
  );

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  const [identity] = await db.query('SELECT current_database() AS d');
  expect(identity.d).toBe('ai_job_hunter_test');
  await db.runMigrations();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AI_CONFIG)
    .useValue({
      provider: 'gemini',
      baseUrl: 'https://example.invalid',
      model: GEMINI_MODEL,
      timeoutMs: 5000,
      apiKey: 'synthetic',
      limits: LIMITS,
    })
    .overrideProvider(AI_PROVIDER)
    .useValue({ generate })
    .compile();
  app = module.createNestApplication();
  configureAuth(app, {
    origins: [ORIGIN],
    rateLimit: { max: 1000, windowMs: 60_000 },
  });
  configureAnalysisHttp(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
  const auth = new AuthService(db);
  users.a = await signUp(auth, 'quota-a');
  users.b = await signUp(auth, 'quota-b');
});
beforeEach(async () => {
  generate.mockReset();
  // Invalid model output: the request still reached the provider and counts.
  generate.mockResolvedValue('{}');
  await db.query(`DELETE FROM ${S}.ai_usage`);
});
afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    await db.query(`DELETE FROM ${S}.ai_usage`);
    await db.query(`DELETE FROM ${S}.users WHERE email LIKE $1`, [
      `%-${run}@example.test`,
    ]);
    await db.query(
      `DELETE FROM ${S}.auth_codes WHERE "createdAt" > now() - interval '1 hour'`,
    );
    await db.destroy();
  }
});

test('the AiUsage migration reverts, reapplies and repeat-runs cleanly', async () => {
  const exists = async () =>
    (await db.query(`SELECT to_regclass('${S}.ai_usage') AS t`))[0].t !== null;
  const reverted = await revertThrough(db, 'AiUsage1794700000000');
  expect(await exists()).toBe(false);
  expect((await db.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await exists()).toBe(true);
  expect(await db.runMigrations()).toEqual([]);
});

test('per-user daily limit: attempts count even when they fail; the next is refused before the provider', async () => {
  const { a } = users;
  generate.mockRejectedValueOnce(new AiError('UPSTREAM_HTTP_FAILURE', 500));
  expect((await feedback(a.cookie)).status).not.toBe(429);
  expect((await feedback(a.cookie)).status).not.toBe(429);
  expect(generate).toHaveBeenCalledTimes(2);
  const refused = await feedback(a.cookie).expect(429);
  expect(refused.body).toEqual({
    statusCode: 429,
    errorCode: 'AI_DAILY_USER_LIMIT',
    message: expect.stringContaining('resets at midnight'),
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(await usage(a.id)).toBe(2);
});

test('global daily limit refuses every account and does not charge the refused one', async () => {
  const { a, b } = users;
  await feedback(a.cookie);
  await feedback(a.cookie);
  await feedback(b.cookie); // global 3/3
  const refused = await feedback(b.cookie).expect(429);
  expect(refused.body.errorCode).toBe('AI_DAILY_GLOBAL_LIMIT');
  expect(await usage(b.id)).toBe(1);
  expect(await usage(GLOBAL_USAGE_ID)).toBe(3);
  expect(generate).toHaveBeenCalledTimes(3);
});

test('raw /analyses runs in the owner’s AI context and reports the limit', async () => {
  const { a } = users;
  await feedback(a.cookie);
  await feedback(a.cookie);
  const boundary = 'synthetic-boundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="cv"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    Buffer.from(pdfFixture(['Synthetic Candidate. TypeScript engineer.'])),
    Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="jdText"\r\n\r\nSynthetic JD: TypeScript.\r\n--${boundary}--\r\n`,
    ),
  ]);
  const res = await request(app.getHttpServer())
    .post('/api/v1/analyses')
    .set(HEADERS)
    .set('Cookie', a.cookie)
    .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
    .send(body);
  // A lost context would fail closed as AI_UNAVAILABLE instead.
  expect(res.body.error?.code).toBe('AI_DAILY_USER_LIMIT');
  expect(res.status).toBe(429);
  expect(generate).toHaveBeenCalledTimes(2);
});

test('concurrent reservations never exceed the limit', async () => {
  const service = new AiUsageService(db, { ...LIMITS, dailyPerUser: 3 });
  const results = await Promise.all(
    Array.from({ length: 10 }, () => service.reserve(users.a.id)),
  );
  expect(results.filter((r) => r === null)).toHaveLength(3);
  expect(results.filter((r) => r === 'AI_DAILY_USER_LIMIT')).toHaveLength(7);
  expect(await usage(users.a.id)).toBe(3);
});

test('the concurrency cap refuses without counting; no owner context fails closed', async () => {
  const service = new AiUsageService(db, LIMITS);
  let release!: () => void;
  const slow = new Promise<string>((resolve) => {
    release = () => resolve('{}');
  });
  const inContext = <T>(fn: () => Promise<T>) =>
    aiRequest.run({ ownerId: users.b.id }, fn);
  const first = inContext(() => service.run(() => slow));
  await expect(
    inContext(() => service.run(async () => 'never')),
  ).rejects.toMatchObject({ code: 'AI_BUSY' });
  release();
  await first;
  expect(await usage(users.b.id)).toBe(1);
  await expect(service.run(async () => 'never')).rejects.toMatchObject({
    code: 'AI_UNAVAILABLE',
  });
});
