import 'reflect-metadata';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiConfig } from '../../src/ai/ai.config.js';
import type { AiProvider } from '../../src/ai/ai-provider.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { configureCvMatchDiagnostics } from '../../src/matching/cv-match.diagnostics.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import {
  canonicalRequirements,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic job and CV only.
const cvText = [
  'EXPERIENCE',
  '- Built Java services.',
  '- Containerized services with Docker.',
  '- Built services consuming Kafka topics.',
].join('\n');
const job = {
  id: 'synthetic',
  title: 'Backend Engineer',
  skills: 'Java\nDocker\nKafka',
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: 'Requirements: Java. Docker. Kafka.',
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const quote: Record<string, string> = {
  Java: '- Built Java services.',
  Docker: '- Containerized services with Docker.',
  Kafka: '- Built services consuming Kafka topics.',
};
// Like the real Gemini output: no parentId, concise items for the first rows only.
const initial = () =>
  canonicalRequirements(job)
    .slice(0, 1)
    .map((item) => ({
      ...item,
      parentId: undefined,
      cvQuote: quote[item.requirement]!,
    }));
const completion = (): MatchRequirement[] =>
  canonicalRequirements(job)
    .slice(1)
    .map((item) => ({ ...item, cvQuote: quote[item.requirement]! }));
const reply = (requirements: unknown[]) => JSON.stringify({ requirements });

function setup(
  responses: Array<() => string>,
  provider: AiConfig['provider'] = 'gemini',
) {
  const row = {
    text: cvText,
    fileName: 'synthetic.pdf',
    updatedAt: job.updatedAt,
  };
  const cvs = {
    findOne: jest.fn(async () => row),
    findOneBy: jest.fn(async () => row),
  };
  const jobs = { get: jest.fn(async () => job) };
  const generate = jest.fn<AiProvider['generate']>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected provider call');
    return next();
  });
  const rows = memoryMatchRows();
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService({ generate }),
    new MatchingService(),
    jobs as unknown as OpportunitiesService,
    rows,
    { provider } as AiConfig,
  );
  const saved = () =>
    (rows as unknown as { rows: CvMatchRecord[] }).rows.length;
  return { service, generate, saved };
}
const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: { errorCode?: string }) => error.errorCode,
  );

afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});

test('omitted requirements are completed by exactly one extra call', async () => {
  const { service, generate, saved } = setup([
    () => reply(initial()),
    () => reply(completion()),
  ]);
  const result = await service.analyze('synthetic');
  expect(generate).toHaveBeenCalledTimes(2);
  expect(
    result.requirements.map((row) => [row.requirement, row.status]),
  ).toEqual([
    ['Java', 'EVIDENCED'],
    ['Docker', 'EVIDENCED'],
    ['Kafka', 'EVIDENCED'],
  ]);
  for (const row of result.requirements) expect(cvText).toContain(row.cvQuote);
  expect(saved()).toBe(1);
  // The completion request carries only the missing requirements, ids required.
  const request = generate.mock.calls[1]![0];
  const listed = request.prompt.slice(
    request.prompt.indexOf('"canonicalRequirements"'),
  );
  expect(listed).not.toContain('"Java"');
  expect(listed).toContain('"p2"');
  expect(listed).toContain('"p3"');
  const items = (
    request.schema as never as {
      properties: {
        requirements: {
          items: {
            required: string[];
            properties: { parentId: { enum: string[] } };
          };
        };
      };
    }
  ).properties.requirements.items;
  expect(items.required).toContain('parentId');
  expect(items.properties.parentId.enum).toEqual(['p2', 'p3']);
});

test('a complete first response makes exactly one call', async () => {
  const all = [...initial(), ...completion()];
  const { service, generate } = setup([() => reply(all)]);
  await service.analyze('synthetic');
  expect(generate).toHaveBeenCalledTimes(1);
});

test('Ollama keeps the existing behavior: no completion call', async () => {
  const { service, generate } = setup([() => reply(initial())], 'ollama');
  expect(await code(service.analyze('synthetic'))).toBe('CV_MATCH_INCOMPLETE');
  expect(generate).toHaveBeenCalledTimes(1);
});

describe('invalid completions are rejected with no saved score', () => {
  const [docker, kafka] = completion();
  test.each([
    ['one item still missing', [docker], 'CV_MATCH_INCOMPLETE'],
    [
      'duplicate id',
      [docker, { ...kafka!, parentId: 'p2' }],
      'CV_MATCH_INCOMPLETE',
    ],
    [
      'invented id',
      [docker, { ...kafka!, parentId: 'p9' }],
      'CV_MATCH_INVALID_OUTPUT',
    ],
    [
      'already-covered id',
      [docker, { ...kafka!, parentId: 'p1' }],
      'CV_MATCH_INVALID_OUTPUT',
    ],
    [
      'missing id',
      [docker, { ...kafka!, parentId: undefined }],
      'CV_MATCH_INVALID_OUTPUT',
    ],
    [
      'correct id, mismatched requirement text',
      [docker, { ...kafka!, requirement: 'RabbitMQ', jdQuote: 'Java' }],
      'CV_MATCH_INCOMPLETE',
    ],
  ])('%s', async (_, items, expected) => {
    const { service, generate, saved } = setup([
      () => reply(initial()),
      () => reply(items),
    ]);
    expect(await code(service.analyze('synthetic'))).toBe(expected);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(saved()).toBe(0);
  });

  test('unsupported CV evidence is caught by existing validation', async () => {
    const { service, saved } = setup([
      () => reply(initial()),
      () => reply([docker, { ...kafka!, cvQuote: 'Fabricated Kafka passage' }]),
    ]);
    // The schema's exact-passage enum rejects a quote that is not in the CV.
    expect(await code(service.analyze('synthetic'))).toBe(
      'CV_MATCH_INVALID_OUTPUT',
    );
    expect(saved()).toBe(0);
  });
});

describe('error classification', () => {
  test.each([
    [
      'timeout',
      () => {
        throw new AiError('TIMEOUT');
      },
      'CV_MATCH_TIMEOUT',
    ],
    [
      'rate limit / upstream',
      () => {
        throw new AiError('UPSTREAM_HTTP_FAILURE');
      },
      'CV_MATCH_UNAVAILABLE',
    ],
    ['invalid JSON', () => '{', 'CV_MATCH_INVALID_OUTPUT'],
  ])('initial %s: no completion call', async (_, first, expected) => {
    const { service, generate } = setup([first]);
    expect(await code(service.analyze('synthetic'))).toBe(expected);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  test.each([
    [
      'timeout',
      () => {
        throw new AiError('TIMEOUT');
      },
      'CV_MATCH_TIMEOUT',
    ],
    [
      'rate limit / upstream',
      () => {
        throw new AiError('UPSTREAM_HTTP_FAILURE');
      },
      'CV_MATCH_UNAVAILABLE',
    ],
    ['invalid JSON', () => '{', 'CV_MATCH_INVALID_OUTPUT'],
    [
      'schema mismatch',
      () => JSON.stringify({ score: 1 }),
      'CV_MATCH_INVALID_OUTPUT',
    ],
  ])(
    'completion %s keeps its own classification',
    async (_, second, expected) => {
      const { service, generate, saved } = setup([
        () => reply(initial()),
        second,
      ]);
      expect(await code(service.analyze('synthetic'))).toBe(expected);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(saved()).toBe(0);
    },
  );
});

test('diagnostics: completion outcome line holds no source text', async () => {
  configureCvMatchDiagnostics(true);
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  const { service } = setup([
    () => reply(initial()),
    () => reply(completion()),
  ]);
  await service.analyze('synthetic');
  const lines = write.mock.calls.map(([line]) => String(line));
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    {
      event: 'CV_MATCH_COMPLETION',
      outcome: 'COMPLETED',
      counts: { missing: 2, returned: 2 },
    },
  ]);
  for (const text of [
    ...Object.values(quote),
    'Java',
    'Docker',
    'Kafka',
    'Requirements',
  ])
    expect(lines.join('')).not.toContain(text);
});
