import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { DatabaseModule } from '../../src/database/database.module.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { TailoredCvModule } from '../../src/tailored-cv/tailored-cv.module.js';
import { TailoredCvService } from '../../src/tailored-cv/tailored-cv.service.js';
import { TailoredDraftService } from '../../src/tailored-cv/tailored-draft.service.js';
import { FoundationRequestErrors } from '../../src/tailored-cv/tailored-cv.http.js';
import {
  CvProfileRevision,
  CvSourceRevision,
  TailoredCvDraft,
} from '../../src/tailored-cv/tailored-cv.entity.js';
import { initialReview } from '../../src/tailored-cv/tailored-draft-review.policy.js';
import type { TailoredDraftDocument } from '../../src/tailored-cv/tailored-draft.contract.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import { cvTextHash } from '../../src/matching/job-match.service.js';
import { MATCHING_POLICY_VERSION } from '../../src/matching/match-context.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { draftFixture } from '../support/tailored-draft-fixtures.js';

let app: INestApplication, db: DataSource;
let drafts: TailoredDraftService, profiles: TailoredCvService;
let aiCalls = 0;
const owner = randomUUID();
const otherOwner = randomUUID();
const v = { contractVersion: '1' };
const fixture = draftFixture();
let profileRevisionId = '';
const sources: string[] = [];

const job = (ownerId: string, title: string) =>
  db.getRepository(Opportunity).save(
    Object.assign(new Opportunity(), {
      ownerId,
      title,
      company: 'Example',
      source: 'Other',
      status: 'SAVED',
      originalLink: '',
      contactNotes: '',
      description: 'Java required',
      skills: 'Java',
      notes: '',
      contactDates: [],
      appliedDate: null,
      applicationChannel: null,
      followUpDate: null,
    }),
  );
const fact = (id: string, proposedWording?: unknown) => ({
  id,
  ...(proposedWording === undefined ? {} : { proposedWording }),
});
const doc = (review: unknown, facts: unknown[] = [], kind = 'tailored_cv') =>
  ({
    contractVersion: '1',
    kind,
    sections: [{ entries: [{ facts }] }],
    ...(review === undefined ? {} : { review }),
  }) as unknown as TailoredDraftDocument;
async function draft(
  jobRow: Opportunity,
  document: TailoredDraftDocument,
  revision = 1,
  createdAt = new Date(),
) {
  await db.getRepository(TailoredCvDraft).insert({
    id: randomUUID(),
    ownerId: jobRow.ownerId,
    jobId: jobRow.id,
    profileRevisionId,
    jobUpdatedAt: jobRow.updatedAt,
    revision,
    document,
    generationMetadata: null,
    createdAt,
    updatedAt: createdAt,
  });
}
// What the client computes from GET /drafts/:id (dto() falls back to initialReview).
function clientSummary(document: TailoredDraftDocument, revision: number) {
  const review = document.review ?? initialReview(document);
  return {
    pending: Object.values(review.factReviews).filter(
      (s) => s.proposal === 'pending',
    ).length,
    approved:
      review.approval?.revision !== undefined &&
      review.approval.revision === revision,
  };
}

beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  await db.runMigrations();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, TailoredCvModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({
      generate: () => {
        aiCalls++;
        throw Error('No AI in progress reads');
      },
    })
    .compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  await app.init();
  drafts = app.get(TailoredDraftService);
  profiles = app.get(TailoredCvService);
  // Drafts reference a real (synthetic) review profile.
  await db.getRepository(SavedCv).insert({
    ownerId: owner,
    fileName: 'synthetic-progress-cv.txt',
    text: fixture.text,
    sourceMetadata: null,
  });
  const cv = await db
    .getRepository(SavedCv)
    .findOneByOrFail({ ownerId: owner });
  const source = await profiles.capture(owner, {
    ...v,
    expectedSavedCvUpdatedAt: cv.updatedAt.toISOString(),
  });
  sources.push(source.id);
  const profile = await profiles.createProfile(owner, {
    ...v,
    sourceRevisionId: source.id,
    expectedSavedCvUpdatedAt: cv.updatedAt.toISOString(),
  });
  profileRevisionId = profile.id;
});
afterAll(async () => {
  await app?.close();
  if (!db?.isInitialized) return;
  for (const ownerId of [owner, otherOwner]) {
    await db.getRepository(TailoredCvDraft).delete({ ownerId });
    await db.getRepository(CvMatchRecord).delete({ ownerId });
    await db.getRepository(Opportunity).delete({ ownerId });
  }
  await db.getRepository(CvProfileRevision).delete({ ownerId: owner });
  for (const id of sources)
    await db.getRepository(CvSourceRevision).delete({ ownerId: owner, id });
  await db.getRepository(SavedCv).delete({ ownerId: owner });
  await db.destroy();
});

test('SQL draft summary matches the review policy for the latest draft only', async () => {
  const proposal = { text: 'x', status: 'pending', requirementIds: [] };
  const cases: [string, TailoredDraftDocument, number][] = [
    // Null review: initialReview() marks truthy proposedWording as pending.
    [
      'null review',
      doc(null, [
        fact('a', proposal),
        fact('b', proposal),
        fact('c', null),
        fact('d'),
        fact('e', ''),
      ]),
      1,
    ],
    ['missing review', doc(undefined, [fact('a', proposal)]), 1],
    [
      'decided suggestions',
      doc({
        factReviews: {
          a: { proposal: 'pending' },
          b: { proposal: 'accepted' },
          c: { proposal: 'rejected' },
          d: { proposal: 'none' },
        },
        approval: null,
      }),
      2,
    ],
    [
      'approved current revision',
      doc({
        factReviews: { a: { proposal: 'accepted' } },
        approval: { revision: 3 },
      }),
      3,
    ],
    [
      'approved older revision',
      doc({
        factReviews: { a: { proposal: 'accepted' } },
        approval: { revision: 2 },
      }),
      3,
    ],
    [
      'legacy review without approval',
      doc({ factReviews: { a: { proposal: 'rejected' } } }),
      1,
    ],
  ];
  const rows = new Map<string, Opportunity>();
  for (const [name, document, revision] of cases) {
    const row = await job(owner, name);
    rows.set(name, row);
    await draft(row, document, revision);
  }
  // An older draft with pending work must not leak into the summary.
  const latest = await job(owner, 'latest wins');
  await draft(
    latest,
    doc(null, [fact('a', proposal)]),
    1,
    new Date('2020-01-01'),
  );
  await draft(latest, doc({ factReviews: {}, approval: { revision: 1 } }), 1);
  // A malformed saved review yields no pending count, so no step is inferred.
  const malformed = await job(owner, 'malformed');
  await draft(malformed, doc({ approval: null }));
  const otherKind = await job(owner, 'other kind');
  await draft(otherKind, doc(null, [], 'profile'));

  const result = await drafts.progress(owner);
  const byId = new Map(result.jobs.map((j) => [j.id, j]));
  for (const [name, document, revision] of cases)
    expect([name, byId.get(rows.get(name)!.id)!.draft]).toEqual([
      name,
      expect.objectContaining(clientSummary(document, revision)),
    ]);
  expect(byId.get(latest.id)!.draft).toMatchObject({
    pending: 0,
    approved: true,
  });
  expect(byId.get(malformed.id)!.draft).toMatchObject({ pending: null });
  expect(byId.get(otherKind.id)!.draft).toBeNull();
  // Facts only: no draft content in the response.
  expect(JSON.stringify(result)).not.toContain('factReviews');
});

test('match status is read-only, owner-scoped and covers every job', async () => {
  const cv = await db.getRepository(SavedCv).findOneOrFail({
    where: { ownerId: owner },
    select: { ownerId: true, text: true, updatedAt: true },
  });
  const hash = cvTextHash(cv.text);
  const statuses = {
    VALID: { policyVersion: MATCHING_POLICY_VERSION, cvTextHash: hash },
    STALE_CV: { policyVersion: MATCHING_POLICY_VERSION, cvTextHash: 'other' },
    EXPIRED: { policyVersion: 'old-policy', cvTextHash: hash },
  } as const;
  const ids: Record<string, string> = {};
  const oldCvTime = new Date('2020-01-01T00:00:00.000Z');
  for (const [status, fields] of Object.entries(statuses)) {
    const row = await job(owner, `match ${status}`);
    ids[status] = row.id;
    await db.getRepository(CvMatchRecord).insert({
      matchId: randomUUID(),
      ownerId: owner,
      jobId: row.id,
      // An old CV timestamp would be re-bound by currentMatch(); progress must not.
      cvUpdatedAt: oldCvTime,
      jobUpdatedAt: row.updatedAt,
      analyzedAt: new Date(),
      assessment: {} as never,
      ...fields,
    });
  }
  const staleJob = await job(owner, 'match STALE_JOB');
  ids.STALE_JOB = staleJob.id;
  await db.getRepository(CvMatchRecord).insert({
    matchId: randomUUID(),
    ownerId: owner,
    jobId: staleJob.id,
    cvUpdatedAt: oldCvTime,
    jobUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
    analyzedAt: new Date(),
    assessment: {} as never,
    policyVersion: MATCHING_POLICY_VERSION,
    cvTextHash: hash,
  });
  ids.MISSING = (await job(owner, 'match MISSING')).id;
  // More than 20 jobs are all returned; no candidate cap.
  for (let n = 0; n < 22; n++) await job(owner, `bulk ${n}`);
  // Another owner's job never appears.
  const foreign = await job(otherOwner, 'foreign');

  const result = await drafts.progress(owner);
  const byId = new Map(result.jobs.map((j) => [j.id, j]));
  for (const [status, id] of Object.entries(ids))
    expect([status, byId.get(id)?.matchStatus]).toEqual([status, status]);
  expect(byId.has(foreign.id)).toBe(false);
  const total = await db.getRepository(Opportunity).countBy({ ownerId: owner });
  expect(result.jobs).toHaveLength(total);
  expect(total).toBeGreaterThan(20);
  // Read-only: no CV re-bind, no AI.
  const rows = await db.getRepository(CvMatchRecord).findBy({ ownerId: owner });
  expect(
    rows.every((r) => r.cvUpdatedAt.getTime() === oldCvTime.getTime()),
  ).toBe(true);
  expect(aiCalls).toBe(0);
  // Without a CV: every job is CV_UNAVAILABLE and the CV is reported missing.
  const none = await drafts.progress(otherOwner);
  expect(none.cv).toEqual({ saved: false, sourceReason: null });
  expect(none.jobs.map((j) => j.matchStatus)).toEqual(['CV_UNAVAILABLE']);
});

test('CV-level source reason equals readiness without a match', async () => {
  const cv = await db
    .getRepository(SavedCv)
    .findOneByOrFail({ ownerId: owner });
  const row = await job(owner, 'readiness parity');
  const readiness = await drafts.readiness(owner, row.id, {
    ...v,
    expectedJobUpdatedAt: row.updatedAt.toISOString(),
    expectedSavedCvUpdatedAt: cv.updatedAt.toISOString(),
    matchId: null,
  });
  const result = await drafts.progress(owner);
  expect(result.cv).toEqual({ saved: true, sourceReason: readiness.reason });
});

test('POST /tailored-cv/job-progress is a local, versioned, read-only read', async () => {
  const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
  const url = '/api/v1/tailored-cv/job-progress';
  // Personal data: same strict local-origin policy as other private reads.
  await request(app.getHttpServer()).post(url).send(v).expect(403);
  await request(app.getHttpServer())
    .post(url)
    .set(origin)
    .send({ ...v, extra: true })
    .expect(400);
  const response = await request(app.getHttpServer())
    .post(url)
    .set(origin)
    .send(v)
    .expect(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toMatchObject({
    contractVersion: '1',
    cv: { saved: expect.any(Boolean) },
    jobs: expect.any(Array),
  });
});
