import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { InterviewAnswersService } from '../../src/interview-prep/interview-answers.service.js';
import { InterviewPrepService } from '../../src/interview-prep/interview-prep.service.js';
import type { AiService } from '../../src/ai/ai.service.js';
import type { TailoredDraftService } from '../../src/tailored-cv/tailored-draft.service.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { revertThrough } from '../support/migration-revert.js';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { TranscriptionService } from '../../src/interview-prep/transcription.service.js';
import { fakeStt, wav } from '../support/fake-stt.js';

let db: DataSource;
let app: INestApplication;
let localJob: string | undefined;
const ownerA = randomUUID();
const ownerB = randomUUID();
const SETS = 'ai_job_hunter.interview_question_sets';
const QUESTIONS = 'ai_job_hunter.interview_job_questions';
const ANSWERS = 'ai_job_hunter.interview_answers';
const hash = 'a'.repeat(64);
const exists = async (table: string) =>
  (await db.query(`SELECT to_regclass('${table}') AS t`))[0].t !== null;
const job = async (ownerId: string) =>
  (
    await db.query(
      `INSERT INTO ai_job_hunter.opportunities ("ownerId",title,company,source,status,"originalLink","contactNotes",description,notes)
       VALUES ($1,'Synthetic PR15 job','Example Company','Other','SAVED','','','Synthetic JD text.','') RETURNING id`,
      [ownerId],
    )
  )[0].id as string;
const set = async (ownerId: string, jobId: string) =>
  (
    await db.query(
      `INSERT INTO ${SETS} ("ownerId","jobId","jdHash") VALUES ($1,$2,$3) RETURNING id`,
      [ownerId, jobId, hash],
    )
  )[0].id as string;
const question = (
  ownerId: string,
  setId: string,
  overrides: Record<string, unknown> = {},
) => {
  const row = {
    position: 1,
    category: 'skill',
    kind: 'general',
    question: 'How does PostgreSQL MVCC work?',
    why: 'The JD requires PostgreSQL.',
    evidence: 'Strong PostgreSQL experience required',
    ...overrides,
  };
  return db.query(
    `INSERT INTO ${QUESTIONS} ("ownerId","setId",position,category,kind,question,why,evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      ownerId,
      setId,
      row.position,
      row.category,
      row.kind,
      row.question,
      row.why,
      row.evidence,
    ],
  );
};
const count = async (table: string, ownerId: string) =>
  Number(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE "ownerId" = $1`,
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
    if (localJob) {
      await db.query(
        `DELETE FROM ${ANSWERS} WHERE "ownerId" = $1 AND "questionId" IN (SELECT 'jd-' || q.id::text FROM ${QUESTIONS} q JOIN ${SETS} s ON s.id = q."setId" WHERE s."jobId" = $2)`,
        [LOCAL_OWNER_ID, localJob],
      );
      await db.query(
        `DELETE FROM ai_job_hunter.opportunities WHERE "ownerId" = $1 AND id = $2`,
        [LOCAL_OWNER_ID, localJob],
      );
    }
    for (const table of [ANSWERS, 'ai_job_hunter.opportunities'])
      await db.query(`DELETE FROM ${table} WHERE "ownerId" = ANY($1)`, [
        [ownerA, ownerB],
      ]);
    await db.destroy();
  }
});

test('the migration reverts, reapplies and repeat-runs without touching PR14 answers', async () => {
  await db.query(
    `INSERT INTO ${ANSWERS} ("ownerId","questionId",answer) VALUES ($1,'hr-intro-01','Synthetic kept answer.'),($1,$2,'Synthetic jd answer.')`,
    [ownerA, `jd-${randomUUID()}`],
  );
  const before = await db.query(
    `SELECT "questionId", answer, version, "updatedAt" FROM ${ANSWERS} WHERE "ownerId" = $1 ORDER BY "questionId"`,
    [ownerA],
  );
  expect(await exists(SETS)).toBe(true);
  expect(await exists(QUESTIONS)).toBe(true);
  const reverted = await revertThrough(
    db,
    'InterviewJobQuestions1794300000000',
  );
  expect(reverted[0]).toBe('InterviewJobQuestions1794300000000');
  expect(await exists(SETS)).toBe(false);
  expect(await exists(QUESTIONS)).toBe(false);
  expect((await db.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await db.runMigrations()).toEqual([]);
  expect(
    await db.query(
      `SELECT "questionId", answer, version, "updatedAt" FROM ${ANSWERS} WHERE "ownerId" = $1 ORDER BY "questionId"`,
      [ownerA],
    ),
  ).toEqual(before);
});

test('sets and questions cannot cross owners', async () => {
  const jobA = await job(ownerA);
  await expect(set(ownerB, jobA)).rejects.toMatchObject({
    driverError: { code: '23503' },
  });
  const setA = await set(ownerA, jobA);
  await expect(question(ownerB, setA)).rejects.toMatchObject({
    driverError: { code: '23503' },
  });
  await expect(question(ownerA, setA)).resolves.toHaveLength(1);
});

test('regenerating appends a set; positions are unique per set only', async () => {
  const jobA = await job(ownerA);
  const first = await set(ownerA, jobA);
  const second = await set(ownerA, jobA);
  await question(ownerA, first);
  await question(ownerA, second);
  await expect(question(ownerA, first)).rejects.toMatchObject({
    driverError: { code: '23505' },
  });
  const [newest] = await db.query(
    `SELECT id FROM ${SETS} WHERE "ownerId" = $1 AND "jobId" = $2 ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
    [ownerA, jobA],
  );
  expect(newest.id).toBe(second);
});

test('constraints reject malformed rows', async () => {
  const jobA = await job(ownerA);
  await expect(
    db.query(
      `INSERT INTO ${SETS} ("ownerId","jobId","jdHash") VALUES ($1,$2,'not-a-hash')`,
      [ownerA, jobA],
    ),
  ).rejects.toMatchObject({ driverError: { code: '23514' } });
  const setA = await set(ownerA, jobA);
  for (const bad of [
    { position: 0 },
    { position: 9 },
    { category: 'hr' },
    { kind: 'behavioural' },
    { question: 'Too short' },
    { question: ' Leading space is not trimmed?' },
    { question: 'Control \u0007 character question?' },
    { why: '' },
    { evidence: 'short quote' },
    { evidence: 'x'.repeat(301) },
  ])
    await expect(question(ownerA, setA, bad)).rejects.toMatchObject({
      driverError: { code: '23514' },
    });
});

test('deleting a job cascades to its sets and questions; answers are kept', async () => {
  const jobB = await job(ownerB);
  const setB = await set(ownerB, jobB);
  const [{ id }] = await question(ownerB, setB);
  await db.query(
    `INSERT INTO ${ANSWERS} ("ownerId","questionId",answer) VALUES ($1,$2,'Synthetic answer.')`,
    [ownerB, `jd-${id}`],
  );
  await db.query(
    `DELETE FROM ai_job_hunter.opportunities WHERE "ownerId" = $1 AND id = $2`,
    [ownerB, jobB],
  );
  expect(await count(SETS, ownerB)).toBe(0);
  expect(await count(QUESTIONS, ownerB)).toBe(0);
  expect(await count(ANSWERS, ownerB)).toBe(1);
});

// ------------------------------------------- Slice 2: answers and feedback
const generatedQuestion = async (ownerId: string, kind = 'general') => {
  const setId = await set(ownerId, await job(ownerId));
  const [{ id }] = await question(ownerId, setId, { kind });
  return `jd-${id as string}`;
};
const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error as { errorCode: string; current?: unknown };
  }
  throw new Error('expected an error');
};
const answer = (text: string, expectedVersion: number | null) => ({
  answer: text,
  expectedVersion,
});

test('generated questions use the PR14 save, update, conflict, list and remove semantics', async () => {
  const answers = new InterviewAnswersService(db);
  const id = await generatedQuestion(ownerA);
  const created = await answers.save(ownerA, id, answer('First.', null));
  expect(created).toMatchObject({
    questionId: id,
    answer: 'First.',
    version: 1,
  });
  const conflict = await errorOf(
    answers.save(ownerA, id, answer('Second create.', null)),
  );
  expect(conflict).toMatchObject({
    errorCode: 'INTERVIEW_ANSWER_CONFLICT',
    current: created,
  });
  const updated = await answers.save(ownerA, id, answer('Updated.', 1));
  expect(updated.version).toBe(2);
  expect(
    await errorOf(answers.save(ownerA, id, answer('Stale.', 1))),
  ).toMatchObject({ errorCode: 'INTERVIEW_ANSWER_CONFLICT', current: updated });
  expect(await answers.list(ownerA)).toContainEqual(updated);
  expect(await errorOf(answers.remove(ownerA, id, '1'))).toMatchObject({
    errorCode: 'INTERVIEW_ANSWER_CONFLICT',
    current: updated,
  });
  await answers.remove(ownerA, id, '2');
  expect((await answers.list(ownerA)).map((a) => a.questionId)).not.toContain(
    id,
  );
});

test('generated IDs are owner-scoped, exact-format, and must exist', async () => {
  const answers = new InterviewAnswersService(db);
  const ownedByB = await generatedQuestion(ownerB);
  const missing = `jd-${randomUUID()}`;
  for (const id of [
    ownedByB,
    missing,
    ownedByB.toUpperCase().replace('JD-', 'jd-'),
    `${ownedByB} `,
    'jd-not-a-uuid',
    'jd-',
  ]) {
    expect(
      await errorOf(answers.save(ownerA, id, answer('Nope.', null))),
    ).toMatchObject({ errorCode: 'INTERVIEW_INVALID_REQUEST' });
    expect(await errorOf(answers.remove(ownerA, id, '1'))).toMatchObject({
      errorCode: 'INTERVIEW_INVALID_REQUEST',
    });
  }
  expect(
    await db.query(
      `SELECT 1 FROM ${ANSWERS} WHERE "ownerId" = $1 AND "questionId" = ANY($2)`,
      [ownerA, [ownedByB, missing]],
    ),
  ).toEqual([]);
});

test('list hides answers whose generated question no longer exists, and keeps curated ones', async () => {
  const answers = new InterviewAnswersService(db);
  const jobId = await job(ownerA);
  const [{ id }] = await question(ownerA, await set(ownerA, jobId));
  const kept = await answers.save(ownerA, `jd-${id}`, answer('Kept.', null));
  const curated = await answers.save(
    ownerA,
    'hr-goals-01',
    answer('Curated.', null),
  );
  await db.query(
    `INSERT INTO ${ANSWERS} ("ownerId","questionId",answer) VALUES ($1,$2,'Orphan.')`,
    [ownerA, `jd-${randomUUID()}`],
  );
  let listed = await answers.list(ownerA);
  expect(listed).toEqual(expect.arrayContaining([kept, curated]));
  expect(listed.some((a) => a.answer === 'Orphan.')).toBe(false);
  await db.query(
    `DELETE FROM ai_job_hunter.opportunities WHERE "ownerId" = $1 AND id = $2`,
    [ownerA, jobId],
  );
  listed = await answers.list(ownerA);
  expect(listed.map((a) => a.questionId)).not.toContain(`jd-${id}`);
  expect(listed).toContainEqual(curated);
  // The hidden answer is still stored, never deleted.
  expect(await count(ANSWERS, ownerA)).toBeGreaterThanOrEqual(3);
});

test('feedback resolves the owner generated question and maps it to the PR14 contract', async () => {
  const prompts: string[] = [];
  const ai = {
    generateStructured: (r: { prompt: string }) => {
      prompts.push(r.prompt);
      return Promise.resolve({
        suggestion: '',
        followUpQuestions: [],
        phrases: [],
      });
    },
  } as unknown as AiService;
  const cv = {
    reviewedFacts: () => Promise.resolve(null),
  } as unknown as TailoredDraftService;
  const service = new InterviewPrepService(ai, cv, db);
  const id = await generatedQuestion(ownerA);
  const res = await service.feedback(ownerA, {
    questionId: id,
    mode: 'express',
    answer: 'MVCC giữ nhiều phiên bản của dòng dữ liệu.',
  });
  expect(res).toMatchObject({ contractVersion: '1', mode: 'express' });
  expect(prompts[0]).toContain('How does PostgreSQL MVCC work?');
  // PR21: the stored why is fenced context for the feedback prompt.
  expect(prompts[0]).toContain('"""The JD requires PostgreSQL."""');
  for (const questionId of [
    await generatedQuestion(ownerB),
    `jd-${randomUUID()}`,
  ])
    expect(
      await errorOf(
        service.feedback(ownerA, { questionId, mode: 'express', answer: 'x' }),
      ),
    ).toMatchObject({ errorCode: 'INTERVIEW_INVALID_REQUEST' });
  expect(
    await errorOf(
      service.feedback(ownerA, {
        questionId: id,
        mode: 'express',
        answer: 'x',
        variant: 1,
      }),
    ),
  ).toMatchObject({ errorCode: 'INTERVIEW_INVALID_REQUEST' });
  expect(prompts).toHaveLength(1);
});

test('HTTP: guarded PUT, list and DELETE work for the local owner generated question', async () => {
  localJob = await job(LOCAL_OWNER_ID);
  const [{ id }] = await question(
    LOCAL_OWNER_ID,
    await set(LOCAL_OWNER_ID, localJob),
  );
  const qid = `jd-${id as string}`;
  const server = app.getHttpServer();
  const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
  await request(server)
    .put(`/api/v1/interview-prep/answers/${qid}`)
    .send(answer('No origin.', null))
    .expect(403);
  const put = await request(server)
    .put(`/api/v1/interview-prep/answers/${qid}`)
    .set(origin)
    .send(answer('Local answer.', null))
    .expect(200);
  expect(put.body).toMatchObject({ questionId: qid, version: 1 });
  const list = await request(server)
    .post('/api/v1/interview-prep/answers/list')
    .set(origin)
    .send({ contractVersion: '1' })
    .expect(200);
  expect(list.body.answers).toContainEqual(put.body);
  const bad = await request(server)
    .put(`/api/v1/interview-prep/answers/jd-${randomUUID()}`)
    .set(origin)
    .send(answer('Missing.', null))
    .expect(400);
  expect(bad.body.errorCode).toBe('INTERVIEW_INVALID_REQUEST');
  await request(server)
    .delete(`/api/v1/interview-prep/answers/${qid}?expectedVersion=1`)
    .set(origin)
    .expect(204);
});

test('PR16 transcription resolves only the owner’s JD question for a short vocabulary hint', async () => {
  const stt = fakeStt();
  const env = { ...process.env };
  process.env.STT_BIN = stt.bin;
  process.env.STT_MODEL = stt.model;
  try {
    const jobId = await job(ownerA);
    const [row] = await question(ownerA, await set(ownerA, jobId));
    const id = `jd-${row.id}`;
    const service = new TranscriptionService(db);
    const go = (owner: string) =>
      service.transcribe(
        owner,
        Object.assign(Readable.from([wav()]), {
          headers: { 'content-type': 'audio/wav' },
        }) as unknown as IncomingMessage,
        id,
        new AbortController().signal,
      );
    const own = await go(ownerA);
    expect(own.transcript).toContain(
      'PROMPT=Technical terms: PostgreSQL, MVCC.',
    );
    // JD evidence/why text never reaches the prompt.
    expect(own.transcript).not.toMatch(/JD requires|Strong/u);
    await expect(go(ownerB)).rejects.toMatchObject({
      errorCode: 'INTERVIEW_INVALID_REQUEST',
    });
  } finally {
    process.env = env;
  }
});
