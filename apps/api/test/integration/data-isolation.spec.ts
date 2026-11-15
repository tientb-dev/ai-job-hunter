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
import { databaseOptions } from '../../src/database/database.config.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';

// Web beta PR 2: every data route is scoped to the signed-in account, through
// the real session middleware and real HTTP requests.
const S = 'ai_job_hunter';
const ORIGIN = 'http://127.0.0.1:5173';
const HEADERS = { Origin: ORIGIN, Host: '127.0.0.1:3000' };
const run = randomUUID().slice(0, 8);
const C = { contractVersion: '1' };
let db: DataSource;
let app: INestApplication;
let auth: AuthService;
const users: Record<'a' | 'b', { id: string; cookie: string }> = {} as never;
let localCookie: string | null = null;
let createdLocalOwner = false;
const ownedJobs: string[] = [];

type Method = 'get' | 'post' | 'put' | 'delete' | 'patch';
const call = (cookie: string, method: Method, path: string, body?: object) => {
  const r = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set(HEADERS)
    .set('Cookie', cookie);
  return body ? r.send(body) : r;
};
const job = (title: string, link = `https://example.com/${title}-${run}`) => ({
  title,
  company: 'Example Company',
  source: 'Zalo',
  status: 'SAVED',
  originalLink: link,
  description: 'Synthetic JD only',
  contactNotes: '',
  notes: '',
  contactDates: [],
  followUpDate: null,
});

async function signUp(name: string, userId: string | null = null) {
  const code = await auth.issueInvite(1, userId);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .set('Origin', ORIGIN)
    .send({
      email: `${name}-${run}@example.test`,
      password: 'synthetic-password-1',
      invitationCode: code,
    })
    .expect(201);
  const cookie = String(res.headers['set-cookie']?.[0]).split(';')[0]!;
  const [row] = await db.query(`SELECT id FROM ${S}.users WHERE email = $1`, [
    `${name}-${run}@example.test`,
  ]);
  return { id: row.id as string, cookie };
}

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  const [identity] = await db.query('SELECT current_database() AS d');
  expect(identity.d).toBe('ai_job_hunter_test');
  await db.runMigrations();
  auth = new AuthService(db);
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureAuth(app, {
    origins: [ORIGIN],
    rateLimit: { max: 1000, windowMs: 60_000 },
  });
  app.setGlobalPrefix('api/v1');
  await app.init();
  users.a = await signUp('iso-a');
  users.b = await signUp('iso-b');
  const [existing] = await db.query(`SELECT 1 FROM ${S}.users WHERE id = $1`, [
    LOCAL_OWNER_ID,
  ]);
  if (!existing) {
    localCookie = (await signUp('iso-local', LOCAL_OWNER_ID)).cookie;
    createdLocalOwner = true;
  }
});

afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    const ids = [users.a?.id, users.b?.id].filter(Boolean);
    for (const table of [
      'interview_sessions',
      'interview_answers',
      'tailored_cv_drafts',
      'cv_profile_revisions',
      'cv_source_revisions',
      'saved_cvs',
      'opportunities',
    ])
      await db.query(`DELETE FROM ${S}.${table} WHERE "ownerId" = ANY($1)`, [
        ids,
      ]);
    if (ownedJobs.length)
      await db.query(`DELETE FROM ${S}.opportunities WHERE id = ANY($1)`, [
        ownedJobs,
      ]);
    await db.query(`DELETE FROM ${S}.users WHERE email LIKE $1`, [
      `%-${run}@example.test`,
    ]);
    if (createdLocalOwner)
      await db.query(`DELETE FROM ${S}.users WHERE id = $1`, [LOCAL_OWNER_ID]);
    await db.query(
      `DELETE FROM ${S}.auth_codes WHERE "createdAt" > now() - interval '1 hour'`,
    );
    await db.destroy();
  }
});

test('jobs: B cannot list, read, update, match or download A’s job; duplicate checks are per account', async () => {
  const { a, b } = users;
  // A client-supplied ownerId is rejected, not trusted.
  await call(a.cookie, 'post', '/opportunities', {
    ...job('a-job'),
    ownerId: b.id,
  }).expect(400);
  const created = await call(
    a.cookie,
    'post',
    '/opportunities',
    job('a-job'),
  ).expect(201);
  const id = created.body.id as string;
  const [row] = await db.query(
    `SELECT "ownerId" FROM ${S}.opportunities WHERE id = $1`,
    [id],
  );
  expect(row.ownerId).toBe(a.id);

  const listB = await call(b.cookie, 'get', '/opportunities').expect(200);
  expect(listB.body).toEqual([]);
  await call(b.cookie, 'get', `/opportunities/${id}`).expect(404);
  await call(b.cookie, 'put', `/opportunities/${id}`, job('hijack')).expect(
    404,
  );
  await call(b.cookie, 'get', `/opportunities/${id}/match`).expect(404);
  await call(b.cookie, 'get', `/opportunities/${id}/document`).expect(404);
  const link = encodeURIComponent(`https://example.com/a-job-${run}`);
  expect(
    (await call(b.cookie, 'get', `/opportunities/duplicate-url?url=${link}`))
      .body.match,
  ).toBeNull();
  expect(
    (await call(a.cookie, 'get', `/opportunities/duplicate-url?url=${link}`))
      .body.match.id,
  ).toBe(id);
  // The same URL is not a duplicate for another account.
  const mine = await call(
    b.cookie,
    'post',
    '/opportunities',
    job('b-job', `https://example.com/a-job-${run}`),
  ).expect(201);
  expect(
    (await call(b.cookie, 'get', '/opportunities').expect(200)).body.map(
      (j: { id: string }) => j.id,
    ),
  ).toEqual([mine.body.id]);
  const unchanged = await call(a.cookie, 'get', `/opportunities/${id}`);
  expect(unchanged.body.title).toBe('a-job');
});

test('saved CV and Tailored CV sources are private; B cannot read, delete or link them', async () => {
  const { a, b } = users;
  const savedAt = '2026-01-01T00:00:00.000Z';
  await db.query(
    `INSERT INTO ${S}.saved_cvs ("ownerId", "fileName", text, "updatedAt")
       VALUES ($1, 'a-cv.pdf', 'Synthetic CV text for account A.', $2)`,
    [a.id, savedAt],
  );
  expect(
    (await call(a.cookie, 'get', '/opportunities/cv/current')).body.fileName,
  ).toBe('a-cv.pdf');
  expect(
    (await call(b.cookie, 'get', '/opportunities/cv/current').expect(200)).body,
  ).toEqual({});

  const source = await call(a.cookie, 'post', '/tailored-cv/sources', {
    ...C,
    expectedSavedCvUpdatedAt: savedAt,
  }).expect(201);
  const sourceId = source.body.id as string;
  await call(b.cookie, 'get', `/tailored-cv/sources/${sourceId}`).expect(404);
  await call(
    b.cookie,
    'get',
    `/tailored-cv/sources/${sourceId}/content`,
  ).expect(404);
  await call(b.cookie, 'delete', `/tailored-cv/sources/${sourceId}`).expect(
    404,
  );
  await call(a.cookie, 'get', `/tailored-cv/sources/${sourceId}`).expect(200);
  // B has no saved CV: capturing cannot fall back to A's.
  await call(b.cookie, 'post', '/tailored-cv/sources', {
    ...C,
    expectedSavedCvUpdatedAt: savedAt,
  }).expect(409);
  // Linking A's source into B's profile is refused.
  const profileB = await call(b.cookie, 'post', '/tailored-cv/profiles', {
    ...C,
    sourceRevisionId: sourceId,
    expectedSavedCvUpdatedAt: savedAt,
  });
  expect([404, 409]).toContain(profileB.status);
  // The same request succeeds for the owner, so the refusal above is ownership.
  await call(a.cookie, 'post', '/tailored-cv/profiles', {
    ...C,
    sourceRevisionId: sourceId,
    expectedSavedCvUpdatedAt: savedAt,
  }).expect(201);
});

test('tailored drafts, job progress and interview question sets do not reach another account’s job', async () => {
  const { a, b } = users;
  const [aJob] = await db.query(
    `SELECT id FROM ${S}.opportunities WHERE "ownerId" = $1 LIMIT 1`,
    [a.id],
  );
  const drafts = await call(
    b.cookie,
    'post',
    `/tailored-cv/jobs/${aJob.id}/drafts/list`,
    { ...C, before: null },
  );
  expect(drafts.status).toBe(404);
  const progressB = await call(
    b.cookie,
    'post',
    '/tailored-cv/job-progress',
    C,
  );
  expect(JSON.stringify(progressB.body)).not.toContain(aJob.id);
  const sets = await call(
    b.cookie,
    'post',
    `/interview-prep/jobs/${aJob.id}/sets/list`,
    C,
  );
  expect(sets.status).toBe(404);
  const generate = await call(
    b.cookie,
    'post',
    `/interview-prep/jobs/${aJob.id}/sets`,
    { ...C, basedOnSetId: null },
  );
  expect(generate.status).toBe(404);
});

test('interview answers and sessions are private per account', async () => {
  const { a, b } = users;
  await call(a.cookie, 'put', '/interview-prep/answers/hr-intro-01', {
    answer: 'Account A answer.',
    expectedVersion: null,
  }).expect(200);
  const listB = await call(b.cookie, 'post', '/interview-prep/answers/list', C);
  expect(JSON.stringify(listB.body)).not.toContain('Account A answer.');
  await call(
    b.cookie,
    'delete',
    '/interview-prep/answers/hr-intro-01?expectedVersion=1',
  );
  const listA = await call(a.cookie, 'post', '/interview-prep/answers/list', C);
  expect(JSON.stringify(listA.body)).toContain('Account A answer.');

  const session = await call(a.cookie, 'post', '/interview-prep/sessions', {
    ...C,
    source: 'curated',
    count: 5,
  }).expect(201);
  const sid = session.body.id as string;
  expect(
    (await call(b.cookie, 'post', `/interview-prep/sessions/${sid}/read`, C))
      .status,
  ).toBe(404);
  expect(
    (
      await call(b.cookie, 'put', `/interview-prep/sessions/${sid}/items/0`, {
        expectedVersion: 1,
        answer: 'x',
        feedback: null,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call(
        b.cookie,
        'delete',
        `/interview-prep/sessions/${sid}?expectedVersion=1`,
      )
    ).status,
  ).toBe(404);
  const activeB = await call(
    b.cookie,
    'post',
    '/interview-prep/sessions/active',
    C,
  );
  expect(activeB.body.session).toBeNull();
  const sessionsB = await call(
    b.cookie,
    'post',
    '/interview-prep/sessions/list',
    C,
  );
  expect(JSON.stringify(sessionsB.body)).not.toContain(sid);
  // B can run its own session independently while A's stays active.
  await call(b.cookie, 'post', '/interview-prep/sessions', {
    ...C,
    source: 'curated',
    count: 5,
  }).expect(201);
  await call(
    a.cookie,
    'post',
    `/interview-prep/sessions/${sid}/read`,
    C,
  ).expect(200);
});

test('discovery candidates are listed per account', async () => {
  const listB = await call(users.b.cookie, 'get', '/discovery/candidates');
  expect(listB.status).toBe(200);
  await call(
    users.b.cookie,
    'get',
    `/discovery/candidates/${randomUUID()}`,
  ).expect(404);
});

test('existing local-owner data stays with the local-owner account only', async () => {
  if (!localCookie) return; // a pre-existing local owner in the disposable test DB
  const [legacy] = await db.query(
    `INSERT INTO ${S}.opportunities ("ownerId", title, company, source, status,
       "originalLink", description, "contactNotes", notes, "jdText")
     VALUES ($1, 'Legacy local job', 'Example', 'Zalo', 'SAVED', '', '', '', '', '')
     RETURNING id`,
    [LOCAL_OWNER_ID],
  );
  ownedJobs.push(legacy.id);
  const local = await call(localCookie, 'get', '/opportunities').expect(200);
  expect(local.body.map((j: { id: string }) => j.id)).toContain(legacy.id);
  await call(localCookie, 'get', `/opportunities/${legacy.id}`).expect(200);
  await call(users.a.cookie, 'get', `/opportunities/${legacy.id}`).expect(404);
  const listA = await call(users.a.cookie, 'get', '/opportunities');
  expect(listA.body.map((j: { id: string }) => j.id)).not.toContain(legacy.id);
});

test('anonymous requests stay rejected, including raw /analyses', async () => {
  const server = app.getHttpServer();
  await request(server).get('/api/v1/opportunities').expect(401);
  await request(server)
    .post('/api/v1/interview-prep/sessions/list')
    .set(HEADERS)
    .send(C)
    .expect(401);
  await request(server).post('/api/v1/analyses').set(HEADERS).expect(401);
});
