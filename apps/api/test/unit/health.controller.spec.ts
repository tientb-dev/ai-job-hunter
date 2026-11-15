import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
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
import request from 'supertest';
import { HealthController } from '../../src/health/health.controller.js';
import { HealthService } from '../../src/health/health.service.js';

const isReady = jest.fn<() => Promise<boolean>>();
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: { isReady } }],
  }).compile();
  app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
});
beforeEach(() => {
  isReady.mockReset();
});
afterAll(async () => {
  await app?.close();
});
test('liveness returns 200 without calling the database health service', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/health/live')
    .expect(200, { status: 'ok' });
  expect(isReady).not.toHaveBeenCalled();
});
test('successful readiness returns 200 with caching disabled', async () => {
  isReady.mockResolvedValue(true);
  await request(app.getHttpServer())
    .get('/api/v1/health/ready')
    .expect('Cache-Control', 'no-store')
    .expect(200, { status: 'ok' });
});
test('failed readiness returns only a sanitized 503 body', async () => {
  isReady.mockResolvedValue(false);
  await request(app.getHttpServer())
    .get('/api/v1/health/ready')
    .expect(503, { status: 'unavailable' });
});
