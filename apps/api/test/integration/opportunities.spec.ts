import { pdfFixture } from '../support/pdf-fixtures.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database.config.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { OpportunitiesModule } from '../../src/opportunities/opportunities.module.js';
import { createValidationPipe } from '../../src/config/validation.js';
let app: INestApplication;
let database: DataSource;
const input = {
  title: 'Synthetic Phase 1 opportunity',
  company: 'Example Company',
  source: 'Zalo',
  status: 'SAVED',
  originalLink: 'https://example.com/synthetic-job',
  description: 'Synthetic JD only',
  contactNotes: 'Synthetic contact',
  notes: '',
  contactDates: [],
  followUpDate: null,
};
const syntheticIds: string[] = [];
const origin = { Origin: 'http://127.0.0.1:5173', Host: '127.0.0.1:3000' };
beforeAll(async () => {
  database = new DataSource(databaseOptions('test'));
  await database.initialize();
  await database.runMigrations();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, OpportunitiesModule],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  await app.init();
});
afterAll(async () => {
  await app?.close();
  if (database?.isInitialized) {
    for (const id of syntheticIds)
      await database.query(
        'DELETE FROM ai_job_hunter.opportunities WHERE id=$1 AND title=$2',
        [id, input.title],
      );
    await database.destroy();
  }
});
test('creates, edits, skips statuses, clears dates and survives a new connection', async () => {
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send(input)
    .expect(201);
  const id = created.body.id as string;
  syntheticIds.push(id);
  expect(created.body.ownerId).toBe('00000000-0000-4000-8000-000000000001');
  const edited = {
    ...input,
    status: 'INTERVIEW',
    notes: 'Synthetic interview booked',
    contactDates: ['2026-10-30'],
    followUpDate: '2026-11-02',
  };
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send(edited)
    .expect(200);
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [row] = await fresh.query(
      'SELECT status, notes, "contactDates", "followUpDate"::text FROM ai_job_hunter.opportunities WHERE id=$1',
      [id],
    );
    expect(row).toEqual({
      status: 'INTERVIEW',
      notes: edited.notes,
      contactDates: edited.contactDates,
      followUpDate: edited.followUpDate,
    });
  } finally {
    await fresh.destroy();
  }
  const listed = await request(app.getHttpServer())
    .get('/api/v1/opportunities')
    .expect(200);
  expect(listed.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id, status: 'INTERVIEW' }),
    ]),
  );
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send({ ...edited, status: 'SAVED', followUpDate: null, contactDates: [] })
    .expect(200);
  const reloaded = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(reloaded.body.followUpDate).toBeNull();
  expect(reloaded.body.contactDates).toEqual([]);
});
test('follow-up status persists, resets on a new date and never changes application status', async () => {
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send({
      ...input,
      originalLink: 'https://example.com/follow-up-job',
      status: 'APPLIED',
      followUpDate: '2026-11-02',
    })
    .expect(201);
  const id = created.body.id as string;
  syntheticIds.push(id);
  expect(created.body.followUpStatus).toBe('PENDING');
  const put = (body: object) =>
    request(app.getHttpServer())
      .put(`/api/v1/opportunities/${id}`)
      .set(origin)
      .send({
        ...input,
        originalLink: 'https://example.com/follow-up-job',
        status: 'APPLIED',
        ...body,
      })
      .expect(200);
  let saved = await put({ followUpDate: '2026-11-02', followUpStatus: 'DONE' });
  expect(saved.body).toMatchObject({
    followUpStatus: 'DONE',
    status: 'APPLIED',
  });
  // Older clients omit the field: the saved status is kept.
  saved = await put({ followUpDate: '2026-11-02' });
  expect(saved.body.followUpStatus).toBe('DONE');
  saved = await put({
    followUpDate: '2026-11-09',
    followUpStatus: 'DISMISSED',
  });
  expect(saved.body).toMatchObject({
    followUpStatus: 'PENDING',
    status: 'APPLIED',
  });
  await put({ followUpDate: '2026-11-09', followUpStatus: 'DISMISSED' });
  saved = await put({ followUpDate: null });
  expect(saved.body.followUpStatus).toBe('DISMISSED');
});
test('rejects invalid data and non-local writes', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send({ ...input, ownerId: 'injected' })
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set({ ...origin, Origin: 'https://example.com' })
    .send(input)
    .expect(403);
  await request(app.getHttpServer())
    .get('/api/v1/opportunities/invalid')
    .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/opportunities/00000000-0000-4000-8000-999999999999')
    .expect(404);
});

test('parses a synthetic JD PDF without inference and rejects unsupported uploads', async () => {
  const parsed = await request(app.getHttpServer())
    .post('/api/v1/opportunities/parse-document')
    .set(origin)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from(pdfFixture(['Synthetic developer job description'])))
    .expect(200);
  expect(parsed.body.text).toContain('Synthetic developer job description');
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/parse-document')
    .set(origin)
    .set('Content-Type', 'application/msword')
    .send(Buffer.from('synthetic'))
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/parse-document')
    .set(origin)
    .set('Content-Type', 'application/pdf')
    .send(Buffer.from('invalid PDF'))
    .expect(400);
});

test('Contact Date save read edit read preserves date-only values and other tracking fields', async () => {
  const original = {
    ...input,
    originalLink: 'https://example.com/synthetic-contact-date-job',
    status: 'APPLIED',
    notes: 'Synthetic Contact Date tracking',
    contactDates: ['2026-10-30'],
    followUpDate: '2026-11-02',
  };
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send(original)
    .expect(201);
  const id = created.body.id as string;
  syntheticIds.push(id);
  const first = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(first.body.contactDates).toEqual(['2026-10-30']);
  const edited = { ...original, contactDates: ['2026-10-30', '2026-10-29'] };
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send(edited)
    .expect(200);
  const read = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(read.body).toMatchObject({
    contactDates: edited.contactDates,
    title: input.title,
    status: 'APPLIED',
    notes: original.notes,
    followUpDate: original.followUpDate,
  });
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [stored] = await fresh.query(
      'SELECT "contactDates", status, notes, "followUpDate"::text FROM ai_job_hunter.opportunities WHERE id=$1',
      [id],
    );
    expect(stored).toEqual({
      contactDates: edited.contactDates,
      status: 'APPLIED',
      notes: original.notes,
      followUpDate: original.followUpDate,
    });
  } finally {
    await fresh.destroy();
  }
});

test('application details persist, preserve omitted fields, edit and clear', async () => {
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send({
      ...input,
      originalLink: '',
      appliedDate: '2024-02-29',
      applicationChannel: 'Referral',
    })
    .expect(201);
  const id = created.body.id as string;
  syntheticIds.push(id);
  expect(created.body).toMatchObject({
    appliedDate: '2024-02-29',
    applicationChannel: 'Referral',
    source: 'Zalo',
    status: 'SAVED',
  });
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send({ ...input, originalLink: '', notes: 'Legacy client edit' })
    .expect(200);
  const reopened = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(reopened.body).toMatchObject({
    appliedDate: '2024-02-29',
    applicationChannel: 'Referral',
  });
  const edited = {
    ...input,
    originalLink: '',
    appliedDate: '2026-10-30',
    applicationChannel: 'TopCV',
  };
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send(edited)
    .expect(200);
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [stored] = await fresh.query(
      'SELECT "appliedDate"::text, "applicationChannel" FROM ai_job_hunter.opportunities WHERE id=$1',
      [id],
    );
    expect(stored).toEqual({
      appliedDate: edited.appliedDate,
      applicationChannel: edited.applicationChannel,
    });
  } finally {
    await fresh.destroy();
  }
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send({ ...edited, appliedDate: null, applicationChannel: null })
    .expect(200);
  const cleared = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(cleared.body).toMatchObject({
    appliedDate: null,
    applicationChannel: null,
    status: 'SAVED',
    contactDates: [],
    followUpDate: null,
  });
});
