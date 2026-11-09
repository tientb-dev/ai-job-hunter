import 'reflect-metadata';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { AiService } from '../../src/ai/ai.service.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import {
  normalizeGreenhouse,
  DISCOVERY_SOURCES,
} from '../../src/discovery/greenhouse.source.js';
import { rankJob } from '../../src/discovery/discovery.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
const alternative =
  'Experience in at least one managed language such as Java, Scala, Go, C# or similar';
const fullJd = [
  'Ho Chi Minh City',
  'Hybrid work schedule, onsite Tuesday–Friday.',
  'We are looking for a Junior Software Engineer.',
  'Requirements',
  alternative,
  'Responsibilities',
  'Use AI-assisted development tooling, not production AI/ML engineering.',
].join('\n');
const cv =
  'Backend — Java, Spring Boot, Hibernate\nLed development of core enterprise features using Java Spring Boot.\n6+ years of experience building enterprise applications.';
function sourceJob(title = 'Software Engineer', description = fullJd) {
  return normalizeGreenhouse(
    {
      jobs: [
        {
          id: 123,
          title,
          company_name: 'Synthetic Axon',
          location: { name: 'Ho Chi Minh City' },
          absolute_url: 'https://job-boards.greenhouse.io/synthetic/jobs/123',
          content: description,
        },
      ],
    },
    DISCOVERY_SOURCES[0],
    '2026-10-30T00:00:00.000Z',
  ).jobs[0]!;
}
function savedJob() {
  return {
    experience: '',
    domain: '',
    jdText: '',
    postText: '',
    ...sourceJob(),
    updatedAt: new Date('2026-10-30T00:00:00Z'),
  } as Opportunity;
}
test('discovery preserves the full JD and the managed-language OR requirement, not a mandatory Java tag', () => {
  const source = sourceJob();
  expect(source.description).toBe(fullJd);
  expect(source.skills).toBe(alternative);
  expect(source.discovery.techStack).toEqual(['Java']);
  expect(source.seniority).toBe('Junior');
  expect(
    canonicalRequirements(savedJob()).map((item) => item.requirement),
  ).toEqual([alternative]);
});
test('existing discovered rows with legacy Java tags analyze the full qualification without mutating saved data', () => {
  const job = savedJob();
  delete job.discovery!.requirementSkills;
  job.skills = 'Java';
  const snapshot = JSON.stringify(job);
  expect(canonicalRequirements(job).map((item) => item.requirement)).toEqual([
    alternative,
  ]);
  expect(matchJobText(job)).toContain(`Required skills: ${alternative}`);
  expect(matchJobText(job)).toContain(`Description:\n${fullJd}`);
  expect(JSON.stringify(job)).toBe(snapshot);
});
test('title/search stack mentions never become automatic requirements and source manual edits survive', () => {
  const source = sourceJob(
    'Java Software Engineer',
    'Our products use Java and React.',
  );
  expect(source.discovery.techStack).toEqual(['Java', 'React']);
  expect(source.skills).toBe('');
  const job = { ...savedJob(), ...source } as Opportunity;
  expect(canonicalRequirements(job)).toEqual([]);
  job.skills = 'SQL';
  expect(canonicalRequirements(job).map((item) => item.requirement)).toEqual([
    'SQL',
  ]);
  const legacy = savedJob();
  delete legacy.discovery!.requirementSkills;
  legacy.skills = 'Java, SQL';
  expect(canonicalRequirements(legacy).map((item) => item.requirement)).toEqual(
    ['Java', 'SQL'],
  );
});
test('only professional Java work satisfies the managed-language experience alternative', () => {
  const job = savedJob();
  for (const evidence of [
    cv.split('\n')[0]!,
    cv.split('\n')[1]!,
    'Technical Skills: Java, Spring Boot',
  ]) {
    const result = scoreCvMatch(
      [
        {
          requirement: alternative,
          priority: 'required',
          category: 'skill',
          jdQuote: alternative,
          cvQuote: '',
        },
      ],
      evidence,
      matchJobText(job),
      canonicalRequirements(job),
    );
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]).toMatchObject({
      requirement: alternative,
      status: evidence === cv.split('\n')[1] ? 'EVIDENCED' : 'NOT_EVIDENCED',
      cvQuote: evidence === cv.split('\n')[1] ? evidence : '',
    });
    expect(result.score).toBe(evidence === cv.split('\n')[1] ? 100 : 0);
    expect(evidence).toContain(result.requirements[0]!.cvQuote);
  }
});
test('JavaScript and coding tools do not provide Java or production AI evidence', () => {
  const job = savedJob();
  for (const evidence of [
    'Technical Skills: JavaScript, React',
    'Tools: AI-assisted coding with Copilot',
    'No Java Spring Boot development experience.',
  ]) {
    expect(
      scoreCvMatch([], evidence, matchJobText(job), canonicalRequirements(job))
        .requirements[0]!.status,
    ).toBe('NOT_EVIDENCED');
  }
});
test('all seniorities remain discoverable; actual Junior JD seniority is preserved and never changes CV scoring', () => {
  const filters = {
    location: 'Ho Chi Minh City',
    stacks: ['Java'],
    workMode: 'All',
    seniority: 'Senior',
  } as const;
  const base = sourceJob();
  const ranks = ['Junior', 'Mid-level', 'Senior', 'Technical Lead', ''].map(
    (seniority) =>
      rankJob({ ...base, seniority }, { ...filters, stacks: ['Java'] }),
  );
  expect(ranks.every((rank) => rank !== null)).toBe(true);
  expect(ranks[2]!).toBeGreaterThan(ranks[0]!);
  expect(ranks[3]!).toBeGreaterThan(ranks[1]!);
  const job = savedJob();
  expect(canonicalRequirements({ ...job, seniority: 'Senior' })).toEqual(
    canonicalRequirements({ ...job, seniority: 'Junior' }),
  );
});
test('full discovered JD → real matching service → API-shaped result retains OR semantics and explicit Java evidence', async () => {
  const job = savedJob();
  const row = { text: cv, updatedAt: job.updatedAt, fileName: 'synthetic.pdf' };
  const cvs = {
    findOne: jest.fn<() => Promise<typeof row>>().mockResolvedValue(row),
    findOneBy: jest.fn<() => Promise<typeof row>>().mockResolvedValue(row),
  };
  const provider = {
    generate: jest.fn(async (request: { prompt: string }) => {
      const input = JSON.parse(request.prompt.split('\n').at(-1)!);
      expect(input.job).toContain(fullJd);
      expect(input.canonicalRequirements).toHaveLength(1);
      expect(input.canonicalRequirements[0].requirement).toBe(alternative);
      return JSON.stringify({
        requirements: [
          {
            requirement: alternative,
            priority: 'required',
            category: 'skill',
            jdQuote: alternative,
            cvQuote: '',
          },
        ],
      });
    }),
  };
  const jobs = {
    get: jest.fn<() => Promise<Opportunity>>().mockResolvedValue(job),
  };
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService(provider),
    new MatchingService(),
    jobs as unknown as OpportunitiesService,
    memoryMatchRows(),
  );
  const result = await service.analyze('synthetic');
  expect(result.requirements[0]).toMatchObject({
    requirement: alternative,
    status: 'EVIDENCED',
    cvQuote: cv.split('\n')[1],
  });
  expect(result.requirements.some((item) => item.requirement === 'Java')).toBe(
    false,
  );
  expect(provider.generate).toHaveBeenCalledTimes(1); // Mock only, no Ollama.
});

test('an alternative supported by Scala evidence is one matched requirement, not four mandatory languages', () => {
  const job = savedJob();
  const quote = 'Professional experience: Developed production Scala services.';
  const result = scoreCvMatch(
    [
      {
        requirement: alternative,
        priority: 'required',
        category: 'skill',
        jdQuote: alternative,
        cvQuote: quote,
      },
    ],
    quote,
    matchJobText(job),
    canonicalRequirements(job),
  );
  expect(result.requirements).toHaveLength(1);
  expect(result.requirements[0]).toMatchObject({
    requirement: alternative,
    status: 'EVIDENCED',
    cvQuote: quote,
  });
});
