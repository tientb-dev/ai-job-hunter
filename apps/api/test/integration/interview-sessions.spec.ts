import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { InterviewSessionsService } from '../../src/interview-prep/interview-sessions.service.js';
import { revertThrough } from '../support/migration-revert.js';

let db: DataSource;
let service: InterviewSessionsService;
let app: INestApplication;
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const base = '/api/v1/interview-prep/sessions';
const ownerA = randomUUID();
const ownerB = randomUUID();
const T = 'ai_job_hunter.interview_sessions';
const C = { contractVersion: '1' };
const curated = { contractVersion: '1', source: 'curated', count: 5 };
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return (error as { errorCode: string }).errorCode;
  }
  throw new Error('expected an error');
};
const job = async (ownerId: string) =>
  (
    await db.query(
      `INSERT INTO ai_job_hunter.opportunities ("ownerId",title,company,source,status,"originalLink","contactNotes",description,notes)
       VALUES ($1,'Synthetic PR17 job','Example Company','Other','SAVED','','','Synthetic JD text.','') RETURNING id`,
      [ownerId],
    )
  )[0].id as string;
const jobSet = async (ownerId: string, jobId: string, n: number) => {
  const setId = (
    await db.query(
      `INSERT INTO ai_job_hunter.interview_question_sets ("ownerId","jobId","jdHash") VALUES ($1,$2,$3) RETURNING id`,
      [ownerId, jobId, 'a'.repeat(64)],
    )
  )[0].id as string;
  for (let p = 1; p <= n; p += 1)
    await db.query(
      `INSERT INTO ai_job_hunter.interview_job_questions ("ownerId","setId",position,category,kind,question,why,evidence)
       VALUES ($1,$2,$3,'skill','general',$4,'The JD requires it.','Strong PostgreSQL experience required')`,
      [ownerId, setId, p, `Synthetic question number ${p}?`],
    );
  return setId;
};

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  const [identity] = await db.query('SELECT current_database() AS d');
  expect(identity.d).toBe('ai_job_hunter_test');
  await db.runMigrations();
  service = new InterviewSessionsService(db);
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    await db.query(`DELETE FROM ${T} WHERE "ownerId" = ANY($1)`, [
      [ownerA, ownerB],
    ]);
    await db.query(
      `DELETE FROM ai_job_hunter.opportunities WHERE "ownerId" = ANY($1)`,
      [[ownerA, ownerB]],
    );
    await db.destroy();
  }
});

test('the InterviewSessions migration reverts, reapplies and repeat-runs cleanly', async () => {
  const exists = async () =>
    (await db.query(`SELECT to_regclass('${T}') AS t`))[0].t !== null;
  expect(await exists()).toBe(true);
  const reverted = await revertThrough(db, 'InterviewSessions1794400000000');
  expect(reverted[0]).toBe('InterviewSessions1794400000000');
  expect(await exists()).toBe(false);
  expect((await db.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await exists()).toBe(true);
  expect(await db.runMigrations()).toEqual([]);
});

test('curated session: create, one active, answer, skip, resume, complete, delete', async () => {
  const s = await service.create(ownerA, curated);
  expect(s).toMatchObject({ status: 'active', currentIndex: 0, version: 1 });
  expect(new Set(s.items.map((i) => i.questionId)).size).toBe(5);
  expect(await errorOf(service.create(ownerA, curated))).toBe(
    'INTERVIEW_SESSION_ACTIVE',
  );

  const a = await service.saveItem(ownerA, s.id, '0', {
    expectedVersion: 1,
    answer: 'My confirmed answer.',
    feedback: null,
  });
  expect(a).toMatchObject({ currentIndex: 1, version: 2 });
  expect(a.items[0]).toMatchObject({
    answer: 'My confirmed answer.',
    feedback: null,
  });
  // Stale version and wrong index both conflict; nothing changes.
  expect(
    await errorOf(
      service.saveItem(ownerA, s.id, '1', {
        expectedVersion: 1,
        answer: 'x',
        feedback: null,
      }),
    ),
  ).toBe('INTERVIEW_SESSION_CONFLICT');
  expect(
    await errorOf(
      service.saveItem(ownerA, s.id, '0', {
        expectedVersion: 2,
        answer: 'x',
        feedback: null,
      }),
    ),
  ).toBe('INTERVIEW_SESSION_CONFLICT');
  const skipped = await service.saveItem(ownerA, s.id, '1', {
    expectedVersion: 2,
    answer: null,
    feedback: null,
  });
  expect(skipped.items[1]).toMatchObject({ skipped: true, answer: null });

  // Refresh: the active session comes back as stored.
  expect(await service.active(ownerA, C)).toEqual(skipped);
  expect(await service.active(ownerB, C)).toBeNull();
  expect(await errorOf(service.get(ownerB, s.id, C))).toBe(
    'INTERVIEW_SESSION_NOT_FOUND',
  );

  const done = await service.complete(ownerA, s.id, { expectedVersion: 3 });
  expect(done).toMatchObject({ status: 'completed', version: 4 });
  expect(done.summary).toMatchObject({
    total: 5,
    answered: 1,
    skipped: 1,
    unanswered: 3,
  });
  expect(await service.active(ownerA, C)).toBeNull();
  expect(await service.get(ownerA, s.id, C)).toEqual(done);
  expect(
    await errorOf(
      service.saveItem(ownerA, s.id, '2', {
        expectedVersion: 4,
        answer: 'x',
        feedback: null,
      }),
    ),
  ).toBe('INTERVIEW_SESSION_CONFLICT');

  // Completed sessions are kept; a new one can start.
  const next = await service.create(ownerA, curated);
  expect(await errorOf(service.remove(ownerB, next.id, '1'))).toBe(
    'INTERVIEW_SESSION_NOT_FOUND',
  );
  expect(await errorOf(service.remove(ownerA, next.id, '9'))).toBe(
    'INTERVIEW_SESSION_CONFLICT',
  );
  await service.remove(ownerA, next.id, '1'); // discard
  await service.remove(ownerA, s.id, '4'); // delete completed
  expect(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM ${T} WHERE "ownerId" = $1`,
        [ownerA],
      )
    )[0].n,
  ).toBe(0);
});

test('job session uses only the owner’s set, snapshots questions and cascades with the job', async () => {
  const jobId = await job(ownerB);
  const setId = await jobSet(ownerB, jobId, 3);
  const body = { contractVersion: '1', source: 'job', count: 6, jobId, setId };
  expect(await errorOf(service.create(ownerA, body))).toBe(
    'INTERVIEW_JOB_NOT_FOUND',
  );
  const s = await service.create(ownerB, body);
  expect(s.items.map((i) => i.questionText)).toEqual([
    'Synthetic question number 1?',
    'Synthetic question number 2?',
    'Synthetic question number 3?',
  ]);
  expect(s.items[0]!.questionId).toMatch(/^jd-/u);
  // Shorter JD set: the actual count, not the requested 6.
  expect(s.summary).toMatchObject({ total: 3, unanswered: 3 });
  await db.query('DELETE FROM ai_job_hunter.opportunities WHERE id = $1', [
    jobId,
  ]);
  expect(await service.active(ownerB, C)).toBeNull();
});

test('the database rejects rows the API would never write', async () => {
  const insert = (items: unknown, extra = '') =>
    errorOf(
      db
        .query(
          `INSERT INTO ${T} ("ownerId", source, items${extra ? ', "currentIndex"' : ''})
         VALUES ($1, 'curated', $2::jsonb${extra})`,
          [randomUUID(), JSON.stringify(items)],
        )
        .catch((e: { driverError?: { code?: string } }) => {
          throw { errorCode: e.driverError?.code };
        }),
    );
  expect(await insert([])).toBe('23514');
  expect(await insert({})).toBe('23514');
  expect(await insert([{}], ', 2')).toBe('23514');
});

test('HTTP: every session route is local-only, strict and owner-scoped', async () => {
  const server = app.getHttpServer();
  // Never touch a real local session in the test database.
  const [existing] = await db.query(
    `SELECT id FROM ${T} WHERE "ownerId" = $1 AND status = 'active'`,
    [LOCAL_OWNER_ID],
  );
  expect(existing).toBeUndefined();
  const remote = { Host: '127.0.0.1:3000' };
  const id = randomUUID();
  const routes = [
    () => request(server).post(base).send(curated),
    () => request(server).post(`${base}/active`).send(C),
    () => request(server).post(`${base}/${id}/read`).send(C),
    () => request(server).post(`${base}/list`).send(C),
    () =>
      request(server)
        .put(`${base}/${id}/items/0`)
        .send({ expectedVersion: 1, answer: 'x', feedback: null }),
    () =>
      request(server)
        .post(`${base}/${id}/complete`)
        .send({ expectedVersion: 1 }),
    () => request(server).delete(`${base}/${id}?expectedVersion=1`),
  ];
  for (const route of routes) {
    const res = await route().set(remote).expect(403);
    expect(res.body.errorCode).toBe('INTERVIEW_LOCAL_ONLY');
  }

  const created = await request(server)
    .post(base)
    .set(origin)
    .send(curated)
    .expect(201);
  expect(created.headers['cache-control']).toBe('no-store');
  const sid = created.body.id as string;
  try {
    await request(server).post(base).set(origin).send(curated).expect(409);
    await request(server)
      .post(`${base}/active`)
      .set(origin)
      .send({})
      .expect(400);
    const active = await request(server)
      .post(`${base}/active`)
      .set(origin)
      .send(C)
      .expect(200);
    expect(active.body.session.id).toBe(sid);
    await request(server)
      .put(`${base}/${sid}/items/0`)
      .set(origin)
      .send({
        expectedVersion: 1,
        answer: 'Typed answer.',
        feedback: { bogus: true },
      })
      .expect(400);
    await request(server)
      .put(`${base}/${sid}/items/9`)
      .set(origin)
      .send({ expectedVersion: 1, answer: 'x', feedback: null })
      .expect(400);
    const saved = await request(server)
      .put(`${base}/${sid}/items/0`)
      .set(origin)
      .send({ expectedVersion: 1, answer: 'Typed answer.', feedback: null })
      .expect(200);
    expect(saved.body).toMatchObject({ currentIndex: 1, version: 2 });
    // Another owner's session is invisible through the service, and an unknown id is 404.
    expect(await errorOf(service.get(ownerB, sid, C))).toBe(
      'INTERVIEW_SESSION_NOT_FOUND',
    );
    await request(server)
      .post(`${base}/${randomUUID()}/read`)
      .set(origin)
      .send(C)
      .expect(404);
    await request(server)
      .post(`${base}/not-a-uuid/read`)
      .set(origin)
      .send(C)
      .expect(404);
    await request(server)
      .post(`${base}/${sid}/complete`)
      .set(origin)
      .send({ expectedVersion: 1 })
      .expect(409);
    const done = await request(server)
      .post(`${base}/${sid}/complete`)
      .set(origin)
      .send({ expectedVersion: 2 })
      .expect(200);
    expect(done.body.summary).toMatchObject({
      answered: 1,
      skipped: 0,
      unanswered: 4,
    });
    const read = await request(server)
      .post(`${base}/${sid}/read`)
      .set(origin)
      .send(C)
      .expect(200);
    expect(read.body).toEqual(done.body);
    await request(server)
      .delete(`${base}/${sid}?expectedVersion=3`)
      .set(origin)
      .expect(204);
    await request(server)
      .post(`${base}/${sid}/read`)
      .set(origin)
      .send(C)
      .expect(404);
  } finally {
    await db.query(`DELETE FROM ${T} WHERE id = $1`, [sid]);
  }
});

test('history lists completed sessions only, newest first, owner-scoped, with job title', async () => {
  const items = JSON.stringify([
    {
      questionId: 'q1',
      questionText: 'Q?',
      answer: 'A.',
      feedback: null,
      skipped: false,
    },
    {
      questionId: 'q2',
      questionText: 'Q2?',
      answer: null,
      feedback: null,
      skipped: true,
    },
  ]);
  const jobId = await job(ownerA);
  const insert = async (
    owner: string,
    status: string,
    at: string,
    jid: string | null = null,
  ) =>
    (
      await db.query(
        `INSERT INTO ${T} ("ownerId",source,"jobId",status,items,"updatedAt")
         VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
        [owner, jid ? 'job' : 'curated', jid, status, items, at],
      )
    )[0].id as string;
  await db.query(`DELETE FROM ${T} WHERE "ownerId" = ANY($1)`, [
    [ownerA, ownerB],
  ]);
  const older = await insert(ownerA, 'completed', '2026-01-01T00:00:00Z');
  const newer = await insert(
    ownerA,
    'completed',
    '2026-02-01T00:00:00Z',
    jobId,
  );
  await insert(ownerA, 'active', '2026-03-01T00:00:00Z');
  await insert(ownerB, 'completed', '2026-03-01T00:00:00Z');

  const list = await service.list(ownerA, C);
  expect(list.items.map((i) => i.id)).toEqual([newer, older]);
  expect(list.items[0]).toMatchObject({
    source: 'job',
    jobId,
    jobTitle: 'Synthetic PR17 job',
    summary: { total: 2, answered: 1, skipped: 1, unanswered: 0 },
  });
  expect(list.items[1]).toMatchObject({ jobTitle: null, jobId: null });
  expect(list.items[0]).not.toHaveProperty('items');
  expect(await errorOf(service.list(ownerA, {}))).toBe(
    'INTERVIEW_INVALID_REQUEST',
  );

  for (let n = 0; n < 51; n += 1)
    await insert(ownerA, 'completed', '2025-01-01T00:00:00Z');
  expect((await service.list(ownerA, C)).items).toHaveLength(50);
  await db.query(`DELETE FROM ${T} WHERE "ownerId" = ANY($1)`, [
    [ownerA, ownerB],
  ]);
});
