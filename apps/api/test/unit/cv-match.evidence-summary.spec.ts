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
import {
  demonstratedUseReason,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import {
  canonicalRequirements,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic only; PRIVATE_* sentinels must never appear in diagnostics.
const broker =
  'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies';
const postgres = 'Experience with PostgreSQL';
const job = {
  id: 'synthetic',
  title: 'Backend Engineer PRIVATE_TITLE',
  skills: `- ${broker}\n- ${postgres}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements PRIVATE_JD\n- ${broker}.\n- ${postgres}.`,
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const canonical = canonicalRequirements(job);
const pgLine = '- Designed PostgreSQL schemas and wrote migrations. PRIVATE_CV';

function run(
  cv: string,
  kafkaQuote: string,
  pgQuote: string,
  provider: AiConfig['provider'] = 'gemini',
) {
  const requirements: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: row.requirement === postgres ? pgQuote : '',
    ...(row.requirement === broker
      ? {
          components: requirementGroup(broker, row.category).components.map(
            (c) => ({
              componentId: c.id,
              jdQuote: c.jdQuote,
              cvQuote: c.label === 'Kafka' ? kafkaQuote : '',
            }),
          ),
        }
      : {}),
  }));
  const row = { text: cv, fileName: 'synthetic.pdf', updatedAt: job.updatedAt };
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
    { provider } as AiConfig,
  );
}
async function summary(service: JobMatchService) {
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  await service.analyze('synthetic');
  const lines = write.mock.calls.map(([line]) => String(line));
  write.mockRestore();
  expect(lines.join('')).not.toMatch(/PRIVATE|Kafka|PostgreSQL|Designed/u);
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}
afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});

const workAndSkills = [
  'SKILLS',
  'Messaging: Kafka, RabbitMQ',
  'EXPERIENCE',
  '- Built services consuming Kafka topics.',
  pgLine,
].join('\n');

describe('CV_MATCH_EVIDENCE_SUMMARY', () => {
  test('off by default', async () => {
    configureCvMatchDiagnostics(false);
    expect(await summary(run(workAndSkills, 'Kafka', pgLine))).toEqual([]);
  });

  test('ambiguous fragment blocks recovery although a work-line candidate exists', async () => {
    configureCvMatchDiagnostics(true);
    expect(await summary(run(workAndSkills, 'Kafka', pgLine))).toEqual([
      {
        event: 'CV_MATCH_EVIDENCE_SUMMARY',
        quotes: { allowed: 1, widened: 0, ambiguous: 1, dropped: 0 },
        recoveryBlocked: 1,
        requirements: [
          {
            index: 0,
            mode: 'OR',
            status: 'NOT_EVIDENCED',
            recovery: 'BLOCKED_WITH_CANDIDATE',
            // Kafka has work evidence but recovery was blocked: UNKNOWN; the
            // recovery field above carries the cause.
            components: [
              {
                position: 0,
                status: 'NOT_EVIDENCED',
                accepted: false,
                quote: 'AMBIGUOUS',
                reason: 'UNKNOWN',
              },
              {
                position: 1,
                status: 'NOT_EVIDENCED',
                accepted: false,
                quote: 'MISSING',
                reason: 'SKILLS_ONLY',
              },
            ],
          },
          {
            index: 1,
            mode: 'SINGLE',
            status: 'EVIDENCED',
            recovery: 'ALLOWED',
          },
        ],
      },
    ]);
  });

  test('skills-only CV: blocked with no eligible candidate', async () => {
    configureCvMatchDiagnostics(true);
    const cv = [
      'SKILLS',
      'Messaging: Kafka, RabbitMQ',
      'Tools: Kafka UI, Git',
      'EXPERIENCE',
      pgLine,
    ].join('\n');
    const [line] = await summary(run(cv, 'Kafka', pgLine));
    expect(line!.requirements).toContainEqual({
      index: 0,
      mode: 'OR',
      status: 'NOT_EVIDENCED',
      recovery: 'BLOCKED_NO_CANDIDATE',
      components: [
        {
          position: 0,
          status: 'NOT_EVIDENCED',
          accepted: false,
          quote: 'AMBIGUOUS',
          reason: 'SKILLS_ONLY',
        },
        {
          position: 1,
          status: 'NOT_EVIDENCED',
          accepted: false,
          quote: 'MISSING',
          reason: 'SKILLS_ONLY',
        },
      ],
    });
  });

  test('widened and dropped quotes are counted', async () => {
    configureCvMatchDiagnostics(true);
    const [line] = await summary(
      run(
        workAndSkills,
        'consuming Kafka topics',
        'PRIVATE_FABRICATED PostgreSQL work',
      ),
    );
    expect(line).toMatchObject({
      quotes: { allowed: 0, widened: 1, ambiguous: 0, dropped: 1 },
      requirements: [
        { index: 0, mode: 'OR', status: 'EVIDENCED', recovery: 'ALLOWED' },
        {
          index: 1,
          mode: 'SINGLE',
          status: 'NOT_EVIDENCED',
          recovery: 'BLOCKED_WITH_CANDIDATE',
        },
      ],
    });
  });

  test('Ollama: classified without an allowed set; no widening', async () => {
    configureCvMatchDiagnostics(true);
    const [line] = await summary(
      run(
        workAndSkills,
        '- Built services consuming Kafka topics.',
        pgLine,
        'ollama',
      ),
    );
    expect(line).toMatchObject({
      quotes: { allowed: 2, widened: 0, ambiguous: 0, dropped: 0 },
      recoveryBlocked: 0,
    });
  });
});

test('wrapped work bullet: RabbitMQ reported EVIDENCED, no source text logged', async () => {
  configureCvMatchDiagnostics(true);
  const cv = [
    'SKILLS',
    'Messaging: RabbitMQ',
    'EXPERIENCE',
    '- Led the PRIVATE_PROJECT redesign into a microservices',
    'architecture with asynchronous communication using RabbitMQ.',
    pgLine,
  ].join('\n');
  const [line] = await summary(run(cv, '', pgLine));
  expect(line!.requirements).toContainEqual({
    index: 0,
    mode: 'OR',
    status: 'EVIDENCED',
    recovery: 'ALLOWED',
    components: [
      {
        position: 0,
        status: 'NOT_EVIDENCED',
        accepted: false,
        quote: 'MISSING',
        reason: 'NO_MENTION',
      },
      {
        position: 1,
        status: 'EVIDENCED',
        accepted: true,
        quote: 'MISSING',
        reason: 'EVIDENCED',
      },
    ],
  });
});

describe('broker component reason codes', () => {
  const group = requirementGroup(broker, 'skill');
  const reason = (cv: string, status = 'NOT_EVIDENCED') =>
    demonstratedUseReason('RabbitMQ', cv, group, status);
  test.each([
    ['EVIDENCED', '- Integrated RabbitMQ into backend services.', 'EVIDENCED'],
    ['NO_MENTION', '- Built services consuming Kafka topics.', 'NOT_EVIDENCED'],
    [
      'SKILLS_ONLY',
      'SKILLS\nMessaging: RabbitMQ\nTechnologies: Java, RabbitMQ',
      'NOT_EVIDENCED',
    ],
    [
      'NEGATED',
      '- Led reviews but never\nused RabbitMQ in production.',
      'NOT_EVIDENCED',
    ],
    [
      'WRAPPED_SPLIT',
      '- Led the Example platform redesign.\nasynchronous messaging over RabbitMQ.',
      'NOT_EVIDENCED',
    ],
    ['NO_WORK_VERB', 'EXPERIENCE\n- Message queue: RabbitMQ', 'NOT_EVIDENCED'],
    ['UNKNOWN', '- Integrated RabbitMQ into backend services.', 'CONFLICT'],
  ])('%s', (expected, cv, status) => {
    expect(reason(cv, status)).toBe(expected);
  });
});
