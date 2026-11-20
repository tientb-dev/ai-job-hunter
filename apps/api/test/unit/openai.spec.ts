import 'reflect-metadata';
import { afterEach, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { AI_CONFIG, aiConfig, OPENAI_MODEL } from '../../src/ai/ai.config.js';
import { AiModule } from '../../src/ai/ai.module.js';
import { AiService } from '../../src/ai/ai.service.js';
import { AiUsageService } from '../../src/ai/ai-usage.js';
import { GeminiProvider } from '../../src/ai/gemini.provider.js';
import { OpenAiProvider } from '../../src/ai/openai.provider.js';
import { TailoredDraftGenerator } from '../../src/tailored-cv/tailored-draft.generator.js';
import {
  draftModelProvenance,
  draftModelSupported,
} from '../../src/tailored-cv/tailored-draft.service.js';
import { draftInput } from '../support/tailored-draft-fixtures.js';

const env = {
  AI_PROVIDER: 'openai',
  AI_API_KEY: 'synthetic-openai-api-key',
};
const config = aiConfig(env);
const client = new AiService(new OpenAiProvider(config));
const request = {
  prompt: 'Synthetic prompt',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: { type: 'string', maxLength: 8 },
      verify: { type: 'string' },
    },
  },
};
const completed = (text: string) =>
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
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens_details: { reasoning_tokens: 0 },
      private: 'ignored',
    },
  });
const partial = (ms = 5000, signal = new AbortController().signal) => ({
  signal,
  deadline: performance.now() + ms,
  onProviderTiming: jest.fn(),
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('one hosted adapter and usage limiter serve every workflow', async () => {
  const saved = process.env;
  const run = jest.fn((send: () => Promise<unknown>) => send());
  const transport = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => completed('{"text":"ok"}'));
  try {
    for (const [provider, adapter] of [
      ['openai', OpenAiProvider],
      ['gemini', GeminiProvider],
    ] as const) {
      process.env = { ...saved, ...env, AI_PROVIDER: provider };
      const module = await Test.createTestingModule({ imports: [AiModule] })
        .overrideProvider(AiUsageService)
        .useValue({ run })
        .compile();
      try {
        expect(module.get(AI_PROVIDER)).toBeInstanceOf(adapter);
        expect(module.get(AI_CONFIG)).not.toHaveProperty('apiKey');
        if (provider === 'openai') {
          for (const workflow of [
            'cv-match',
            'tailored-cv',
            'interview-review',
          ]) {
            await expect(
              module
                .get(AiService)
                .generateStructured({ ...request, workflow }),
            ).resolves.toEqual({ text: 'ok' });
          }
        }
      } finally {
        await module.close();
      }
    }
    expect(run).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.map(([url]) => url)).toEqual(
      Array(3).fill('https://api.openai.com/v1/responses'),
    );
  } finally {
    process.env = saved;
  }
  expect(() => aiConfig({ AI_PROVIDER: 'openai' })).toThrow('AI_API_KEY');
  expect(JSON.stringify(config)).not.toContain(env.AI_API_KEY);
  expect(draftModelSupported(config)).toBe(true);
  expect(draftModelProvenance(config)).toEqual({
    provider: 'openai',
    model: OPENAI_MODEL,
    modelDigest: null,
  });
});

test('converts optional fields for strict output and keeps application validation', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(completed('{"text":"ok","verify":null}'))
    .mockResolvedValueOnce(
      completed('{"text":"too long for local schema","verify":null}'),
    );
  const execution = partial();
  await expect(
    client.generateStructured({ ...request, partial: execution }),
  ).resolves.toEqual({ text: 'ok' });
  const body: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({
    model: OPENAI_MODEL,
    store: false,
    reasoning: { effort: 'none' },
    max_output_tokens: 4096,
    text: {
      format: {
        strict: true,
        schema: {
          required: ['text', 'verify'],
          additionalProperties: false,
          properties: {
            verify: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
    },
  });
  expect(execution.onProviderTiming).toHaveBeenCalledWith(
    expect.objectContaining({
      attempts: 1,
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        cached_tokens: 20,
        reasoning_tokens: 0,
      },
    }),
  );
  await expect(client.generateStructured(request)).rejects.toMatchObject({
    code: 'SCHEMA_VALIDATION_FAILURE',
  });
});

test('retries temporary rate limits and gateway failures up to three attempts', async () => {
  const headers = { 'Retry-After': '0' };
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: 'rate_limit_exceeded' } },
        { status: 429, headers },
      ),
    )
    .mockImplementation(
      async () => new Response(null, { status: 504, headers }),
    );
  await expect(client.generateStructured(request)).rejects.toMatchObject({
    code: 'UPSTREAM_HTTP_FAILURE',
    httpStatus: 504,
    attempts: 3,
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([401, 403, 429])(
  'does not retry terminal HTTP %s or expose private errors',
  async (status) => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          { error: { code: 'insufficient_quota', message: 'private' } },
          { status },
        ),
      );
    await expect(client.generateStructured(request)).rejects.toMatchObject({
      code: 'UPSTREAM_HTTP_FAILURE',
      httpStatus: status,
      attempts: 1,
      message: 'AI provider returned an unsuccessful HTTP status',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

test('honors the deadline even if fetch ignores abort, and skips expired work', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => new Promise(() => {}));
  const expired = partial(-1);
  await expect(
    client.generateStructured({ ...request, partial: expired }),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(fetch).not.toHaveBeenCalled();
  const execution = partial(30);
  await expect(
    client.generateStructured({ ...request, partial: execution }),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(execution.onProviderTiming).toHaveBeenCalledWith(
    expect.objectContaining({ attempts: 1, timeout: 'overall' }),
  );
  expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

test('aborts retry waits and refuses Retry-After outside the deadline', async () => {
  const controller = new AbortController();
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () =>
        new Response(null, { status: 503, headers: { 'Retry-After': '1' } }),
    );
  await expect(
    client.generateStructured({ ...request, partial: partial(500) }),
  ).rejects.toMatchObject({
    code: 'UPSTREAM_HTTP_FAILURE',
    attempts: 1,
  });
  const execution = partial(5000, controller.signal);
  const generation = client.generateStructured({
    ...request,
    partial: execution,
  });
  setTimeout(() => controller.abort(), 15);
  await expect(generation).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('rejects refusals, incomplete output and invalid JSON', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'private' }],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { output_tokens: 9 },
      }),
    )
    .mockResolvedValueOnce(completed('not JSON'));
  await expect(client.generateStructured(request)).rejects.toMatchObject({
    code: 'MALFORMED_RESPONSE',
  });
  const execution = partial();
  await expect(
    client.generateStructured({ ...request, partial: execution }),
  ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT_EXCEEDED' });
  expect(execution.onProviderTiming).toHaveBeenCalledWith(
    expect.objectContaining({ usage: { output_tokens: 9 } }),
  );
  await expect(client.generateStructured(request)).rejects.toMatchObject({
    code: 'INVALID_JSON',
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('Tailored CV keeps reviewed marketing evidence and rejects foreign fact IDs', async () => {
  const source = '• Prepared email campaign reports for the marketing team.\n';
  const input = draftInput('email campaign reports', false, source);
  const proposal = {
    factId: 'foreign-entry',
    entryId: 'role-1',
    text: 'Prepared marketing reports.',
    explanation: 'Rephrase the reporting contribution.',
    confirmationAssertion: null,
    requirementIds: ['p1'],
  };
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      completed(
        JSON.stringify({ outcome: 'no_change', proposals: [], questions: [] }),
      ),
    )
    .mockResolvedValueOnce(
      completed(
        JSON.stringify({
          outcome: 'opportunities',
          proposals: [proposal],
          questions: [],
        }),
      ),
    );
  const generator = new TailoredDraftGenerator(client);
  const recheck = jest.fn(async () => {});
  const { document } = await generator.generate(input, recheck);
  const fact = document.sections
    .flatMap((section) => section.entries.flatMap((entry) => entry.facts))
    .find((fact) => fact.id === 'java');
  expect(fact?.acceptedText).toBe(source);
  expect(fact?.proposedWording).toBeNull();
  expect(recheck).toHaveBeenCalledTimes(2);
  await expect(generator.generate(input, recheck)).rejects.toMatchObject({
    errorCode: 'CV_DRAFT_UNSUPPORTED_REFERENCE',
  });
});
