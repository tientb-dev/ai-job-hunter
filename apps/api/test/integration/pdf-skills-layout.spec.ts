import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { databaseOptions } from '../../src/database/database.config.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { TailoredCvModule } from '../../src/tailored-cv/tailored-cv.module.js';
import { TailoredCvService } from '../../src/tailored-cv/tailored-cv.service.js';
import { FoundationRequestErrors } from '../../src/tailored-cv/tailored-cv.http.js';
import {
  CvSourceRevision,
  CvProfileRevision,
} from '../../src/tailored-cv/tailored-cv.entity.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import {
  EXTRACTION_OWNER,
  ExtractionOwner,
} from '../../src/extraction/extraction.owner.js';
import { DocumentParser } from '../../src/extraction/document-parser.js';
import { skillsPdf } from '../support/pdf-skills-fixture.js';
import { validatePdfLayout } from '../../src/extraction/pdf-layout.js';
import type { ProfileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
const owner = LOCAL_OWNER_ID,
  filename = `synthetic-d22-${randomUUID()}.pdf`;
const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const v = { contractVersion: '1' };
let db: DataSource,
  app: INestApplication,
  sourceId: string,
  profileId: string,
  ownsCv = false;
beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  await db.runMigrations();
  expect(
    await db.getRepository(SavedCv).findOneBy({ ownerId: owner }),
  ).toBeNull();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, TailoredCvModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({ generate: async () => JSON.stringify({ fields: [] }) })
    .overrideProvider(EXTRACTION_OWNER)
    .useValue(new ExtractionOwner(new DocumentParser()))
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  await app.init();
});
afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    if (profileId)
      await db
        .getRepository(CvProfileRevision)
        .delete({ ownerId: owner, profileId });
    if (sourceId)
      await db
        .getRepository(CvSourceRevision)
        .delete({ ownerId: owner, id: sourceId });
    if (ownsCv)
      await db
        .getRepository(SavedCv)
        .delete({ ownerId: owner, fileName: filename });
    await db.destroy();
  }
});
test('fresh synthetic PDF import persists geometry through capture and profile organization over HTTP', async () => {
  const imported = await request(app.getHttpServer())
    .post('/api/v1/opportunities/cv/current')
    .set(headers)
    .field('record', '{}')
    .attach('document', Buffer.from(skillsPdf('interleaved')), {
      filename,
      contentType: 'application/pdf',
    })
    .expect(200);
  ownsCv = true;
  const saved = await db.getRepository(SavedCv).findOneOrFail({
    where: { ownerId: owner },
    select: { ownerId: true, text: true, sourceMetadata: true },
  });
  expect(saved.sourceMetadata?.pdfLayout?.complete).toBe(true);
  expect(
    validatePdfLayout(saved.sourceMetadata!.pdfLayout, saved.text),
  ).toBeDefined();
  const captured = await request(app.getHttpServer())
    .post('/api/v1/tailored-cv/sources')
    .set(headers)
    .send({ ...v, expectedSavedCvUpdatedAt: imported.body.updatedAt })
    .expect(201);
  sourceId = captured.body.id;
  const reloaded = await db.getRepository(CvSourceRevision).findOneOrFail({
    where: { ownerId: owner, id: sourceId },
    select: { id: true, text: true, provenance: true },
  });
  expect(reloaded.text).toBe(saved.text);
  expect(reloaded.provenance.pdfLayout).toEqual(
    saved.sourceMetadata!.pdfLayout,
  );
  const initial = await request(app.getHttpServer())
    .post('/api/v1/tailored-cv/profiles')
    .set(headers)
    .send({
      ...v,
      sourceRevisionId: sourceId,
      expectedSavedCvUpdatedAt: imported.body.updatedAt,
    })
    .expect(201);
  profileId = initial.body.profileId;
  const organized = await request(app.getHttpServer())
    .post(`/api/v1/tailored-cv/profiles/${profileId}/proposal`)
    .set(headers)
    .send({
      ...v,
      expectedRevision: initial.body.revision,
      expectedSavedCvUpdatedAt: imported.body.updatedAt,
    })
    .expect(201);
  const document = organized.body.document as ProfileDocument;
  const rows = document.sections
    .flatMap((s) => s.entries)
    .filter((e) => e.facts.some((f) => f.field === 'skill_category'));
  expect(rows.map((e) => e.facts[0]!.value.trim())).toEqual([
    'Backend',
    'Frontend',
    'Leadership',
  ]);
  expect(rows[0]!.facts.map((f) => f.value.trim())).toEqual([
    'Backend',
    'Java, Spring Boot, C++, C#',
    '.NET, Node.js, CI/CD',
  ]);
  expect(rows[1]!.facts.map((f) => f.value.trim())).toEqual([
    'Frontend',
    'React, TypeScript',
    'Accessibility testing',
  ]);
  const before = structuredClone(document);
  const rebuilt = await app.get(TailoredCvService).propose(
    owner,
    profileId,
    {
      ...v,
      expectedRevision: organized.body.revision,
      expectedSavedCvUpdatedAt: imported.body.updatedAt,
    },
    true,
  );
  expect(rebuilt.revision).toBe(organized.body.revision + 1);
  expect(
    (await app.get(TailoredCvService).getProfile(owner, organized.body.id))
      .document,
  ).toEqual(before);
  expect(
    (
      await db
        .getRepository(CvSourceRevision)
        .findOneOrFail({ where: { id: sourceId }, select: { text: true } })
    ).text,
  ).toBe(saved.text);
});
