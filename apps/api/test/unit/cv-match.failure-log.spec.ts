import 'reflect-metadata';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiConfig } from '../../src/ai/ai.config.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { CvMatchError } from '../../src/matching/cv-match.error.js';
import { configureCvMatchDiagnostics } from '../../src/matching/cv-match.diagnostics.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import {
  canonicalRequirements,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic only. Every PRIVATE_* sentinel must stay out of logs.
const pairs = 'Experience with Docker and Kubernetes';
const job = {
  id: 'synthetic',
  title: 'Backend Engineer',
  skills: `Kafka\n${pairs}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements: Kafka. ${pairs}.\nPRIVATE_JD_SENTINEL`,
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const kafkaLine =
  '- Built services consuming Kafka topics. PRIVATE_CV_SENTINEL';
const dockerLine = '- Deployed services with Docker.';
const cvText = ['EXPERIENCE', kafkaLine, dockerLine].join('\n');
const canonical = canonicalRequirements(job);
const components = (quote: string, id?: string) =>
  requirementGroup(pairs, 'skill').components.map((c) => ({
    componentId: id ?? c.id,
    jdQuote: c.jdQuote,
    cvQuote: c.label === 'Docker' ? quote : '',
  }));
const rows = (
  change: (row: MatchRequirement) => Partial<MatchRequirement> = () => ({}),
): MatchRequirement[] =>
  canonical.map((row) => ({
    ...row,
    cvQuote: row.requirement === 'Kafka' ? kafkaLine : '',
    ...(row.requirement === pairs
      ? { components: components(dockerLine) }
      : {}),
    ...change(row),
  }));
const reply = (requirements: unknown) => JSON.stringify({ requirements });
type Step = () => string | Promise<string>;

function setup(
  steps: Step[],
  options: {
    provider?: AiConfig['provider'];
    cv?: string | null;
    savedJob?: Opportunity;
    laterJob?: Opportunity;
    persist?: () => Promise<void>;
  } = {},
) {
  const text = options.cv === undefined ? cvText : options.cv;
  const row =
    text === null
      ? null
      : { text, fileName: 'synthetic.pdf', updatedAt: job.updatedAt };
  const savedJob = options.savedJob ?? job;
  const get = jest
    .fn(async () => savedJob)
    .mockResolvedValueOnce(savedJob)
    .mockResolvedValue(options.laterJob ?? savedJob);
  const matchRows = memoryMatchRows();
  if (options.persist)
    (
      matchRows as unknown as { manager: { transaction: () => Promise<void> } }
    ).manager = {
      transaction: options.persist,
    };
  return new JobMatchService(
    {
      findOne: jest.fn(async () => row),
      findOneBy: jest.fn(async () => row),
    } as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService({
      generate: async () => {
        const step = steps.shift();
        if (!step) throw new Error('PRIVATE_UNEXPECTED_CALL');
        return step();
      },
    }),
    new MatchingService(),
    { get } as unknown as OpportunitiesService,
    matchRows as Repository<CvMatchRecord>,
    { provider: options.provider ?? 'gemini' } as AiConfig,
  );
}
const fail =
  (error: Error): Step =>
  () => {
    throw error;
  };

afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});
async function events(service: JobMatchService) {
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  await service.analyze('synthetic').catch(() => undefined);
  const lines = write.mock.calls.map(([line]) => String(line));
  write.mockRestore();
  expect(lines.join('')).not.toMatch(/PRIVATE/u);
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}
async function failure(service: JobMatchService) {
  const lines = await events(service);
  const found = lines.filter((line) => line.event === 'CV_MATCH_FAILURE');
  expect(found).toHaveLength(1);
  expect(found[0]!.durationMs).toEqual(expect.any(Number));
  const rest = { ...found[0]! };
  delete rest.durationMs;
  delete rest.event;
  return rest;
}

const evidence = {
  errorCode: 'CV_MATCH_EVIDENCE_REJECTED',
  stage: 'EVIDENCE_VALIDATION',
  provider: 'gemini',
  responseStatus: 503,
};
const partial = rows((row) =>
  row.requirement === pairs
    ? {
        requirement: 'PRIVATE_SKIPPED',
        jdQuote: 'PRIVATE_SKIPPED',
        parentId: undefined,
      }
    : {},
);

describe('one classified CV_MATCH_FAILURE per failed operation', () => {
  test.each<[string, () => JobMatchService, Record<string, unknown>]>([
    [
      'no saved CV',
      () => setup([], { cv: null }),
      {
        stage: 'SETUP',
        errorCode: 'CV_MATCH_CV_UNAVAILABLE',
        reasonCode: 'CV_TEXT_EMPTY',
        provider: 'gemini',
        responseStatus: 400,
      },
    ],
    [
      'no job content',
      () => setup([], { savedJob: { ...job, skills: '', description: ' ' } }),
      {
        stage: 'SETUP',
        errorCode: 'NONE',
        reasonCode: 'NO_JOB_CONTENT',
        provider: 'gemini',
        responseStatus: 400,
      },
    ],
    [
      'initial HTTP 400',
      () => setup([fail(new AiError('UPSTREAM_HTTP_FAILURE', 400))]),
      {
        stage: 'INITIAL',
        errorCode: 'CV_MATCH_UNAVAILABLE',
        reasonCode: 'UPSTREAM_HTTP_FAILURE',
        provider: 'gemini',
        upstreamHttpStatus: 400,
        responseStatus: 503,
      },
    ],
    [
      'initial timeout',
      () => setup([fail(new AiError('TIMEOUT'))]),
      {
        stage: 'INITIAL',
        errorCode: 'CV_MATCH_TIMEOUT',
        reasonCode: 'TIMEOUT',
        provider: 'gemini',
        responseStatus: 504,
      },
    ],
    [
      'initial output limit',
      () => setup([fail(new AiError('OUTPUT_LIMIT_EXCEEDED'))]),
      {
        stage: 'INITIAL',
        errorCode: 'CV_MATCH_UNAVAILABLE',
        reasonCode: 'OUTPUT_LIMIT_EXCEEDED',
        provider: 'gemini',
        responseStatus: 503,
      },
    ],
    [
      'initial connection failure',
      () => setup([fail(new AiError('CONNECTION_FAILURE'))]),
      {
        stage: 'INITIAL',
        errorCode: 'CV_MATCH_UNAVAILABLE',
        reasonCode: 'CONNECTION_FAILURE',
        provider: 'gemini',
        responseStatus: 503,
      },
    ],
    [
      'initial invalid JSON',
      () => setup([() => '{PRIVATE_OUTPUT']),
      {
        stage: 'INITIAL',
        errorCode: 'CV_MATCH_INVALID_OUTPUT',
        reasonCode: 'INVALID_JSON',
        provider: 'gemini',
        responseStatus: 503,
      },
    ],
    [
      'unexpected provider error',
      () => setup([fail(new Error('PRIVATE_RAW_MESSAGE'))]),
      {
        stage: 'INITIAL',
        errorCode: 'CV_MATCH_UNAVAILABLE',
        reasonCode: 'UNKNOWN',
        provider: 'gemini',
        responseStatus: 503,
      },
    ],
    [
      'completion exhausted 503',
      () =>
        setup([
          () => reply(partial),
          fail(new AiError('UPSTREAM_HTTP_FAILURE', 503)),
        ]),
      {
        stage: 'COMPLETION',
        errorCode: 'CV_MATCH_UNAVAILABLE',
        reasonCode: 'UPSTREAM_HTTP_FAILURE',
        provider: 'gemini',
        upstreamHttpStatus: 503,
        responseStatus: 503,
      },
    ],
    [
      'completion with the wrong item count',
      () => setup([() => reply(partial), () => reply([rows()[1], rows()[1]])]),
      {
        stage: 'COMPLETION',
        errorCode: 'CV_MATCH_INCOMPLETE',
        reasonCode: 'COMPLETION_COUNT',
        provider: 'gemini',
        responseStatus: 503,
        counts: { missing: 1, returned: 2 },
      },
    ],
    [
      'Ollama omission',
      () => setup([() => reply(partial)], { provider: 'ollama' }),
      {
        stage: 'OUTPUT_VALIDATION',
        errorCode: 'CV_MATCH_INCOMPLETE',
        reasonCode: 'REQUIREMENTS_UNLINKED',
        provider: 'ollama',
        responseStatus: 503,
        counts: { canonical: 2, returned: 2, unlinked: 1 },
      },
    ],
    [
      'unknown component',
      () =>
        setup([
          () =>
            reply(
              rows((row) =>
                row.requirement === pairs
                  ? { components: components(dockerLine, 'c9') }
                  : {},
              ),
            ),
        ]),
      {
        stage: 'OUTPUT_VALIDATION',
        errorCode: 'CV_MATCH_INVALID_OUTPUT',
        reasonCode: 'COMPONENT_UNKNOWN',
        provider: 'gemini',
        responseStatus: 503,
        counts: { requirementIndex: 1 },
      },
    ],
    [
      'JD quote not verbatim',
      () =>
        setup([
          () =>
            reply([
              ...rows(),
              {
                ...rows()[0]!,
                requirement: 'PRIVATE_EXTRA',
                jdQuote: 'PRIVATE_NOT_IN_JD',
                parentId: undefined,
              },
            ]),
        ]),
      {
        ...evidence,
        reasonCode: 'JD_QUOTE_NOT_VERBATIM',
        counts: { requirementIndex: 2, returned: 3 },
      },
    ],
    [
      'JD quote empty',
      () =>
        setup([
          () =>
            reply([
              ...rows(),
              { ...rows()[0]!, jdQuote: ' ', parentId: undefined },
            ]),
        ]),
      {
        ...evidence,
        reasonCode: 'JD_QUOTE_EMPTY',
        counts: { requirementIndex: 2, returned: 3 },
      },
    ],
    [
      'component quote not in CV',
      () =>
        setup([
          () =>
            reply(
              rows((row) =>
                row.requirement === pairs
                  ? {
                      components: components(
                        'Ran PRIVATE_FAKE Docker clusters.',
                      ),
                    }
                  : {},
              ),
            ),
        ]),
      {
        ...evidence,
        reasonCode: 'COMPONENT_CV_QUOTE_NOT_IN_CV',
        counts: { requirementIndex: 1 },
      },
    ],
    [
      'component quote not an allowed passage',
      () =>
        setup([
          () =>
            reply(
              rows((row) =>
                row.requirement === pairs
                  ? { components: components('services with Docker.') }
                  : {},
              ),
            ),
        ]),
      {
        ...evidence,
        reasonCode: 'COMPONENT_CV_QUOTE_NOT_ALLOWED_PASSAGE',
        counts: { requirementIndex: 1 },
      },
    ],
    [
      'no verifiable CV quote',
      () =>
        setup([
          () =>
            reply(
              rows((row) => ({
                cvQuote:
                  row.requirement === 'Kafka' ? 'consuming Kafka topics.' : '',
                ...(row.requirement === pairs
                  ? {
                      cvQuote: 'PRIVATE_FAKE_QUOTE',
                      components: components(''),
                    }
                  : {}),
              })),
            ),
        ]),
      {
        ...evidence,
        reasonCode: 'NO_VERIFIABLE_CV_QUOTES',
        counts: {
          returned: 2,
          unverified: 2,
          notAllowedPassage: 1,
          notInCv: 1,
        },
      },
    ],
    [
      'CV or job changed during analysis',
      () =>
        setup([() => reply(rows())], {
          laterJob: { ...job, updatedAt: new Date('2026-11-02T00:00:00Z') },
        }),
      {
        stage: 'SOURCE_VERIFICATION',
        errorCode: 'NONE',
        reasonCode: 'SOURCE_CHANGED',
        provider: 'gemini',
        responseStatus: 409,
      },
    ],
    [
      'persistence failure',
      () =>
        setup([() => reply(rows())], {
          persist: async () => {
            throw new Error('PRIVATE_DB_MESSAGE');
          },
        }),
      {
        stage: 'PERSISTENCE',
        errorCode: 'NONE',
        reasonCode: 'UNKNOWN',
        provider: 'gemini',
        responseStatus: 503,
      },
    ],
  ])('%s', async (_, service, expected) => {
    expect(await failure(service())).toEqual(expected);
  });

  test('an analysis already running is classified', async () => {
    let release!: () => void;
    const service = setup([
      () =>
        new Promise<string>(
          (resolve) => (release = () => resolve(reply(rows()))),
        ),
    ]);
    const first = service.analyze('synthetic');
    await new Promise((resolve) => setImmediate(resolve));
    expect(await failure(service)).toMatchObject({
      stage: 'SETUP',
      reasonCode: 'ANALYSIS_ALREADY_RUNNING',
      responseStatus: 409,
    });
    release();
    await first;
  });

  test('success writes no failure event', async () => {
    expect(await events(setup([() => reply(rows())]))).toEqual([]);
  });

  test('with detailed diagnostics on, still exactly one failure event', async () => {
    configureCvMatchDiagnostics(true);
    const lines = await events(
      setup([
        () =>
          reply([
            ...rows(),
            {
              ...rows()[0]!,
              jdQuote: 'PRIVATE_NOT_IN_JD',
              requirement: 'PRIVATE_X',
              parentId: undefined,
            },
          ]),
      ]),
    );
    expect(
      lines.filter((line) => line.event === 'CV_MATCH_FAILURE'),
    ).toHaveLength(1);
    expect(lines.map((line) => line.event)).toContain(
      'CV_MATCH_EVIDENCE_REJECTED',
    );
  });
});

test('internal reason and counts never reach the HTTP response body', () => {
  const plain = new CvMatchError('CV_MATCH_EVIDENCE_REJECTED');
  const detailed = new CvMatchError(
    'CV_MATCH_EVIDENCE_REJECTED',
    'NO_VERIFIABLE_CV_QUOTES',
    { returned: 1 },
  );
  expect(detailed.getResponse()).toEqual(plain.getResponse());
  expect(detailed.getStatus()).toBe(plain.getStatus());
  expect(detailed.message).toBe(plain.message);
});
