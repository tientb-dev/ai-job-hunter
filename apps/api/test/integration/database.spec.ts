import { asLocalOwner } from '../support/as-local-owner.js';
import { CompleteJobImportFields1793490000000 } from '../../src/database/migrations/1793490000000-CompleteJobImportFields.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { createValidationPipe } from '../../src/config/validation.js';

let database: DataSource;
let app: INestApplication;
beforeAll(async () => {
  // Validate before opening any connection or performing any migration operation.
  database = new DataSource(databaseOptions('test'));
  await database.initialize();
  const [identity] = await database.query(
    'SELECT current_database() AS database, current_user AS role',
  );
  expect(identity).toEqual({
    database: 'ai_job_hunter_test',
    role: 'ai_job_hunter_test',
  });
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  await app.init();
});
afterAll(async () => {
  await app?.close();
  if (database?.isInitialized) await database.destroy();
});
test('connects to the isolated PostgreSQL database', async () => {
  expect(await database.query('SELECT 1 AS connected')).toEqual([
    { connected: 1 },
  ]);
});
test('applies the application schema migration', async () => {
  await database.runMigrations();
  expect(
    await database.query(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name='ai_job_hunter'",
    ),
  ).toEqual([{ schema_name: 'ai_job_hunter' }]);
});
test('reverts and reapplies the complete import fields migration without losing an older job', async () => {
  const [existing] = await database.query(
    `SELECT count(*)::int AS count FROM ai_job_hunter.opportunities WHERE experience<>'' OR "preferredSkills"<>'' OR domain<>''`,
  );
  expect(existing.count).toBe(0);
  const [seed] = await database.query(
    `INSERT INTO ai_job_hunter.opportunities ("ownerId",title,company,source,status,"originalLink","contactNotes",description,notes,"contactDates","followUpDate") VALUES ('00000000-0000-4000-8000-000000000001','Synthetic migration preservation','Example Company','Other','APPLIED','','','','Synthetic tracking notes','["2026-10-30"]'::jsonb,'2026-11-02') RETURNING id`,
  );
  const runner = database.createQueryRunner();
  await runner.connect();
  const migration = new CompleteJobImportFields1793490000000();
  try {
    await migration.down(runner);
    expect(
      await database.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='ai_job_hunter' AND table_name='opportunities' AND column_name='experience'",
      ),
    ).toEqual([]);
    const [old] = await database.query(
      'SELECT title,status,notes,"contactDates","followUpDate"::text FROM ai_job_hunter.opportunities WHERE id=$1',
      [seed.id],
    );
    expect(old).toEqual({
      title: 'Synthetic migration preservation',
      status: 'APPLIED',
      notes: 'Synthetic tracking notes',
      contactDates: ['2026-10-30'],
      followUpDate: '2026-11-02',
    });
    expect(await database.showMigrations()).toBe(false);
  } finally {
    await migration.up(runner);
    await runner.release();
    try {
      const [restored] = await database.query(
        'SELECT experience,"preferredSkills",domain FROM ai_job_hunter.opportunities WHERE id=$1',
        [seed.id],
      );
      expect(restored).toEqual({
        experience: '',
        preferredSkills: '',
        domain: '',
      });
    } finally {
      await database.query(
        "DELETE FROM ai_job_hunter.opportunities WHERE id=$1 AND title='Synthetic migration preservation'",
        [seed.id],
      );
    }
  }
  expect(await database.showMigrations()).toBe(false);
});
test('repeated migration execution changes neither schema nor migration history', async () => {
  const before = await database.query(
    'SELECT * FROM public.typeorm_migrations ORDER BY id',
  );
  expect(await database.runMigrations()).toEqual([]);
  expect(await database.showMigrations()).toBe(false);
  expect(
    await database.query('SELECT * FROM public.typeorm_migrations ORDER BY id'),
  ).toEqual(before);
});
test('liveness responds 200', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/health/live')
    .expect(200, { status: 'ok' });
});
test('readiness responds 200 with real PostgreSQL', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/health/ready')
    .expect(200, { status: 'ok' });
});
test('authentication outage returns 503, preserves liveness, and recovers', async () => {
  // Hold an established administrator session so restoring LOGIN requires no new login.
  // This role exists only in the disposable test cluster, never the development cluster.
  const admin = database.createQueryRunner();
  await admin.connect();
  try {
    await admin.query('ALTER ROLE ai_job_hunter_test NOLOGIN');
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503, { status: 'unavailable' });
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200, { status: 'ok' });
  } finally {
    try {
      await admin.query('ALTER ROLE ai_job_hunter_test LOGIN');
    } finally {
      await admin.release();
    }
  }
  await request(app.getHttpServer())
    .get('/api/v1/health/ready')
    .expect(200, { status: 'ok' });
});
