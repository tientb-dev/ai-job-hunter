import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DiscoveryController } from '../../src/discovery/discovery.controller.js';
import { DiscoveryQueueService } from '../../src/discovery/discovery-queue.service.js';
import { DiscoveryQueueActionsService } from '../../src/discovery/discovery-queue-actions.service.js';
import { DiscoveryConflict } from '../../src/discovery/discovery-conflict.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { validateQueueQuery } from '../../src/discovery/discovery-candidate.validation.js';
import { validateSaveConfirmation } from '../../src/discovery/discovery-actions.validation.js';
import { candidateSnapshot } from '../support/discovery-candidate.synthetic.js';
const id = '00000000-0000-4000-8000-000000000002';
const local = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const row = {
  id,
  ownerId: LOCAL_OWNER_ID,
  snapshot: candidateSnapshot(),
  status: 'NEW',
  opportunityId: null,
};
const queue = {
  list: jest.fn(async (_owner: string, query: unknown) => {
    validateQueueQuery(query);
    return { items: [row], total: 1, totalPages: 1, page: 1, pageSize: 10 };
  }),
  get: jest.fn(async () => row),
};
const actions = {
  run: jest.fn<
    (owner: string, body: unknown) => Promise<{ found: number; added: number }>
  >(async () => ({ found: 0, added: 0 })),
  status: jest.fn(async () => row),
  save: jest.fn(async (_owner: string, _id: string, body: unknown) => {
    validateSaveConfirmation(body);
    throw new DiscoveryConflict('POSSIBLE_DUPLICATE', 'Review similar jobs.', [
      { id, title: 'Synthetic', company: 'Synthetic', location: '' },
    ]);
  }),
};
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [DiscoveryController],
    providers: [
      { provide: DiscoveryQueueService, useValue: queue },
      { provide: DiscoveryQueueActionsService, useValue: actions },
    ],
  }).compile();
  app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app?.close();
});
test('read DTOs omit owner/storage fields, validate query/UUID and use no-store', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/v1/discovery/candidates')
    .expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.items[0]).toMatchObject({
    id,
    title: row.snapshot.title,
    status: 'NEW',
  });
  expect(response.body.items[0]).not.toHaveProperty('ownerId');
  expect(response.body.items[0]).not.toHaveProperty('snapshot');
  expect(queue.list).toHaveBeenCalledWith(LOCAL_OWNER_ID, {});
  await request(app.getHttpServer())
    .get('/api/v1/discovery/candidates?ownerId=other')
    .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/discovery/candidates/invalid')
    .expect(400);
  const detail = await request(app.getHttpServer())
    .get(`/api/v1/discovery/candidates/${id}`)
    .expect(200);
  expect(detail.body.description).toBe(row.snapshot.description);
});
test('all mutations enforce local origin and choose the owner server-side', async () => {
  await request(app.getHttpServer())
    .post('/api/v1/discovery/runs')
    .send({})
    .expect(403);
  await request(app.getHttpServer())
    .patch(`/api/v1/discovery/candidates/${id}/status`)
    .send({ status: 'SEEN' })
    .expect(403);
  await request(app.getHttpServer())
    .post(`/api/v1/discovery/candidates/${id}/save`)
    .send({})
    .expect(403);
  await request(app.getHttpServer())
    .post('/api/v1/discovery/runs')
    .set(local)
    .send({ stacks: ['Java'] })
    .expect(200);
  expect(actions.run).toHaveBeenCalledWith(LOCAL_OWNER_ID, {
    stacks: ['Java'],
  });
});
test('structured duplicate conflicts survive response handling and internal errors stay private', async () => {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/discovery/candidates/${id}/save`)
    .set(local)
    .send({})
    .expect(409);
  expect(response.body).toMatchObject({
    errorCode: 'POSSIBLE_DUPLICATE',
    matches: [{ id }],
  });
  expect(response.headers['cache-control']).toBe('no-store');
  await request(app.getHttpServer())
    .post(`/api/v1/discovery/candidates/${id}/save`)
    .set(local)
    .send({ opportunityId: id })
    .expect(400);
  queue.get.mockRejectedValueOnce(new Error('secret connection string'));
  const failed = await request(app.getHttpServer())
    .get(`/api/v1/discovery/candidates/${id}`)
    .expect(503);
  expect(failed.body.message).toBe(
    'Discovery storage unavailable. Retry later.',
  );
  expect(JSON.stringify(failed.body)).not.toContain('secret');
});
