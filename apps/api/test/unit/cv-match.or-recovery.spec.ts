import 'reflect-metadata';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import { Repository } from 'typeorm';
import { AiService } from '../../src/ai/ai.service.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

const capture = JSON.parse(
  readFileSync(
    '../../docs/audits/fixtures/p63-synthetic-cv-match.json',
    'utf8',
  ),
) as {
  fixture: { cv: string; required: string; preferred: string };
  rawModelOutput: { requirements: MatchRequirement[] };
};
const jobFor = (skills = '', preferredSkills = 'MCP or knowledge graphs.') =>
  ({
    id: 'p63-synthetic-only',
    title: 'Synthetic P6.3 role',
    skills,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-05T00:00:00.000Z'),
  }) as Opportunity;
function omitted(cv: string, job = jobFor()) {
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job);
  const proposals = canonical.map((row) => ({ ...row, cvQuote: '' }));
  return scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
}

test('captured P6.3 omission replays through the matching service as 44 / Consider without changing raw model output', async () => {
  const job = jobFor(capture.fixture.required, capture.fixture.preferred);
  const snapshot = JSON.stringify(capture.rawModelOutput);
  const cvs = {
    findOne: async () => ({
      text: capture.fixture.cv,
      fileName: 'synthetic.pdf',
      updatedAt: job.updatedAt,
    }),
    findOneBy: async () => ({
      fileName: 'synthetic.pdf',
      updatedAt: job.updatedAt,
    }),
  };
  const ai = new AiService({
    generate: async () => JSON.stringify(capture.rawModelOutput),
  });
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    ai,
    new MatchingService(),
    { get: async () => job } as unknown as OpportunitiesService,
    memoryMatchRows(),
  );
  const result = await service.analyze(job.id);
  expect(result).toMatchObject({
    score: 44,
    recommendation: 'Consider',
    requirements: [
      { status: 'PARTIAL', credit: 0.25 },
      { status: 'EVIDENCED', credit: 1, cvQuote: 'Built MCP servers.' },
    ],
  });
  expect(result.requirements[1]!.coverage.components[0]).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: 'Built MCP servers.',
  });
  expect(JSON.stringify(capture.rawModelOutput)).toBe(snapshot);
});

test.each([
  'Built MCP servers.',
  'Built Model Context Protocol servers.',
  '  Built MCP servers.  ',
])(
  'omitted explicit MCP/alias passage is recovered as an exact source span: %s',
  (cv) => {
    const row = omitted(cv).requirements[0]!;
    expect(row.status).toBe('EVIDENCED');
    expect(cv).toContain(row.cvQuote);
    expect(row.cvQuote).toBe(cv.trim());
  },
);

test.each([
  'Synthetic unrelated work.',
  'Built Java services.',
  'MCP',
  'Never used MCP.',
  'Interested in building MCP servers.',
  'Aspiring MCP developer.',
  'Skills: no MCP experience.',
  'Used Copilot for MCP code generation.',
  'I want to build MCP servers.',
  'I will implement MCP.',
  'If I built MCP servers, I would learn more.',
  'MCP build',
])(
  'omitted unsupported/negative/aspirational/tooling passage remains Unknown: %s',
  (cv) => {
    expect(omitted(cv)).toMatchObject({
      score: 0,
      requirements: [{ status: 'NOT_EVIDENCED', cvQuote: '' }],
    });
  },
);

test('omitted contradictory MCP evidence surfaces Conflict with both original passages', () => {
  const result = omitted('Built MCP servers.\nNever used MCP.');
  expect(result).toMatchObject({
    score: 0,
    requirements: [{ status: 'CONFLICT', credit: 0 }],
  });
  expect(result.requirements[0]!.coverage.components[0]).toMatchObject({
    cvQuote: 'Built MCP servers.',
    conflictingQuotes: ['Never used MCP.'],
  });
});

test.each([
  'Skills: RAG.',
  'Personally built a RAG prototype only.',
  'Our team built and delivered RAG to production.',
  'Personally built one RAG application.',
  'Personally built and delivered zero RAG applications to production.',
  'Personally built and delivered 0 RAG applications to production.',
])('OR recovery cannot bypass personal delivery beyond prototype: %s', (cv) => {
  const job = jobFor(
    '',
    'Personally built and delivered at least one LLM, RAG, or agent-based application beyond the prototype stage.',
  );
  expect(omitted(cv, job).requirements[0]!.status).toBe('NOT_EVIDENCED');
});

test('OR recovery honors personal production delivery and shared minimum duration', () => {
  const delivery = jobFor(
    '',
    'Personally built and delivered at least one LLM, RAG, or agent-based application beyond the prototype stage.',
  );
  const cv =
    'Personally built and delivered one RAG application to production.';
  expect(omitted(cv, delivery).requirements[0]!.status).toBe('EVIDENCED');
  const duration = jobFor('', 'At least 3 years of experience with MCP or RAG');
  for (const text of ['Skills: MCP.', '2 years of experience with MCP.'])
    expect(omitted(text, duration).score).toBe(0);
  expect(omitted('4 years of experience with MCP.', duration).score).toBe(100);
});

test('unsupported quantity, mixed logic and unrecognized alternatives never gain recovery credit', () => {
  for (const requirement of [
    'Experience with at least 2 MCP or RAG applications',
    'MCP and RAG or tool calling',
    'Flux capacitor or temporal routing',
  ]) {
    const cv =
      'Built MCP, RAG, tool calling, flux capacitor and temporal routing systems.';
    expect(omitted(cv, jobFor('', requirement)).score).toBe(0);
  }
});

test('AND design recovery evaluates explicit components individually while preserving partial credit', () => {
  const job = jobFor('Experience designing APIs and integrations', '');
  const cv = 'Designed APIs.\nDesigned integrations.';
  expect(omitted(cv, job).score).toBe(100);
  const partialCv = 'Designed APIs.';
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job);
  const proposals = [{ ...canonical[0]!, cvQuote: 'Designed APIs.' }];
  expect(
    scoreCvMatch(
      validateMatchAssessment(proposals, partialCv, jd, canonical),
      partialCv,
      jd,
      canonical,
    ),
  ).toMatchObject({
    score: 50,
    recommendation: 'Consider',
    requirements: [{ status: 'PARTIAL', credit: 0.5 }],
  });
});

test('recovery never masks rejected model parent evidence or changes typed fabrication failures', () => {
  const job = jobFor('Python');
  const cv = 'Built Python services.\nBuilt MCP servers.';
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job);
  const proposals = canonical.map((row, index) => ({
    ...row,
    cvQuote: index ? 'Invented MCP qualification.' : 'Built Python services.',
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  expect(
    scoreCvMatch(verified, cv, jd, canonical).requirements[1]!.status,
  ).toBe('NOT_EVIDENCED');
  const fabricatedComponent = [
    { ...proposals[0]!, cvQuote: 'Built Python services.' },
    {
      ...canonical[1]!,
      cvQuote: '',
      components: [
        {
          componentId: 'c1',
          jdQuote: 'MCP',
          cvQuote: 'Invented MCP qualification.',
        },
      ],
    },
  ];
  expect(() =>
    validateMatchAssessment(fabricatedComponent, cv, jd, canonical),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
  expect(() =>
    validateMatchAssessment(
      [{ ...canonical[1]!, jdQuote: 'Invented JD', cvQuote: '' }],
      cv,
      jd,
      [canonical[1]!],
    ),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
});
