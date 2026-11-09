import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { DatabaseModule } from '../../src/database/database.module.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { TailoredCvModule } from '../../src/tailored-cv/tailored-cv.module.js';
import { TailoredCvService } from '../../src/tailored-cv/tailored-cv.service.js';
import { FoundationRequestErrors } from '../../src/tailored-cv/tailored-cv.http.js';
import {
  CvSourceRevision,
  CvProfileRevision,
  TailoredCvDraft,
} from '../../src/tailored-cv/tailored-cv.entity.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import {
  syntheticCv,
  syntheticProfile,
} from '../support/tailored-cv-fixtures.js';
import { pdfFixture } from '../support/pdf-fixtures.js';

let app: INestApplication;
let db: DataSource;
let service: TailoredCvService;
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const owner = LOCAL_OWNER_ID;
const other = randomUUID();
const filename = `synthetic-p81-${randomUUID()}.pdf`;
const savedAt = '2026-01-01T00:00:00.000Z';
const base = '/api/v1/tailored-cv';
const v = { contractVersion: '1' };
const sources = new Set<string>();
const profiles = new Set<string>();
const drafts = new Set<string>();
let jobId: string;
let sourceId: string;
let profileId: string;
let profileRevisionId: string;
let jobUpdatedAt: string;
let ownsSavedCv = false;
let generations = 0;
beforeAll(async () => {
  // Validates isolated role/database/port before any connection or fixture mutation.
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  await db.runMigrations();
  expect(
    await db.getRepository(SavedCv).findOneBy({ ownerId: owner }),
  ).toBeNull();
  await db.getRepository(SavedCv).insert({
    ownerId: owner,
    fileName: filename,
    text: syntheticCv,
    updatedAt: new Date(savedAt),
    sourceMetadata: null,
  });
  ownsSavedCv = true;
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, TailoredCvModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({
      generate: () => {
        generations++;
        throw new Error('P8.1 must not invoke AI');
      },
    })
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  await app.init();
  service = app.get(TailoredCvService);
  const job = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send({
      title: 'Synthetic P8 foundation job',
      company: '',
      source: 'Other',
      status: 'SAVED',
      originalLink: '',
      contactNotes: '',
      description: 'Java',
      skills: 'Java',
      notes: '',
      contactDates: [],
      followUpDate: null,
    })
    .expect(201);
  jobId = job.body.id;
  jobUpdatedAt = job.body.updatedAt;
});
afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    for (const id of drafts)
      await db.getRepository(TailoredCvDraft).delete({ id });
    for (const id of profiles)
      await db.getRepository(CvProfileRevision).delete({ profileId: id });
    for (const id of sources)
      await db.getRepository(CvSourceRevision).delete({ id });
    if (jobId)
      await db.getRepository(Opportunity).delete({ id: jobId, ownerId: owner });
    if (ownsSavedCv)
      await db
        .getRepository(SavedCv)
        .delete({ ownerId: owner, fileName: filename });
    await db.destroy();
  }
});
test('capture is durable/idempotent, hashed exactly, private by default and honest about legacy provenance', async () => {
  const capture = () =>
    request(app.getHttpServer())
      .post(`${base}/sources`)
      .set(origin)
      .send({ ...v, expectedSavedCvUpdatedAt: savedAt })
      .expect(201);
  const first = await capture();
  sourceId = first.body.id;
  sources.add(sourceId);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(first.body.text).toBeUndefined();
  expect(first.body.ownerId).toBeUndefined();
  expect(first.body.textHash).toBe(
    createHash('sha256').update(syntheticCv).digest('hex'),
  );
  expect(first.body.provenance).toEqual({
    kind: 'saved-text-bootstrap',
    format: null,
    parser: null,
    segments: null,
    warnings: null,
    originalBytesRetained: false,
  });
  expect((await capture()).body.id).toBe(sourceId);
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const stored = await fresh
      .getRepository(CvSourceRevision)
      .findOne({ where: { id: sourceId }, select: { text: true } });
    expect(stored?.text).toBe(syntheticCv);
  } finally {
    await fresh.destroy();
  }
  await request(app.getHttpServer())
    .get(`${base}/sources/${sourceId}/content`)
    .set(origin)
    .expect(200)
    .expect((r) => expect(r.body.text).toBe(syntheticCv));
});
test('every personal-data read/write requires local Host/Origin and versioned, bounded envelopes', async () => {
  await request(app.getHttpServer())
    .get(`${base}/sources/${sourceId}/content`)
    .set({ ...origin, Origin: 'https://evil.invalid' })
    .expect(403);
  await request(app.getHttpServer())
    .get(`${base}/sources/${sourceId}`)
    .expect(403);
  await request(app.getHttpServer())
    .post(`${base}/sources`)
    .set(origin)
    .send({ ...v, expectedSavedCvUpdatedAt: savedAt, ownerId: other })
    .expect(400);
  await request(app.getHttpServer())
    .get(`${base}/sources/invalid`)
    .set(origin)
    .expect(400);
  for (const body of [
    '{"privateCv":',
    JSON.stringify({ privateCv: 'private'.repeat(20000) }),
  ]) {
    const response = await request(app.getHttpServer())
      .post(`${base}/profiles`)
      .set(origin)
      .set('Content-Type', 'application/json')
      .send(body);
    expect([400, 413]).toContain(response.status);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response.body)).not.toContain('private');
  }
});
test('initial profile retains every source character as unresolved, append preserves pinned history', async () => {
  const response = await request(app.getHttpServer())
    .post(`${base}/profiles`)
    .set(origin)
    .send({
      ...v,
      sourceRevisionId: sourceId,
      expectedSavedCvUpdatedAt: savedAt,
    })
    .expect(201);
  profileId = response.body.profileId;
  profiles.add(profileId);
  profileRevisionId = response.body.id;
  expect(response.body.document.sections).toEqual([]);
  expect(response.body.document.coverage[0]).toMatchObject({
    start: 0,
    end: syntheticCv.length,
    disposition: 'unresolved',
  });
  const next = await request(app.getHttpServer())
    .post(`${base}/profiles/${profileId}/revisions`)
    .set(origin)
    .send({ ...v, expectedRevision: 1, document: syntheticProfile(sourceId) })
    .expect(201);
  expect(next.body.revision).toBe(2);
  await request(app.getHttpServer())
    .get(`${base}/profile-revisions/${profileRevisionId}`)
    .set(origin)
    .expect(200)
    .expect((r) => expect(r.body.document.sections).toEqual([]));
  profileRevisionId = next.body.id;
  await expect(
    service.appendProfile(owner, profileId, {
      ...v,
      expectedRevision: 1,
      document: syntheticProfile(sourceId),
    }),
  ).rejects.toMatchObject({ status: 409 });
});
test('HTTP document limits reject otherwise valid oversized profiles without creating a revision', async () => {
  const document = syntheticProfile(sourceId);
  document.sections[0]!.entries[0]!.facts.push(
    ...Array.from({ length: 24 }, (_, index) => ({
      id: `extra-${index}`,
      field: 'note',
      value: 'x'.repeat(4000),
      origin: 'user_entered' as const,
      review: 'pending' as const,
      evidence: [],
    })),
  );
  await request(app.getHttpServer())
    .post(`${base}/profiles/${profileId}/revisions`)
    .set(origin)
    .send({ ...v, expectedRevision: 2, document })
    .expect(400);
  expect(await db.getRepository(CvProfileRevision).countBy({ profileId })).toBe(
    2,
  );
});
test('concurrent profile appends have exactly one winner', async () => {
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      service.appendProfile(owner, profileId, {
        ...v,
        expectedRevision: 2,
        document: syntheticProfile(sourceId),
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const loser = results.find((r) => r.status === 'rejected');
  expect(loser?.reason).toMatchObject({ status: 409 });
});
test('database rejects updates to source/profile revisions and cross-owner references', async () => {
  await expect(
    db
      .getRepository(CvSourceRevision)
      .update({ id: sourceId }, { fileName: 'changed' }),
  ).rejects.toMatchObject({ driverError: { code: '23514' } });
  await expect(
    db
      .getRepository(CvProfileRevision)
      .update({ id: profileRevisionId }, { revision: 99 }),
  ).rejects.toMatchObject({ driverError: { code: '23514' } });
  await expect(
    db.getRepository(CvProfileRevision).insert({
      id: randomUUID(),
      ownerId: other,
      profileId: randomUUID(),
      revision: 1,
      sourceRevisionId: sourceId,
      document: syntheticProfile(sourceId),
    }),
  ).rejects.toMatchObject({ driverError: { code: '23503' } });
  await expect(
    db.getRepository(CvProfileRevision).insert({
      id: randomUUID(),
      ownerId: owner,
      profileId: randomUUID(),
      revision: 1,
      sourceRevisionId: sourceId,
      document: {
        ...syntheticProfile(sourceId),
        coverage: Array.from({ length: 5000 }, () => ({
          start: 0,
          end: 1,
          disposition: 'unresolved' as const,
          factIds: [],
          reason: null,
        })),
      },
    }),
  ).rejects.toMatchObject({ driverError: { code: '23514' } });
  await expect(service.getSource(other, sourceId)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    service.getProfile(other, profileRevisionId),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.appendProfile(other, profileId, {
      ...v,
      expectedRevision: 3,
      document: syntheticProfile(sourceId),
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(service.deleteSource(other, sourceId)).rejects.toMatchObject({
    status: 404,
  });
});
test('drafts pin an exact profile revision and job, isolate owners and compare revisions atomically', async () => {
  await expect(
    service.createDraft(other, jobId, profileRevisionId, jobUpdatedAt),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.createDraft(owner, jobId, profileRevisionId, savedAt),
  ).rejects.toMatchObject({ status: 409 });
  const draft = await service.createDraft(
    owner,
    jobId,
    profileRevisionId,
    jobUpdatedAt,
  );
  drafts.add(draft.id);
  expect(draft.profileRevisionId).toBe(profileRevisionId);
  expect(draft.generationMetadata).toBeNull();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      service.saveDraft(owner, draft.id, 1, syntheticProfile(sourceId)),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  await expect(
    service.saveDraft(other, draft.id, 2, syntheticProfile(sourceId)),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.deleteDraft(other, draft.id, { ...v, expectedRevision: 2 }),
  ).rejects.toMatchObject({ status: 404 });
  await request(app.getHttpServer())
    .delete(`${base}/drafts/${draft.id}`)
    .set(origin)
    .send({ ...v, expectedRevision: 1 })
    .expect(409);
  await request(app.getHttpServer())
    .delete(`${base}/profiles/${profileId}`)
    .set(origin)
    .send({ ...v, expectedRevision: 3 })
    .expect(409);
  await expect(
    db.getRepository(Opportunity).delete({ id: jobId }),
  ).rejects.toMatchObject({ driverError: { code: '23503' } });
  await request(app.getHttpServer())
    .delete(`${base}/drafts/${draft.id}`)
    .set(origin)
    .send({ ...v, expectedRevision: 2 })
    .expect(200);
});
test('source replacement leaves history intact and rejects stale captures/profile creation; new uploads retain known provenance', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/cv/current')
    .set(origin)
    .field('record', '{}')
    .attach(
      'document',
      Buffer.from(pdfFixture(['Synthetic replacement CV.'])),
      { filename, contentType: 'application/pdf' },
    )
    .expect(200);
  const saved = await db
    .getRepository(SavedCv)
    .findOneByOrFail({ ownerId: owner });
  await request(app.getHttpServer())
    .post(`${base}/sources`)
    .set(origin)
    .send({ ...v, expectedSavedCvUpdatedAt: savedAt })
    .expect(409);
  await request(app.getHttpServer())
    .post(`${base}/profiles`)
    .set(origin)
    .send({
      ...v,
      sourceRevisionId: sourceId,
      expectedSavedCvUpdatedAt: saved.updatedAt.toISOString(),
    })
    .expect(409);
  expect((await service.getSource(owner, sourceId, true)).text).toBe(
    syntheticCv,
  );
  const capture = await service.capture(owner, {
    ...v,
    expectedSavedCvUpdatedAt: saved.updatedAt.toISOString(),
  });
  sources.add(capture.id);
  expect(capture.provenance).toMatchObject({
    kind: 'parsed-upload',
    format: 'pdf',
    parser: 'bounded-document-parser/v1',
    warnings: null,
  });
  expect(capture.provenance.segments?.length).toBeGreaterThan(0);
  expect(capture.id).not.toBe(sourceId);
  await service.deleteSource(owner, capture.id);
  expect(
    (await db.getRepository(SavedCv).findOneByOrFail({ ownerId: owner }))
      .updatedAt,
  ).toEqual(saved.updatedAt);
});
test('explicit deletion removes only requested history after dependents are deleted; no AI or tracker changes', async () => {
  await request(app.getHttpServer())
    .delete(`${base}/sources/${sourceId}`)
    .set(origin)
    .expect(409);
  await request(app.getHttpServer())
    .delete(`${base}/profiles/${profileId}`)
    .set(origin)
    .send({ ...v, expectedRevision: 2 })
    .expect(409);
  await expect(
    service.deleteProfile(other, profileId, { ...v, expectedRevision: 3 }),
  ).rejects.toMatchObject({ status: 404 });
  await request(app.getHttpServer())
    .delete(`${base}/profiles/${profileId}`)
    .set(origin)
    .send({ ...v, expectedRevision: 3 })
    .expect(200);
  expect(await db.getRepository(CvProfileRevision).countBy({ profileId })).toBe(
    0,
  );
  await request(app.getHttpServer())
    .delete(`${base}/sources/${sourceId}`)
    .set(origin)
    .expect(200);
  await request(app.getHttpServer())
    .get(`${base}/sources/${sourceId}`)
    .set(origin)
    .expect(404);
  expect(await db.getRepository(SavedCv).existsBy({ ownerId: owner })).toBe(
    true,
  );
  expect(
    (
      await db.getRepository(Opportunity).findOneByOrFail({ id: jobId })
    ).updatedAt.toISOString(),
  ).toBe(jobUpdatedAt);
  expect(generations).toBe(0);
});
