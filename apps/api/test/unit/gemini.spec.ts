import 'reflect-metadata';
import { afterEach, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { aiConfig, GEMINI_MODEL } from '../../src/ai/ai.config.js';
import { AiModule } from '../../src/ai/ai.module.js';
import { AiService } from '../../src/ai/ai.service.js';
import {
  GeminiProvider,
  GEMINI_MAX_OUTPUT_TOKENS,
  geminiSchema,
} from '../../src/ai/gemini.provider.js';
import { OllamaProvider } from '../../src/ai/ollama.provider.js';
import { MAX_RESPONSE_BYTES } from '../../src/ai/ollama.provider.js';
import {
  CV_OUTPUT_SCHEMA,
  JD_OUTPUT_SCHEMA,
} from '../../src/extraction/extraction.schemas.js';
import { PARTIAL_ENVELOPE_SCHEMA } from '../../src/extraction/partial-proposal.contract.js';
import { JOB_QUESTIONS_SCHEMA } from '../../src/interview-prep/job-questions.policy.js';
import {
  EXPRESS_SCHEMA,
  REVIEW_SCHEMA,
} from '../../src/interview-prep/interview-prep.policy.js';
import { MATCH_SCHEMA } from '../../src/matching/cv-match.js';
import { IMPORT_SCHEMA } from '../../src/opportunities/job-import.contract.js';
import {
  draftModelProvenance,
  draftModelSupported,
} from '../../src/tailored-cv/tailored-draft.service.js';

const KEY = 'synthetic-test-key-0123456789abcdef';
const geminiEnv = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: KEY };
const config = aiConfig(geminiEnv);
const schema = {
  type: 'object',
  properties: { name: { type: ['string', 'null'] } },
  required: ['name'],
  additionalProperties: false,
};
const input = { prompt: 'Synthetic fixture', schema };
const envelope = (candidate: unknown) =>
  new Response(JSON.stringify({ candidates: [candidate], usageMetadata: {} }), {
    status: 200,
  });
const stop = (text: string) => ({
  finishReason: 'STOP',
  content: { role: 'model', parts: [{ text }] },
});
const mockFetch = () => jest.spyOn(globalThis, 'fetch');

afterEach(() => {
  jest.restoreAllMocks();
});

test('Ollama stays the default provider and Gemini is selected explicitly', async () => {
  const resolve = async (env: NodeJS.ProcessEnv) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const ref = await Test.createTestingModule({
        imports: [AiModule],
      }).compile();
      return ref.get(AI_PROVIDER);
    } finally {
      process.env = saved;
    }
  };
  expect(aiConfig({}).provider).toBe('ollama');
  expect(await resolve({ AI_PROVIDER: 'ollama' })).toBeInstanceOf(
    OllamaProvider,
  );
  expect(await resolve(geminiEnv)).toBeInstanceOf(GeminiProvider);
});

test('Gemini config pins the model and keeps the key out of serialization', () => {
  expect(config).toMatchObject({
    provider: 'gemini',
    model: GEMINI_MODEL,
    baseUrl: 'https://generativelanguage.googleapis.com',
  });
  expect(JSON.stringify(config)).not.toContain(KEY);
  expect(Object.keys(config)).not.toContain('apiKey');
  expect(() => aiConfig({ AI_PROVIDER: 'gemini' })).toThrow('GEMINI_API_KEY');
  expect(() => aiConfig({ ...geminiEnv, GEMINI_API_KEY: `${KEY} ` })).toThrow(
    'GEMINI_API_KEY',
  );
  expect(() =>
    aiConfig({ ...geminiEnv, GEMINI_MODEL: 'gemini-3.5-flash' }),
  ).toThrow('GEMINI_MODEL');
  expect(() => aiConfig({ ...geminiEnv, AI_REQUEST_TIMEOUT_MS: '0' })).toThrow(
    'AI_REQUEST_TIMEOUT_MS',
  );
});

test('sends one bounded structured-output request and returns validated JSON', async () => {
  const fetch = mockFetch().mockResolvedValue(envelope(stop('{"name":"Ada"}')));
  const result = await new AiService(
    new GeminiProvider(config),
  ).generateStructured(input);
  expect(result).toEqual({ name: 'Ada' });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  );
  expect(init!.redirect).toBe('error');
  expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
  expect(String(url)).not.toContain(KEY);
  expect(JSON.parse(init!.body as string)).toEqual({
    contents: [{ role: 'user', parts: [{ text: 'Synthetic fixture' }] }],
    generationConfig: {
      temperature: 0,
      candidateCount: 1,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
    },
  });
});

test.each([
  ['CV', CV_OUTPUT_SCHEMA],
  ['JD', JD_OUTPUT_SCHEMA],
  ['partial envelope', PARTIAL_ENVELOPE_SCHEMA],
  ['match', MATCH_SCHEMA],
  ['job import', IMPORT_SCHEMA],
  ['job questions', JOB_QUESTIONS_SCHEMA],
  ['express', EXPRESS_SCHEMA],
  ['review', REVIEW_SCHEMA],
])(
  'forwards the production %s schema without maxItems and still validates the full schema',
  async (_name, production) => {
    const fetch = mockFetch().mockResolvedValue(envelope(stop('{"x":1}')));
    await expect(
      new AiService(new GeminiProvider(config)).generateStructured({
        prompt: 'Synthetic fixture',
        schema: production,
      }),
    ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILURE' });
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    const sent = JSON.stringify(body.generationConfig.responseJsonSchema);
    expect(sent).not.toContain('maxItems');
    expect(body.generationConfig.responseJsonSchema).toEqual(
      geminiSchema(production),
    );
    expect(sent.length).toBeGreaterThan(50);
  },
);

test.each([
  [
    'truncated output',
    () => envelope({ ...stop('{"name":'), finishReason: 'MAX_TOKENS' }),
    'OUTPUT_LIMIT_EXCEEDED',
  ],
  [
    'safety block',
    () => envelope({ finishReason: 'SAFETY' }),
    'MALFORMED_RESPONSE',
  ],
  [
    'blocked prompt',
    () =>
      new Response(
        JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }),
      ),
    'MALFORMED_RESPONSE',
  ],
  [
    'non-text part',
    () =>
      envelope({
        finishReason: 'STOP',
        content: { parts: [{ inlineData: {} }] },
      }),
    'MALFORMED_RESPONSE',
  ],
  ['non-JSON envelope', () => new Response('<html>'), 'MALFORMED_RESPONSE'],
  [
    'oversized response',
    () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    'RESPONSE_TOO_LARGE',
  ],
])('rejects %s', async (_name, response, code) => {
  mockFetch().mockResolvedValue(response());
  await expect(
    new GeminiProvider(config).generate(input),
  ).rejects.toMatchObject({ code });
});

test('output exceeding an omitted maxItems still fails full validation', async () => {
  const limited = {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'integer' }, maxItems: 2 },
    },
    required: ['items'],
    additionalProperties: false,
  };
  mockFetch().mockResolvedValue(envelope(stop('{"items":[1,2,3]}')));
  await expect(
    new AiService(new GeminiProvider(config)).generateStructured({
      prompt: 'Synthetic fixture',
      schema: limited,
    }),
  ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILURE' });
  expect(geminiSchema(limited)).toEqual({
    ...limited,
    properties: { items: { type: 'array', items: { type: 'integer' } } },
  });
});

test('maps upstream errors without exposing their body', async () => {
  mockFetch().mockResolvedValue(
    new Response(`quota exceeded for ${KEY} prompt Synthetic fixture`, {
      status: 429,
    }),
  );
  const error = await new GeminiProvider(config).generate(input).then(
    () => new Error('resolved'),
    (e: unknown) => e as Error,
  );
  expect(error).toMatchObject({ code: 'UPSTREAM_HTTP_FAILURE' });
  expect(error.message).not.toMatch(/quota|Synthetic|synthetic-test-key/);
});

test('maps transport failures and skips thought parts', async () => {
  mockFetch().mockRejectedValueOnce(new TypeError('fetch failed'));
  await expect(
    new GeminiProvider(config).generate(input),
  ).rejects.toMatchObject({ code: 'CONNECTION_FAILURE' });
  mockFetch().mockResolvedValue(
    envelope({
      finishReason: 'STOP',
      content: { parts: [{ text: 'thinking', thought: true }, { text: '{}' }] },
    }),
  );
  await expect(new GeminiProvider(config).generate(input)).resolves.toBe('{}');
});

test('times out a transport that ignores abort, at the partial deadline', async () => {
  const fetch = mockFetch().mockReturnValue(new Promise<Response>(() => {}));
  const controller = new AbortController();
  await expect(
    new GeminiProvider(config).generate({
      ...input,
      partial: { signal: controller.signal, deadline: performance.now() + 20 },
    }),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
});

test('refuses already-expired partial work without calling the API', async () => {
  const fetch = mockFetch();
  const controller = new AbortController();
  controller.abort();
  await expect(
    new GeminiProvider(config).generate({
      ...input,
      partial: {
        signal: controller.signal,
        deadline: performance.now() + 5000,
      },
    }),
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(fetch).not.toHaveBeenCalled();
});

test('each provider refuses the other provider config without network', async () => {
  const fetch = mockFetch();
  await expect(
    new OllamaProvider(config).generate(input),
  ).rejects.toMatchObject({ code: 'CONTEXT_UNVERIFIED' });
  await expect(
    new GeminiProvider(aiConfig({})).generate(input),
  ).rejects.toMatchObject({ code: 'CONTEXT_UNVERIFIED' });
  expect(fetch).not.toHaveBeenCalled();
});

test('tailored drafts gate on the pinned model and record provider provenance', () => {
  const ollama = aiConfig({});
  expect(draftModelSupported(ollama)).toBe(true);
  expect(draftModelSupported(config)).toBe(true);
  expect(draftModelSupported(aiConfig({ OLLAMA_MODEL: 'llama3:8b' }))).toBe(
    false,
  );
  expect(draftModelSupported({ ...config, model: 'gemini-x' })).toBe(false);
  expect(draftModelProvenance(ollama)).toEqual({
    provider: 'ollama',
    model: 'qwen3:4b',
    modelDigest:
      '359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7',
  });
  expect(draftModelProvenance(config)).toEqual({
    provider: 'gemini',
    model: GEMINI_MODEL,
    modelDigest: null,
  });
});
