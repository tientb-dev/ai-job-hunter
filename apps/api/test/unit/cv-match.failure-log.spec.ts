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
import {
  configureCvMatchDiagnostics,
  emitMatchFailure,
} from '../../src/matching/cv-match.diagnostics.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import {
  canonicalRequirements,
  completionRejection,
  validateMatchAssessment,
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
// Allowed passages are at most 3 consecutive lines; this quote spans 4.
const cv5 = [cvText, '- Wrote tests.', '- Reviewed code.'].join('\n');
const fourLines = `${kafkaLine} ${dockerLine} - Wrote tests. - Reviewed code.`;
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
        setup(
          [
            () =>
              reply(
                rows((row) =>
                  row.requirement === pairs
                    ? { components: components(fourLines) }
                    : {},
                ),
              ),
          ],
          { cv: cv5 },
        ),
      {
        ...evidence,
        reasonCode: 'COMPONENT_CV_QUOTE_NOT_ALLOWED_PASSAGE',
        counts: { requirementIndex: 1, spannedLines: 4 },
      },
    ],
    [
      'no verifiable CV quote',
      () =>
        setup(
          [
            () =>
              reply(
                rows((row) => ({
                  cvQuote: row.requirement === 'Kafka' ? fourLines : '',
                  ...(row.requirement === pairs
                    ? {
                        cvQuote: 'PRIVATE_FAKE_QUOTE',
                        components: components(''),
                      }
                    : {}),
                })),
              ),
          ],
          { cv: cv5 },
        ),
      {
        ...evidence,
        reasonCode: 'NO_VERIFIABLE_CV_QUOTES',
        counts: {
          returned: 2,
          unverified: 2,
          toolingRejected: 0,
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

  test('an ambiguous Gemini component quote is dropped without a failure event', async () => {
    const service = setup([
      () =>
        reply(
          rows((row) =>
            row.requirement === pairs
              ? { components: components('services') }
              : {},
          ),
        ),
    ]);
    expect(await events(service)).toEqual([]);
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

// Three requirements so a completion can be asked for two of them.
const job3 = {
  ...job,
  skills: `Kafka\nRedis\n${pairs}`,
  description: `Requirements: Kafka. Redis. ${pairs}.\nPRIVATE_JD_SENTINEL`,
} as Opportunity;
const [kafka3, redis3, pairs3] = canonicalRequirements(job3) as [
  MatchRequirement,
  MatchRequirement,
  MatchRequirement,
];
const first3 = () =>
  reply([{ ...kafka3, parentId: undefined, cvQuote: kafkaLine }]);
const withComponents = (list: NonNullable<MatchRequirement['components']>) =>
  rows((row) => (row.requirement === pairs ? { components: list } : {}));
const [c1, c2] = components(dockerLine) as [
  ReturnType<typeof components>[number],
  ReturnType<typeof components>[number],
];
const validation = (reasonCode: string, requirementIndex: number) => ({
  stage: 'OUTPUT_VALIDATION',
  errorCode: 'CV_MATCH_INVALID_OUTPUT',
  reasonCode,
  provider: 'gemini',
  responseStatus: 503,
  counts: { requirementIndex },
});
const completion = (reasonCode: string, missing: number, returned: number) => ({
  stage: 'COMPLETION',
  errorCode: 'CV_MATCH_INCOMPLETE',
  reasonCode,
  provider: 'gemini',
  responseStatus: 503,
  counts: { missing, returned },
});

describe('remaining reason codes through analyze()', () => {
  test.each<[string, () => JobMatchService, Record<string, unknown>]>([
    [
      'PARENT_ID_UNLINKED',
      () =>
        setup([
          () =>
            reply([
              ...rows(),
              {
                ...rows()[0]!,
                requirement: 'PRIVATE_EXTRA',
                jdQuote: 'Kafka',
                parentId: 'p9',
              },
            ]),
        ]),
      validation('PARENT_ID_UNLINKED', 2),
    ],
    [
      'COMPONENT_DUPLICATE',
      () => setup([() => reply(withComponents([c1, c1]))]),
      validation('COMPONENT_DUPLICATE', 1),
    ],
    [
      'COMPONENT_JD_SPAN_MISMATCH',
      () =>
        setup([
          () => reply(withComponents([{ ...c1, jdQuote: 'PRIVATE_SPAN' }, c2])),
        ]),
      validation('COMPONENT_JD_SPAN_MISMATCH', 1),
    ],
    [
      'COMPLETION_DUPLICATE_ID',
      () =>
        setup(
          [
            first3,
            () =>
              reply([
                { ...redis3, cvQuote: '' },
                { ...redis3, cvQuote: 'PRIVATE_DUP' },
              ]),
          ],
          { savedJob: job3 },
        ),
      completion('COMPLETION_DUPLICATE_ID', 2, 2),
    ],
    [
      'COMPLETION_TEXT_MISMATCH',
      () =>
        setup(
          [
            first3,
            () =>
              reply([
                { ...redis3, cvQuote: '' },
                {
                  ...pairs3,
                  requirement: 'PRIVATE_LABEL',
                  jdQuote: 'Kafka',
                  cvQuote: '',
                },
              ]),
          ],
          { savedJob: job3 },
        ),
      completion('COMPLETION_TEXT_MISMATCH', 2, 2),
    ],
  ])('%s', async (_, service, expected) => {
    expect(await failure(service())).toEqual(expected);
  });

  test('an invented completion id is stopped earlier by the completion schema', async () => {
    // The parentId enum makes COMPLETION_UNKNOWN_ID unreachable via a provider.
    const service = setup(
      [
        first3,
        () =>
          reply([
            { ...redis3, cvQuote: '' },
            { ...pairs3, parentId: 'p9', cvQuote: '' },
          ]),
      ],
      { savedJob: job3 },
    );
    expect(await failure(service)).toEqual({
      stage: 'COMPLETION',
      errorCode: 'CV_MATCH_INVALID_OUTPUT',
      reasonCode: 'SCHEMA_VALIDATION_FAILURE',
      provider: 'gemini',
      responseStatus: 503,
    });
  });
});

describe('reason codes not reachable through analyze() inputs', () => {
  const lines = (error: unknown, stage: 'VALIDATION' | 'COMPLETION') => {
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    emitMatchFailure(error, { stage }, 'gemini', 0);
    const out = write.mock.calls.map(([line]) => String(line));
    write.mockRestore();
    expect(out).toHaveLength(1);
    expect(out.join('')).not.toMatch(/PRIVATE/u);
    const { durationMs, ...rest } = JSON.parse(out[0]!) as Record<
      string,
      unknown
    >;
    expect(durationMs).toBe(0);
    return rest;
  };
  const thrown = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error('expected a failure');
  };

  test('COMPONENT_JD_QUOTE_NOT_IN_JD', () => {
    // analyze() always includes each canonical clause in the JD text, so this
    // check is exercised with a JD that omits the component span.
    const error = thrown(() =>
      validateMatchAssessment(
        withComponents([c1, c2]),
        cvText,
        `Kafka\n${pairs.replace('Kubernetes', 'PRIVATE')}`,
        canonical,
      ),
    );
    expect(lines(error, 'VALIDATION')).toEqual({
      event: 'CV_MATCH_FAILURE',
      stage: 'EVIDENCE_VALIDATION',
      errorCode: 'CV_MATCH_EVIDENCE_REJECTED',
      reasonCode: 'COMPONENT_JD_QUOTE_NOT_IN_JD',
      provider: 'gemini',
      responseStatus: 503,
      counts: { requirementIndex: 1 },
    });
  });

  test('COMPLETION_UNKNOWN_ID', () => {
    const missing = [redis3, pairs3];
    const items = [redis3, { ...pairs3, parentId: undefined }];
    const reason = completionRejection(items, missing);
    expect(reason).toBe('UNKNOWN_ID');
    expect(
      lines(
        new CvMatchError('CV_MATCH_INCOMPLETE', `COMPLETION_${reason!}`, {
          missing: 2,
          returned: 2,
        }),
        'COMPLETION',
      ),
    ).toEqual({
      event: 'CV_MATCH_FAILURE',
      ...completion('COMPLETION_UNKNOWN_ID', 2, 2),
    });
  });

  test('AI-tooling quotes are counted separately in NO_VERIFIABLE_CV_QUOTES', () => {
    const production = 'Production AI/ML model development';
    const quote = 'Used Cursor for coding. PRIVATE_TOOL';
    const seed: MatchRequirement = {
      requirement: production,
      priority: 'required',
      category: 'skill',
      jdQuote: production,
      cvQuote: '',
    };
    const error = thrown(() =>
      validateMatchAssessment(
        [
          { ...seed, cvQuote: quote },
          { ...seed, cvQuote: 'PRIVATE_NOT_IN_CV' },
        ],
        quote,
        production,
        [seed],
      ),
    );
    expect(lines(error, 'VALIDATION')).toMatchObject({
      reasonCode: 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT',
      counts: {
        returned: 2,
        unverified: 2,
        toolingRejected: 1,
        notAllowedPassage: 0,
        notInCv: 1,
      },
    });
  });
});
