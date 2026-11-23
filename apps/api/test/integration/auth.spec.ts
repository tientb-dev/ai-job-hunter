import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { configureAuth } from '../../src/auth/auth.http.js';
import type { AuthHttpOptions } from '../../src/auth/auth.http.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { revertThrough } from '../support/migration-revert.js';

const S = 'ai_job_hunter';
const ORIGIN = 'http://127.0.0.1:5173';
const run = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${run}@example.test`;
const PASSWORD = 'synthetic-password-1';
let db: DataSource;
let auth: AuthService;
let app: INestApplication;
let limited: INestApplication;

async function startApp(options: AuthHttpOptions) {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const instance = module.createNestApplication();
  configureAuth(instance, options);
  instance.setGlobalPrefix('api/v1');
  await instance.init();
  return instance;
}

const post = (path: string, body: object, cookie?: string) => {
  const r = request(app.getHttpServer())
    .post(`/api/v1${path}`)
    .set('Origin', ORIGIN)
    .send(body);
  return cookie ? r.set('Cookie', cookie) : r;
};
const get = (path: string, cookie?: string) => {
  const r = request(app.getHttpServer()).get(`/api/v1${path}`);
  return cookie ? r.set('Cookie', cookie) : r;
};
const cookieOf = (res: request.Response): string =>
  String(res.headers['set-cookie']?.[0] ?? '').split(';')[0]!;
const register = (name: string, invitationCode: string, password = PASSWORD) =>
  post('/auth/register', { email: email(name), password, invitationCode });

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  const [identity] = await db.query('SELECT current_database() AS d');
  expect(identity.d).toBe('ai_job_hunter_test');
  await db.runMigrations();
  auth = new AuthService(db);
  app = await startApp({
    origins: [ORIGIN],
    rateLimit: { max: 1000, windowMs: 60_000 },
  });
  limited = await startApp({
    origins: [ORIGIN],
    rateLimit: { max: 2, windowMs: 60_000 },
  });
});
afterAll(async () => {
  await app?.close();
  await limited?.close();
  if (db?.isInitialized) {
    await db.query(`DELETE FROM ${S}.users WHERE email LIKE $1`, [
      `%-${run}@example.test`,
    ]);
    await db.query(
      `DELETE FROM ${S}.auth_codes WHERE "createdAt" > now() - interval '1 hour'`,
    );
    await db.destroy();
  }
});

test('the Auth migration reverts, reapplies and repeat-runs cleanly', async () => {
  const exists = async () =>
    (await db.query(`SELECT to_regclass('${S}.users') AS t`))[0].t !== null;
  const reverted = await revertThrough(db, 'Auth1794600000000');
  expect(await exists()).toBe(false);
  expect((await db.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await exists()).toBe(true);
  expect(await db.runMigrations()).toEqual([]);
});

test('a valid code registers once, stores only hashes, and starts a session', async () => {
  const code = await auth.issueInvite(7);
  const res = await register('valid', code.toLowerCase()).expect(201);
  const cookie = cookieOf(res);
  expect(res.headers['set-cookie']?.[0]).toMatch(/HttpOnly; SameSite=Lax/);
  const me = await get('/auth/me', cookie).expect(200);
  expect(me.body).toEqual({ email: email('valid'), isAdmin: false });
  const [user] = await db.query(
    `SELECT "passwordHash" FROM ${S}.users WHERE email = $1`,
    [email('valid')],
  );
  expect(user.passwordHash).toMatch(/^scrypt\$/);
  const stored = JSON.stringify([
    await db.query(`SELECT * FROM ${S}.auth_codes`),
    await db.query(`SELECT * FROM ${S}.auth_sessions`),
  ]);
  expect(stored).not.toContain(code.replaceAll('-', ''));
  expect(stored).not.toContain(cookie.split('=')[1]);
  // Reused code
  expect((await register('reuse', code).expect(400)).body).toEqual({
    errorCode: 'REGISTRATION_FAILED',
  });
});

test('invalid and expired codes are refused with the same generic error', async () => {
  expect(
    (await register('bad', 'AAAAA-AAAAA-AAAAA-AAAAA').expect(400)).body,
  ).toEqual({ errorCode: 'REGISTRATION_FAILED' });
  const expired = await auth.issueInvite(1);
  await db.query(
    `UPDATE ${S}.auth_codes SET "expiresAt" = now() - interval '1 second' WHERE "usedAt" IS NULL AND kind = 'INVITE'`,
  );
  expect((await register('expired', expired).expect(400)).body).toEqual({
    errorCode: 'REGISTRATION_FAILED',
  });
});

test('concurrent redemptions of one code create exactly one account', async () => {
  const code = await auth.issueInvite(7);
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => register(`race${i}`, code)),
  );
  expect(results.map((r) => r.status).sort()).toEqual([
    201, 400, 400, 400, 400, 400,
  ]);
  const [{ n }] = await db.query(
    `SELECT count(*)::int AS n FROM ${S}.users WHERE email LIKE $1`,
    [`race%-${run}@example.test`],
  );
  expect(n).toBe(1);
});

test('a duplicate email is refused generically and does not consume the code', async () => {
  await register('dup', await auth.issueInvite(7)).expect(201);
  const code = await auth.issueInvite(7);
  const again = await post('/auth/register', {
    email: `  DUP-${run}@Example.test `,
    password: PASSWORD,
    invitationCode: code,
  }).expect(400);
  expect(again.body).toEqual({ errorCode: 'REGISTRATION_FAILED' });
  await register('dup-other', code).expect(201);
});

test('weak passwords and malformed emails are rejected before redemption', async () => {
  const code = await auth.issueInvite(7);
  await register('weak', code, 'short').expect(400);
  await post('/auth/register', {
    email: 'not-an-email',
    password: PASSWORD,
    invitationCode: code,
  }).expect(400);
  await register('weak', code).expect(201);
});

test('login is generic for unknown email and wrong password; logout revokes the session', async () => {
  await register('login', await auth.issueInvite(7)).expect(201);
  const wrong = await post('/auth/login', {
    email: email('login'),
    password: 'wrong-password-1',
  }).expect(401);
  const unknown = await post('/auth/login', {
    email: email('nobody'),
    password: PASSWORD,
  }).expect(401);
  expect(wrong.body).toEqual(unknown.body);
  const res = await post('/auth/login', {
    email: email('LOGIN').toUpperCase(),
    password: PASSWORD,
  }).expect(200);
  const cookie = cookieOf(res);
  await get('/auth/me', cookie).expect(200);
  const out = await post('/auth/logout', {}, cookie).expect(204);
  expect(out.headers['set-cookie']?.[0]).toContain('Max-Age=0');
  await get('/auth/me', cookie).expect(401);
});

test('expired sessions are refused', async () => {
  const cookie = cookieOf(await register('expiry', await auth.issueInvite(7)));
  await get('/auth/me', cookie).expect(200);
  await db.query(
    `UPDATE ${S}.auth_sessions s SET "expiresAt" = now() - interval '1 second'
       FROM ${S}.users u WHERE u.id = s."userId" AND u.email = $1`,
    [email('expiry')],
  );
  await get('/auth/me', cookie).expect(401);
});

test('unauthenticated requests are denied; health stays public', async () => {
  await get('/health/live').expect(200);
  expect((await get('/opportunities').expect(401)).body).toEqual({
    errorCode: 'UNAUTHENTICATED',
  });
  await get('/auth/me').expect(401);
  await get('/interview-prep/answers').expect(401);
  await get('/opportunities', 'ajh_session=forged-token').expect(401);
  // Raw Express route registered after auth is covered too.
  await request(app.getHttpServer())
    .post('/api/v1/analyses')
    .set('Origin', ORIGIN)
    .expect(401);
});

test('state-changing requests need exactly one allowed Origin', async () => {
  const cookie = cookieOf(await register('csrf', await auth.issueInvite(7)));
  const server = app.getHttpServer();
  await request(server)
    .post('/api/v1/auth/logout')
    .set('Cookie', cookie)
    .expect(403);
  await request(server)
    .post('/api/v1/auth/logout')
    .set('Cookie', cookie)
    .set('Origin', 'https://evil.example')
    .expect(403);
  await request(server)
    .post('/api/v1/auth/login')
    .set('Origin', 'null')
    .send({ email: email('csrf'), password: PASSWORD })
    .expect(403);
  await get('/auth/me', cookie).expect(200);
});

test('admin reset code sets a new password once and revokes existing sessions', async () => {
  const cookie = cookieOf(await register('reset', await auth.issueInvite(7)));
  expect(await auth.issueReset(email('missing'), 24)).toBeNull();
  const stale = await auth.issueReset(email('reset'), 24);
  const code = await auth.issueReset(email('reset').toUpperCase(), 24);
  const reset = (resetCode: string) =>
    post('/auth/reset-password', {
      resetCode: resetCode!,
      password: 'brand-new-password',
    });
  await reset(stale!).expect(400); // superseded
  await reset(code!).expect(204);
  await reset(code!).expect(400); // single use
  await get('/auth/me', cookie).expect(401);
  await post('/auth/login', {
    email: email('reset'),
    password: PASSWORD,
  }).expect(401);
  await post('/auth/login', {
    email: email('reset'),
    password: 'brand-new-password',
  }).expect(200);
  // An invite cannot be used as a reset code.
  await reset(await auth.issueInvite(7)).expect(400);
});

test('login and registration are rate limited per client', async () => {
  const server = limited.getHttpServer();
  const attempt = () =>
    request(server)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: email('limited'), password: PASSWORD });
  await attempt().expect(401);
  await attempt().expect(401);
  const blocked = await attempt().expect(429);
  expect(blocked.body).toEqual({ errorCode: 'TOO_MANY_ATTEMPTS' });
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
});
