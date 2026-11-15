import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../../src/database/database.config.js';
import { DiscoveryCandidate } from '../../src/discovery/discovery-candidate.entity.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { DiscoveryQueueActionsService } from '../../src/discovery/discovery-queue-actions.service.js';
import { DiscoveryService } from '../../src/discovery/discovery.service.js';
import {
  DISCOVERY_SOURCES,
  type GreenhouseSource,
} from '../../src/discovery/greenhouse.source.js';
import {
  LOCAL_OWNER_ID,
  OpportunitiesService,
} from '../../src/opportunities/opportunities.service.js';
import type { JobImportService } from '../../src/opportunities/job-import.service.js';
import { discoveredOpportunityFields } from '../../src/opportunities/discovered-opportunity.js';

let db: DataSource;
const owners = new Set<string>();
const filters = {
  location: 'Vietnam',
  stacks: ['Java'],
  seniority: 'All',
  workMode: 'All',
};
beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  expect(
    await db.query('SELECT current_database() AS name, current_user AS role'),
  ).toEqual([{ name: 'ai_job_hunter_test', role: 'ai_job_hunter_test' }]);
  await db.runMigrations();
});
afterAll(async () => {
  if (db?.isInitialized) {
    for (const ownerId of owners) {
      await db.getRepository(DiscoveryCandidate).delete({ ownerId });
      await db.getRepository(Opportunity).delete({ ownerId });
    }
    await db.destroy();
  }
});
function setup(count = 1) {
  const owner = randomUUID();
  owners.add(owner);
  const raw = (id: number) => ({
    id,
    title: `Synthetic Java ${id}`,
    company_name: `Synthetic ${owner}`,
    location: { name: 'Vietnam' },
    content: '<p>Required Java.</p>',
    absolute_url: `https://boards.greenhouse.io/${owner}/jobs/${id}`,
  });
  let feed = Array.from({ length: count }, (_, i) => raw(i + 1));
  let failure = false;
  const source = {
    read: async (value: { url: string }) => {
      if (value.url === DISCOVERY_SOURCES[1].url) {
        if (failure) throw new Error('Synthetic feed failure');
        return { jobs: [] };
      }
      if (value.url !== DISCOVERY_SOURCES[0].url) return { jobs: [] };
      return { jobs: feed };
    },
  };
  const ops = new OpportunitiesService(
    db.getRepository(Opportunity),
    {} as JobImportService,
  );
  const pipeline = new DiscoveryService(
    source as unknown as GreenhouseSource,
    ops,
  );
  const actions = new DiscoveryQueueActionsService(
    db.getRepository(DiscoveryCandidate),
    pipeline,
    ops,
  );
  return {
    owner,
    ops,
    pipeline,
    actions,
    setFailure: () => {
      failure = true;
    },
    changeFeed: () => {
      feed = feed.map((row) => ({ ...row, title: 'Changed provider title' }));
    },
  };
}
async function candidates(ownerId: string) {
  return db
    .getRepository(DiscoveryCandidate)
    .find({ where: { ownerId }, order: { sourceJobId: 'ASC' } });
}

test('ingestion cap, repeated/concurrent runs, partial failures and all states retain original snapshots', async () => {
  const env = setup(54);
  env.setFailure();
  const first = await env.actions.run(env.owner, filters);
  expect(first).toMatchObject({
    found: 54,
    added: 50,
    refreshed: 0,
    remaining: 4,
  });
  expect(first.errors).toHaveLength(1);
  expect(
    await db.getRepository(Opportunity).countBy({ ownerId: env.owner }),
  ).toBe(0);
  const initial = await candidates(env.owner);
  await env.actions.status(env.owner, initial[0]!.id, { status: 'SEEN' });
  await env.actions.status(env.owner, initial[1]!.id, { status: 'DISMISSED' });
  await env.actions.save(env.owner, initial[2]!.id, {});
  const before = await candidates(env.owner);
  env.changeFeed();
  const parallel = new DiscoveryQueueActionsService(
    db.getRepository(DiscoveryCandidate),
    env.pipeline,
    env.ops,
  );
  const runs = await Promise.all([
    env.actions.run(env.owner, filters),
    parallel.run(env.owner, filters),
  ]);
  expect(runs.reduce((n, run) => n + run.added, 0)).toBe(4);
  const after = await candidates(env.owner);
  expect(after).toHaveLength(54);
  for (const old of before) {
    const row = after.find((item) => item.id === old.id)!;
    expect(row.status).toBe(old.status);
    expect(row.snapshot).toEqual(old.snapshot);
    expect(row.firstSeenAt).toEqual(old.firstSeenAt);
    expect(row.updatedAt).toEqual(old.updatedAt);
    expect(row.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      old.lastSeenAt.getTime(),
    );
  }
});
test('explicit transitions, no-op timestamps, invalid inputs and owner isolation', async () => {
  const env = setup();
  await env.actions.run(env.owner, filters);
  const [row] = await candidates(env.owner);
  const seen = await env.actions.status(env.owner, row!.id, { status: 'SEEN' });
  expect(
    (await env.actions.status(env.owner, row!.id, { status: 'SEEN' }))
      .updatedAt,
  ).toEqual(seen.updatedAt);
  await env.actions.status(env.owner, row!.id, { status: 'DISMISSED' });
  await env.actions.status(env.owner, row!.id, { status: 'DISMISSED' });
  await expect(
    env.actions.status(env.owner, row!.id, { status: 'SEEN' }),
  ).rejects.toMatchObject({ errorCode: 'INVALID_REVIEW_TRANSITION' });
  await expect(env.actions.save(randomUUID(), row!.id, {})).rejects.toThrow(
    'not found',
  );
  await expect(
    env.actions.status(randomUUID(), row!.id, { status: 'SEEN' }),
  ).rejects.toThrow('not found');
  await expect(
    env.actions.save(env.owner, row!.id, { opportunityId: randomUUID() }),
  ).rejects.toThrow();
  await env.actions.save(env.owner, row!.id, {});
  await expect(
    env.actions.status(env.owner, row!.id, { status: 'DISMISSED' }),
  ).rejects.toThrow();
});
test('concurrent/retried Save creates exactly one job and preserves that link after job edits', async () => {
  const env = setup();
  await env.actions.run(env.owner, filters);
  const [row] = await candidates(env.owner);
  const results = await Promise.all([
    env.actions.save(env.owner, row!.id, {}),
    env.actions.save(env.owner, row!.id, {}),
  ]);
  expect(new Set(results.map((r) => r.opportunityId)).size).toBe(1);
  expect(results.map((r) => r.outcome).sort()).toEqual([
    'already_saved',
    'created',
  ]);
  expect(
    await db.getRepository(Opportunity).countBy({ ownerId: env.owner }),
  ).toBe(1);
  await db.getRepository(Opportunity).update(results[0]!.opportunityId, {
    title: 'User edited title',
    originalLink: '',
  });
  expect(await env.actions.save(env.owner, row!.id, {})).toMatchObject({
    outcome: 'already_saved',
    opportunityId: results[0]!.opportunityId,
  });
});
test('exact duplicates link without overwrite; multiple exact matches conflict even with confirmation', async () => {
  const env = setup(2);
  await env.actions.run(env.owner, filters);
  const rows = await candidates(env.owner);
  const repo = db.getRepository(Opportunity);
  const existing = await repo.save(
    repo.create({
      ...discoveredOpportunityFields(rows[0]!.snapshot),
      ownerId: env.owner,
      notes: 'Preserve notes',
      status: 'APPLIED',
      discovery: rows[0]!.snapshot.discovery,
    }),
  );
  const before = await repo.findOneByOrFail({ id: existing.id });
  expect(await env.actions.save(env.owner, rows[0]!.id, {})).toMatchObject({
    outcome: 'linked_existing',
    opportunityId: existing.id,
  });
  expect(await repo.findOneByOrFail({ id: existing.id })).toEqual(before);
  for (let i = 0; i < 2; i++)
    await repo.save(
      repo.create({
        ...discoveredOpportunityFields(rows[1]!.snapshot),
        ownerId: env.owner,
      }),
    );
  await expect(
    env.actions.save(env.owner, rows[1]!.id, { confirmSeparate: true }),
  ).rejects.toMatchObject({ errorCode: 'AMBIGUOUS_INBOX_MATCH' });
  expect(
    (
      await db
        .getRepository(DiscoveryCandidate)
        .findOneByOrFail({ id: rows[1]!.id })
    ).status,
  ).toBe('NEW');
});
test('heuristic-only matches require explicit separate-job confirmation', async () => {
  const env = setup();
  await env.actions.run(env.owner, filters);
  const [row] = await candidates(env.owner);
  const repo = db.getRepository(Opportunity);
  const match = await repo.save(
    repo.create({
      ...discoveredOpportunityFields(row!.snapshot),
      ownerId: env.owner,
      originalLink: 'https://example.com/different',
      notes: 'Private synthetic notes',
    }),
  );
  await expect(env.actions.save(env.owner, row!.id, {})).rejects.toMatchObject({
    errorCode: 'POSSIBLE_DUPLICATE',
    matches: [{ id: match.id }],
  });
  expect(await repo.countBy({ ownerId: env.owner })).toBe(1);
  const saved = await env.actions.save(env.owner, row!.id, {
    confirmSeparate: true,
  });
  expect(saved.outcome).toBe('created');
  expect(saved.opportunityId).not.toBe(match.id);
  expect(await repo.countBy({ ownerId: env.owner })).toBe(2);
});
test('failure after job insertion rolls back job and candidate link together', async () => {
  const env = setup();
  await env.actions.run(env.owner, filters);
  const [row] = await candidates(env.owner);
  const original = env.ops.saveDiscovered.bind(env.ops);
  const spy = jest
    .spyOn(env.ops, 'saveDiscovered')
    .mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('Synthetic transaction failure');
    });
  try {
    await expect(env.actions.save(env.owner, row!.id, {})).rejects.toThrow(
      'Synthetic transaction failure',
    );
  } finally {
    spy.mockRestore();
  }
  expect(
    await db.getRepository(Opportunity).countBy({ ownerId: env.owner }),
  ).toBe(0);
  expect(
    await db.getRepository(DiscoveryCandidate).findOneByOrFail({ id: row!.id }),
  ).toMatchObject({ status: 'NEW', opportunityId: null });
});
test('manual creation and queue Save share the identity write lock', async () => {
  const env = setup();
  await env.actions.run(env.owner, filters);
  const [row] = await candidates(env.owner);
  // Move only this synthetic candidate to the server owner to exercise the manual service.
  await db
    .getRepository(DiscoveryCandidate)
    .update(row!.id, { ownerId: LOCAL_OWNER_ID });
  try {
    const results = await Promise.allSettled([
      env.ops.create(
        LOCAL_OWNER_ID,
        discoveredOpportunityFields(row!.snapshot),
      ),
      env.actions.save(LOCAL_OWNER_ID, row!.id, {}),
    ]);
    expect(results[1]!.status).toBe('fulfilled');
    expect(
      await db.getRepository(Opportunity).countBy({
        ownerId: LOCAL_OWNER_ID,
        originalLink: row!.snapshot.originalLink,
      }),
    ).toBe(1);
  } finally {
    await db.getRepository(DiscoveryCandidate).delete({ id: row!.id });
    await db.getRepository(Opportunity).delete({
      ownerId: LOCAL_OWNER_ID,
      originalLink: row!.snapshot.originalLink,
    });
  }
});

test('pre-existing Inbox jobs still discover as NEW and explicit Save preserves application history', async () => {
  const env = setup();
  const { jobs } = await env.pipeline.scan(filters);
  const repo = db.getRepository(Opportunity);
  const existing = await repo.save(
    repo.create({
      ...discoveredOpportunityFields(jobs[0]!),
      ownerId: env.owner,
      discovery: jobs[0]!.discovery,
      status: 'APPLIED',
      notes: 'Preserve application notes',
      contactDates: ['2026-10-29'],
      appliedDate: '2026-10-25',
      applicationChannel: 'Referral',
    }),
  );
  const before = await repo.findOneByOrFail({ id: existing.id });
  expect(await env.actions.run(env.owner, filters)).toMatchObject({
    added: 1,
    refreshed: 0,
  });
  const [row] = await candidates(env.owner);
  expect(row).toMatchObject({ status: 'NEW', opportunityId: null });
  expect(await repo.findOneByOrFail({ id: existing.id })).toEqual(before);
  expect(await env.actions.save(env.owner, row!.id, {})).toMatchObject({
    outcome: 'linked_existing',
    opportunityId: existing.id,
  });
  expect(await repo.countBy({ ownerId: env.owner })).toBe(1);
  expect(await repo.findOneByOrFail({ id: existing.id })).toEqual(before);
});
