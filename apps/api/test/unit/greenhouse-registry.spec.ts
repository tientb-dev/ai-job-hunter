import { expect, jest, test } from '@jest/globals';
import {
  activeGreenhouseSources,
  DISCOVERY_SOURCES,
  greenhouseSourceKey,
  validateGreenhouseRegistry,
} from '../../src/discovery/greenhouse-registry.js';
import {
  discoverySourceKey,
  GreenhouseSource,
  normalizeGreenhouse,
} from '../../src/discovery/greenhouse.source.js';
import { DiscoveryService } from '../../src/discovery/discovery.service.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
const board = {
  key: 'greenhouse:synthetic',
  token: 'synthetic',
  name: 'Synthetic',
  enabled: true,
};
const filters = {
  location: 'Vietnam',
  stacks: ['Java'],
  workMode: 'All',
  seniority: 'All',
};
const payload = (token: string) => ({
  jobs: [
    {
      id: 1,
      title: 'Java engineer',
      company_name: 'Synthetic company',
      location: { name: 'Vietnam' },
      content: '<p>Required Java.</p>',
      absolute_url: `https://job-boards.greenhouse.io/${token}/jobs/1`,
    },
  ],
});

test('bounded static registry rejects malformed tokens, duplicate identities and caller URLs', () => {
  for (const entries of [
    [],
    Array.from({ length: 7 }, (_, i) => ({
      ...board,
      token: `board${i}`,
      key: `greenhouse:board${i}`,
    })),
    [board, { ...board, key: 'greenhouse:other' }],
    [board, { ...board, token: 'other' }],
    ...[
      '../other',
      'https://example.com',
      'Synthetic',
      'x?redirect=y',
      'x'.repeat(81),
      '',
    ].map((token) => [{ ...board, token }]),
    [{ ...board, key: 'other' }],
    [{ ...board, name: '' }],
    [{ ...board, name: 'x'.repeat(201) }],
    [{ ...board, url: 'https://example.com' }],
  ]) {
    expect(() => validateGreenhouseRegistry(entries)).toThrow();
  }
  expect(Object.isFrozen(DISCOVERY_SOURCES)).toBe(true);
  expect(Object.isFrozen(DISCOVERY_SOURCES[0])).toBe(true);
});
test('existing canonical URLs and keys remain exact and disabled sources still resolve', () => {
  expect(DISCOVERY_SOURCES.slice(0, 2)).toMatchObject([
    {
      key: 'greenhouse:axon',
      name: 'Axon · Greenhouse',
      url: 'https://boards-api.greenhouse.io/v1/boards/axon/jobs?content=true',
    },
    {
      key: 'greenhouse:workatbackbase',
      name: 'Backbase · Greenhouse',
      url: 'https://boards-api.greenhouse.io/v1/boards/workatbackbase/jobs?content=true',
    },
  ]);
  const registry = validateGreenhouseRegistry([{ ...board, enabled: false }]);
  expect(activeGreenhouseSources(registry)).toEqual([]);
  expect(greenhouseSourceKey(registry[0].url, registry)).toBe(board.key);
  expect(greenhouseSourceKey('https://example.com')).toBeUndefined();
});
test.each(['temus', 'go1vn', 'thoughtworks', 'agoda'])(
  'new board %s normalizes without changing identity or metadata rules',
  (token) => {
    const source = DISCOVERY_SOURCES.find((s) => s.token === token)!;
    const { jobs, invalid } = normalizeGreenhouse(
      payload(token),
      source,
      '2026-11-04T00:00:00.000Z',
    );
    expect(invalid).toBe(0);
    expect(jobs[0]).toMatchObject({
      location: 'Vietnam',
      workMode: '',
      seniority: '',
      discovery: {
        sourceJobId: '1',
        sourceName: source.name,
        sourceUrl: source.url,
      },
    });
    expect(discoverySourceKey(jobs[0]!.discovery)).toBe(`greenhouse:${token}`);
  },
);
test('two concurrent fetches aggregate equal-rank jobs and failures in registry order', async () => {
  jest.useFakeTimers();
  let active = 0,
    max = 0;
  const calls: string[] = [];
  const source = {
    read: async (value: { url: string }) => {
      const index = DISCOVERY_SOURCES.findIndex((s) => s.url === value.url);
      calls.push(value.url);
      active++;
      max = Math.max(max, active);
      await new Promise((resolve) =>
        setTimeout(resolve, index % 2 === 0 ? 50 : 5),
      );
      active--;
      if (index === 2) throw new Error('private error');
      return payload(DISCOVERY_SOURCES[index]!.token);
    },
  };
  try {
    const service = new DiscoveryService(
      source as unknown as GreenhouseSource,
      {} as OpportunitiesService,
    );
    const run = service.scan(filters);
    expect(calls).toEqual(DISCOVERY_SOURCES.slice(0, 2).map((s) => s.url));
    await jest.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(2);
    await jest.runAllTimersAsync();
    const result = await run;
    expect(max).toBe(2);
    expect(calls).toEqual(DISCOVERY_SOURCES.map((s) => s.url));
    expect(result.jobs.map((j) => j.discovery.sourceName)).toEqual(
      DISCOVERY_SOURCES.filter((_, i) => i !== 2).map((s) => s.name),
    );
    expect(result.errors).toEqual([
      'Temus · Greenhouse: feed unavailable or rate limited. Retry later; no sample listings substituted.',
    ]);
  } finally {
    jest.useRealTimers();
  }
});
test('new board caches and cooldowns remain independent and expire at existing bounds', async () => {
  jest.useFakeTimers();
  const original = globalThis.fetch;
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(payload('temus')))
    .mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '600' } }),
    )
    .mockImplementation(async () => Response.json({ jobs: [] }));
  globalThis.fetch = fetch;
  try {
    const source = new GreenhouseSource();
    await source.read(DISCOVERY_SOURCES[2]);
    await expect(source.read(DISCOVERY_SOURCES[3])).rejects.toThrow();
    await source.read(DISCOVERY_SOURCES[2]);
    expect(fetch).toHaveBeenCalledTimes(2);
    jest.setSystemTime(Date.now() + 300001);
    await source.read(DISCOVERY_SOURCES[2]);
    await expect(source.read(DISCOVERY_SOURCES[3])).rejects.toThrow('cooldown');
    expect(fetch).toHaveBeenCalledTimes(3);
    jest.setSystemTime(Date.now() + 300000);
    await source.read(DISCOVERY_SOURCES[3]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    await expect(
      source.read({ name: 'Untrusted', url: 'https://example.com' }),
    ).rejects.toThrow('Unsupported source');
    expect(fetch).toHaveBeenCalledTimes(4);
  } finally {
    globalThis.fetch = original;
    jest.useRealTimers();
  }
});
