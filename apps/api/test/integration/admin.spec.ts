import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
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
const CODE = /^[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/;
const previousAdmins = process.env.ADMIN_EMAILS;
let db: DataSource;
let auth: AuthService;
let app: INestApplication;
let limited: INestApplication;
let admin: { id: string; cookie: string };
let member: { id: string; cookie: string };

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

const post = (path: string, body: object, cookie?: string, on = app) => {
  const r = request(on.getHttpServer())
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
async function signUp(name: string) {
  const res = await post('/auth/register', {
    email: email(name),
    password: PASSWORD,
    invitationCode: await auth.issueInvite(7),
  }).expect(201);
  const [{ id }] = await db.query(
    `SELECT id FROM ${S}.users WHERE email = $1`,
    [email(name)],
  );
  return { id: id as string, cookie: cookieOf(res) };
}
const auditRows = (adminId: string) =>
  db.query(
    `SELECT action, "targetId" FROM ${S}.admin_audit_log WHERE "adminUserId" = $1 ORDER BY "createdAt", action`,
    [adminId],
  ) as Promise<{ action: string; targetId: string | null }[]>;

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  const [identity] = await db.query('SELECT current_database() AS d');
  expect(identity.d).toBe('ai_job_hunter_test');
  await db.runMigrations();
  auth = new AuthService(db);
  process.env.ADMIN_EMAILS = ` ${email('ADMIN')} , other-admin-${run}@example.test`;
  app = await startApp({
    origins: [ORIGIN],
    rateLimit: { max: 1000, windowMs: 60_000 },
  });
  limited = await startApp({
    origins: [ORIGIN],
    rateLimit: { max: 2, windowMs: 60_000 },
  });
  admin = await signUp('admin');
  member = await signUp('member');
});
afterAll(async () => {
  if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = previousAdmins;
  await app?.close();
  await limited?.close();
  if (db?.isInitialized) {
    const users = (await db.query(
      `SELECT id FROM ${S}.users WHERE email LIKE $1`,
      [`%-${run}@example.test`],
    )) as { id: string }[];
    const ids = users.map((u) => u.id);
    await db.query(
      `DELETE FROM ${S}.admin_audit_log WHERE "adminUserId" = ANY($1::uuid[])`,
      [ids],
    );
    await db.query(`DELETE FROM ${S}.users WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query(
      `DELETE FROM ${S}.auth_codes WHERE "createdAt" > now() - interval '1 hour'`,
    );
    await db.destroy();
  }
});

test('the AdminAudit migration reverts, reapplies and repeat-runs cleanly', async () => {
  const state = async () =>
    (
      await db.query(
        `SELECT to_regclass('${S}.admin_audit_log') IS NOT NULL AS log,
                EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = '${S}' AND table_name = 'auth_codes'
                    AND column_name = 'revokedAt') AS col`,
      )
    )[0];
  const reverted = await revertThrough(db, 'AdminAudit1795400000000');
  expect(await state()).toEqual({ log: false, col: false });
  expect((await db.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await state()).toEqual({ log: true, col: true });
  expect(await db.runMigrations()).toEqual([]);
});

test('admin routes: 401 signed out, 404 like an unknown route for members, isAdmin in /auth/me', async () => {
  await get('/admin/invites').expect(401);
  await post('/admin/invites', {}).expect(401);
  const unknown = await get('/no-such-route', member.cookie).expect(404);
  const hidden = await get('/admin/invites', member.cookie).expect(404);
  expect(hidden.body.error).toBe(unknown.body.error);
  expect(Object.keys(hidden.body).sort()).toEqual(
    Object.keys(unknown.body).sort(),
  );
  for (const [path, body] of [
    ['/admin/invites', {}],
    [`/admin/invites/${randomUUID()}/revoke`, {}],
    [`/admin/users/${admin.id}/reset-code`, { password: PASSWORD }],
  ] as const)
    await post(path, body, member.cookie).expect(404);
  await get(`/admin/users?email=${email('admin')}`, member.cookie).expect(404);
  expect((await get('/auth/me', member.cookie).expect(200)).body).toEqual({
    email: email('member'),
    isAdmin: false,
  });
  expect((await get('/auth/me', admin.cookie).expect(200)).body).toEqual({
    email: email('admin'),
    isAdmin: true,
  });
  expect(await auditRows(member.id)).toEqual([]);
});

test('admin creates, lists and revokes invites; revoked and used invites are distinct', async () => {
  await post('/admin/invites', { days: 0 }, admin.cookie).expect(400);
  await post('/admin/invites', { days: '7' }, admin.cookie).expect(400);
  const created = await post(
    '/admin/invites',
    { days: 3 },
    admin.cookie,
  ).expect(201);
  expect(created.headers['cache-control']).toBe('no-store');
  expect(created.body).toEqual({
    id: expect.any(String),
    code: expect.stringMatching(CODE),
    expiresAt: expect.any(String),
  });
  const used = (await post('/admin/invites', {}, admin.cookie).expect(201))
    .body;
  await post('/auth/register', {
    email: email('invited'),
    password: PASSWORD,
    invitationCode: used.code,
  }).expect(201);

  await post(
    `/admin/invites/${created.body.id}/revoke`,
    {},
    admin.cookie,
  ).expect(204);
  await post(
    `/admin/invites/${created.body.id}/revoke`,
    {},
    admin.cookie,
  ).expect(404);
  await post(`/admin/invites/${used.id}/revoke`, {}, admin.cookie).expect(404);
  await post('/admin/invites/not-a-uuid/revoke', {}, admin.cookie).expect(400);
  await post('/auth/register', {
    email: email('late'),
    password: PASSWORD,
    invitationCode: created.body.code,
  }).expect(400);

  const list = await get('/admin/invites', admin.cookie).expect(200);
  expect(list.headers['cache-control']).toBe('no-store');
  const byId = new Map(
    (list.body.invites as { id: string; status: string }[]).map((i) => [
      i.id,
      i,
    ]),
  );
  expect(byId.get(created.body.id)?.status).toBe('revoked');
  expect(byId.get(used.id)?.status).toBe('used');
  const raw = JSON.stringify(list.body);
  expect(raw).not.toContain('codeHash');
  expect(raw).not.toContain(created.body.code);
  expect(Object.keys(byId.get(used.id)!).sort()).toEqual([
    'createdAt',
    'expiresAt',
    'id',
    'revokedAt',
    'status',
    'usedAt',
  ]);

  expect(await auditRows(admin.id)).toEqual(
    expect.arrayContaining([
      { action: 'INVITE_CREATE', targetId: created.body.id },
      { action: 'INVITE_CREATE', targetId: used.id },
      { action: 'INVITE_REVOKE', targetId: created.body.id },
    ]),
  );
});

test('a failed audit write rolls the admin action back', async () => {
  const count = async () =>
    (await db.query(`SELECT count(*)::int AS n FROM ${S}.auth_codes`))[0].n;
  const before = await count();
  await db.query(
    `ALTER TABLE ${S}.admin_audit_log RENAME TO admin_audit_log_off`,
  );
  const logged: string[] = [];
  const capture = (stream: NodeJS.WriteStream) =>
    jest.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
      logged.push(String(chunk));
      return true;
    });
  const spies = [capture(process.stdout), capture(process.stderr)];
  try {
    await post('/admin/invites', {}, admin.cookie).expect(500);
    await post(
      `/admin/users/${member.id}/reset-code`,
      { password: PASSWORD },
      admin.cookie,
    ).expect(500);
  } finally {
    spies.forEach((spy) => spy.mockRestore());
    await db.query(
      `ALTER TABLE ${S}.admin_audit_log_off RENAME TO admin_audit_log`,
    );
  }
  expect(await count()).toBe(before);
  // The error is logged by type and driver code only: no SQL, parameters or hashes.
  const log = logged.join('');
  expect(log).toContain('QueryFailedError (42P01)');
  expect(log).not.toMatch(/parameters|INSERT INTO|Buffer|\\x/);
});

test('user lookup is exact after normalisation and audited', async () => {
  const found = await get(
    `/admin/users?email=${encodeURIComponent(` ${email('MEMBER')} `)}`,
    admin.cookie,
  ).expect(200);
  expect(found.headers['cache-control']).toBe('no-store');
  expect(found.body).toEqual({
    id: member.id,
    email: email('member'),
    createdAt: expect.any(String),
  });
  await get(`/admin/users?email=${email('mem')}`, admin.cookie).expect(404);
  await get('/admin/users?email=member', admin.cookie).expect(400);
  await get('/admin/users', admin.cookie).expect(400);
  const lookups = (await auditRows(admin.id)).filter(
    (r) => r.action === 'USER_LOOKUP',
  );
  expect(lookups).toEqual(
    expect.arrayContaining([{ action: 'USER_LOOKUP', targetId: member.id }]),
  );
  expect(lookups.some((r) => r.targetId === null)).toBe(true);
});

test('reset codes need the admin password, never target the admin, and work once', async () => {
  const issue = (id: string, body: object) =>
    post(`/admin/users/${id}/reset-code`, body, admin.cookie);
  const before = (await auditRows(admin.id)).length;
  await issue(member.id, {}).expect(400);
  expect(
    (await issue(member.id, { password: 'wrong-password-1' }).expect(403)).body,
  ).toEqual({ errorCode: 'REAUTH_FAILED' });
  // A failed confirmation is not a lost session: the admin stays signed in.
  expect((await get('/auth/me', admin.cookie).expect(200)).body.isAdmin).toBe(
    true,
  );
  await get('/admin/invites', admin.cookie).expect(200);
  expect(
    (await issue(admin.id, { password: PASSWORD }).expect(403)).body,
  ).toEqual({
    errorCode: 'SELF_RESET_FORBIDDEN',
  });
  await issue(randomUUID(), { password: PASSWORD }).expect(404);
  await issue(member.id, { password: PASSWORD, hours: 169 }).expect(400);
  expect((await auditRows(admin.id)).length).toBe(before);
  const [{ n: noCodes }] = await db.query(
    `SELECT count(*)::int AS n FROM ${S}.auth_codes WHERE kind = 'RESET' AND "userId" = $1`,
    [member.id],
  );
  expect(noCodes).toBe(0);

  const stale = (
    await issue(member.id, { password: PASSWORD, hours: 2 }).expect(201)
  ).body;
  const res = await issue(member.id, { password: PASSWORD }).expect(201);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({
    code: expect.stringMatching(CODE),
    expiresAt: expect.any(String),
  });
  const reset = (resetCode: string) =>
    post('/auth/reset-password', { resetCode, password: 'brand-new-password' });
  await reset(stale.code).expect(400);
  await reset(res.body.code).expect(204);
  await reset(res.body.code).expect(400);
  await get('/auth/me', member.cookie).expect(401);
  await get('/auth/me', admin.cookie).expect(200);

  const audit = await auditRows(admin.id);
  expect(audit.filter((r) => r.action === 'RESET_ISSUE')).toEqual([
    { action: 'RESET_ISSUE', targetId: member.id },
    { action: 'RESET_ISSUE', targetId: member.id },
  ]);
  const stored = JSON.stringify(
    await db.query(`SELECT * FROM ${S}.admin_audit_log`),
  );
  for (const secret of [res.body.code, stale.code, PASSWORD, email('member')])
    expect(stored).not.toContain(secret);
});

test('admin issuing has its own rate-limit bucket that never blocks login', async () => {
  const login = (password: string) =>
    post(
      '/auth/login',
      { email: email('admin'), password },
      undefined,
      limited,
    );
  await post('/admin/invites', {}, admin.cookie, limited).expect(201);
  await post('/admin/invites', {}, admin.cookie, limited).expect(201);
  expect(
    (await post('/admin/invites', {}, admin.cookie, limited).expect(429)).body,
  ).toEqual({ errorCode: 'TOO_MANY_ATTEMPTS' });
  await post(
    `/admin/users/${member.id}/reset-code`,
    { password: PASSWORD },
    admin.cookie,
    limited,
  ).expect(429);
  // Same IP, login bucket untouched; the login limit itself still applies.
  await login('wrong-password-1').expect(401);
  await login(PASSWORD).expect(200);
  await login(PASSWORD).expect(429);
});
