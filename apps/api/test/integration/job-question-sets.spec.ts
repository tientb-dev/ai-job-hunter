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
import { AiService } from '../../src/ai/ai.service.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { JobQuestionsService } from '../../src/interview-prep/job-questions.service.js';
import { InterviewAnswersService } from '../../src/interview-prep/interview-answers.service.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';

let db: DataSource;
let app: INestApplication;
let service: JobQuestionsService;
const generateStructured =
  jest.fn<(r: { prompt: string }) => Promise<unknown>>();
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const otherOwner = randomUUID();
const jobs: string[] = [];
const SECRET = 'PRIVATE-NOTE-7f3a';
const SETS = 'ai_job_hunter.interview_question_sets';

// Synthetic JD; private fields carry a marker that must never leave the server.
const DESCRIPTION =
  'You will build event-driven services.\nStrong experience with PostgreSQL and Kafka is required.\nDesign REST APIs for high traffic.\nMonitor and troubleshoot production incidents.';
async function job(ownerId = LOCAL_OWNER_ID, description = DESCRIPTION) {
  const [{ id }] = await db.query(
    `INSERT INTO ai_job_hunter.opportunities ("ownerId",title,company,source,status,"originalLink","contactNotes",description,notes,skills,"postText")
     VALUES ($1,'Synthetic Backend Engineer','Example Company','Other','SAVED','https://example.com/private-${SECRET}',$2,$3,$2,'Node.js, TypeScript, PostgreSQL',$2) RETURNING id`,
    [ownerId, SECRET, description],
  );
  jobs.push(id);
  return id as string;
}
const good = [
  [
    'How does PostgreSQL MVCC handle concurrent updates?',
    'skill',
    'general',
    'Strong experience with PostgreSQL and Kafka is required',
  ],
  [
    'How would you design REST APIs for high traffic in Node.js?',
    'architecture',
    'hypothetical',
    'Design REST APIs for high traffic',
  ],
  [
    'How would you troubleshoot a sudden latency spike in production?',
    'troubleshooting',
    'hypothetical',
    'Monitor and troubleshoot production incidents',
  ],
  [
    'Have you worked with Kafka? If so, how did you handle consumer lag?',
    'experience',
    'personal',
    'Strong experience with PostgreSQL and Kafka is required',
  ],
  [
    'What makes an event-driven service easier to scale?',
    'skill',
    'general',
    'You will build event-driven services',
  ],
  [
    'How would you keep TypeScript types consistent across services?',
    'skill',
    'hypothetical',
    'Node.js, TypeScript, PostgreSQL',
  ],
] as const;
const item = ([question, category, kind, evidence]: readonly string[]) => ({
  question,
  category,
  kind,
  why: 'Checks a requirement stated in the JD.',
  evidence,
});
const output = (n: number, from = 0) => ({
  questions: good.slice(from, from + n).map(item),
});
// Distinct, JD-grounded questions for a regenerated set.
const fresh = [
  [
    'What are the trade-offs of PostgreSQL indexes on write-heavy tables?',
    'skill',
    'general',
    'Strong experience with PostgreSQL and Kafka is required',
  ],
  [
    'How would you version REST APIs without breaking existing clients?',
    'architecture',
    'hypothetical',
    'Design REST APIs for high traffic',
  ],
  [
    'How would you find the root cause of intermittent production errors?',
    'troubleshooting',
    'hypothetical',
    'Monitor and troubleshoot production incidents',
  ],
  [
    'Why do Kafka partitions matter for message ordering guarantees?',
    'skill',
    'general',
    'Strong experience with PostgreSQL and Kafka is required',
  ],
  [
    'How would you structure TypeScript error handling across Node.js services?',
    'skill',
    'hypothetical',
    'Node.js, TypeScript, PostgreSQL',
  ],
] as const;
const freshOutput = (n: number) => ({ questions: fresh.slice(0, n).map(item) });
const bad = {
  question: 'Tell me about your experience with MongoDB?',
  category: 'experience',
  kind: 'personal',
  why: 'x',
  evidence: 'not in the job description at all',
};
const list = (jobId: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/interview-prep/jobs/${jobId}/sets/list`)
    .set(origin)
    .send({ contractVersion: '1' });
const generate = (jobId: string, basedOnSetId: string | null = null) =>
  request(app.getHttpServer())
    .post(`/api/v1/interview-prep/jobs/${jobId}/sets`)
    .set(origin)
    .send({ contractVersion: '1', basedOnSetId });
const setCount = async (jobId: string) =>
  Number(
    (
      await db.query(
        `SELECT count(*)::int AS n FROM ${SETS} WHERE "jobId" = $1`,
        [jobId],
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
    .overrideProvider(AiService)
    .useValue({ generateStructured })
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  service = app.get(JobQuestionsService);
});
beforeEach(() => {
  generateStructured.mockReset();
});
afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    await db.query(
      `DELETE FROM ai_job_hunter.interview_answers WHERE "questionId" IN (
         SELECT 'jd-' || q.id::text FROM ai_job_hunter.interview_job_questions q
         JOIN ${SETS} s ON s.id = q."setId" WHERE s."jobId" = ANY($1))`,
      [jobs],
    );
    await db.query(
      'DELETE FROM ai_job_hunter.opportunities WHERE id = ANY($1)',
      [jobs],
    );
    await db.destroy();
  }
});

test('first generation persists 5–8 grounded questions; list shows them with stable IDs and no private fields', async () => {
  const jobId = await job();
  expect((await list(jobId).expect(200)).body).toEqual({
    contractVersion: '1',
    job: {
      id: jobId,
      title: 'Synthetic Backend Engineer',
      company: 'Example Company',
    },
    jdEmpty: false,
    jdChanged: false,
    sets: [],
  });
  generateStructured.mockResolvedValueOnce({
    questions: [...output(6).questions, bad],
  });
  const res = await generate(jobId).expect(201);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body.partial).toBe(false);
  expect(res.body.set.questions).toHaveLength(6);
  expect(
    res.body.set.questions.map((q: { position: number }) => q.position),
  ).toEqual([1, 2, 3, 4, 5, 6]);
  for (const q of res.body.set.questions)
    expect(q.id).toMatch(/^jd-[0-9a-f-]{36}$/u);
  expect(generateStructured).toHaveBeenCalledTimes(1);
  // Only JD fields reach the model, and nothing private reaches the client.
  const prompt = generateStructured.mock.calls[0]![0].prompt;
  expect(prompt).toContain('Strong experience with PostgreSQL');
  expect(prompt).not.toContain(SECRET);
  expect(prompt).not.toContain('Example Company');
  // Initial generation has no avoid list.
  expect(prompt).not.toContain('already chosen');
  const listed = (await list(jobId).expect(200)).body;
  expect(listed.sets).toEqual([res.body.set]);
  expect(JSON.stringify(listed)).not.toContain(SECRET);
  expect(JSON.stringify(res.body)).not.toContain(SECRET);
});

test('regeneration appends a new active set and preserves previous sets and answers', async () => {
  const jobId = await job();
  generateStructured.mockResolvedValueOnce(output(5));
  const first = (await generate(jobId).expect(201)).body.set;
  const answers = new InterviewAnswersService(db);
  const saved = await answers.save(LOCAL_OWNER_ID, first.questions[0].id, {
    answer: 'Synthetic prepared answer.',
    expectedVersion: null,
  });
  // A stale tab (basedOnSetId null) cannot silently create another set.
  generateStructured.mockResolvedValue(freshOutput(5));
  expect((await generate(jobId, null).expect(409)).body.errorCode).toBe(
    'INTERVIEW_SET_OUTDATED',
  );
  // No model call for the stale request (the one call is the first generation).
  expect(generateStructured).toHaveBeenCalledTimes(1);
  const second = (await generate(jobId, first.id).expect(201)).body.set;
  const listed = (await list(jobId).expect(200)).body;
  expect(
    listed.sets.map((s: { id: string; active: boolean }) => [s.id, s.active]),
  ).toEqual([
    [second.id, true],
    [first.id, false],
  ]);
  expect(listed.sets[1].questions).toEqual(first.questions);
  // The previous set's question is still practicable and its answer listed.
  expect(await answers.list(LOCAL_OWNER_ID)).toContainEqual(saved);
  await expect(
    answers.save(LOCAL_OWNER_ID, first.questions[0].id, {
      answer: 'Updated while a newer set exists.',
      expectedVersion: 1,
    }),
  ).resolves.toMatchObject({ version: 2 });
});

test('a thin first response retries once with an avoid list, pooling without duplicates', async () => {
  const jobId = await job();
  generateStructured
    .mockResolvedValueOnce({ questions: [...output(3).questions, bad] })
    .mockResolvedValueOnce(output(4)); // 3 duplicates + 1 new
  const res = await generate(jobId).expect(201);
  expect(generateStructured).toHaveBeenCalledTimes(2);
  expect(generateStructured.mock.calls[1]![0].prompt).toContain(
    `already chosen; write DIFFERENT ones:\n  - ${good[0][0]}`,
  );
  expect(res.body).toMatchObject({ partial: true });
  expect(
    res.body.set.questions.map((q: { question: string }) => q.question),
  ).toEqual(good.slice(0, 4).map((g) => g[0]));
});

test('fewer than 3 valid after the retry fails without persisting', async () => {
  const jobId = await job();
  generateStructured
    .mockResolvedValueOnce(output(1))
    .mockResolvedValueOnce({ questions: [bad] });
  expect((await generate(jobId).expect(422)).body).toEqual({
    statusCode: 422,
    errorCode: 'INTERVIEW_TOO_FEW_QUESTIONS',
    message:
      "The AI couldn't produce enough questions grounded in this job description. Nothing was saved — try again.",
  });
  expect(await setCount(jobId)).toBe(0);
});

test('AI timeout, unavailable and invalid output are not retried and persist nothing', async () => {
  const jobId = await job();
  for (const [code, status, errorCode] of [
    ['TIMEOUT', 504, 'INTERVIEW_TIMEOUT'],
    ['CONNECTION_FAILURE', 503, 'INTERVIEW_AI_UNAVAILABLE'],
    ['SCHEMA_VALIDATION_FAILURE', 502, 'INTERVIEW_INVALID_OUTPUT'],
  ] as const) {
    generateStructured.mockReset();
    generateStructured.mockRejectedValueOnce(new AiError(code));
    const res = await generate(jobId).expect(status);
    expect(res.body.errorCode).toBe(errorCode);
    expect(generateStructured).toHaveBeenCalledTimes(1);
  }
  expect(await setCount(jobId)).toBe(0);
});

test('a failed retry keeps a 3–4 question first result; otherwise returns the AI error', async () => {
  const jobId = await job();
  generateStructured
    .mockResolvedValueOnce(output(3))
    .mockRejectedValueOnce(new AiError('TIMEOUT'));
  expect((await generate(jobId).expect(201)).body.partial).toBe(true);
  const other = await job();
  generateStructured
    .mockResolvedValueOnce(output(2))
    .mockRejectedValueOnce(new AiError('TIMEOUT'));
  expect((await generate(other).expect(504)).body.errorCode).toBe(
    'INTERVIEW_TIMEOUT',
  );
  expect(await setCount(other)).toBe(0);
});

test('a JD edit during generation discards the result', async () => {
  const jobId = await job();
  generateStructured.mockImplementationOnce(async () => {
    await db.query(
      `UPDATE ai_job_hunter.opportunities SET description = description || ' Also Redis.' WHERE id = $1`,
      [jobId],
    );
    return output(5);
  });
  expect((await generate(jobId).expect(409)).body.errorCode).toBe(
    'INTERVIEW_JD_CHANGED',
  );
  expect(await setCount(jobId)).toBe(0);
  expect((await list(jobId).expect(200)).body.sets).toEqual([]);
});

test('list reports a JD change after generation without regenerating', async () => {
  const jobId = await job();
  generateStructured.mockResolvedValueOnce(output(5));
  await generate(jobId).expect(201);
  await db.query(
    `UPDATE ai_job_hunter.opportunities SET skills = skills || ', Go' WHERE id = $1`,
    [jobId],
  );
  const listed = (await list(jobId).expect(200)).body;
  expect(listed.jdChanged).toBe(true);
  expect(listed.sets).toHaveLength(1);
  expect(generateStructured).toHaveBeenCalledTimes(1);
});

test('concurrent Generate requests: one succeeds, the other is rejected', async () => {
  const jobId = await job();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  generateStructured.mockImplementation(async () => {
    await gate;
    return output(5);
  });
  const a = generate(jobId).then((r) => r);
  await new Promise((r) => setTimeout(r, 50));
  const b = await generate(jobId);
  release();
  const statuses = [(await a).status, b.status].sort();
  expect(statuses).toEqual([201, 409]);
  expect(b.body.errorCode).toBe('INTERVIEW_BUSY');
  expect(await setCount(jobId)).toBe(1);
});

test('the persistence transaction rejects a set created after the pre-check', async () => {
  const jobId = await job();
  generateStructured.mockImplementationOnce(async () => {
    // Another process creates a set while this generation is running.
    await db.query(
      `INSERT INTO ${SETS} ("ownerId","jobId","jdHash") VALUES ($1,$2,$3)`,
      [LOCAL_OWNER_ID, jobId, 'b'.repeat(64)],
    );
    return output(5);
  });
  expect((await generate(jobId).expect(409)).body.errorCode).toBe(
    'INTERVIEW_SET_OUTDATED',
  );
  expect(await setCount(jobId)).toBe(1);
});

test('empty JD, unknown and other-owner jobs, bad bodies and missing Origin are rejected', async () => {
  const empty = await job(LOCAL_OWNER_ID, '');
  expect((await list(empty).expect(200)).body.jdEmpty).toBe(true);
  expect((await generate(empty).expect(422)).body.errorCode).toBe(
    'INTERVIEW_JD_EMPTY',
  );
  const foreign = await job(otherOwner);
  for (const id of [foreign, randomUUID()]) {
    expect((await list(id).expect(404)).body.errorCode).toBe(
      'INTERVIEW_JOB_NOT_FOUND',
    );
    expect((await generate(id).expect(404)).body.errorCode).toBe(
      'INTERVIEW_JOB_NOT_FOUND',
    );
  }
  // The other owner's job stays usable for its owner (service level).
  await expect(
    service.list(otherOwner, foreign, { contractVersion: '1' }),
  ).resolves.toMatchObject({ job: { id: foreign } });
  const server = app.getHttpServer();
  const jobId = await job();
  await request(server)
    .post(`/api/v1/interview-prep/jobs/${jobId}/sets`)
    .send({ contractVersion: '1', basedOnSetId: null })
    .expect(403);
  await request(server)
    .post(`/api/v1/interview-prep/jobs/${jobId}/sets/list`)
    .send({ contractVersion: '1' })
    .expect(403);
  for (const body of [
    {},
    { contractVersion: '1' },
    { contractVersion: '2', basedOnSetId: null },
    { contractVersion: '1', basedOnSetId: 'not-a-uuid' },
    { contractVersion: '1', basedOnSetId: null, extra: 1 },
  ])
    expect(
      (
        await request(server)
          .post(`/api/v1/interview-prep/jobs/${jobId}/sets`)
          .set(origin)
          .send(body)
          .expect(400)
      ).body.errorCode,
    ).toBe('INTERVIEW_INVALID_REQUEST');
  await request(server)
    .post('/api/v1/interview-prep/jobs/not-a-uuid/sets/list')
    .set(origin)
    .send({ contractVersion: '1' })
    .expect(400);
  await request(server)
    .post(`/api/v1/interview-prep/jobs/${jobId}/sets/list`)
    .set(origin)
    .send({ contractVersion: '1', more: true })
    .expect(400);
  expect(generateStructured).not.toHaveBeenCalled();
});

// ------------------------------------------- meaningful regeneration
const regenerate = async (jobId: string) => {
  generateStructured.mockResolvedValueOnce(output(5));
  const first = (await generate(jobId).expect(201)).body.set;
  const answers = new InterviewAnswersService(db);
  const saved = await answers.save(LOCAL_OWNER_ID, first.questions[0].id, {
    answer: 'Synthetic kept answer.',
    expectedVersion: null,
  });
  return { first, saved, answers };
};

test('regeneration sends the active set as an avoid list and accepts only new, grounded questions', async () => {
  const jobId = await job();
  const { first } = await regenerate(jobId);
  generateStructured.mockResolvedValueOnce({
    questions: [
      ...output(2).questions, // exact duplicates of the active set
      item([
        `${good[2][0].replace('?', '')} quickly?`,
        'troubleshooting',
        'hypothetical',
        good[2][3],
      ]), // near-duplicate
      ...freshOutput(5).questions,
      bad,
    ],
  });
  const res = await generate(jobId, first.id).expect(201);
  const prompt = generateStructured.mock.calls[1]![0].prompt;
  for (const q of first.questions)
    expect(prompt).toContain(`  - ${q.question as string}`);
  expect(prompt).toMatch(/Explore other technical angles of the same JD/u);
  expect(res.body.partial).toBe(false);
  expect(
    res.body.set.questions.map((q: { question: string }) => q.question),
  ).toEqual(fresh.map((f) => f[0]));
  expect(generateStructured).toHaveBeenCalledTimes(2);
});

test('regeneration with 3–4 new questions is saved as partial after one retry', async () => {
  const jobId = await job();
  const { first } = await regenerate(jobId);
  generateStructured
    .mockResolvedValueOnce({
      questions: [...output(5).questions, ...freshOutput(2).questions],
    })
    .mockResolvedValueOnce({ questions: [...freshOutput(3).questions] });
  const res = await generate(jobId, first.id).expect(201);
  expect(generateStructured).toHaveBeenCalledTimes(3);
  // The retry avoids both the active set and the new questions so far.
  const retry = generateStructured.mock.calls[2]![0].prompt;
  expect(retry).toContain(`  - ${good[0][0]}`);
  expect(retry).toContain(`  - ${fresh[0][0]}`);
  expect(res.body.partial).toBe(true);
  expect(res.body.set.questions).toHaveLength(3);
});

test('fewer than 3 new questions stores nothing and keeps every set and answer', async () => {
  const jobId = await job();
  const { first, saved, answers } = await regenerate(jobId);
  generateStructured
    .mockResolvedValueOnce(output(5)) // identical to the active set
    .mockResolvedValueOnce({
      questions: [...output(5).questions, ...freshOutput(2).questions],
    });
  const res = await generate(jobId, first.id).expect(422);
  expect(res.body).toEqual({
    statusCode: 422,
    errorCode: 'INTERVIEW_NO_NEW_QUESTIONS',
    message:
      "This job description didn't give enough new questions beyond the current set. Nothing was saved and your current questions are unchanged. Adding more technical detail to the JD can help.",
  });
  expect(await setCount(jobId)).toBe(1);
  const listed = (await list(jobId).expect(200)).body;
  expect(listed.sets.map((s: { id: string }) => s.id)).toEqual([first.id]);
  expect(listed.sets[0].questions).toEqual(first.questions);
  expect(await answers.list(LOCAL_OWNER_ID)).toContainEqual(saved);
});

test('regeneration compares with the active set only, not older sets', async () => {
  const jobId = await job();
  const { first } = await regenerate(jobId);
  generateStructured.mockResolvedValueOnce(freshOutput(5));
  const second = (await generate(jobId, first.id).expect(201)).body.set;
  // Questions from the older (first) set are allowed again.
  generateStructured.mockResolvedValueOnce(output(5));
  const third = (await generate(jobId, second.id).expect(201)).body.set;
  expect(third.questions.map((q: { question: string }) => q.question)).toEqual(
    good.slice(0, 5).map((g) => g[0]),
  );
  expect(generateStructured.mock.calls.at(-1)![0].prompt).not.toContain(
    `  - ${good[0][0]}`,
  );
  expect(await setCount(jobId)).toBe(3);
});

test('regeneration keeps the stale-tab and JD-change protections', async () => {
  const jobId = await job();
  const { first } = await regenerate(jobId);
  generateStructured.mockImplementationOnce(async () => {
    await db.query(
      `UPDATE ai_job_hunter.opportunities SET description = description || ' Also Go.' WHERE id = $1`,
      [jobId],
    );
    return freshOutput(5);
  });
  expect((await generate(jobId, first.id).expect(409)).body.errorCode).toBe(
    'INTERVIEW_JD_CHANGED',
  );
  generateStructured.mockResolvedValueOnce(freshOutput(5));
  expect((await generate(jobId, null).expect(409)).body.errorCode).toBe(
    'INTERVIEW_SET_OUTDATED',
  );
  expect(await setCount(jobId)).toBe(1);
});

test('regeneration rejects close paraphrases of the active set (0.60) but keeps new angles', async () => {
  const jobId = await job();
  const { first } = await regenerate(jobId);
  generateStructured.mockResolvedValueOnce({
    questions: [
      // ~0.67 overlap with active question 1: allowed by 0.75, rejected by 0.60.
      item([
        'How does PostgreSQL MVCC handle many concurrent writes?',
        'skill',
        'general',
        good[0][3],
      ]),
      ...freshOutput(5).questions,
    ],
  });
  const res = await generate(jobId, first.id).expect(201);
  expect(res.body.partial).toBe(false);
  expect(
    res.body.set.questions.map((q: { question: string }) => q.question),
  ).toEqual(fresh.map((f) => f[0]));
});
