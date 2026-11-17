import 'reflect-metadata';
import { expect, jest, test } from '@jest/globals';
import type { EntityManager, Repository } from 'typeorm';
import { candidateSnapshot } from '../support/discovery-candidate.synthetic.js';
import {
  DISCOVERY_SOURCES,
  type GreenhouseSource,
} from '../../src/discovery/greenhouse.source.js';
import { DiscoveryService } from '../../src/discovery/discovery.service.js';
import { DiscoveryQueueActionsService } from '../../src/discovery/discovery-queue-actions.service.js';
import { DiscoveryCandidate } from '../../src/discovery/discovery-candidate.entity.js';
import {
  assertReviewTransition,
  validateReviewStatus,
  validateSaveConfirmation,
} from '../../src/discovery/discovery-actions.validation.js';
import { matchDiscoveredOpportunity } from '../../src/opportunities/discovered-opportunity.js';
import { DiscoveryConflict } from '../../src/discovery/discovery-conflict.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

const snapshot = () => ({
  ...candidateSnapshot(),
  discovery: {
    ...candidateSnapshot().discovery,
    sourceUrl: DISCOVERY_SOURCES[0].url,
  },
});
function existing(change: Partial<Opportunity> = {}): Opportunity {
  return {
    ...snapshot(),
    id: '00000000-0000-4000-8000-000000000002',
    ownerId: '00000000-0000-4000-8000-000000000001',
    ...change,
  } as Opportunity;
}
test('exact source or normalized URL matches link; union ambiguity cannot be bypassed by confirmation', () => {
  const job = snapshot();
  const sourceMatch = existing({
    title: 'Edited title',
    originalLink: 'https://example.com/edited',
  });
  expect(
    matchDiscoveredOpportunity(
      job,
      DISCOVERY_SOURCES[0].key,
      [sourceMatch],
      false,
    ),
  ).toBe(sourceMatch);
  const urlMatch = existing({
    discovery: null,
    originalLink: job.originalLink + '?utm_source=test#section',
  });
  expect(
    matchDiscoveredOpportunity(
      job,
      DISCOVERY_SOURCES[0].key,
      [urlMatch],
      false,
    ),
  ).toBe(urlMatch);
  for (const confirm of [false, true]) {
    try {
      matchDiscoveredOpportunity(
        job,
        DISCOVERY_SOURCES[0].key,
        [sourceMatch, { ...urlMatch, id: 'other' }],
        confirm,
      );
      throw new Error('Expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(DiscoveryConflict);
      expect(error).toMatchObject({ errorCode: 'AMBIGUOUS_INBOX_MATCH' });
    }
  }
});
test('heuristic duplicates never auto-link and expose only safe bounded match fields', () => {
  const row = existing({
    discovery: null,
    originalLink: 'https://example.com/different',
    notes: 'private note',
    contactNotes: 'private contact',
  });
  expect(() =>
    matchDiscoveredOpportunity(
      snapshot(),
      DISCOVERY_SOURCES[0].key,
      [row],
      false,
    ),
  ).toThrow(DiscoveryConflict);
  try {
    matchDiscoveredOpportunity(
      snapshot(),
      DISCOVERY_SOURCES[0].key,
      [row],
      false,
    );
  } catch (error) {
    expect(error).toMatchObject({
      errorCode: 'POSSIBLE_DUPLICATE',
      matches: [
        {
          id: row.id,
          title: row.title,
          company: row.company,
          location: row.location,
        },
      ],
    });
    expect(JSON.stringify(error)).not.toContain('private');
  }
  expect(
    matchDiscoveredOpportunity(
      snapshot(),
      DISCOVERY_SOURCES[0].key,
      [row],
      true,
    ),
  ).toBeNull();
  expect(
    matchDiscoveredOpportunity(
      snapshot(),
      DISCOVERY_SOURCES[0].key,
      [existing({ discovery: null, company: '', originalLink: '' })],
      false,
    ),
  ).toBeNull();
});
test('review transition matrix keeps SAVED immutable and supports only explicit no-ops', () => {
  for (const current of ['NEW', 'SEEN', 'SAVED', 'DISMISSED'] as const)
    for (const next of ['SEEN', 'DISMISSED'] as const) {
      const allowed =
        current === 'NEW' ||
        current === next ||
        (current === 'SEEN' && next === 'DISMISSED');
      if (allowed)
        expect(() => assertReviewTransition(current, next)).not.toThrow();
      else
        expect(() => assertReviewTransition(current, next)).toThrow(
          DiscoveryConflict,
        );
    }
});
test('action bodies reject client content, owner, arbitrary links and malformed confirmation', () => {
  expect(validateSaveConfirmation(undefined)).toBe(false);
  expect(validateSaveConfirmation({})).toBe(false);
  expect(validateSaveConfirmation({ confirmSeparate: true })).toBe(true);
  expect(validateReviewStatus({ status: 'SEEN' })).toBe('SEEN');
  for (const input of [
    null,
    [],
    { status: 'SAVED' },
    { status: ['SEEN'] },
    { status: 'SEEN', ownerId: 'other' },
  ])
    expect(() => validateReviewStatus(input)).toThrow();
  for (const input of [
    null,
    [],
    { confirmSeparate: 'true' },
    { confirmSeparate: 1 },
    { opportunityId: 'chosen' },
    { snapshot: snapshot() },
    { ownerId: 'other' },
  ])
    expect(() => validateSaveConfirmation(input)).toThrow();
});
test('queue run uses shared source validation and partial failures, caps new identities and never creates Inbox jobs', async () => {
  const raw = (id: number) => ({
    id,
    title: `Java ${id}`,
    company_name: 'Synthetic Company',
    location: { name: 'Vietnam' },
    content: '<p>Required Java.</p>',
    absolute_url: `https://boards.greenhouse.io/synthetic/jobs/${id}`,
  });
  let listingCount = 56;
  let allFailed = false;
  const source = {
    read: jest.fn(async (value: { url: string }) => {
      if (allFailed) throw new Error('private failure');
      if (value.url === DISCOVERY_SOURCES[1].url)
        throw new Error('private failure');
      if (value.url !== DISCOVERY_SOURCES[0].url) return { jobs: [] };
      return {
        jobs: [
          ...Array.from({ length: listingCount }, (_, i) => raw(i + 1)),
          raw(1),
        ],
      };
    }),
  };
  const opportunities = {
    importDiscovered: jest.fn(),
    saveDiscovered: jest.fn(),
  };
  const pipeline = new DiscoveryService(
    source as unknown as GreenhouseSource,
    opportunities as unknown as OpportunitiesService,
  );
  const rows: { id: string; sourceKey: string; sourceJobId: string }[] = [];
  const inserted: unknown[] = [];
  const repository = {
    find: async () => rows,
    insert: async (row: { sourceKey: string; sourceJobId: string }) => {
      inserted.push(row);
      rows.push({ id: String(rows.length), ...row });
    },
  };
  const query = jest.fn(async () => []);
  const manager = { getRepository: () => repository, query };
  const candidates = {
    manager: {
      transaction: async (run: (m: EntityManager) => Promise<unknown>) =>
        run(manager as unknown as EntityManager),
    },
  };
  const actions = new DiscoveryQueueActionsService(
    candidates as unknown as Repository<DiscoveryCandidate>,
    pipeline,
    opportunities as unknown as OpportunitiesService,
  );
  const owner = '00000000-0000-4000-8000-000000000001';
  const filters = {
    location: 'Vietnam',
    stacks: ['Java'],
    seniority: 'All',
    workMode: 'All',
  };
  expect(await actions.run(owner, filters)).toMatchObject({
    found: 56,
    eligible: 56,
    fetched: 57,
    normalized: 57,
    sourceFailures: 1,
    added: 50,
    refreshed: 0,
    remaining: 6,
  });
  // Rescan every review state without updating the stored snapshot or link.
  rows.slice(0, 4).forEach((row, index) =>
    Object.assign(row, {
      status: ['NEW', 'SEEN', 'SAVED', 'DISMISSED'][index],
      snapshot: { title: 'Original snapshot' },
      opportunityId: index === 2 ? 'existing-inbox-id' : null,
    }),
  );
  const beforeRescan = structuredClone(rows.slice(0, 4));
  const result = await actions.run(owner, filters);
  expect(rows.slice(0, 4)).toEqual(beforeRescan);
  const refreshes = query.mock.calls as unknown as [string, unknown[]][];
  expect(refreshes.filter(([sql]) => sql.startsWith('UPDATE'))).toHaveLength(
    50,
  );
  for (const [sql] of refreshes.filter(([sql]) => sql.startsWith('UPDATE')))
    expect(sql).toBe(
      'UPDATE ai_job_hunter.discovery_candidates SET "lastSeenAt"=GREATEST("lastSeenAt", $1::timestamptz) WHERE id=$2 AND "ownerId"=$3',
    );
  expect(result).toMatchObject({
    found: 56,
    eligible: 56,
    fetched: 57,
    normalized: 57,
    sourceFailures: 1,
    added: 6,
    refreshed: 50,
    remaining: 0,
  });
  expect(result.eligible).toBe(
    result.added + result.refreshed + result.remaining,
  );
  expect(result.errors).toHaveLength(1);
  expect(result.errors.join()).not.toContain('private');
  expect(inserted).toHaveLength(56);
  listingCount = 110;
  const capped = await actions.run(owner, filters);
  expect(capped).toMatchObject({
    eligible: 110,
    found: 110,
    fetched: 111,
    normalized: 111,
    added: 50,
    refreshed: 56,
    remaining: 4,
  });
  expect(capped.eligible).toBe(
    capped.added + capped.refreshed + capped.remaining,
  );
  expect(rows.slice(0, 4)).toEqual(beforeRescan);
  allFailed = true;
  const beforeFailure = structuredClone(rows);
  const failed = await actions.run(owner, filters);
  expect(failed).toMatchObject({
    eligible: 0,
    found: 0,
    fetched: 0,
    normalized: 0,
    added: 0,
    refreshed: 0,
    remaining: 0,
    sourceFailures: DISCOVERY_SOURCES.length,
  });
  expect(rows).toEqual(beforeFailure);
  expect(opportunities.importDiscovered).not.toHaveBeenCalled();
  expect(opportunities.saveDiscovered).not.toHaveBeenCalled();
  await expect(
    actions.run(owner, { ...filters, ownerId: owner }),
  ).rejects.toThrow();
});

test('Save passes one transaction through job creation and linkage, and retries use the existing link', async () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  const id = '00000000-0000-4000-8000-000000000002';
  const opportunityId = '00000000-0000-4000-8000-000000000003';
  const row = Object.assign(new DiscoveryCandidate(), {
    id,
    ownerId: owner,
    sourceKey: DISCOVERY_SOURCES[0].key,
    status: 'NEW',
    snapshot: snapshot(),
    opportunityId: null,
  });
  const repository = {
    findOne: jest.fn(async () => row),
    save: jest.fn(async (value: DiscoveryCandidate) => value),
  };
  const manager = {
    query: jest.fn(async () => []),
    getRepository: () => repository,
  };
  const candidates = {
    manager: {
      transaction: async (run: (m: EntityManager) => Promise<unknown>) =>
        run(manager as unknown as EntityManager),
    },
  };
  const opportunities = {
    saveDiscovered: jest
      .fn<OpportunitiesService['saveDiscovered']>()
      .mockResolvedValue({ opportunityId, outcome: 'created' }),
    requireOwnedLink: jest
      .fn<OpportunitiesService['requireOwnedLink']>()
      .mockResolvedValue(undefined),
  };
  const actions = new DiscoveryQueueActionsService(
    candidates as unknown as Repository<DiscoveryCandidate>,
    {} as DiscoveryService,
    opportunities as unknown as OpportunitiesService,
  );
  expect(await actions.save(owner, id, {})).toMatchObject({
    candidateId: id,
    opportunityId,
    status: 'SAVED',
    outcome: 'created',
  });
  expect(opportunities.saveDiscovered).toHaveBeenCalledWith(
    manager as unknown as EntityManager,
    owner,
    row.sourceKey,
    row.snapshot,
    false,
  );
  expect(repository.save).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'SAVED', opportunityId }),
  );
  expect(
    await actions.save(owner, id, { confirmSeparate: true }),
  ).toMatchObject({ opportunityId, outcome: 'already_saved' });
  expect(opportunities.saveDiscovered).toHaveBeenCalledTimes(1);
  expect(repository.save).toHaveBeenCalledTimes(1);
  expect(opportunities.requireOwnedLink).toHaveBeenCalledWith(
    manager as unknown as EntityManager,
    owner,
    opportunityId,
  );
});
