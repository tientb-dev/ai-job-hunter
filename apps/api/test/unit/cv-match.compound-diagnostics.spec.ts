import 'reflect-metadata';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiConfig } from '../../src/ai/ai.config.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { configureCvMatchDiagnostics } from '../../src/matching/cv-match.diagnostics.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import {
  canonicalRequirements,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic only. PRIVATE_* sentinels, skill names and quotes must never be logged.
const devops =
  'Experience using Docker, CI/CD pipelines, logging, monitoring, and automated deployment practices';
const broker =
  'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies';
const pair = 'Experience with Docker and Kubernetes';
const job = {
  id: 'synthetic',
  title: 'Backend Engineer PRIVATE_TITLE',
  skills: [devops, broker, pair].map((r) => `- ${r}`).join('\n'),
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements PRIVATE_JD\n${[devops, broker, pair].map((r) => `- ${r}.`).join('\n')}`,
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const canonical = canonicalRequirements(job);
const docker =
  '- Containerized Java services with Docker and deployed them to staging. PRIVATE_CV';
const cicd = '- Built CI/CD pipelines with GitHub Actions for order services.';
const skills = 'DevOps: Docker, GitHub Actions, CI/CD, Kubernetes';
const wrapped = [
  '- Led the order platform migration into a',
  'microservices architecture using RabbitMQ.',
];
const negated = 'Never used Kubernetes in production.';
const uncertain = 'Maybe deployed Kubernetes workloads.';
const cv = [
  'SKILLS',
  skills,
  'EXPERIENCE',
  'Backend Engineer, Example Co, 2019-2024',
  docker,
  cicd,
  ...wrapped,
  negated,
  uncertain,
].join('\n');

type Quotes = Record<string, Record<string, string>>;
function service(quotes: Quotes) {
  const requirements: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quotes[row.requirement]?.[c.label] ?? '',
      }),
    ),
  }));
  const row = {
    text: cv,
    fileName: 'PRIVATE_FILE.pdf',
    updatedAt: job.updatedAt,
  };
  return new JobMatchService(
    {
      findOne: jest.fn(async () => row),
      findOneBy: jest.fn(async () => row),
    } as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService({ generate: async () => JSON.stringify({ requirements }) }),
    new MatchingService(),
    { get: jest.fn(async () => job) } as unknown as OpportunitiesService,
    memoryMatchRows(),
    { provider: 'gemini' } as AiConfig,
  );
}
const forbidden =
  /PRIVATE|Docker|Kubernetes|Kafka|RabbitMQ|CI\/CD|logging|monitoring|GitHub|Containerized|Never used|Maybe|Experience/u;
async function run(quotes: Quotes, diagnostics: boolean) {
  configureCvMatchDiagnostics(diagnostics);
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  const result = await service(quotes)
    .analyze('synthetic')
    .catch((e: { errorCode?: string }) => ({
      error: e.errorCode,
    }));
  const lines = write.mock.calls.map(([line]) => String(line));
  write.mockRestore();
  expect(lines.join('')).not.toMatch(forbidden);
  const events = lines.map(
    (line) => JSON.parse(line) as Record<string, unknown>,
  );
  return { result, events };
}
const summaryOf = (events: Record<string, unknown>[]) =>
  events.find((e) => e.event === 'CV_MATCH_EVIDENCE_SUMMARY') as
    | {
        requirements: { index: number; mode: string; components?: unknown[] }[];
      }
    | undefined;
afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});

const NOT = { status: 'NOT_EVIDENCED', accepted: false };
const mixed: Quotes = {
  [devops]: {
    Docker: docker, // valid work evidence
    'CI/CD pipelines': skills, // skills-only quote for an experience row
    logging: 'Docker', // repeated fragment
    // monitoring and automated deployment practices: no quote
  },
  [broker]: { RabbitMQ: wrapped[0]! }, // wrapped work evidence
  [pair]: { Docker: cicd, Kubernetes: negated }, // irrelevant line; negated
};

describe('per-component AND/OR diagnostics', () => {
  test('fixed codes for valid, skills-only, ambiguous, missing, wrapped, irrelevant and negated quotes', async () => {
    const summary = summaryOf((await run(mixed, true)).events)!;
    expect(summary.requirements.map((r) => [r.index, r.mode])).toEqual([
      [0, 'AND'],
      [1, 'OR'],
      [2, 'AND'],
    ]);
    expect(summary.requirements[0]!.components).toEqual([
      { position: 0, status: 'EVIDENCED', accepted: true, quote: 'ALLOWED' },
      { position: 1, ...NOT, quote: 'SKILLS_DECLARATION' },
      { position: 2, ...NOT, quote: 'AMBIGUOUS' },
      { position: 3, ...NOT, quote: 'MISSING' },
      { position: 4, ...NOT, quote: 'MISSING' },
    ]);
    expect(summary.requirements[1]!.components).toEqual([
      { position: 0, ...NOT, quote: 'MISSING', reason: 'NO_MENTION' },
      {
        position: 1,
        status: 'EVIDENCED',
        accepted: true,
        quote: 'ALLOWED',
        reason: 'EVIDENCED',
      },
    ]);
    expect(summary.requirements[2]!.components).toEqual([
      { position: 0, ...NOT, quote: 'ALLOWED' }, // CI/CD line for Docker
      { position: 1, ...NOT, quote: 'ALLOWED' }, // negated line
    ]);
  });

  test('uncertain evidence is reported as not accepted', async () => {
    const summary = summaryOf(
      (await run({ [pair]: { Kubernetes: uncertain } }, true)).events,
    )!;
    expect(summary.requirements[2]!.components).toContainEqual({
      position: 1,
      ...NOT,
      quote: 'ALLOWED',
    });
  });

  test('a component quote not in the CV fails the analysis: one failure line, no summary', async () => {
    const { events } = await run(
      { [devops]: { Docker: 'Ran PRIVATE_FAKE Docker clusters at scale' } },
      true,
    );
    expect(summaryOf(events)).toBeUndefined();
    expect(events.filter((e) => e.event === 'CV_MATCH_FAILURE')).toEqual([
      expect.objectContaining({
        reasonCode: 'COMPONENT_CV_QUOTE_NOT_IN_CV',
        counts: { requirementIndex: 0 },
      }),
    ]);
  });

  test('disabled by default: no summary', async () => {
    const { events } = await run(mixed, false);
    expect(events).toEqual([]);
  });

  test('statuses, credits and score are identical with diagnostics on or off', async () => {
    const strip = (r: unknown) => {
      const value = r as {
        score: number;
        requirements: { status: string; credit: number; coverage: unknown }[];
      };
      return {
        score: value.score,
        rows: value.requirements.map((x) => [x.status, x.credit, x.coverage]),
      };
    };
    const on = await run(mixed, true);
    const off = await run(mixed, false);
    expect(strip(on.result)).toEqual(strip(off.result));
  });
});
