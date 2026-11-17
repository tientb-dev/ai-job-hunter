import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { expect, jest, test } from '@jest/globals';
import {
  duplicateJob,
  jobFamily,
  rankJob,
  validateFilters,
  type DiscoveryFilters,
  type DiscoveredJob,
} from '../../src/discovery/discovery.js';
import {
  DISCOVERY_SOURCES,
  GreenhouseSource,
  normalizeGreenhouse,
} from '../../src/discovery/greenhouse.source.js';
import { DiscoveryService } from '../../src/discovery/discovery.service.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
const filters: DiscoveryFilters = {
  family: 'All',
  location: 'Ho Chi Minh City',
  stacks: ['Java', 'Spring Boot', 'Node.js', 'React'],
  workMode: 'All',
  seniority: 'Senior',
};
const raw = {
  id: 100,
  title: 'Senior Backend Developer',
  company_name: 'Synthetic Company',
  location: { name: 'Ho Chi Minh City, Vietnam' },
  absolute_url: 'https://job-boards.greenhouse.io/synthetic/jobs/100',
  content:
    '&lt;p&gt;Required Java and Spring Boot.&lt;/p&gt;&lt;p&gt;Hybrid work schedule.&lt;/p&gt;',
};
const normalized = () =>
  normalizeGreenhouse(
    { jobs: [raw] },
    DISCOVERY_SOURCES[0],
    '2026-10-30T00:00:00.000Z',
  ).jobs[0]!;
test('normalizes source-backed fields, decodes HTML safely and preserves attribution', () => {
  expect(normalized()).toMatchObject({
    title: raw.title,
    company: raw.company_name,
    location: raw.location.name,
    skills: 'Required Java and Spring Boot.',
    workMode: 'Hybrid',
    seniority: 'Senior',
    description: 'Required Java and Spring Boot.\nHybrid work schedule.',
    discovery: {
      sourceName: DISCOVERY_SOURCES[0].name,
      sourceJobId: '100',
      discoveredAt: '2026-10-30T00:00:00.000Z',
    },
  });
});
test('unknown values stay empty and malformed or unsafe source rows are omitted', () => {
  const result = normalizeGreenhouse(
    {
      jobs: [
        {
          ...raw,
          company_name: null,
          location: {},
          title: 'Backend Developer',
          content: '<p>Experience with React.</p>',
        },
        { ...raw, absolute_url: 'http://127.0.0.1/private' },
      ],
    },
    DISCOVERY_SOURCES[0],
    '2026-10-30',
  );
  expect(result.invalid).toBe(1);
  expect(result.jobs[0]).toMatchObject({
    company: '',
    location: '',
    workMode: '',
    seniority: '',
  });
});
test('stack filters use OR and recognize Spring Boot and Node.js backend equivalents', () => {
  for (const description of [
    'Spring Boot',
    'NodeJS backend',
    'Node.js backend',
    'React',
  ])
    expect(
      rankJob({ ...normalized(), skills: '', description }, filters),
    ).not.toBeNull();
  expect(
    rankJob(
      {
        ...normalized(),
        title: 'JavaScript developer',
        skills: '',
        description: 'JavaScript only',
      },
      { ...filters, stacks: ['Java'] },
    ),
  ).toBeNull();
  expect(
    rankJob({ ...normalized(), skills: '', description: 'Rust only' }, filters),
  ).toBeNull();
});
test('ranks HCMC onsite/hybrid and senior/technical leads ahead without dropping unknown or remote jobs', () => {
  const base = normalized();
  const unknown = { ...base, location: '', workMode: '', seniority: '' };
  expect(rankJob(unknown, filters)).not.toBeNull();
  expect(rankJob({ ...unknown, workMode: 'Remote' }, filters)).not.toBeNull();
  expect(rankJob(base, filters)!).toBeGreaterThan(rankJob(unknown, filters)!);
  expect(rankJob({ ...base, seniority: 'Technical Lead' }, filters)).toBe(
    rankJob(base, filters),
  );
  expect(
    rankJob(
      { ...base, location: 'London, United Kingdom', workMode: 'Onsite' },
      filters,
    ),
  ).toBeNull();
});
test('rejects unsupported filters instead of pretending the API supports them', () => {
  expect(() => validateFilters({ ...filters, stacks: ['Go'] })).toThrow();
  expect(() => validateFilters({ ...filters, salary: 100 })).toThrow();
});
test('job family classification is conservative and title-only', () => {
  expect(jobFamily('Senior Backend Software Engineer II')).toBe('IT');
  expect(jobFamily('Binance Accelerator Program - Growth Marketing')).toBe(
    'Marketing',
  );
  expect(jobFamily('Strategic Account Manager (Ho Chi Minh)')).toBe('Sales');
  expect(jobFamily('Nhân viên kinh doanh')).toBe('Sales');
  // Ambiguous or unknown titles are never claimed by a family.
  expect(jobFamily('Sales Engineer')).toBeNull();
  expect(jobFamily('Supply Specialist')).toBeNull();
});
test('a specific family is a hard filter; All keeps uncertain titles; stacks only narrow IT', () => {
  const job = (title: string) => ({
    ...normalized(),
    title,
    skills: '',
    description: 'Hotel partnerships',
  });
  const any = validateFilters({ ...filters, stacks: [] });
  const sales = validateFilters({ ...filters, stacks: [], family: 'Sales' });
  expect(rankJob(job('Account Executive'), sales)).not.toBeNull();
  expect(rankJob(job('Backend Engineer'), sales)).toBeNull();
  expect(rankJob(job('Supply Specialist'), sales)).toBeNull();
  expect(rankJob(job('Supply Specialist'), any)).not.toBeNull();
  expect(
    rankJob(
      job('Backend Engineer'),
      validateFilters({ ...filters, family: 'IT', stacks: ['Java'] }),
    ),
  ).toBeNull();
  expect(() =>
    validateFilters({ ...filters, family: 'Sales', stacks: ['Java'] }),
  ).toThrow();
  expect(() => validateFilters({ ...filters, family: 'Finance' })).toThrow();
  expect(validateFilters({ ...filters, family: undefined }).family).toBe('All');
});
test('no selected stack keeps non-IT jobs eligible but still drops foreign onsite roles', () => {
  const anyFamily = validateFilters({ ...filters, stacks: [] });
  const sales = {
    ...normalized(),
    title: 'Account Manager',
    skills: '',
    description: 'Hotel partnerships and negotiation',
  };
  expect(rankJob(sales, filters)).toBeNull();
  expect(rankJob(sales, anyFamily)).not.toBeNull();
  expect(
    rankJob({ ...sales, location: 'Bangkok, Thailand' }, anyFamily),
  ).toBeNull();
});
test('deduplicates tracked URLs, equivalent HCMC identities, and source IDs after manual edits', () => {
  const job = normalized();
  expect(
    duplicateJob(job, {
      ...job,
      originalLink: `${job.originalLink}?utm_source=test#apply`,
    }),
  ).toBe(true);
  expect(
    duplicateJob(job, {
      ...job,
      discovery: null,
      originalLink: 'https://example.com/other-source',
      location: 'HCMC',
    }),
  ).toBe(true);
  expect(
    duplicateJob(job, {
      ...job,
      title: 'Manually corrected title',
      originalLink: 'https://example.com/edited',
    }),
  ).toBe(true);
  expect(
    duplicateJob(job, {
      ...job,
      discovery: null,
      originalLink: 'https://example.com/other',
      company: 'Another Company',
    }),
  ).toBe(false);
});
test('source failure is reported while the other feed can still import', async () => {
  const source = {
    read: jest
      .fn<(value: { name: string }) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('private internal error'))
      .mockResolvedValueOnce({ jobs: [raw] })
      .mockResolvedValue({ jobs: [] }),
  };
  const jobs = {
    importDiscovered: jest
      .fn<(ownerId: string, rows: DiscoveredJob[]) => Promise<unknown>>()
      .mockResolvedValue({
        imported: 1,
        duplicatesSkipped: 0,
        remaining: 0,
        importedIds: ['synthetic'],
      }),
  };
  const result = await new DiscoveryService(
    source as unknown as GreenhouseSource,
    jobs as unknown as OpportunitiesService,
  ).discover(LOCAL_OWNER_ID, filters);
  expect(result).toMatchObject({ found: 1, imported: 1 });
  expect(result.errors[0]).toContain('feed unavailable');
  expect(result.errors.join()).not.toContain('private internal error');
  expect(jobs.importDiscovered.mock.calls[0]![1][0]!.discovery.sourceName).toBe(
    DISCOVERY_SOURCES[1].name,
  );
});
test('feed cache and 429 Retry-After prevent repeated network requests', async () => {
  const original = globalThis.fetch;
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ jobs: [raw] }))
    .mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '600' } }),
    );
  globalThis.fetch = fetch;
  try {
    const source = new GreenhouseSource();
    await source.read(DISCOVERY_SOURCES[0]);
    await source.read(DISCOVERY_SOURCES[0]);
    await expect(source.read(DISCOVERY_SOURCES[1])).rejects.toThrow();
    await expect(source.read(DISCOVERY_SOURCES[1])).rejects.toThrow('cooldown');
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    globalThis.fetch = original;
  }
});

test('technology mentions do not silently become mandatory skills', () => {
  const decoded = normalizeGreenhouse(
    {
      jobs: [
        {
          ...raw,
          title: 'Backend Developer',
          content:
            '<p>Our products use React.</p><p>Experience with Java is required.</p><p>Spring Boot is a nice to have.</p><p>We build hybrid cloud products.</p>',
        },
      ],
    },
    DISCOVERY_SOURCES[0],
    '2026-10-30',
  );
  expect(decoded.jobs[0]).toMatchObject({
    skills: 'Experience with Java is required.',
    preferredSkills: 'Spring Boot is a nice to have.',
    workMode: '',
    discovery: { techStack: ['Java', 'Spring Boot', 'React'] },
  });
});

test('all live boards retain raw/normalized counts, distinct eligibility and cached fetch times', async () => {
  const original = globalThis.fetch;
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () =>
      Response.json({
        jobs: [raw, raw, { ...raw, id: 101, content: 'Rust only' }, {}],
      }),
    );
  globalThis.fetch = fetch;
  try {
    const service = new DiscoveryService(
      new GreenhouseSource(),
      {} as OpportunitiesService,
    );
    const live = await service.scan(filters);
    const boards = DISCOVERY_SOURCES.length;
    expect(live).toMatchObject({
      fetched: 4 * boards,
      normalized: 3 * boards,
      eligible: boards,
      sourceFailures: 0,
    });
    expect(live.jobs).toHaveLength(boards);
    expect(live.warnings).toHaveLength(boards);
    expect(live.errors).toEqual(live.warnings);
    expect(live.sources.map((s) => s.sourceKey)).toEqual(
      DISCOVERY_SOURCES.map((s) => s.key),
    );
    for (const source of live.sources) {
      expect(source).toMatchObject({
        status: 'success',
        fetched: 4,
        normalized: 3,
        invalid: 1,
        cacheHit: false,
        failure: null,
      });
      expect(source.fetchedAt).toEqual(expect.any(String));
    }
    const cached = await service.scan(filters);
    expect(cached.sources).toEqual(
      live.sources.map((s) => ({ ...s, cacheHit: true })),
    );
    expect(fetch).toHaveBeenCalledTimes(boards);
  } finally {
    globalThis.fetch = original;
  }
});

test('malformed envelopes and unavailable sources have unknown counts and safe distinct failures', async () => {
  const original = globalThis.fetch;
  const fetch = jest
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ jobs: 'private invalid envelope' }))
    .mockRejectedValueOnce(new Error('private connection string'))
    .mockResolvedValueOnce(Response.json({ jobs: [] }))
    .mockResolvedValueOnce(Response.json({ jobs: [raw, {}] }))
    .mockImplementation(async () => Response.json({ jobs: [] }));
  globalThis.fetch = fetch;
  try {
    const service = new DiscoveryService(
      new GreenhouseSource(),
      {} as OpportunitiesService,
    );
    const result = await service.scan(filters);
    expect(result).toMatchObject({
      fetched: 2,
      normalized: 1,
      eligible: 1,
      sourceFailures: 2,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({
      status: 'failed',
      fetched: null,
      normalized: null,
      invalid: null,
      failure: { code: 'INVALID_FEED' },
    });
    expect(result.sources[1]).toMatchObject({
      status: 'failed',
      fetched: null,
      fetchedAt: null,
      failure: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(result.sources[2]).toMatchObject({ status: 'success', fetched: 0 });
    expect(JSON.stringify(result)).not.toContain('private');
    const cached = await service.scan(filters);
    expect(cached.sources[0]).toMatchObject({
      cacheHit: true,
      status: 'failed',
      fetched: null,
    });
    expect(cached.sources[0]!.fetchedAt).toBe(result.sources[0]!.fetchedAt);
  } finally {
    globalThis.fetch = original;
  }
});

test('all sources failed reports no available source counts and no eligible jobs', async () => {
  const source = {
    read: async () => {
      throw new Error('private');
    },
  };
  const result = await new DiscoveryService(
    source as unknown as GreenhouseSource,
    {} as OpportunitiesService,
  ).scan(filters);
  expect(result).toMatchObject({
    fetched: 0,
    normalized: 0,
    eligible: 0,
    jobs: [],
    sourceFailures: DISCOVERY_SOURCES.length,
    warnings: [],
  });
  expect(result.sources).toHaveLength(DISCOVERY_SOURCES.length);
  expect(
    result.sources.every((s) => s.status === 'failed' && s.fetched === null),
  ).toBe(true);
});
