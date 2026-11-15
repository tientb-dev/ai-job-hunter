import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { expect, test, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OpportunitiesController } from '../../src/opportunities/opportunities.controller.js';
import { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import { JobImportService } from '../../src/opportunities/job-import.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';

test('legacy discovery responds 410 without fetching or saving even with a valid old request', async () => {
  const importDiscovered = jest.fn();
  const create = jest.fn();
  const module = await Test.createTestingModule({
    controllers: [OpportunitiesController],
    providers: [
      { provide: OpportunitiesService, useValue: { importDiscovered, create } },
      { provide: JobImportService, useValue: {} },
      { provide: JobMatchService, useValue: {} },
    ],
  }).compile();
  const app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
  try {
    const response = await request(app.getHttpServer())
      .post('/api/v1/opportunities/discover')
      .set({ Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' })
      .send({
        location: 'Vietnam',
        stacks: ['Java'],
        workMode: 'All',
        seniority: 'All',
      })
      .expect(410);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.message).toContain('Reload Discover Jobs');
    expect(importDiscovered).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
