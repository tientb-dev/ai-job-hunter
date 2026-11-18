import { asLocalOwner } from '../support/as-local-owner.js';
import type { GenerationRequest } from '../../src/ai/ai-provider.js';
import type { MatchRequirement } from '../../src/matching/cv-match.js';
import { SavedCv1793500000000 } from '../../src/database/migrations/1793500000000-SavedCv.js';
import { MultiCv1794800000000 } from '../../src/database/migrations/1794800000000-MultiCv.js';
import { CvOriginalFile1794900000000 } from '../../src/database/migrations/1794900000000-CvOriginalFile.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { databaseOptions } from '../../src/database/database.config.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { OpportunitiesModule } from '../../src/opportunities/opportunities.module.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { pdfFixture } from '../support/pdf-fixtures.js';
import { revertThrough } from '../support/migration-revert.js';
import { MATCHING_POLICY_VERSION } from '../../src/matching/match-context.js';
import {
  completeReview,
  removeReviews,
  reviseReview,
} from '../support/completed-review.js';
let app: INestApplication;
let database: DataSource;
let id: string;
let ownsCv = false;
let generations = 0;
const origin = { Origin: 'http://127.0.0.1:5173', Host: '127.0.0.1:3000' };
const syntheticName = 'synthetic-match-cv.pdf';
// Beta guide fixtures; the PDF needs a bundled standard font (Windows regression).
const betaSamples = ['synthetic-cv.docx', 'synthetic-cv.pdf'];
beforeAll(async () => {
  database = new DataSource(databaseOptions('test'));
  await database.initialize();
  await database.runMigrations();
  // Never replace an existing test fixture owned by another test run.
  expect(
    await database.query('SELECT "ownerId" FROM ai_job_hunter.saved_cvs'),
  ).toEqual([]);
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, OpportunitiesModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({
      generate: async (request: GenerationRequest) => {
        generations++;
        const data = JSON.parse(request.prompt.split('\n').at(-1)!) as {
          cv: string;
          canonicalRequirements: MatchRequirement[];
        };
        return JSON.stringify({
          // Prompt-only group metadata is input context, not model output.
          requirements: data.canonicalRequirements.map((item) => ({
            parentId: item.parentId,
            requirement: item.requirement,
            priority: item.priority,
            category: item.category,
            jdQuote: item.jdQuote,
            cvQuote: data.cv.includes(`Built ${item.requirement} services.`)
              ? `Built ${item.requirement} services.`
              : '',
          })),
        });
      },
    })
    .compile();
  app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app?.close();
  if (database?.isInitialized) {
    await removeReviews(database, LOCAL_OWNER_ID);
    // Jobs first: a CV a job or match still references cannot be deleted.
    if (id)
      await database.query(
        'DELETE FROM ai_job_hunter.opportunities WHERE id=$1 AND title=$2',
        [id, 'Synthetic CV match fixture'],
      );
    if (ownsCv)
      await database.query(
        'DELETE FROM ai_job_hunter.saved_cvs WHERE "ownerId"=$1 AND "fileName"=ANY($2)',
        [LOCAL_OWNER_ID, [syntheticName, ...betaSamples]],
      );
    await database.destroy();
  }
});
test('match review-revision migration reverts, reapplies and repeat-runs', async () => {
  const column = async () =>
    (
      await database.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema='ai_job_hunter' AND table_name='cv_matches'
            AND column_name='profileRevisionId'`,
      )
    ).length;
  expect(await column()).toBe(1);
  const reverted = await revertThrough(
    database,
    'MatchProfileRevision1795100000000',
  );
  expect(reverted).toEqual(['MatchProfileRevision1795100000000']);
  expect(await column()).toBe(0);
  expect((await database.runMigrations()).map((m) => m.name)).toEqual(reverted);
  expect(await column()).toBe(1);
  expect(await database.runMigrations()).toEqual([]);
});
test('new migration reverses reapplies and repeat-runs without touching jobs', async () => {
  const before = await database.query(
    'SELECT id, "updatedAt" FROM ai_job_hunter.opportunities ORDER BY id',
  );
  const runner = database.createQueryRunner();
  await runner.connect();
  const migration = new SavedCv1793500000000();
  // Exercise this historical migration without discarding later additive columns.
  await runner.startTransaction();
  try {
    await new CvOriginalFile1794900000000().down(runner);
    await new MultiCv1794800000000().down(runner);
    await migration.down(runner);
    expect(
      await runner.query(
        "SELECT to_regclass('ai_job_hunter.saved_cvs') AS name",
      ),
    ).toEqual([{ name: null }]);
    await migration.up(runner);
    expect(
      await runner.query('SELECT "ownerId" FROM ai_job_hunter.saved_cvs'),
    ).toEqual([]);
    await new MultiCv1794800000000().up(runner);
    await new CvOriginalFile1794900000000().up(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  expect(await database.runMigrations()).toEqual([]);
  expect(
    await database.query(
      'SELECT id, "updatedAt" FROM ai_job_hunter.opportunities ORDER BY id',
    ),
  ).toEqual(before);
});
test('synthetic CV upload persists and matching reuses latest CV/job without modifying tracker', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/cv')
    .set({ ...origin, Origin: 'https://example.invalid' })
    .expect(403);
  const saved = await request(app.getHttpServer())
    .post('/api/v1/opportunities/cv')
    .set(origin)
    .field('record', '{}')
    .attach('document', Buffer.from(pdfFixture(['Built Python services.'])), {
      filename: syntheticName,
      contentType: 'application/pdf',
    })
    .expect(200);
  ownsCv = true;
  expect(saved.body.fileName).toBe(syntheticName);
  expect(saved.body.text).toBeUndefined();
  expect(generations).toBe(0);
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [stored] = await fresh.query(
      'SELECT text FROM ai_job_hunter.saved_cvs WHERE "ownerId"=$1',
      [LOCAL_OWNER_ID],
    );
    expect(stored.text).toContain('Built Python services.');
  } finally {
    await fresh.destroy();
  }
  await request(app.getHttpServer())
    .get('/api/v1/opportunities/cv/current')
    .expect(200)
    .expect((response) => expect(response.body.fileName).toBe(syntheticName));
  const input = {
    title: 'Synthetic CV match fixture',
    company: '',
    source: 'Other',
    status: 'INTERVIEW',
    originalLink: '',
    contactNotes: '',
    description: 'Python required',
    skills: 'Python',
    notes: 'Synthetic tracking notes',
    contactDates: ['2026-10-30'],
    followUpDate: '2026-11-02',
  };
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send(input)
    .expect(201);
  id = created.body.id;
  await completeReview(database, LOCAL_OWNER_ID, saved.body.id);
  const first = await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${id}/match`)
    .set(origin)
    .expect(200);
  expect(first.body).toMatchObject({
    score: 100,
    recommendation: 'Apply',
    evaluability: { total: 1, evaluated: 1, low: false },
    guidance: {
      recommendation: 'WORTH_APPLYING',
      confidence: 'NORMAL',
      actions: [],
    },
  });
  // Guidance is persisted with the assessment and served unchanged.
  const current = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}/match`)
    .expect(200);
  expect(current.body).toMatchObject({
    status: 'VALID',
    result: {
      guidance: first.body.guidance,
      evaluability: first.body.evaluability,
    },
  });
  const unchanged = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(unchanged.body).toEqual(created.body);
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send({ ...input, skills: 'Python, Java' })
    .expect(200);
  const second = await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${id}/match`)
    .set(origin)
    .expect(200);
  expect(second.body.score).toBe(50);
  expect(second.body.requirements).toContainEqual(
    expect.objectContaining({ requirement: 'Java', status: 'NOT_EVIDENCED' }),
  );
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/cv')
    .set(origin)
    .field('record', '{}')
    .attach('document', Buffer.from(pdfFixture(['Built Java services.'])), {
      filename: syntheticName,
      contentType: 'application/pdf',
    })
    .expect(200)
    .then(({ body }) =>
      request(app.getHttpServer())
        .put(`/api/v1/opportunities/${id}/cv/current`)
        .set(origin)
        .send({ cvId: body.id })
        .expect(200),
    );
  // A newly uploaded CV is matched only after its own review.
  await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${id}/match`)
    .set(origin)
    .expect(409);
  await completeReview(
    database,
    LOCAL_OWNER_ID,
    (
      await request(app.getHttpServer())
        .get(`/api/v1/opportunities/${id}/cv/current`)
        .expect(200)
    ).body.id,
  );
  const third = await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${id}/match`)
    .set(origin)
    .expect(200);
  expect(third.body.score).toBe(50);
  expect(third.body.requirements).toContainEqual(
    expect.objectContaining({
      requirement: 'Java',
      status: 'EVIDENCED',
      cvQuote: 'Built Java services.',
    }),
  );
  expect(generations).toBe(3); // Mock provider only; no Ollama calls.
  const tracker = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(tracker.body).toMatchObject({
    status: 'INTERVIEW',
    notes: input.notes,
    contactDates: input.contactDates,
    followUpDate: input.followUpDate,
  });
});
// Runs before the restart test: closing a restarted context closes the
// shared extraction owner for later tests in this file.
test('beta sample DOCX and PDF upload over HTTP as separate CVs', async () => {
  const upload = (fileName: string, contentType: string) =>
    request(app.getHttpServer())
      .post('/api/v1/opportunities/cv')
      .set(origin)
      .field('record', '{}')
      .attach(
        'document',
        readFileSync(
          resolve(process.cwd(), '../../docs/beta-samples', fileName),
        ),
        { filename: fileName, contentType },
      )
      .expect((response) =>
        expect([fileName, response.status, response.body]).toEqual([
          fileName,
          200,
          {
            id: expect.any(String),
            name: fileName,
            fileName,
            isDefault: false,
            updatedAt: expect.any(String),
            fileSize: expect.any(Number),
            originalAvailable: true,
          },
        ]),
      );
  ownsCv = true;
  await upload(
    'synthetic-cv.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  await upload('synthetic-cv.pdf', 'application/pdf');
  const [stored] = await database.query(
    'SELECT "fileName", text FROM ai_job_hunter.saved_cvs WHERE "ownerId"=$1 AND "fileName"=$2',
    [LOCAL_OWNER_ID, 'synthetic-cv.pdf'],
  );
  expect(stored.fileName).toBe('synthetic-cv.pdf');
  expect(stored.text).toContain(
    '- Built REST APIs with Node.js, TypeScript and NestJS.',
  );
});

const uploadCv = async (line: string) =>
  (
    await request(app.getHttpServer())
      .post('/api/v1/opportunities/cv')
      .set(origin)
      .field('record', '{}')
      .attach('document', Buffer.from(pdfFixture([line])), {
        filename: syntheticName,
        contentType: 'application/pdf',
      })
      .expect(200)
  ).body as { id: string; isDefault: boolean; updatedAt: string };
// Spec tests accumulate synthetic CVs; free the ones no job uses before adding more.
const freeUnusedCvs = async () => {
  const server = app.getHttpServer();
  for (const cv of (await request(server).get('/api/v1/opportunities/cv'))
    .body as { id: string }[])
    await request(server)
      .delete(`/api/v1/opportunities/cv/${cv.id}`)
      .set(origin);
};
const selectCv = (job: string, cvId: string, status = 200) =>
  request(app.getHttpServer())
    .put(`/api/v1/opportunities/${job}/cv/current`)
    .set(origin)
    .send({ cvId })
    .expect(status);
test('CV originals download byte-for-byte and accounts keep at most 5 CVs, even under concurrent uploads', async () => {
  const server = app.getHttpServer();
  ownsCv = true;
  const added: string[] = [];
  const upload = (name: string, bytes: Buffer) =>
    request(server)
      .post('/api/v1/opportunities/cv')
      .set(origin)
      .field('record', '{}')
      .attach('document', bytes, {
        filename: name,
        contentType: 'application/pdf',
      });
  const count = async () =>
    (await request(server).get('/api/v1/opportunities/cv').expect(200)).body
      .length as number;
  try {
    const bytes = Buffer.from(pdfFixture(['Built Download services.']));
    const name = 'CV Tiến – bản gốc.pdf';
    await freeUnusedCvs();
    if ((await count()) >= 5) throw new Error('Fixture needs a free CV slot.');
    const saved = await upload(name, bytes).expect(200);
    added.push(saved.body.id);
    expect(saved.body).toMatchObject({
      fileName: name,
      fileSize: bytes.length,
      originalAvailable: true,
    });
    const file = await request(server)
      .get(`/api/v1/opportunities/cv/${saved.body.id}/file`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(file.body as Buffer, bytes)).toBe(0);
    expect(file.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    // CVs saved before originals were kept report it and cannot be downloaded.
    const legacy = await insertCv('Built legacy services.');
    added.push(legacy.id);
    expect(
      (await request(server).get('/api/v1/opportunities/cv')).body,
    ).toContainEqual(
      expect.objectContaining({ id: legacy.id, originalAvailable: false }),
    );
    await request(server)
      .get(`/api/v1/opportunities/cv/${legacy.id}/file`)
      .expect(404);
    // Fill to 4, then race two uploads for the last slot.
    while ((await count()) < 4)
      added.push((await insertCv('Built filler services.')).id);
    const race = await Promise.all([
      upload(syntheticName, bytes),
      upload(syntheticName, bytes),
    ]);
    // The loser is refused either by the one-at-a-time parser (400) or the limit (409).
    expect(race.filter((r) => r.status === 200)).toHaveLength(1);
    expect([400, 409]).toContain(race.map((r) => r.status).sort()[1]);
    added.push(...race.filter((r) => r.status === 200).map((r) => r.body.id));
    expect(await count()).toBe(5);
    const blocked = await upload(syntheticName, bytes).expect(409);
    expect(blocked.body.message).toMatch(/up to 5 CVs/);
    expect(await count()).toBe(5);
    // Deleting one frees a slot again.
    await request(server)
      .delete(`/api/v1/opportunities/cv/${added.pop()}`)
      .set(origin)
      .expect(200);
    added.push((await upload(syntheticName, bytes).expect(200)).body.id);
  } finally {
    await database.query(
      'DELETE FROM ai_job_hunter.saved_cvs WHERE "ownerId"=$1 AND id = ANY($2)',
      [LOCAL_OWNER_ID, added],
    );
  }
});
test('saved matches persist across restart and go stale only when this job changes CV or job', async () => {
  await freeUnusedCvs();
  const python = await uploadCv('Built Python services.');
  ownsCv = true;
  const input = {
    title: 'Synthetic CV match persistence',
    company: '',
    source: 'Other',
    status: 'SAVED',
    originalLink: '',
    contactNotes: '',
    description: 'Python required',
    skills: 'Python',
    notes: '',
    contactDates: [],
    followUpDate: null,
  };
  const job = (
    await request(app.getHttpServer())
      .post('/api/v1/opportunities')
      .set(origin)
      .send(input)
      .expect(201)
  ).body.id as string;
  const status = async (server = app) =>
    (
      await request(server.getHttpServer())
        .get(`/api/v1/opportunities/${job}/match`)
        .expect(200)
    ).body;
  try {
    await selectCv(job, python.id);
    // Source CV Review is mandatory: blocked with a review action, no AI call.
    const unreviewed = generations;
    expect(await status()).toEqual({
      status: 'CV_REVIEW_REQUIRED',
      cvId: python.id,
      reviewStatus: 'NOT_STARTED',
    });
    const refused = await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${job}/match`)
      .set(origin)
      .expect(409);
    expect(refused.body.errorCode).toBe('CV_MATCH_REVIEW_REQUIRED');
    expect(generations).toBe(unreviewed);
    const review = await completeReview(database, LOCAL_OWNER_ID, python.id);
    expect(await status()).toEqual({ status: 'MISSING' });
    const before = generations;
    const analyzed = (
      await request(app.getHttpServer())
        .post(`/api/v1/opportunities/${job}/match`)
        .set(origin)
        .expect(200)
    ).body;
    expect(generations).toBe(before + 1);
    // The match is pinned to the completed review revision it ran on.
    expect(
      await database.query(
        'SELECT "profileRevisionId" FROM ai_job_hunter.cv_matches WHERE "jobId"=$1',
        [job],
      ),
    ).toEqual([{ profileRevisionId: review.profileRevisionId }]);
    // Adding another CV never touches this job's match.
    const java = await uploadCv('Built Java services.');
    expect(await status()).toMatchObject({
      status: 'VALID',
      result: { matchId: analyzed.matchId },
    });
    // Job edits make the saved match stale; no analysis is triggered.
    await request(app.getHttpServer())
      .put(`/api/v1/opportunities/${job}`)
      .set(origin)
      .send({ ...input, skills: 'Python, Java' })
      .expect(200);
    expect(await status()).toEqual({ status: 'STALE_JOB' });
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${job}/match`)
      .set(origin)
      .expect(200);
    expect((await status()).status).toBe('VALID');
    await selectCv(job, java.id);
    expect(await status()).toMatchObject({ status: 'CV_REVIEW_REQUIRED' });
    // A match saved for another (reviewed) CV is stale.
    await completeReview(database, LOCAL_OWNER_ID, java.id);
    expect(await status()).toEqual({ status: 'STALE_CV' });
    await selectCv(job, python.id);
    expect((await status()).status).toBe('VALID');
    // Legacy raw-text matches (no review revision) read as stale.
    await database.query(
      'UPDATE ai_job_hunter.cv_matches SET "profileRevisionId"=NULL WHERE "jobId"=$1',
      [job],
    );
    expect(await status()).toEqual({ status: 'STALE_CV' });
    await database.query(
      'UPDATE ai_job_hunter.cv_matches SET "profileRevisionId"=$1 WHERE "jobId"=$2',
      [review.profileRevisionId, job],
    );
    expect((await status()).status).toBe('VALID');
    // A new completed review revision makes the prior match stale.
    const revised = await reviseReview(database, LOCAL_OWNER_ID, review);
    expect(await status()).toEqual({ status: 'STALE_CV' });
    await request(app.getHttpServer())
      .post(`/api/v1/opportunities/${job}/match`)
      .set(origin)
      .expect(200);
    expect(
      await database.query(
        'SELECT "profileRevisionId" FROM ai_job_hunter.cv_matches WHERE "jobId"=$1',
        [job],
      ),
    ).toEqual([{ profileRevisionId: revised }]);
    await database.query(
      'UPDATE ai_job_hunter.cv_matches SET "policyVersion"=$1 WHERE "jobId"=$2',
      ['older-policy', job],
    );
    expect(await status()).toEqual({ status: 'EXPIRED' });
    expect(generations).toBe(before + 3);
    // A fresh application instance (API restart) restores the saved result.
    await database.query(
      'UPDATE ai_job_hunter.cv_matches SET "policyVersion"=$1 WHERE "jobId"=$2',
      [MATCHING_POLICY_VERSION, job],
    );
    const saved = await status();
    expect(saved.status).toBe('VALID');
    const restarted = (
      await Test.createTestingModule({
        imports: [DatabaseModule, OpportunitiesModule],
      })
        .overrideProvider(AI_PROVIDER)
        .useValue({
          generate: async () => {
            throw new Error('No AI after restart');
          },
        })
        .compile()
    ).createNestApplication();
    asLocalOwner(restarted);
    restarted.setGlobalPrefix('api/v1');
    await restarted.init();
    try {
      const reloaded = await status(restarted);
      expect(reloaded).toMatchObject({
        status: 'VALID',
        result: { matchId: saved.result.matchId, score: saved.result.score },
      });
      expect(generations).toBe(before + 3);
    } finally {
      await restarted.close();
    }
  } finally {
    await database.query(
      'DELETE FROM ai_job_hunter.opportunities WHERE id=$1 AND title=$2',
      [job, input.title],
    );
    expect(
      await database.query(
        'SELECT 1 FROM ai_job_hunter.cv_matches WHERE "jobId"=$1',
        [job],
      ),
    ).toEqual([]);
  }
});

test('multi-CV migration keeps a legacy CV as the default and binds its existing match', async () => {
  const owner = '00000000-0000-4000-8000-0000000000c9';
  const runner = database.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await new MultiCv1794800000000().down(runner);
    await runner.query(
      `INSERT INTO ai_job_hunter.saved_cvs ("ownerId","fileName",text,"updatedAt")
        VALUES ($1,'legacy.pdf','Built Python services.','2026-01-02T03:04:05.678Z')`,
      [owner],
    );
    const [{ id: job }] = await runner.query(
      `INSERT INTO ai_job_hunter.opportunities ("ownerId",title,company,source,status,"originalLink","contactNotes",description,notes,"contactDates")
        VALUES ($1,'Synthetic legacy job','','Other','SAVED','','','','','[]'::jsonb) RETURNING id`,
      [owner],
    );
    await runner.query(
      `INSERT INTO ai_job_hunter.cv_matches ("matchId","ownerId","jobId","cvTextHash","cvUpdatedAt","jobUpdatedAt","policyVersion",assessment,"analyzedAt")
        VALUES (gen_random_uuid(),$1,$2,'hash',now(),now(),'p','{}'::jsonb,now())`,
      [owner, job],
    );
    await new MultiCv1794800000000().up(runner);
    const [cv] = await runner.query(
      'SELECT id, name, "isDefault", "fileName", text, "updatedAt" FROM ai_job_hunter.saved_cvs WHERE "ownerId"=$1',
      [owner],
    );
    expect(cv).toEqual({
      id: expect.any(String),
      name: 'legacy.pdf',
      isDefault: true,
      fileName: 'legacy.pdf',
      text: 'Built Python services.',
      updatedAt: new Date('2026-01-02T03:04:05.678Z'),
    });
    expect(
      await runner.query(
        'SELECT "cvId" FROM ai_job_hunter.cv_matches WHERE "jobId"=$1',
        [job],
      ),
    ).toEqual([{ cvId: cv.id }]);
    expect(
      await runner.query(
        'SELECT "cvId" FROM ai_job_hunter.opportunities WHERE id=$1',
        [job],
      ),
    ).toEqual([{ cvId: null }]);
    // At most one default per account.
    await expect(
      runner.query(
        `INSERT INTO ai_job_hunter.saved_cvs ("ownerId",name,"isDefault","fileName",text) VALUES ($1,'x',true,'x','x')`,
        [owner],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
});

// The restart test above closes the shared parser, so later CVs are inserted directly.
const insertCv = async (text: string) =>
  (
    await database.query(
      `INSERT INTO ai_job_hunter.saved_cvs ("ownerId", name, "fileName", text)
        VALUES ($1, $2, $2, $3) RETURNING id, "isDefault"`,
      [LOCAL_OWNER_ID, syntheticName, text],
    )
  )[0] as { id: string; isDefault: boolean };
test('each job keeps its own CV: other jobs, default changes and renames never make it stale; used CVs cannot be deleted', async () => {
  const server = app.getHttpServer();
  const input = {
    title: 'Synthetic per-job CV',
    company: '',
    source: 'Other',
    status: 'SAVED',
    originalLink: '',
    contactNotes: '',
    description: 'Python required',
    skills: 'Python',
    notes: '',
    contactDates: [],
    followUpDate: null,
  };
  const jobs: string[] = [];
  const createJob = async () => {
    const created = await request(server)
      .post('/api/v1/opportunities')
      .set(origin)
      .send(input)
      .expect(201);
    jobs.push(created.body.id);
    return created.body as { id: string; updatedAt: string };
  };
  const status = async (job: string) =>
    (
      await request(server)
        .get(`/api/v1/opportunities/${job}/match`)
        .expect(200)
    ).body.status;
  const jobCv = async (job: string) =>
    (
      await request(server)
        .get(`/api/v1/opportunities/${job}/cv/current`)
        .expect(200)
    ).body.id;
  const patch = (cvId: string, body: object, code = 200) =>
    request(server)
      .patch(`/api/v1/opportunities/cv/${cvId}`)
      .set(origin)
      .send(body)
      .expect(code);
  const remove = (cvId: string, code: number) =>
    request(server)
      .delete(`/api/v1/opportunities/cv/${cvId}`)
      .set(origin)
      .expect(code);
  const original = (
    await request(server).get('/api/v1/opportunities/cv/current').expect(200)
  ).body as { id: string };
  ownsCv = true;
  try {
    await completeReview(database, LOCAL_OWNER_ID, original.id);
    const one = await createJob();
    const two = await createJob();
    for (const job of [one.id, two.id])
      await request(server)
        .post(`/api/v1/opportunities/${job}/match`)
        .set(origin)
        .expect(200);
    const other = await insertCv('Built Python services and Java tools.');
    expect(other.isDefault).toBe(false);
    await completeReview(database, LOCAL_OWNER_ID, other.id);
    // Choosing a CV for job one changes neither job two nor the default.
    await selectCv(one.id, other.id);
    expect(await status(one.id)).toBe('STALE_CV');
    expect(await status(two.id)).toBe('VALID');
    expect(await jobCv(two.id)).toBe(original.id);
    expect(
      (await request(server).get('/api/v1/opportunities/cv/current')).body.id,
    ).toBe(original.id);
    // Selecting a CV is not a job edit.
    expect(
      (await request(server).get(`/api/v1/opportunities/${one.id}`)).body
        .updatedAt,
    ).toBe(one.updatedAt);
    // A new default leaves analyzed jobs on the CV they used.
    await patch(other.id, { isDefault: true });
    expect(await status(two.id)).toBe('VALID');
    expect(await jobCv(two.id)).toBe(original.id);
    const fresh = await createJob();
    expect(await jobCv(fresh.id)).toBe(other.id);
    await request(server)
      .post(`/api/v1/opportunities/${one.id}/match`)
      .set(origin)
      .expect(200);
    expect(await status(one.id)).toBe('VALID');
    // Renaming is not a CV change.
    const renamed = await patch(original.id, { name: '  Main CV  ' });
    expect(renamed.body).toContainEqual(
      expect.objectContaining({ id: original.id, name: 'Main CV' }),
    );
    expect(await status(two.id)).toBe('VALID');
    // Deletion guards: used by a job, or the default.
    await remove(original.id, 409);
    await remove(other.id, 409);
    await patch(original.id, { isDefault: true });
    await remove(other.id, 409);
    const unused = await insertCv('Built unused services.');
    await remove(unused.id, 200);
    expect(
      (await request(server).get('/api/v1/opportunities/cv')).body.map(
        (cv: { id: string }) => cv.id,
      ),
    ).not.toContain(unused.id);
    // Unknown CVs and invalid input are rejected without changes.
    await selectCv(one.id, '00000000-0000-4000-8000-0000000000aa', 404);
    await selectCv(one.id, 'not-a-uuid', 400);
    await patch(original.id, { name: '   ' }, 400);
    await patch(original.id, { isDefault: false }, 400);
    expect(await jobCv(one.id)).toBe(other.id);
  } finally {
    await database.query(
      'DELETE FROM ai_job_hunter.opportunities WHERE id = ANY($1) AND title=$2',
      [jobs, input.title],
    );
  }
});
