import { assessConditions } from '../../src/matching/cv-match.conditions.js';
import { expect, jest, test } from '@jest/globals';
import type { QueryRunner } from 'typeorm';
import { JdSkillInventory1795200000000 } from '../../src/database/migrations/1795200000000-JdSkillInventory.js';
import {
  buildCvSkillMatch,
  confirmJdStructure,
  extractJdSkillInventory,
  jdInventoryState,
} from '../../src/matching/cv-skill-match.js';
import type { JobImportService } from '../../src/opportunities/job-import.service.js';
import { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { transactionalRepository } from '../support/transactional-repository.mock.js';

const framework = 'Spring, Spring Boot, or an equivalent framework';
const job = {
  id: 'synthetic',
  jdText: '',
  description: [
    'Required skills',
    'Build applications using Java',
    framework,
    'VueJS/NuxtJS and JavaScript, HTML, CSS or an equivalent stack',
    'Write queries using PostgreSQL and SQL',
    'Git or SVN',
    'Jira or Redmine',
    'English B2',
    '5 years of experience in Java Full Stack development',
    'Preferred skills',
    'Oracle',
    'SQL Server',
  ].join('\n'),
  postText: '',
  skills: 'Spring, Spring Boot or an equivalent framework',
  preferredSkills: 'Oracle\nSQL Server',
  experience: '',
  domain: '',
} as Opportunity;
const emptyCv = { text: '', lines: [] };

test('retains verified candidates, original priorities, and distinct unresolved groups', () => {
  const inventory = extractJdSkillInventory(job);
  expect(inventory.status).toBe('INCOMPLETE');
  expect(inventory.version).toBe(2);
  expect(inventory.extractionPolicyVersion).toBe(5);
  const candidates = inventory.requirements.flatMap(
    (group) => group.candidates,
  );
  expect([...new Set(candidates.map(({ literal }) => literal))].sort()).toEqual(
    [
      'Java',
      'Spring',
      'Spring Boot',
      'VueJS',
      'NuxtJS',
      'JavaScript',
      'HTML',
      'CSS',
      'PostgreSQL',
      'SQL',
      'Git',
      'SVN',
      'Jira',
      'Redmine',
      'Oracle',
      'SQL Server',
    ].sort(),
  );
  for (const { literal, source } of candidates)
    expect(job[source.field].slice(source.start, source.end)).toBe(literal);
  const frameworks = inventory.requirements.filter((group) =>
    group.candidates.some(({ literal }) => literal === 'Spring Boot'),
  );
  expect(frameworks).toHaveLength(1);
  expect(frameworks[0]).toMatchObject({
    eligible: false,
    mode: 'UNKNOWN',
    reason: 'AMBIGUOUS_GROUP',
    sources: expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({ field: 'description' }),
      }),
      expect.objectContaining({
        source: expect.objectContaining({ field: 'skills' }),
      }),
    ]),
  });
  expect(inventory.requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'NONTECHNICAL', eligible: false }),
      expect.objectContaining({
        eligible: false,
        candidates: expect.arrayContaining([
          expect.objectContaining({ literal: 'Git', canonical: null }),
        ]),
      }),
    ]),
  );
  expect(inventory.groups).toEqual([
    expect.objectContaining({ options: ['Java'], priority: 'required' }),
    expect.objectContaining({ options: ['PostgreSQL'], priority: 'required' }),
    expect.objectContaining({ options: ['SQL'], priority: 'required' }),
    expect.objectContaining({ options: ['Oracle'], priority: 'preferred' }),
    expect.objectContaining({ options: ['SQL Server'], priority: 'preferred' }),
  ]);
  expect(
    buildCvSkillMatch({ ...job, jdSkillInventory: inventory }, emptyCv),
  ).toMatchObject({
    score: null,
    partialScore: 0,
    inventoryStatus: 'INCOMPLETE',
  });
});

test('fingerprints only extraction inputs and refuses stale or failed inventory', () => {
  const inventory = extractJdSkillInventory(job);
  expect(extractJdSkillInventory(job)).toEqual(inventory);
  const saved = { ...job, jdSkillInventory: inventory };
  expect(jdInventoryState({ ...saved, notes: 'Unrelated tracking note' })).toBe(
    'INCOMPLETE',
  );
  expect(jdInventoryState({ ...saved, preferredSkills: '' })).toBe('STALE');
  expect(
    buildCvSkillMatch({ ...saved, skills: 'Java' }, emptyCv),
  ).toMatchObject({
    inventoryStatus: 'STALE',
    score: null,
    partialScore: null,
  });
  const broken = { ...job, skills: null } as unknown as Opportunity;
  expect(extractJdSkillInventory(broken)).toMatchObject({
    status: 'FAILED',
    incomplete: true,
  });
  expect(
    buildCvSkillMatch(
      { ...broken, jdSkillInventory: extractJdSkillInventory(broken) },
      emptyCv,
    ),
  ).toMatchObject({
    inventoryStatus: 'FAILED',
    score: null,
    limitation: 'INCOMPLETE_INVENTORY',
  });
  expect(buildCvSkillMatch(job, emptyCv)).toMatchObject({
    inventoryStatus: 'MISSING',
    inventoryExtractionStatus: 'INCOMPLETE',
    totalCount: 5,
  });
});

test('saved JD lifecycle generates, reuses, regenerates, and explicitly refreshes inventory', async () => {
  let stored!: Opportunity;
  const rows = transactionalRepository({
    create: (fields: Opportunity) => ({ ...fields }),
    save: async (row: Opportunity) => (stored = row),
    findOneBy: async () => ({ ...stored }),
    findOneByOrFail: async () => ({ ...stored }),
    update: jest.fn(async (_where: unknown, fields: Partial<Opportunity>) =>
      Object.assign(stored, fields),
    ),
  });
  const imports = {
    parse: jest.fn(async () => ({ source: { text: 'Required skills\nJava' } })),
  } as unknown as JobImportService;
  const service = new OpportunitiesService(
    rows as unknown as ConstructorParameters<typeof OpportunitiesService>[0],
    imports,
  );
  const input = {
    title: 'Synthetic developer',
    source: 'Website',
    status: 'SAVED',
    originalLink: '',
    contactNotes: '',
    description: '',
    notes: '',
    contactDates: [],
    followUpDate: null,
    skills: 'Java',
  };
  const created = await service.create('synthetic-owner', input, {
    fileName: 'synthetic.pdf',
    mediaType: 'application/pdf',
    bytes: Buffer.from('synthetic'),
  });
  const first = created.jdSkillInventory;
  expect(first).toMatchObject({ status: 'COMPLETE', jobId: created.id });
  const edited = await service.update('synthetic-owner', created.id, {
    ...input,
    description: created.description,
    notes: 'Updated note',
  });
  expect(edited.jdSkillInventory).toBe(first);
  const changed = await service.update('synthetic-owner', created.id, {
    ...input,
    description: created.description,
    preferredSkills: 'CSS',
  });
  expect(changed.jdSkillInventory?.fingerprint).not.toBe(first?.fingerprint);
  stored.jdSkillInventory = null;
  stored.updatedAt = new Date('2026-01-01T00:00:00Z');
  expect(
    await service.inspectJdSkillInventory('synthetic-owner', created.id),
  ).toEqual({ state: 'MISSING', inventory: null });
  expect(rows.update).not.toHaveBeenCalled();
  const refreshed = await service.refreshJdSkillInventory(
    'synthetic-owner',
    created.id,
  );
  expect(refreshed.inventory).toEqual(changed.jdSkillInventory);
  expect(rows.update).toHaveBeenCalledWith(
    { id: created.id, ownerId: 'synthetic-owner' },
    { jdSkillInventory: refreshed.inventory, updatedAt: expect.any(Function) },
  );
  await service.refreshJdSkillInventory('synthetic-owner', created.id);
  expect(rows.update).toHaveBeenCalledTimes(1);
});

test('migration adds one nullable JSONB column and reverses only that change', async () => {
  const query = jest.fn();
  const runner = { query } as unknown as QueryRunner;
  const migration = new JdSkillInventory1795200000000();
  await migration.up(runner);
  await migration.down(runner);
  expect(query.mock.calls).toEqual([
    [
      'ALTER TABLE ai_job_hunter.opportunities ADD COLUMN "jdSkillInventory" jsonb NULL',
    ],
    ['ALTER TABLE ai_job_hunter.opportunities DROP COLUMN "jdSkillInventory"'],
  ]);
});

test('priority references point to the actual repeated source occurrences', () => {
  const description = 'Required skills\nJava\nPreferred skills\nJava';
  const inventory = extractJdSkillInventory({
    ...job,
    description,
    skills: '',
    preferredSkills: '',
  });
  expect(inventory.groups).toHaveLength(1);
  expect(inventory.requirements).toEqual([
    expect.objectContaining({
      eligible: true,
      priority: 'required',
      sources: [
        expect.objectContaining({
          priority: 'required',
          source: expect.objectContaining({
            start: description.indexOf('Java'),
          }),
        }),
        expect.objectContaining({
          priority: 'preferred',
          source: expect.objectContaining({
            start: description.lastIndexOf('Java'),
          }),
        }),
      ],
    }),
  ]);
});

test('unchanged legacy reads reuse extraction and stored reads consume the versioned result', () => {
  const readDomain = jest.fn(() => '');
  const legacy = {
    ...job,
    id: 'legacy-reuse',
    get domain() {
      return readDomain();
    },
  };
  const first = buildCvSkillMatch(legacy, emptyCv);
  const reads = readDomain.mock.calls.length;
  expect(reads).toBeGreaterThan(0);
  expect(buildCvSkillMatch(legacy, emptyCv).inventoryId).toBe(
    first.inventoryId,
  );
  expect(readDomain).toHaveBeenCalledTimes(reads);

  const persisted = {
    ...legacy,
    jdSkillInventory: extractJdSkillInventory(legacy),
  };
  Object.defineProperty(persisted, 'domain', { get: readDomain });
  readDomain.mockClear();
  expect(buildCvSkillMatch(persisted, emptyCv).inventoryId).toBe(
    persisted.jdSkillInventory.id,
  );
  expect(readDomain).not.toHaveBeenCalled();
});

test.each([
  ['Java\nJavaScript\nAJAX\nCSS\njQuery\nUnknownTool', 'Java, JavaScript', 40],
  ['Java\nSpring\nUnknownTool', 'Java, Spring Boot', 100],
])(
  'preserves partial scoring for the synthetic requirements %j',
  (skills, text, expected) => {
    const input = { ...job, description: '', skills, preferredSkills: '' };
    const result = buildCvSkillMatch(
      { ...input, jdSkillInventory: extractJdSkillInventory(input) },
      {
        text,
        lines: [
          {
            sectionKind: 'skills',
            factId: 'skills',
            entryId: 'entry',
            origin: 'user_entered',
            start: 0,
            end: text.length,
          },
        ],
      },
    );
    expect(result).toMatchObject({
      partialScore: expected,
      score: null,
      inventoryStatus: 'INCOMPLETE',
    });
  },
);

test('assesses explicit database work and preserves unscored relationship metadata', () => {
  const description = [
    'Required skills',
    'Experience with PostgreSQL',
    'Experience writing SQL',
    'React OR Vue',
    'VueJS/NuxtJS or other suitable frontend frameworks',
  ].join('\n');
  const input = { ...job, description, skills: '', preferredSkills: '' };
  const inventory = extractJdSkillInventory(input);
  expect(inventory.groups.map(({ options }) => options)).toEqual([
    ['PostgreSQL'],
    ['SQL'],
    ['React', 'Vue'],
  ]);
  expect(inventory.requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ alternatives: 'EQUAL', eligible: true }),
      expect.objectContaining({
        alternatives: 'NAMED_WITH_FALLBACK',
        namedAlternatives: ['Vue', 'Nuxt'],
        eligible: false,
      }),
    ]),
  );
  expect(inventory.evidenceRelationships).toContainEqual({
    specific: 'PostgreSQL',
    general: 'SQL',
    evidence: 'EXPLICIT_SQL_WORK',
    applied: true,
  });
  const text = 'Built services backed by PostgreSQL.';
  const result = buildCvSkillMatch(
    { ...input, jdSkillInventory: inventory },
    {
      text,
      lines: [
        {
          sectionKind: 'experience',
          factId: 'work',
          entryId: 'entry',
          origin: 'source',
          start: 0,
          end: text.length,
        },
      ],
    },
  );
  expect(
    result.rows.slice(0, 2).map((row) => !!row.skills[0]?.evidence),
  ).toEqual([true, false]);
  expect(result).toMatchObject({
    score: null,
    unresolvedTechnicalGroupCount: 1,
  });
});

function scoreReviewed(input: Opportunity, text: string) {
  return buildCvSkillMatch(input, {
    text,
    lines: [
      {
        sectionKind: 'skills',
        factId: 'skills',
        entryId: 'entry',
        origin: 'source',
        start: 0,
        end: text.length,
      },
    ],
  });
}

test('confirmed mixed structure scores mandatory and named option branches once, with contextual fallback review', () => {
  const input = {
    ...job,
    skills: '',
    preferredSkills: '',
    description:
      'Required skills\nJavaScript, HTML and CSS, plus VueJS/NuxtJS or other suitable frontend frameworks',
  };
  input.jdSkillInventory = extractJdSkillInventory(input);
  expect(scoreReviewed(input, 'Vue.js').totalCount).toBe(0);
  const [group] = input.jdSkillInventory.requirements;
  const confirmation = {
    inventoryId: input.jdSkillInventory.id,
    groupId: group!.id,
    mandatory: ['JavaScript', 'HTML', 'CSS'],
    contextual: [],
    alternatives: ['Vue', 'Nuxt'],
    mandatoryPriority: 'required',
    alternativePriority: 'preferred',
  };
  expect(() =>
    confirmJdStructure(input, {
      ...confirmation,
      alternatives: ['JavaScript', 'React'],
    }),
  ).toThrow();
  expect(() =>
    confirmJdStructure(input, { ...confirmation, mandatory: ['Vue'] }),
  ).toThrow();
  const confirmed = {
    ...input,
    jdSkillInventory: confirmJdStructure(input, confirmation),
  };
  expect(
    scoreReviewed(confirmed, 'JavaScript, HTML, CSS, Vue.js, NuxtJS'),
  ).toMatchObject({
    score: 100,
    matchedCount: 4,
    totalCount: 4,
    fallbackReview: [],
  });
  expect(
    scoreReviewed(confirmed, 'JavaScript, HTML, CSS, React'),
  ).toMatchObject({
    score: null,
    partialScore: 100,
    totalCount: 3,
    fallbackReview: [
      expect.objectContaining({ fallbackStatus: 'NEEDS_REVIEW' }),
    ],
  });
  expect(scoreReviewed(confirmed, 'Vue.js')).toMatchObject({
    score: 10,
    totalCount: 4,
  });
  expect(() => confirmJdStructure(confirmed, confirmation)).toThrow();
  const edited = { ...confirmed, description: input.description + '\nSQL' };
  expect(jdInventoryState(edited)).toBe('STALE');
  expect(scoreReviewed(edited, 'Vue.js').score).toBeNull();
  expect(() => confirmJdStructure(edited, confirmation)).toThrow();
});

test('sales equal alternatives count once and B2B Sales remains separate', () => {
  const input = {
    ...job,
    skills: '',
    preferredSkills: '',
    description:
      'Required skills\nSalesforce OR HubSpot CRM\nB2B Sales\nTerritory planning',
  };
  const jdSkillInventory = extractJdSkillInventory(input);
  expect(jdSkillInventory.requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'UNCLASSIFIED',
        sources: [
          expect.objectContaining({
            source: expect.objectContaining({ quote: 'Territory planning' }),
          }),
        ],
      }),
    ]),
  );
  const result = scoreReviewed(
    { ...input, jdSkillInventory },
    'HubSpot CRM, Spring Boot',
  );
  expect(result).toMatchObject({
    partialScore: 50,
    totalCount: 2,
    matchedCount: 1,
    rows: [
      expect.objectContaining({
        skills: [
          expect.objectContaining({ name: 'Salesforce', evidence: null }),
          expect.objectContaining({
            name: 'HubSpot CRM',
            evidence: expect.any(Object),
          }),
        ],
      }),
      expect.objectContaining({
        skills: [{ name: 'B2B Sales', evidence: null }],
      }),
    ],
  });
});

test('marketing aliases support confirmed mixed requirements without inventing skills', () => {
  const input = {
    ...job,
    skills: '',
    preferredSkills: '',
    description: 'Required skills\nSEO and Google Ads or GA4',
  };
  input.jdSkillInventory = extractJdSkillInventory(input);
  const [group] = input.jdSkillInventory.requirements;
  expect(scoreReviewed(input, 'SEO, Google Analytics 4').totalCount).toBe(0);
  const payload = {
    inventoryId: input.jdSkillInventory.id,
    groupId: group!.id,
    mandatory: ['SEO'],
    contextual: [],
    alternatives: ['Google Ads', 'GA4'],
    mandatoryPriority: 'required',
    alternativePriority: 'required',
  };
  expect(() =>
    confirmJdStructure(input, { ...payload, mandatory: ['SQL'] }),
  ).toThrow();
  expect(
    scoreReviewed(
      { ...input, jdSkillInventory: confirmJdStructure(input, payload) },
      'SEO, Google Analytics 4',
    ),
  ).toMatchObject({ score: 100, matchedCount: 2, totalCount: 2 });
});

test.each(['Java', 'B2B Sales', 'Google Ads'])(
  'keeps %s assessable once while requiring separate evidence for its duration',
  (skill) => {
    const requirement = `2 years of experience with ${skill}`;
    const input = {
      ...job,
      skills: '',
      preferredSkills: '',
      description: `Required skills\n${requirement}\n${skill}`,
    };
    const inventory = extractJdSkillInventory(input);
    expect(inventory.groups).toEqual([
      expect.objectContaining({
        options: [skill],
        priority: 'required',
        source: expect.objectContaining({ quote: requirement }),
      }),
    ]);
    expect(
      scoreReviewed({ ...input, jdSkillInventory: inventory }, skill),
    ).toMatchObject({
      score: 100,
      totalCount: 1,
    });
    expect(
      assessConditions(
        [
          {
            requirement,
            jdQuote: requirement,
            cvQuote: '',
            category: 'experience',
            priority: 'required',
          },
        ],
        requirement,
        skill,
      ),
    ).toEqual([
      expect.objectContaining({ kind: 'EXPERIENCE', status: 'UNKNOWN' }),
    ]);
  },
);

test('keeps an illustrative list unresolved while scoring explicit AND or equal OR', () => {
  const extract = (description: string) =>
    extractJdSkillInventory({
      ...job,
      description,
      skills: '',
      preferredSkills: '',
    });
  const examples = extract(
    'Required skills\nExperience with databases such as PostgreSQL, Oracle and SQL Server',
  );
  expect(examples.groups).toEqual([]);
  expect(examples.requirements[0]).toMatchObject({
    reason: 'ILLUSTRATIVE_LIST',
    eligible: false,
    candidates: expect.arrayContaining([
      expect.objectContaining({ canonical: 'Oracle' }),
      expect.objectContaining({ canonical: 'SQL Server' }),
    ]),
  });
  expect(
    extract('Required skills\nOracle AND SQL Server').groups.map(
      (g) => g.options,
    ),
  ).toEqual([['Oracle'], ['SQL Server']]);
  expect(
    extract('Required skills\nOracle OR SQL Server').groups.map(
      (g) => g.options,
    ),
  ).toEqual([['Oracle', 'SQL Server']]);
  expect(
    extract(
      'Required skills\nExperience with CRM tools, e.g. Salesforce and HubSpot CRM',
    ).groups,
  ).toEqual([]);
  expect(
    extract(
      'Required skills\nCó từ 2 năm kinh nghiệm phát triển ứng dụng với Java',
    ).groups[0]?.options,
  ).toEqual(['Java']);
  expect(
    extract('Required skills\n2 years of experience with Java or Kotlin')
      .groups,
  ).toEqual([]);
});
