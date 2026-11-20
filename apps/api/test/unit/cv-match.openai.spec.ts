import 'reflect-metadata';
import { afterEach, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { aiConfig, OPENAI_MODEL } from '../../src/ai/ai.config.js';
import { AiService } from '../../src/ai/ai.service.js';
import { OpenAiProvider } from '../../src/ai/openai.provider.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import type { MatchRequirement } from '../../src/matching/cv-match.js';
import { groupOf } from '../../src/matching/cv-match.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import {
  LOCAL_OWNER_ID,
  type OpportunitiesService,
} from '../../src/opportunities/opportunities.service.js';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { reviewedAsIs } from '../support/reviewed-cv.stub.js';

const jobId = 'synthetic-job';
const date = new Date('2026-01-01');
const apiKey = 'synthetic-openai-cv-match-key';
const response = (text: string) =>
  Response.json({
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text }],
      },
    ],
    usage: {
      input_tokens: 200,
      output_tokens: 50,
      input_tokens_details: { cached_tokens: 10 },
      ignored: 'PRIVATE',
    },
  });
function fixture(text: string, skills: string[], timeoutMs = 2000) {
  const config = aiConfig({
    AI_PROVIDER: 'openai',
    AI_API_KEY: apiKey,
  });
  Object.assign(config, { timeoutMs });
  const matchAi = new AiService(new OpenAiProvider(config));
  const cv = {
    id: 'synthetic-cv',
    text,
    fileName: 'synthetic.txt',
    updatedAt: date,
  };
  let updatedAt = date;
  const job = {
    id: jobId,
    title: 'Synthetic role',
    skills: skills.join('\n'),
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  };
  const rows = memoryMatchRows();
  const service = new JobMatchService(
    {
      findOne: async () => cv,
      findOneBy: async () => cv,
    } as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    matchAi,
    new MatchingService(),
    {
      get: async () => ({ ...job, updatedAt }) as Opportunity,
    } as unknown as OpportunitiesService,
    rows,
    reviewedAsIs(),
    config,
  );
  return {
    analyze: () => service.analyze(LOCAL_OWNER_ID, jobId),
    rows,
    editJob: () => {
      updatedAt = new Date('2026-02-01');
    },
  };
}
function answer(
  init: RequestInit | undefined,
  quotes: Record<string, string>,
  omit?: string,
) {
  const { input } = JSON.parse(String(init?.body)) as { input: string };
  const data = JSON.parse(input.split('\n').at(-1)!) as {
    canonicalRequirements?: MatchRequirement[];
  };
  if (!data.canonicalRequirements) return response('{"items":[]}');
  return response(
    JSON.stringify({
      requirements: data.canonicalRequirements
        .filter((row) => row.requirement !== omit)
        .map((row) => ({
          parentId: row.parentId,
          requirement: row.requirement,
          priority: row.priority,
          category: row.category,
          jdQuote: row.jdQuote,
          cvQuote: quotes[row.requirement] ?? '',
          components:
            groupOf(row).mode === 'AND'
              ? groupOf(row).components.map((c) => ({
                  componentId: c.id,
                  jdQuote: c.jdQuote,
                  cvQuote: quotes[c.label] ?? '',
                }))
              : null,
        })),
    }),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('OpenAI keeps documented technology evidence separate from duration and SQL practice', async () => {
  const java = '- Developed services with Java and Spring Boot.';
  const vue = '- Built dashboards with Vue.js.';
  const list = 'Java, Spring Boot, Vue.js, SQL Server';
  const duration = 'Có từ 02 năm kinh nghiệm phát triển phần mềm với Java';
  const sql = 'Experience writing SQL queries';
  const f = fixture(
    [
      'EXPERIENCE',
      'Previous role | 2018 - 2022',
      '- Managed internal operations.',
      'Current role',
      java,
      vue,
      'SKILLS',
      list,
    ].join('\n'),
    ['Java', 'Spring Boot', 'Vue.js', duration, sql, 'Kafka'],
  );
  const transport = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_url, init) =>
      answer(init, {
        Java: java,
        'Spring Boot': java,
        'Vue.js': vue,
        [duration]: java,
        [sql]: list,
      }),
    );
  const logged = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const saved = await f.analyze();
  const rows = new Map(saved.requirements.map((row) => [row.requirement, row]));
  for (const skill of ['Java', 'Spring Boot', 'Vue.js']) {
    expect(rows.get(skill)).toMatchObject({
      status: 'EVIDENCED',
      cvOrigin: 'source',
    });
  }
  for (const requirement of [duration, sql, 'Kafka']) {
    expect(rows.get(requirement)).toBeDefined();
    expect(rows.get(requirement)?.status).not.toBe('EVIDENCED');
  }
  const wire = JSON.parse(
    String(transport.mock.calls.at(-1)?.[1]?.body),
  ) as unknown;
  expect(wire).toMatchObject({
    model: OPENAI_MODEL,
    max_output_tokens: 16384,
    text: {
      format: {
        strict: true,
        schema: {
          properties: {
            requirements: {
              items: {
                required: expect.arrayContaining(['parentId', 'components']),
                properties: {
                  cvQuote: { type: 'string' },
                  components: {
                    anyOf: expect.arrayContaining([{ type: 'null' }]),
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  expect(await f.rows.findOneBy({ matchId: saved.matchId })).not.toBeNull();
  const log = logged.mock.calls.map(([line]) => String(line)).join('');
  expect(log).toContain('CV_MATCH_PROVIDER_TIMING');
  expect(log).toContain(OPENAI_MODEL);
  expect(log).toContain('"input_tokens":200');
  expect(log).toContain('"stage":"ANALYSIS"');
  for (const privateValue of [java, vue, list, duration, apiKey, 'PRIVATE'])
    expect(log).not.toContain(privateValue);
});

test('OpenAI preserves non-IT partial coverage and drops fabricated cross-entry quotes', async () => {
  const documented =
    'SEO, Google Ads, Facebook Ads, Content Marketing, Google Analytics';
  const analytics = 'Experience with Google Analytics';
  const unrelated = '- Coordinated in-store events.';
  const f = fixture(
    ['Skills', documented, 'Experience', 'Project: Events', unrelated].join(
      '\n',
    ),
    [analytics, 'In-store events', 'Graphic design'],
  );
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) =>
    answer(init, {
      [analytics]: documented,
      'In-store events': documented + '\n' + unrelated,
    }),
  );
  const saved = await f.analyze();
  expect(
    saved.requirements.find((row) => row.requirement === analytics),
  ).toMatchObject({
    status: 'PARTIAL',
  });
  expect(
    saved.requirements.find((row) => row.requirement === 'In-store events')
      ?.cvQuote,
  ).not.toBe(documented + '\n' + unrelated);
  expect(
    saved.requirements.find((row) => row.requirement === 'Graphic design'),
  ).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
});

test('OpenAI invalid output, overload, timeout and stale context preserve the saved match', async () => {
  const text = '- Built Java services.';
  const f = fixture(text, ['Java'], 100);
  const call = (_url: Parameters<typeof fetch>[0], init?: RequestInit) =>
    Promise.resolve(answer(init, { Java: text }));
  const transport = jest.spyOn(globalThis, 'fetch').mockImplementation(call);
  const saved = await f.analyze();
  const prior = structuredClone(
    await f.rows.findOneBy({ matchId: saved.matchId }),
  );
  transport.mockResolvedValueOnce(response('{"requirements":[]}'));
  await expect(f.analyze()).rejects.toMatchObject({
    errorCode: 'CV_MATCH_INVALID_OUTPUT',
  });
  transport.mockImplementation(
    async () =>
      new Response(null, { status: 503, headers: { 'Retry-After': '0' } }),
  );
  const before = transport.mock.calls.length;
  await expect(f.analyze()).rejects.toMatchObject({
    errorCode: 'CV_MATCH_PROVIDER_BUSY',
  });
  expect(transport.mock.calls.length - before).toBe(3);
  transport.mockImplementation(() => new Promise(() => {}));
  await expect(f.analyze()).rejects.toMatchObject({
    errorCode: 'CV_MATCH_TIMEOUT',
  });
  expect(transport.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true);
  transport.mockImplementation((url, init) => {
    f.editJob();
    return call(url, init);
  });
  await expect(f.analyze()).rejects.toMatchObject({ status: 409 });
  expect(await f.rows.findOneBy({ matchId: saved.matchId })).toEqual(prior);
});

test('OpenAI uses the existing hosted completion path for an omitted requirement', async () => {
  const java = '- Built Java services.';
  const vue = '- Built dashboards with Vue.js.';
  const f = fixture(`${java}\n${vue}`, ['Java', 'Vue.js']);
  const transport = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementationOnce(async (_url, init) =>
      answer(init, { Java: java }, 'Vue.js'),
    )
    .mockImplementationOnce(async (_url, init) =>
      answer(init, { 'Vue.js': vue }),
    );
  const saved = await f.analyze();
  expect(saved.requirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ requirement: 'Java', status: 'EVIDENCED' }),
      expect.objectContaining({ requirement: 'Vue.js', status: 'EVIDENCED' }),
    ]),
  );
  expect(transport).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body))).toMatchObject({
    input: expect.stringContaining('Completion request:'),
    text: {
      format: {
        strict: true,
        schema: {
          properties: {
            requirements: {
              items: {
                properties: {
                  parentId: {
                    enum: [
                      saved.requirements.find(
                        (row) => row.requirement === 'Vue.js',
                      )!.parentId,
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  });
});
