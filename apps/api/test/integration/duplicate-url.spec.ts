import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { databaseOptions } from '../../src/database/database.config.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { OpportunitiesModule } from '../../src/opportunities/opportunities.module.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { validateOpportunity } from '../../src/opportunities/opportunity.validation.js';
import { createValidationPipe } from '../../src/config/validation.js';

let app: INestApplication | undefined;
let database: DataSource;
let base: string;
let snapshot: Opportunity[];
const previousPort = process.env.API_PORT;
const runId = randomUUID();
const otherOwner = randomUUID();
const title = `Synthetic P5.4c ${runId}`;
const ownUrl = `https://www.example.com/p54c/${runId}/owned?a=1&b=2&utm_source=synthetic#jd`;
const otherUrl = `https://example.com/p54c/${runId}/other-only`;
const equivalentUrl = `http://example.com/p54c/${runId}/owned/?b=2&a=1&ref=synthetic`;
const fixtureIds: string[] = [];
let ownId: string;
const input = {
  title,
  company: 'Synthetic acceptance company',
  source: 'Website',
  status: 'SAVED',
  originalLink: ownUrl,
  description: 'Synthetic acceptance JD',
  contactNotes: '',
  notes: '',
  contactDates: [],
  followUpDate: null,
};

beforeAll(async () => {
  // These guards reject development/production identities, hosts and ports.
  database = new DataSource(databaseOptions('test'));
  await database.initialize();
  expect(
    await database.query(
      'SELECT current_database() AS name, current_user AS role',
    ),
  ).toEqual([{ name: 'ai_job_hunter_test', role: 'ai_job_hunter_test' }]);
  if (await database.showMigrations())
    throw new Error(
      'Apply the existing migrations to the isolated test database before acceptance.',
    );

  const rows = database.getRepository(Opportunity);
  ownId = randomUUID();
  const otherOnlyId = randomUUID();
  const otherSameUrlId = randomUUID();
  fixtureIds.push(ownId, otherOnlyId, otherSameUrlId);
  await rows.save([
    rows.create({
      ...validateOpportunity(input),
      id: ownId,
      ownerId: LOCAL_OWNER_ID,
      jdText: '',
    }),
    rows.create({
      ...validateOpportunity({ ...input, originalLink: otherUrl }),
      id: otherOnlyId,
      ownerId: otherOwner,
      jdText: '',
    }),
    rows.create({
      ...validateOpportunity(input),
      id: otherSameUrlId,
      ownerId: otherOwner,
      company: 'Synthetic other owner',
      jdText: '',
    }),
  ]);
  snapshot = await rows.find({
    where: { id: In(fixtureIds) },
    order: { id: 'ASC' },
  });

  const module = await Test.createTestingModule({
    imports: [DatabaseModule, OpportunitiesModule],
  }).compile();
  app = module.createNestApplication({ logger: false });
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  // Keep the real local-write boundary active on this separate ephemeral API.
  process.env.API_PORT = new URL(base).port;
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    if (previousPort === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = previousPort;
    if (database?.isInitialized) {
      try {
        // Never truncate tables or delete another run's data.
        if (fixtureIds.length) {
          const rows = database.getRepository(Opportunity);
          await rows.delete({ id: In(fixtureIds), title });
          expect(await rows.countBy({ id: In(fixtureIds) })).toBe(0);
        }
      } finally {
        await database.destroy();
      }
    }
  }
});

async function lookup(url: string) {
  return fetch(
    `${base}/api/v1/opportunities/duplicate-url?${new URLSearchParams({ url })}`,
  );
}

test('live HTTP static duplicate-url route returns only the current owner exact match', async () => {
  const response = await lookup(ownUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({
    match: { id: ownId, title, company: input.company },
  });
});

test('live HTTP excludes another owner job even when its URL matches exactly', async () => {
  const response = await lookup(otherUrl);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ match: null });
});

test('live HTTP normalization matches Save across scheme, www, slash, tracking, hash and parameter order', async () => {
  const response = await lookup(equivalentUrl);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    match: { id: ownId, title, company: input.company },
  });
});

test('live HTTP new URL returns an explicit null match', async () => {
  const response = await lookup(`https://example.com/p54c/${runId}/new`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ match: null });
});

test.each([
  'invalid',
  'javascript:alert(1)',
  'https://name:synthetic@example.com/job',
  'https://example.com/' + 'x'.repeat(2048),
])('live HTTP invalid URL returns validation error: %s', async (url) => {
  const response = await lookup(url);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    statusCode: 400,
    message: 'Enter a full HTTP(S) job URL without credentials.',
  });
});

test('live HTTP Save rejects an equivalent duplicate with 409 and leaves fixtures unchanged', async () => {
  const response = await fetch(`${base}/api/v1/opportunities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      ...input,
      title: 'Synthetic attempted duplicate',
      originalLink: equivalentUrl,
    }),
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    statusCode: 409,
    message: expect.stringContaining('already saved'),
  });
  const rows = database.getRepository(Opportunity);
  expect(
    await rows.find({ where: { id: In(fixtureIds) }, order: { id: 'ASC' } }),
  ).toEqual(snapshot);
  expect(await rows.countBy({ originalLink: equivalentUrl })).toBe(0);
});
