import 'reflect-metadata';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { AiService } from '../../src/ai/ai.service.js';
import { aiConfig, type AiConfig } from '../../src/ai/ai.config.js';
import type { AiProvider, OutputSchema } from '../../src/ai/ai-provider.js';
import { GeminiProvider } from '../../src/ai/gemini.provider.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import {
  canonicalRequirements,
  matchOutputSchema,
  withoutQuoteEnums,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic job and CV only; PRIVATE_* sentinels must never reach logs.
const pairs = 'Experience with Docker and Kubernetes';
const job = {
  id: 'synthetic',
  title: 'Backend Engineer',
  skills: `Kafka\n${pairs}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements: Kafka. ${pairs}.`,
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const kafkaLine =
  '- Built services consuming Kafka topics. PRIVATE_CV_SENTINEL';
const negated = 'Never used Kafka in production.';
const dockerLine = '- Deployed services with Docker.';
const cvText = ['EXPERIENCE', kafkaLine, dockerLine].join('\n');
const negatedCv = ['EXPERIENCE', negated, dockerLine].join('\n');
const longCv = [
  'EXPERIENCE',
  ...Array.from(
    { length: 150 },
    (_, i) =>
      `- Delivered synthetic project ${i} using Java for an example team with measurable results ${i}.`,
  ),
].join('\n');

const enums = (schema: unknown): string[] => {
  const found: string[] = [];
  JSON.stringify(schema, (key, value: unknown) => {
    if (
      key === 'cvQuote' &&
      value &&
      typeof value === 'object' &&
      'enum' in value
    )
      found.push(key);
    return value;
  });
  return found;
};

describe('Gemini request schema', () => {
  const canonical = canonicalRequirements(job);
  test('a 150-line CV gives a bounded schema without passage enums', () => {
    const full = matchOutputSchema(longCv, canonical);
    const gemini = withoutQuoteEnums(full);
    expect(enums(full)).toHaveLength(2);
    expect(enums(gemini)).toEqual([]);
    expect(JSON.stringify(gemini).length).toBeLessThan(5000);
    expect(JSON.stringify(full).length).toBeGreaterThan(100_000);
  });
});

function setup(
  generate: AiProvider['generate'],
  provider: AiConfig['provider'] = 'gemini',
  text = cvText,
) {
  const row = {
    text,
    fileName: 'synthetic.pdf',
    updatedAt: job.updatedAt,
  };
  const service = new JobMatchService(
    {
      findOne: jest.fn(async () => row),
      findOneBy: jest.fn(async () => row),
    } as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService({ generate: jest.fn(generate) }),
    new MatchingService(),
    { get: jest.fn(async () => job) } as unknown as OpportunitiesService,
    memoryMatchRows(),
    { provider } as AiConfig,
  );
  return service;
}
const canonical = canonicalRequirements(job);
const components = (quote: string) =>
  requirementGroup(pairs, 'skill').components.map((c) => ({
    componentId: c.id,
    jdQuote: c.jdQuote,
    cvQuote: c.label === 'Docker' ? quote : '',
  }));
const answer = (kafkaQuote: string, componentQuote = dockerLine) =>
  JSON.stringify({
    requirements: canonical.map((row): MatchRequirement => ({
      ...row,
      cvQuote: row.requirement === 'Kafka' ? kafkaQuote : '',
      ...(row.requirement === pairs
        ? { components: components(componentQuote) }
        : {}),
    })),
  });
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: { errorCode?: string }) => error.errorCode,
  );

describe('server-side evidence enforcement without schema enums', () => {
  let schemas: OutputSchema[] = [];
  const recording =
    (reply: string): AiProvider['generate'] =>
    async (request) => {
      schemas.push(request.schema);
      return reply;
    };
  afterEach(() => {
    schemas = [];
  });

  test('Gemini gets no enums; an exact passage is still Matched', async () => {
    const result = await setup(recording(answer(kafkaLine))).analyze(
      'synthetic',
    );
    expect(enums(schemas[0])).toEqual([]);
    expect(
      result.requirements.find((r) => r.requirement === 'Kafka'),
    ).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: kafkaLine,
    });
  });

  test('Ollama keeps its passage enums', async () => {
    await setup(recording(answer(kafkaLine)), 'ollama').analyze('synthetic');
    expect(enums(schemas[0])).toHaveLength(2);
  });

  test.each([
    ['fabricated quote', 'Led a PRIVATE_FABRICATED Kafka platform.', cvText],
    // Exact CV substring, but not an allowed passage: it drops the negation.
    ['negation-dropping fragment', 'used Kafka in production.', negatedCv],
  ])('%s never becomes Matched', async (_, quote, text) => {
    const result = await setup(
      recording(answer(quote)),
      'gemini',
      text,
    ).analyze('synthetic');
    const row = result.requirements.find((r) => r.requirement === 'Kafka')!;
    expect(row.status).not.toBe('EVIDENCED');
    expect(row.cvQuote).not.toBe(quote);
  });

  test.each([
    ['fabricated component quote', 'Ran PRIVATE_FABRICATED Docker clusters.'],
  ])('%s is rejected', async (_, quote) => {
    expect(
      await code(
        setup(recording(answer(kafkaLine, quote))).analyze('synthetic'),
      ),
    ).toBe('CV_MATCH_EVIDENCE_REJECTED');
  });

  test('a unique component fragment is widened to its full allowed line', async () => {
    const result = await setup(
      recording(answer(kafkaLine, 'services with Docker')),
    ).analyze('synthetic');
    const docker = result.requirements
      .find((r) => r.requirement === pairs)!
      .coverage.components.find((c) => c.label === 'Docker');
    expect(docker).toMatchObject({ status: 'EVIDENCED', cvQuote: dockerLine });
  });
});

describe('Gemini provider reports the upstream HTTP status', () => {
  const provider = new GeminiProvider(
    aiConfig({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'synthetic-test-key-0123456789abcdef',
    }),
  );
  const request = { prompt: 'Synthetic fixture', schema: { type: 'object' } };
  afterEach(() => {
    jest.restoreAllMocks();
  });
  test.each([
    [400, 1],
    [503, 3], // exhausted retries
  ])('HTTP %i', async (status, calls) => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response('PRIVATE_UPSTREAM_BODY', {
          status,
          headers: { 'retry-after': '0' },
        }),
    );
    const error = await provider.generate(request).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'UPSTREAM_HTTP_FAILURE',
      httpStatus: status,
    });
    expect(String((error as Error).message)).not.toMatch(/PRIVATE/u);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
});
