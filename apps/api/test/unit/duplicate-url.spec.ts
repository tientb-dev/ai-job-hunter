import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { expect, test, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OpportunitiesController } from '../../src/opportunities/opportunities.controller.js';
import {
  OpportunitiesService,
  LOCAL_OWNER_ID,
} from '../../src/opportunities/opportunities.service.js';
import { JobImportService } from '../../src/opportunities/job-import.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { transactionalRepository } from '../support/transactional-repository.mock.js';

const existing = {
  id: '00000000-0000-4000-8000-123456789012',
  title: 'Synthetic engineer',
  company: 'Synthetic company',
  originalLink: 'https://www.example.com/job?a=1&b=2&utm_source=test#section',
};
function setup() {
  const find = jest.fn<(options: unknown) => Promise<(typeof existing)[]>>(
    async () => [existing],
  );
  const save = jest.fn();
  const rows = { find, save };
  const service = new OpportunitiesService(
    transactionalRepository(rows) as unknown as ConstructorParameters<
      typeof OpportunitiesService
    >[0],
    {} as JobImportService,
  );
  return { service, find, save };
}

test('lookup reuses Save normalization, scopes the query to the owner and returns only link metadata', async () => {
  const { service, find, save } = setup();
  expect(
    await service.duplicateUrl(
      LOCAL_OWNER_ID,
      'http://example.com/job/?b=2&a=1&ref=mail',
    ),
  ).toEqual({
    match: {
      id: existing.id,
      title: existing.title,
      company: existing.company,
    },
  });
  expect(find).toHaveBeenCalledWith({
    where: { ownerId: LOCAL_OWNER_ID },
    select: { id: true, title: true, company: true, originalLink: true },
    order: { id: 'ASC' },
  });
  expect(save).not.toHaveBeenCalled();
});
test('a different URL never matches merely because title and company could match', async () => {
  const { service } = setup();
  expect(
    await service.duplicateUrl(LOCAL_OWNER_ID, 'https://example.com/new-job'),
  ).toEqual({
    match: null,
  });
});
test.each([
  undefined,
  '',
  ['https://example.com/job'],
  'invalid',
  'ftp://example.com/job',
  'https://user:secret@example.com/job',
  `https://example.com/${'x'.repeat(2048)}`,
])(
  'invalid lookup input is rejected before reading jobs: %s',
  async (value) => {
    const { service, find } = setup();
    await expect(service.duplicateUrl(LOCAL_OWNER_ID, value)).rejects.toThrow(
      'HTTP(S)',
    );
    expect(find).not.toHaveBeenCalled();
  },
);
test('Save still rejects an exact URL even if no early lookup occurred', async () => {
  const { service, save } = setup();
  await expect(
    service.create(LOCAL_OWNER_ID, {
      title: 'Different title',
      company: 'Different company',
      source: 'Website',
      status: 'SAVED',
      originalLink: 'https://example.com/job?b=2&a=1',
      description: 'Synthetic JD',
      contactNotes: '',
      notes: '',
      contactDates: [],
      followUpDate: null,
    }),
  ).rejects.toThrow('already saved');
  expect(save).not.toHaveBeenCalled();
});
test('read-only HTTP contract returns JSON match/null and no-store; invalid query returns 400', async () => {
  const { service } = setup();
  const module = await Test.createTestingModule({
    controllers: [OpportunitiesController],
    providers: [
      { provide: OpportunitiesService, useValue: service },
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
      .get('/api/v1/opportunities/duplicate-url')
      .query({ url: existing.originalLink })
      .expect(200);
    expect(response.body.match.id).toBe(existing.id);
    expect(response.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .get('/api/v1/opportunities/duplicate-url')
      .query({ url: 'https://example.com/new-job' })
      .expect(200, { match: null });
    await request(app.getHttpServer())
      .get('/api/v1/opportunities/duplicate-url')
      .query({ url: 'invalid' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/opportunities/duplicate-url')
      .expect(400);
  } finally {
    await app.close();
  }
});
