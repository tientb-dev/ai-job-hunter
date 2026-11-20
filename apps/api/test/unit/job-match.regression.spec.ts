import { reviewedAsIs } from '../support/reviewed-cv.stub.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { expect, jest, test } from '@jest/globals';
import { Repository } from 'typeorm';
import { AiError } from '../../src/ai/ai.errors.js';
import {
  aiConfig,
  cvMatchAiConfig,
  type AiConfig,
} from '../../src/ai/ai.config.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiProvider } from '../../src/ai/ai-provider.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import {
  canonicalRequirements,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
const cvText =
  'Backend — Java, Spring Boot, Hibernate\nProfessional Summary: 6+ years of experience building enterprise applications\nTools: AI-assisted coding with Copilot.';
const job = {
  id: 'synthetic',
  title: 'Synthetic AI Developer',
  skills: 'Python, AI/ML, AI application development',
  preferredSkills: 'Backend Java, Voicebot',
  experience: 'Minimum 3 years',
  domain: 'Insurance',
  seniority: '',
  description:
    'Python, AI/ML, AI application development required. Backend Java and Voicebot preferred. Minimum 3 years.',
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-10-30T00:00:00Z'),
} as Opportunity;
const output = () =>
  canonicalRequirements(job).map((item) => ({
    ...item,
    cvQuote:
      item.requirement === 'Backend Java'
        ? cvText.split('\n')[0]!
        : item.requirement === 'Minimum 3 years'
          ? cvText.split('\n')[1]!
          : '',
  }));
function setup(
  generate: AiProvider['generate'],
  text: string | null = cvText,
  savedJob = job,
  config?: AiConfig,
) {
  const row =
    text === null
      ? null
      : { text, fileName: 'synthetic.pdf', updatedAt: job.updatedAt };
  const cvs = {
    findOne: jest.fn<() => Promise<typeof row>>().mockResolvedValue(row),
    findOneBy: jest.fn<() => Promise<typeof row>>().mockResolvedValue(row),
  };
  const jobs = {
    get: jest.fn<() => Promise<Opportunity>>().mockResolvedValue(savedJob),
  };
  const provider = { generate: jest.fn(generate) };
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService(provider),
    new MatchingService(),
    jobs as unknown as OpportunitiesService,
    memoryMatchRows(),
    reviewedAsIs(),
    config,
  );
  return { service, provider, cvs, jobs };
}
test('synthetic accepted AI Developer reports listed Java Coverage and preserves exact duration evidence', async () => {
  const { service, provider } = setup(async (request) => {
    expect(request.prompt).toContain(cvText.split('\n')[0]);
    expect(request.prompt).toContain('Minimum 3 years');
    return JSON.stringify({ requirements: output() });
  });
  const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  expect(result.score).toBe(Math.round(40 / 11));
  expect(
    result.requirements
      .filter((item) => item.status === 'EVIDENCED')
      .map((item) => item.requirement),
  ).toEqual(['Backend Java', 'Minimum 3 years']);
  for (const item of result.requirements.filter(
    (item) => item.status === 'EVIDENCED',
  ))
    expect(cvText).toContain(item.cvQuote);
  expect(provider.generate).toHaveBeenCalledTimes(1);
});
test.each([null, '', '   '])(
  'missing or blank saved CV never reaches inference/scoring (%p)',
  async (text) => {
    const { service, provider } = setup(
      async () => JSON.stringify({ requirements: output() }),
      text,
    );
    await expect(service.analyze(LOCAL_OWNER_ID, 'synthetic')).rejects.toThrow(
      /CV/i,
    );
    expect(provider.generate).not.toHaveBeenCalled();
  },
);
test('empty model output is analysis failure, not a synthesized 0% Java match', async () => {
  const javaJob = {
    ...job,
    skills: 'Java',
    preferredSkills: '',
    experience: '',
    domain: '',
    description: 'Java required',
  };
  const { service } = setup(
    async () => JSON.stringify({ requirements: [] }),
    cvText,
    javaJob,
  );
  await expect(service.analyze(LOCAL_OWNER_ID, 'synthetic')).rejects.toThrow();
});
test.each([
  'timeout',
  'malformed JSON',
  'schema mismatch',
  'unverifiable JD quote',
  'omitted canonical requirements',
])('%s fails explicitly instead of producing a Low Fit score', async (kind) => {
  const { service } = setup(async () => {
    if (kind === 'timeout') throw new AiError('TIMEOUT');
    if (kind === 'malformed JSON') return '{';
    if (kind === 'schema mismatch') return JSON.stringify({ score: 0 });
    const rows = output();
    if (kind === 'unverifiable JD quote')
      rows.push({
        ...rows[0]!,
        requirement: 'Fabricated requirement',
        jdQuote: 'Not present in job',
      });
    if (kind === 'omitted canonical requirements') rows.splice(0, 1);
    return JSON.stringify({ requirements: rows });
  });
  await expect(service.analyze(LOCAL_OWNER_ID, 'synthetic')).rejects.toThrow();
});
test('a valid fully evaluated negative assessment is allowed to remain genuinely zero', async () => {
  const javaJob = {
    ...job,
    skills: 'Java\nDocker\nRust',
    preferredSkills: '',
    experience: '',
    domain: '',
    description: 'Java required',
  };
  const { service } = setup(
    async () =>
      JSON.stringify({
        requirements: canonicalRequirements(javaJob),
      }),
    'Synthetic CV: SQL reporting experience.',
    javaJob,
  );
  expect(await service.analyze(LOCAL_OWNER_ID, 'synthetic')).toMatchObject({
    score: 0,
    coverageHidden: null,
    recommendation: 'Low Fit',
  });
});

test('AI-assisted coding tool evidence cannot substantiate production AI/ML', async () => {
  const { service } = setup(async () => {
    const requirements = output();
    requirements.find((item) => item.requirement === 'AI/ML')!.cvQuote =
      'Tools: AI-assisted coding with Copilot.';
    return JSON.stringify({ requirements });
  });
  const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  expect(result).toMatchObject({
    score: null,
    coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
  });
  expect(
    result.requirements.find((item) => item.requirement === 'AI/ML'),
  ).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
});

test('HTTP pipeline returns structured success or explicit errors without a fabricated score', async () => {
  const { Test } = await import('@nestjs/testing');
  const { default: request } = await import('supertest');
  const { OpportunitiesController } =
    await import('../../src/opportunities/opportunities.controller.js');
  const { OpportunitiesService } =
    await import('../../src/opportunities/opportunities.service.js');
  const { JobImportService } =
    await import('../../src/opportunities/job-import.service.js');
  const { DiscoveryService } =
    await import('../../src/discovery/discovery.service.js');
  const { service, provider } = setup(async () =>
    JSON.stringify({ requirements: output() }),
  );
  const module = await Test.createTestingModule({
    controllers: [OpportunitiesController],
    providers: [
      { provide: JobMatchService, useValue: service },
      { provide: OpportunitiesService, useValue: {} },
      { provide: JobImportService, useValue: {} },
      { provide: DiscoveryService, useValue: {} },
    ],
  }).compile();
  const app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
  const origin = { Origin: 'http://127.0.0.1:5173', Host: '127.0.0.1:3000' };
  const route =
    '/api/v1/opportunities/00000000-0000-4000-8000-000000000123/match';
  try {
    const success = await request(app.getHttpServer())
      .post(route)
      .set(origin)
      .expect(200);
    expect(success.body.score).toBe(Math.round(40 / 11));
    provider.generate.mockImplementation(async () =>
      JSON.stringify({ requirements: [] }),
    );
    const empty = await request(app.getHttpServer())
      .post(route)
      .set(origin)
      .expect(503);
    expect(empty.body.errorCode).toBe('CV_MATCH_INVALID_OUTPUT');
    expect(empty.body.score).toBeUndefined();
    provider.generate.mockImplementation(async () => {
      throw new AiError('TIMEOUT');
    });
    const timeout = await request(app.getHttpServer())
      .post(route)
      .set(origin)
      .expect(504);
    expect(timeout.body.errorCode).toBe('CV_MATCH_TIMEOUT');
    expect(timeout.body.message).toContain('no new fit score');
    expect(timeout.body.score).toBeUndefined();
  } finally {
    await app.close();
  }
});

test('explicit AI-assisted coding-tool requirements can still use tool evidence', async () => {
  const toolingJob = {
    ...job,
    skills: 'AI-assisted coding tools',
    preferredSkills: '',
    experience: '',
    domain: '',
    description: 'AI-assisted coding tools required',
  };
  const { service } = setup(
    async () =>
      JSON.stringify({
        requirements: [
          {
            requirement: 'AI-assisted coding tools',
            priority: 'required',
            category: 'skill',
            jdQuote: 'AI-assisted coding tools',
            cvQuote: 'Tools: AI-assisted coding with Copilot.',
          },
        ],
      }),
    cvText,
    toolingJob,
  );
  expect(await service.analyze(LOCAL_OWNER_ID, 'synthetic')).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [
      {
        status: 'EVIDENCED',
        credit: 1,
        cvQuote: 'Tools: AI-assisted coding with Copilot.',
      },
    ],
  });
});

test('provider output outside the allowed CV passages fails explicitly instead of returning zero', async () => {
  const { service } = setup(async () => {
    const requirements = output();
    requirements[0]!.cvQuote = 'Invented Python production experience';
    return JSON.stringify({ requirements });
  });
  await expect(service.analyze(LOCAL_OWNER_ID, 'synthetic')).rejects.toThrow(
    /invalid matching output/i,
  );
});

test('service returns source-selected quotes and keeps unsupported qualifications unverified', async () => {
  const source =
    'Backend — Java,\n  Spring Boot\n6+ years of\nexperience building enterprise applications\nTools: AI-assisted\n coding with Copilot.';
  const mixedJob = {
    ...job,
    skills: 'Java, SQL, AI-assisted coding tools',
    preferredSkills: '',
    domain: '',
    description:
      'Java, SQL and AI-assisted coding tools required. Minimum 3 years.',
  };
  const quotes: Record<string, string> = {
    Java: 'Backend — Java, Spring Boot',
    SQL: '',
    'AI-assisted coding tools': 'Tools: AI-assisted coding with Copilot.',
    'Minimum 3 years':
      '6+ years of experience building enterprise applications',
  };
  const { service } = setup(
    async () =>
      JSON.stringify({
        requirements: canonicalRequirements(mixedJob).map((item) => ({
          ...item,
          cvQuote: quotes[item.requirement] ?? '',
        })),
      }),
    source,
    mixedJob,
  );
  const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  expect(result.score).toBe(Math.round(40 / 3));
  expect(result.recommendation).toBe('Consider');
  expect(
    result.requirements.find((item) => item.requirement === 'SQL'),
  ).toMatchObject({ cvQuote: '', status: 'NOT_EVIDENCED' });
  for (const item of result.requirements.filter(
    (item) => item.status === 'EVIDENCED',
  ))
    expect(source).toContain(item.cvQuote);
  expect(
    result.requirements.find((item) => item.requirement === 'Java')?.cvQuote,
  ).toBe('Backend — Java,\n  Spring Boot');
  expect(
    result.requirements.every((item) => !('cvEvidenceUnverified' in item)),
  ).toBe(true);
});

test('evidence rejection logs once, never scores, and never writes saved records', async () => {
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  const score = jest.spyOn(MatchingService.prototype, 'matchSavedCv');
  const { service, cvs, jobs } = setup(async () => {
    const rows = output();
    rows[0] = { ...rows[0]!, jdQuote: 'Synthetic unsupported JD quotation' };
    return JSON.stringify({ requirements: rows });
  });
  const saveCv = jest.fn(),
    saveJob = jest.fn();
  Object.assign(cvs, { upsert: saveCv, save: saveCv, update: saveCv });
  Object.assign(jobs, { save: saveJob, update: saveJob });
  try {
    await expect(
      service.analyze(LOCAL_OWNER_ID, 'synthetic'),
    ).rejects.toMatchObject({
      errorCode: 'CV_MATCH_EVIDENCE_REJECTED',
    });
    expect(score).not.toHaveBeenCalled();
    expect(saveCv).not.toHaveBeenCalled();
    expect(saveJob).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    write.mockRestore();
    score.mockRestore();
  }
});

test('successful match adds an opaque context without changing the assessment; replacement invalidates identity', async () => {
  const { service, provider } = setup(async () =>
    JSON.stringify({ requirements: output() }),
  );
  const first = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  const snapshot = await service.requireSnapshot(
    LOCAL_OWNER_ID,
    'synthetic',
    first.matchId,
  );
  const {
    matchId,
    cvUpdatedAt,
    jobUpdatedAt,
    analyzedAt,
    evidenceReview,
    skillMatch,
    ...assessment
  } = first;
  expect(evidenceReview).toMatchObject({
    version: 1,
    jobRevision: job.updatedAt,
  });
  expect(await service.currentMatch(LOCAL_OWNER_ID, 'synthetic')).toMatchObject(
    {
      status: 'VALID',
      result: { matchId, evidenceReview, skillMatch },
    },
  );
  expect(matchId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(cvUpdatedAt).toEqual(job.updatedAt);
  expect(jobUpdatedAt).toEqual(job.updatedAt);
  expect(typeof analyzedAt).toBe('string');
  expect(skillMatch).toMatchObject({ version: 1 });
  expect(snapshot.assessment).toEqual(assessment);
  const second = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  expect(second.matchId).not.toBe(first.matchId);
  expect(second.score).toBe(first.score);
  expect(second.requirements).toEqual(first.requirements);
  await expect(
    service.requireSnapshot(LOCAL_OWNER_ID, 'synthetic', first.matchId),
  ).rejects.toThrow(/stale/);
  await expect(
    service.requireSnapshot(LOCAL_OWNER_ID, 'other', second.matchId),
  ).rejects.toThrow(/stale/);
  expect(provider.generate).toHaveBeenCalledTimes(2);
});

test('context retrieval rechecks saved CV and job revisions without inference or writes', async () => {
  const { service, provider, cvs, jobs } = setup(async () =>
    JSON.stringify({ requirements: output() }),
  );
  const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  // Changed CV text is stale; a new timestamp alone is not (identical re-upload).
  cvs.findOne.mockResolvedValueOnce({
    text: `${cvText}\nChanged line.`,
    fileName: 'synthetic.pdf',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  });
  await expect(
    service.requireSnapshot(LOCAL_OWNER_ID, 'synthetic', result.matchId),
  ).rejects.toThrow(/stale/);
  jobs.get.mockResolvedValueOnce({
    ...job,
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  });
  await expect(
    service.requireSnapshot(LOCAL_OWNER_ID, 'synthetic', result.matchId),
  ).rejects.toThrow(/stale/);
  cvs.findOne.mockResolvedValueOnce(null);
  await expect(
    service.requireSnapshot(LOCAL_OWNER_ID, 'synthetic', result.matchId),
  ).rejects.toThrow(/unavailable/);
  expect(provider.generate).toHaveBeenCalledTimes(1);
  // The repository mock intentionally has no write methods: analyze and lookup
  // must work with source reads only.
  expect(Object.keys(cvs).sort()).toEqual(['findOne', 'findOneBy']);
});

test('failed reanalysis leaves the previous successful snapshot usable', async () => {
  const { service, provider } = setup(async () =>
    JSON.stringify({ requirements: output() }),
  );
  const first = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  provider.generate.mockRejectedValueOnce(new AiError('TIMEOUT'));
  await expect(service.analyze(LOCAL_OWNER_ID, 'synthetic')).rejects.toThrow();
  expect(
    (await service.requireSnapshot(LOCAL_OWNER_ID, 'synthetic', first.matchId))
      .matchId,
  ).toBe(first.matchId);
});

test('current match read reuses the authoritative analysis without inference and detects revision changes', async () => {
  const { service, provider, cvs, jobs } = setup(async () =>
    JSON.stringify({ requirements: output() }),
  );
  expect(await service.currentMatch(LOCAL_OWNER_ID, 'synthetic')).toMatchObject(
    {
      status: 'MISSING',
      evidenceReview: { version: 1 },
    },
  );
  const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
  const current = await service.currentMatch(LOCAL_OWNER_ID, 'synthetic');
  expect(current).toMatchObject({
    status: 'VALID',
    result: {
      matchId: result.matchId,
      score: result.score,
      requirements: result.requirements,
    },
  });
  expect(provider.generate).toHaveBeenCalledTimes(1);
  jobs.get.mockResolvedValueOnce({
    ...job,
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  });
  expect(await service.currentMatch(LOCAL_OWNER_ID, 'synthetic')).toMatchObject(
    {
      status: 'STALE_JOB',
      evidenceReview: { version: 1 },
    },
  );
  cvs.findOne.mockResolvedValueOnce({
    text: `${cvText}\nChanged line.`,
    fileName: 'synthetic.pdf',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  });
  expect(await service.currentMatch(LOCAL_OWNER_ID, 'synthetic')).toMatchObject(
    {
      status: 'STALE_CV',
      evidenceReview: { version: 1 },
    },
  );
  // Byte-identical text under a new timestamp stays valid and is re-bound.
  const rebound = new Date('2026-11-02T00:00:00Z');
  cvs.findOne.mockResolvedValueOnce({
    text: cvText,
    fileName: 'synthetic.pdf',
    updatedAt: rebound,
  });
  expect(await service.currentMatch(LOCAL_OWNER_ID, 'synthetic')).toMatchObject(
    {
      status: 'VALID',
      result: { matchId: result.matchId, cvUpdatedAt: rebound.toISOString() },
    },
  );
  expect(provider.generate).toHaveBeenCalledTimes(1);
  cvs.findOne.mockResolvedValueOnce(null);
  expect(await service.currentMatch(LOCAL_OWNER_ID, 'synthetic')).toEqual({
    status: 'CV_UNAVAILABLE',
  });
  jobs.get.mockRejectedValueOnce(new Error('Job unavailable'));
  await expect(service.currentMatch(LOCAL_OWNER_ID, 'missing')).rejects.toThrow(
    'Job unavailable',
  );
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

test.each(['skill', 'experience'] as const)(
  'service qualification semantics and component selection are category-consistent: %s',
  async (category) => {
    const clause =
      "Bachelor's Degree in Computer Science or Engineering, OR 2+ years of relevant experience, OR coding boot camp";
    const savedJob = {
      ...job,
      skills: category === 'skill' ? clause : '',
      experience: category === 'experience' ? clause : '',
      preferredSkills: '',
      domain: '',
      description: clause,
    };
    const cv = '6+ years of experience building enterprise applications.';
    const { service } = setup(
      async (request) => {
        expect(request.prompt).toContain('minimumMonths');
        return JSON.stringify({
          requirements: canonicalRequirements(savedJob).map((seed) => ({
            ...seed,
            cvQuote: '',
            components: [
              {
                componentId: 'c2',
                jdQuote: '2+ years of relevant experience',
                cvQuote: cv,
              },
            ],
          })),
        });
      },
      cv,
      savedJob,
    );
    const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic');
    expect(result).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [
        {
          parentId: 'p1',
          category,
          status: 'EVIDENCED',
          coverage: { mode: 'OR' },
        },
      ],
    });
    expect(result.requirements[0]!.coverage.components).toHaveLength(3);
    expect(result.requirements[0]!.coverage.components[1]).toMatchObject({
      id: 'c2',
      status: 'EVIDENCED',
      cvQuote: cv,
    });
    expect(
      result.requirements[0]!.coverage.components.every(
        (c) => !('qualification' in c),
      ),
    ).toBe(true);
    expect(
      await service.currentMatch(LOCAL_OWNER_ID, 'synthetic'),
    ).toMatchObject({
      status: 'VALID',
      result: { matchId: result.matchId, score: null },
    });
  },
);

test('condition evidence persists with the saved assessment and current-match reads do not invoke inference', async () => {
  const conditionJob = {
    ...job,
    skills: 'Java\nDocker\nKotlin\nEnglish B2',
    preferredSkills: '',
    experience: '',
    domain: '',
    description: '',
  };
  const { service, provider } = setup(
    async () =>
      JSON.stringify({ requirements: canonicalRequirements(conditionJob) }),
    'Skills: Java, Docker, Kotlin\nEnglish: A2',
    conditionJob,
  );
  const result = await service.analyze(LOCAL_OWNER_ID, conditionJob.id);
  expect(result).toMatchObject({
    score: 40,
    coverageHidden: null,
    conditions: [
      {
        jdQuote: 'English B2',
        status: 'NOT_MET',
        evidence: [{ cvQuote: 'English: A2' }],
      },
    ],
  });
  expect(
    await service.currentMatch(LOCAL_OWNER_ID, conditionJob.id),
  ).toMatchObject({
    status: 'VALID',
    result: { matchId: result.matchId, conditions: result.conditions },
  });
  expect(provider.generate).toHaveBeenCalledTimes(1);
});

test('semantic assessments preserve documented correspondence and incomplete scope through analysis', async () => {
  const postgres = '- Maintained a PostgreSQL-backed billing application.';
  const node = '- Built a payment service using Node.js.';
  const allocation = '- Assigned sprint tasks to team members.';
  const sqlServer = '- Optimized SQL Server reporting queries.';
  const spring = '- Developed Spring Boot services in Java.';
  const career = '6 years of experience in software development.';
  const rest = 'Skills: REST APIs';
  const planning = '- Planned and launched marketing campaigns.';
  const title = 'Project: Enterprise Resource Planning';
  const listed = 'Skills: PostgreSQL, Node.js, Docker';
  const pipeline = '- Maintained build automation in GitLab CI/CD.';
  const cases = [
    [
      'Có kinh nghiệm làm việc với cơ sở dữ liệu PostgreSQL',
      'SUPPORTED',
      postgres,
      'EVIDENCED',
    ],
    [
      'Có kinh nghiệm làm việc với NodeJS là lợi thế',
      'SUPPORTED',
      node,
      'EVIDENCED',
    ],
    [
      'Có khả năng estimate và phân chia technical task',
      'RELATED',
      allocation,
      'PARTIAL',
    ],
    [
      'Có kinh nghiệm làm việc với cơ sở dữ liệu PostgreSQL, có khả năng phân tích/tối ưu câu SQL khi cần thiết',
      'RELATED',
      postgres,
      'PARTIAL',
    ],
    [
      'Ít nhất >5 năm kinh nghiệm phát triển phần mềm bằng ngôn ngữ Java',
      'SUPPORTED',
      spring,
      'PARTIAL',
    ],
    ['Experience delivering REST APIs', 'RELATED', rest, 'PARTIAL'],
    [
      'Nắm vững Core Java: Collections, Generics, Exception Handling, Stream API',
      'NOT_FOUND',
      '',
      'NOT_EVIDENCED',
    ],
    [
      'Có kinh nghiệm với Spring/Spring Boot OR các Java framework tương đương',
      'SUPPORTED',
      spring,
      'EVIDENCED',
    ],
    [
      'Có kinh nghiệm về các công cụ quản lý phiên bản (Git, SVN)',
      'NOT_FOUND',
      '',
      'NOT_EVIDENCED',
    ],
    [
      'Experience with Linux, CentOS, and checking logs, process, resource, network',
      'NOT_FOUND',
      '',
      'NOT_EVIDENCED',
    ],
    [
      'Experience with campaign planning and conversion attribution',
      'RELATED',
      planning,
      'PARTIAL',
    ],
    ['Docker', 'SUPPORTED', listed, 'EVIDENCED'],
    [
      'Experience with source control using Git or SVN',
      'RELATED',
      pipeline,
      'PARTIAL',
    ],
  ] as const;
  const jd = cases.map(([requirement]) => requirement).join('\n');
  const cv = [
    title,
    career,
    postgres,
    node,
    allocation,
    sqlServer,
    spring,
    rest,
    planning,
    listed,
    pipeline,
  ].join('\n\n');
  const synthetic = {
    ...job,
    skills: jd,
    preferredSkills: '',
    experience: '',
    domain: '',
    description: jd,
  };
  const { service } = setup(
    async ({ prompt }) => {
      const payload = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
      if (Array.isArray(payload)) {
        return JSON.stringify({
          items: payload.map(
            ({
              parentId,
              requirement,
            }: {
              parentId: string;
              requirement: string;
            }) =>
              requirement === cases[7][0]
                ? {
                    parentId,
                    mode: 'OR',
                    components: ['Spring', 'Spring Boot'],
                  }
                : { parentId, mode: 'UNSAFE', components: [] },
          ),
        });
      }
      expect(prompt).toContain(
        'Prefer the work passage when it documents applying the same skill',
      );
      expect(payload.cv).toContain(listed);
      expect(payload.cv).toContain(postgres);
      return JSON.stringify({
        requirements: payload.canonicalRequirements.map(
          ({
            group,
            ...parent
          }: MatchRequirement & {
            group: {
              mode: string;
              components: { id: string; jdQuote: string }[];
            };
          }) => {
            const [, correspondence, cvQuote] = cases.find(
              ([requirement]) => requirement === parent.requirement,
            )!;
            const perComponent = new Map<string, string[]>([
              [cases[2][0], ['', allocation]],
              [cases[3][0], [postgres, sqlServer]],
              [cases[7][0], ['', spring]],
              [cases[10][0], [planning, '']],
            ]);
            const selectedQuotes = perComponent.get(parent.requirement) ?? [
              cvQuote,
            ];
            const componentDecision = perComponent.has(parent.requirement)
              ? 'SUPPORTED'
              : correspondence;
            return {
              ...parent,
              correspondence,
              ...(cvQuote === pipeline && {
                missingQualifier:
                  'Build automation is documented. Git and SVN use remain unconfirmed.',
              }),
              cvQuote: parent.requirement === cases[7][0] ? '' : cvQuote,
              components: group.components.map((component, index) => {
                const selected = selectedQuotes[index] ?? '';
                return {
                  componentId: component.id,
                  jdQuote: component.jdQuote,
                  cvQuote: selected,
                  correspondence: !selected
                    ? 'NOT_FOUND'
                    : selected === sqlServer
                      ? 'RELATED'
                      : componentDecision,
                };
              }),
            };
          },
        ),
      });
    },
    cv,
    synthetic,
  );
  const result = await service.analyze(LOCAL_OWNER_ID, synthetic.id);
  expect(result.requirements.map(({ status }) => status)).toEqual(
    cases.map(([, , , status]) => status),
  );
  expect(result.requirements[0]?.cvQuote).toBe(postgres);
  expect(result.requirements[1]?.cvQuote).toBe(node);
  expect(result.requirements[11]?.cvQuote).toBe(listed);
  expect(result.requirements[12]?.coverage).toMatchObject({
    status: 'PARTIAL',
    reason:
      'Build automation is documented. Git and SVN use remain unconfirmed.',
  });
  expect(
    result.requirements[12]?.coverage.components.some(
      (component) => component.status === 'EVIDENCED',
    ),
  ).toBe(false);
  expect(
    result.requirements[2]?.coverage.components.map(({ status }) => status),
  ).toEqual(['NOT_EVIDENCED', 'EVIDENCED']);
  expect(
    result.requirements[3]?.coverage.components.map(({ status, cvQuote }) => [
      status,
      cvQuote,
    ]),
  ).toEqual([
    ['EVIDENCED', postgres],
    ['PARTIAL', sqlServer],
  ]);
  expect(result.conditions).toContainEqual(
    expect.objectContaining({
      parentId: result.requirements[4]?.parentId,
      status: 'UNKNOWN',
      evidence: [],
    }),
  );
  expect(result.requirements[7]?.coverage.components[1]).toMatchObject({
    label: 'Spring Boot',
    cvQuote: spring,
    cvOrigin: 'source',
  });
  for (const index of [8, 9]) {
    expect(result.requirements[index]?.evidence.review).toBe(false);
    expect(
      result.requirements[index]?.coverage.components.every(
        (component) => !('strength' in component),
      ),
    ).toBe(true);
  }
});

test.each([
  ['unsupported CV passage', 'Fabricated attribution project', false, true],
  ['missing CV passage', '', false, true],
  ['wrong component JD span', '', true, false],
] as const)(
  'a semantic AND isolates %s only when component identity is intact',
  async (_name, badQuote, badSpan, retainsEvidence) => {
    const requirement =
      'Experience with campaign planning and conversion attribution';
    const cv = '- Planned marketing campaigns.';
    const savedJob = {
      ...job,
      skills: requirement,
      description: requirement,
      preferredSkills: '',
      experience: '',
      domain: '',
    };
    const config = cvMatchAiConfig(aiConfig({}), {
      CV_MATCH_AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'synthetic-key-for-mocked-provider',
    });
    const { service } = setup(
      async () =>
        JSON.stringify({
          requirements: canonicalRequirements(savedJob).map((parent) => ({
            ...parent,
            correspondence: 'RELATED',
            cvQuote: cv,
            components: [
              {
                componentId: 'c1',
                jdQuote: 'campaign planning',
                correspondence: 'SUPPORTED',
                cvQuote: cv,
              },
              {
                componentId: 'c2',
                jdQuote: badSpan ? 'other skill' : 'conversion attribution',
                correspondence: 'SUPPORTED',
                cvQuote: badQuote,
              },
            ],
          })),
        }),
      cv,
      savedJob,
      config,
    );
    const result = await service.analyze(LOCAL_OWNER_ID, savedJob.id);
    const row = result.requirements[0]!;
    expect(row.status).toBe(retainsEvidence ? 'PARTIAL' : 'UNDECOMPOSED');
    expect(row.evidence.review).toBe(!retainsEvidence);
    expect(row.cvQuote).toBe(retainsEvidence ? cv : '');
    expect(row.coverage.components[1]?.cvQuote).toBe('');
    if (retainsEvidence) {
      expect(row.coverage.components[0]).toMatchObject({
        status: 'EVIDENCED',
        cvQuote: cv,
        cvOrigin: 'source',
      });
      expect(row.coverage.components[1]).toMatchObject({
        status: 'UNDECOMPOSED',
        qualificationReason: 'This component’s evidence could not be verified.',
      });
    }
  },
);
