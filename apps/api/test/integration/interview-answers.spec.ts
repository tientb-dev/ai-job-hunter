import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { InterviewAnswersService } from '../../src/interview-prep/interview-answers.service.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { revertThrough } from '../support/migration-revert.js';

let db: DataSource;
let service: InterviewAnswersService;
let app: INestApplication;
const ownerA = randomUUID();
const ownerB = randomUUID();
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const T = 'ai_job_hunter.interview_answers';
const body = (answer: string, expectedVersion: number | null) => ({
  answer,
  expectedVersion,
});
const conflictOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as { errorCode: string; current: unknown };
  }
  throw new Error('expected a conflict');
};

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  const [identity] = await db.query('SELECT current_database() AS d');
  expect(identity.d).toBe('ai_job_hunter_test');
  await db.runMigrations();
  service = new InterviewAnswersService(db);
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
      `DELETE FROM ${T} WHERE "ownerId" = $1 AND "questionId" = 'hr-goals-01'`,
      [LOCAL_OWNER_ID],
    );
    await db.destroy();
  }
});

test('the InterviewAnswers migration reverts, reapplies and repeat-runs cleanly', async () => {
  const exists = async () =>
    (await db.query(`SELECT to_regclass('${T}') AS t`))[0].t !== null;
  expect(await exists()).toBe(true);
  const reverted = await revertThrough(db, 'InterviewAnswers1794200000000');
  expect(reverted[0]).toBe('InterviewAnswers1794200000000');
  expect(await exists()).toBe(false);
  expect((await db.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await exists()).toBe(true);
  expect(await db.runMigrations()).toEqual([]);
});

test('create is atomic: a second create for the same question is a 409 with the current answer', async () => {
  const first = await service.save(
    ownerA,
    'hr-intro-01',
    body('First answer.', null),
  );
  expect(first).toMatchObject({
    questionId: 'hr-intro-01',
    answer: 'First answer.',
    version: 1,
  });
  const error = await conflictOf(
    service.save(ownerA, 'hr-intro-01', body('Other tab.', null)),
  );
  expect(error.errorCode).toBe('INTERVIEW_ANSWER_CONFLICT');
  expect(error.current).toMatchObject({ answer: 'First answer.', version: 1 });
});

test('update increments the version; a stale version is a 409 and changes nothing', async () => {
  const updated = await service.save(
    ownerA,
    'hr-intro-01',
    body('Second answer.', 1),
  );
  expect(updated.version).toBe(2);
  const error = await conflictOf(
    service.save(ownerA, 'hr-intro-01', body('Stale.', 1)),
  );
  expect(error.current).toMatchObject({ answer: 'Second answer.', version: 2 });
  expect(
    (await service.list(ownerA)).find((a) => a.questionId === 'hr-intro-01')
      ?.answer,
  ).toBe('Second answer.');
});

test('two concurrent updates with the same version: exactly one succeeds (repeated)', async () => {
  await service.save(ownerA, 'tech-api-01', body('Base.', null));
  for (let round = 1; round <= 8; round++) {
    const results = await Promise.allSettled([
      service.save(ownerA, 'tech-api-01', body(`Tab A round ${round}.`, round)),
      service.save(ownerA, 'tech-api-01', body(`Tab B round ${round}.`, round)),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const conflicts = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason as { errorCode?: string }).errorCode ===
          'INTERVIEW_ANSWER_CONFLICT',
    );
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
  }
  const [row] = await db.query(
    `SELECT version FROM ${T} WHERE "ownerId" = $1 AND "questionId" = 'tech-api-01'`,
    [ownerA],
  );
  expect(row.version).toBe(9);
});

test('two concurrent creates: exactly one succeeds', async () => {
  const results = await Promise.allSettled([
    service.save(ownerA, 'hr-learning-01', body('Tab A.', null)),
    service.save(ownerA, 'hr-learning-01', body('Tab B.', null)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});

test('delete needs the current version; deleting twice is a 409 with current null', async () => {
  await service.save(ownerA, 'tech-api-02', body('REST answer.', null));
  const stale = await conflictOf(service.remove(ownerA, 'tech-api-02', '5'));
  expect(stale.current).toMatchObject({ version: 1 });
  await service.remove(ownerA, 'tech-api-02', '1');
  const gone = await conflictOf(service.remove(ownerA, 'tech-api-02', '1'));
  expect(gone.current).toBeNull();
  // Deleted elsewhere: an update conflicts with current null; an explicit create works.
  const update = await conflictOf(
    service.save(ownerA, 'tech-api-02', body('Edit.', 1)),
  );
  expect(update.current).toBeNull();
  expect(
    (await service.save(ownerA, 'tech-api-02', body('Recreated.', null)))
      .version,
  ).toBe(1);
});

test('owners are isolated', async () => {
  await service.save(ownerB, 'hr-intro-01', body('Owner B answer.', null));
  const a = await service.list(ownerA);
  const b = await service.list(ownerB);
  expect(b).toEqual([
    expect.objectContaining({
      questionId: 'hr-intro-01',
      answer: 'Owner B answer.',
      version: 1,
    }),
  ]);
  expect(a.find((x) => x.questionId === 'hr-intro-01')).toMatchObject({
    answer: 'Second answer.',
    version: 2,
  });
  await conflictOf(service.remove(ownerB, 'tech-api-01', '9')); // A's row is invisible to B
  expect(
    (await service.list(ownerA)).some((x) => x.questionId === 'tech-api-01'),
  ).toBe(true);
});

test('unknown or retired question rows stay stored but are hidden; writes to them are refused', async () => {
  await db.query(
    `INSERT INTO ${T} ("ownerId", "questionId", answer) VALUES ($1, 'retired-question-01', 'Old answer.')`,
    [ownerB],
  );
  expect((await service.list(ownerB)).map((x) => x.questionId)).toEqual([
    'hr-intro-01',
  ]);
  expect(
    await db.query(`SELECT count(*)::int AS n FROM ${T} WHERE "ownerId" = $1`, [
      ownerB,
    ]),
  ).toEqual([{ n: 2 }]);
  await expect(
    service.save(ownerB, 'retired-question-01', body('x', null)),
  ).rejects.toMatchObject({ errorCode: 'INTERVIEW_INVALID_REQUEST' });
});

test.each([
  ['leading space', ' padded'],
  ['trailing newline', 'padded\n'],
  ['2001 code points', 'a'.repeat(2001)],
  ['control character', 'bell\u0007'],
  ['carriage return', 'a\rb'],
  ['empty', ''],
])('the database CHECK rejects %s', async (_name, answer) => {
  await expect(
    db.query(
      `INSERT INTO ${T} ("ownerId", "questionId", answer) VALUES ($1, 'hr-goals-01', $2)`,
      [ownerB, answer],
    ),
  ).rejects.toMatchObject({
    driverError: expect.objectContaining({ code: '23514' }),
  });
});
test('the database accepts 2000 emoji (code points, like the API)', async () => {
  await db.query(
    `INSERT INTO ${T} ("ownerId", "questionId", answer) VALUES ($1, 'hr-goals-01', $2)`,
    [ownerB, '😀'.repeat(2000)],
  );
});

test('HTTP round trip through the app: guarded list, create, conflict, delete', async () => {
  const server = app.getHttpServer();
  const put = await request(server)
    .put('/api/v1/interview-prep/answers/hr-goals-01')
    .set(origin)
    .send(body('I want to grow as a tech lead.', null))
    .expect(200);
  expect(put.body).toMatchObject({ questionId: 'hr-goals-01', version: 1 });
  const list = await request(server)
    .post('/api/v1/interview-prep/answers/list')
    .set(origin)
    .send({ contractVersion: '1' })
    .expect(200);
  expect(list.body.answers).toContainEqual(put.body);
  const conflict = await request(server)
    .put('/api/v1/interview-prep/answers/hr-goals-01')
    .set(origin)
    .send(body('Other tab.', null))
    .expect(409);
  expect(conflict.body).toMatchObject({
    errorCode: 'INTERVIEW_ANSWER_CONFLICT',
    current: { version: 1 },
  });
  await request(server)
    .put('/api/v1/interview-prep/answers/hr-goals-01')
    .set(origin)
    .send(body('x'.repeat(2001), 1))
    .expect(400);
  await request(server)
    .delete('/api/v1/interview-prep/answers/hr-goals-01?expectedVersion=1')
    .set(origin)
    .expect(204);
  await request(server)
    .post('/api/v1/interview-prep/answers/list')
    .set({ Host: '127.0.0.1:3000' })
    .send({ contractVersion: '1' })
    .expect(403);
});
