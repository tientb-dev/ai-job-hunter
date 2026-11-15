import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { databaseOptions } from '../../src/database/database.config.js';
import { JobDiscovery1793510000000 } from '../../src/database/migrations/1793510000000-JobDiscovery.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { OpportunitiesModule } from '../../src/opportunities/opportunities.module.js';
import { GreenhouseSource } from '../../src/discovery/greenhouse.source.js';
let database: DataSource;
let app: INestApplication;
const ids = new Set<string>();
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const filters = {
  location: 'Ho Chi Minh City',
  stacks: ['Java', 'React'],
  workMode: 'All',
  seniority: 'Senior',
};
beforeAll(async () => {
  database = new DataSource(databaseOptions('test'));
  await database.initialize();
  await database.runMigrations();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, OpportunitiesModule],
  })
    .overrideProvider(GreenhouseSource)
    .useValue({
      read: async () => {
        throw new Error('Retired route must not fetch feeds');
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
    for (const id of ids)
      await database.query(
        'DELETE FROM ai_job_hunter.opportunities WHERE id=$1 AND company=$2',
        [id, 'Synthetic Discovery Company'],
      );
    await database.destroy();
  }
});
test('discovery migration reverts reapplies and repeat-runs without changing existing jobs', async () => {
  const history = await database.query(
    'SELECT * FROM public.typeorm_migrations ORDER BY id',
  );
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'JobDiscovery1793510000000' }),
    ]),
  );
  const runner = database.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    // Exercise discovery specifically, even when newer migrations are installed.
    // Roll back the fixture and DDL together so failures cannot leave schema drift.
    await runner.query(`INSERT INTO ai_job_hunter.opportunities
      ("ownerId", title, company, source, status, "originalLink", "contactNotes", description, notes, "contactDates", "followUpDate", "appliedDate", "applicationChannel")
      VALUES ('00000000-0000-4000-8000-000000000001', 'Synthetic discovery migration preservation', 'Synthetic Discovery Company', 'Other', 'APPLIED', '', '', '', 'Keep tracking notes', '["2026-10-30"]', '2026-11-03', '2026-10-25', 'Referral')`);
    const snapshot = () =>
      runner.query(
        'SELECT id, status, notes, "contactDates", "followUpDate"::text, "appliedDate"::text, "applicationChannel" FROM ai_job_hunter.opportunities ORDER BY id',
      );
    const before = await snapshot();
    const [populated] = await runner.query(
      'SELECT count(*)::int AS count FROM ai_job_hunter.opportunities WHERE discovery IS NOT NULL',
    );
    expect(populated.count).toBe(0);
    const migration = new JobDiscovery1793510000000();
    await migration.down(runner);
    expect(
      await runner.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='ai_job_hunter' AND table_name='opportunities' AND column_name='discovery'",
      ),
    ).toEqual([]);
    expect(await snapshot()).toEqual(before);
    await migration.up(runner);
    expect(
      await runner.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='ai_job_hunter' AND table_name='opportunities' AND column_name='discovery'",
      ),
    ).toEqual([{ column_name: 'discovery' }]);
    expect(await snapshot()).toEqual(before);
  } finally {
    try {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
    } finally {
      await runner.release();
    }
  }
  expect(await database.runMigrations()).toEqual([]);
  expect(
    await database.query('SELECT * FROM public.typeorm_migrations ORDER BY id'),
  ).toEqual(history);
});
test('retired auto-import rejects stale clients and preserves existing Inbox data', async () => {
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send({
      title: 'Synthetic Discovery Manual role',
      company: 'Synthetic Discovery Company',
      source: 'Zalo',
      status: 'CONTACTED',
      originalLink: 'https://example.com/synthetic-retired-discovery',
      description: 'Synthetic manual description',
      contactNotes: 'Keep contact',
      notes: 'Keep notes',
      contactDates: ['2026-10-29'],
      followUpDate: null,
    })
    .expect(201);
  ids.add(created.body.id);
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/discover')
    .set(origin)
    .send(filters)
    .expect(410);
  const unchanged = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${created.body.id}`)
    .expect(200);
  expect(unchanged.body).toEqual(created.body);
});
