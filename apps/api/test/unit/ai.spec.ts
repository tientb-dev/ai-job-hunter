import 'reflect-metadata';
import { afterEach, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AiService } from '../../src/ai/ai.service.js';
import { AiModule } from '../../src/ai/ai.module.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { aiConfig } from '../../src/ai/ai.config.js';
import { AiError } from '../../src/ai/ai.errors.js';
import {
  OllamaProvider,
  MAX_RESPONSE_BYTES,
} from '../../src/ai/ollama.provider.js';

const schema = {
  type: 'object',
  properties: { name: { type: ['string', 'null'] } },
  required: ['name'],
  additionalProperties: false,
};
const input = { prompt: 'Synthetic fixture', schema };
const config = aiConfig({});
const provider = () => new OllamaProvider(config);
const metadata = {
  model: 'qwen3:4b',
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 20,
  prompt_eval_cached_count: 0,
  eval_count: 1,
};
const envelope = (value: unknown) =>
  new Response(
    JSON.stringify({ ...metadata, response: JSON.stringify(value) }),
  );
// Existing transport/schema tests exercise the final request. Dedicated context tests
// exercise the complete sequence without this fixture routing.
function mockTransport() {
  const final = jest.fn<typeof globalThis.fetch>();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/version') return Response.json({ version: '0.40.10' });
    const model = {
      name: 'qwen3:4b',
      digest:
        '359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7',
      context_length: 8192,
      runner: 'llamacpp',
    };
    if (path === '/api/tags' || path === '/api/ps')
      return Response.json({ models: [model] });
    if (JSON.parse(init!.body as string).options.num_predict === 1)
      return envelope(null);
    return final(url, init);
  });
  return final;
}
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('sends exact Ollama fields and validates nullable output', async () => {
  const fetch = mockTransport().mockResolvedValue(envelope({ name: null }));
  expect(await new AiService(provider()).generateStructured(input)).toEqual({
    name: null,
  });
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:11434/api/generate');
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(options!.body as string)).toEqual({
    model: 'qwen3:4b',
    prompt: input.prompt,
    format: schema,
    stream: false,
    think: false,
    truncate: false,
    shift: false,
    options: { num_ctx: 8192, num_predict: 4096, temperature: 0 },
  });
});

test.each([{ name: 'example' }, { name: null }])(
  'accepts matching output %j',
  async (value) => {
    mockTransport().mockResolvedValue(envelope(value));
    expect(await new AiService(provider()).generateStructured(input)).toEqual(
      value,
    );
  },
);
test.each([{ name: 42 }, {}, { name: 'example', extra: true }])(
  'rejects without coercion/defaulting/removal %j',
  async (value) => {
    mockTransport().mockResolvedValue(envelope(value));
    await expect(
      new AiService(provider()).generateStructured(input),
    ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILURE' });
  },
);
test.each([
  { type: 'string', format: 'email' },
  { type: 'string', default: 'private' },
  { type: 'string', $ref: 'https://example.com/schema' },
  { type: 'string', nullable: true },
  { anyOf: [{ type: 'string' }, { type: 'null' }] },
  { type: ['string', 'number'] },
  { type: 'object', properties: { x: { type: 'string', pattern: '.*' } } },
  { type: 'object', required: ['missing'] },
  { type: 'array', items: [{ type: 'string' }] },
  { type: 'string', minLength: -1 },
  { type: 'string', $async: true },
])('rejects unsupported/invalid schema before HTTP %j', async (invalid) => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(
    new AiService(provider()).generateStructured({ ...input, schema: invalid }),
  ).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
  expect(fetch).not.toHaveBeenCalled();
});
test('supports nested arrays, numeric constraints and nullable properties', async () => {
  const nested = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        score: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      },
      required: ['score'],
      additionalProperties: false,
    },
    maxItems: 2,
  };
  const fetch = mockTransport()
    .mockResolvedValueOnce(envelope([{ score: 0.5 }, { score: null }]))
    .mockResolvedValueOnce(envelope([{ score: 2 }]));
  const service = new AiService(provider());
  expect(
    await service.generateStructured({ ...input, schema: nested }),
  ).toEqual([{ score: 0.5 }, { score: null }]);
  await expect(
    service.generateStructured({ ...input, schema: nested }),
  ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILURE' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
test.each(['not json', '```json\n{}\n```'])(
  'rejects generated invalid JSON',
  async (text) => {
    mockTransport().mockResolvedValue(
      new Response(JSON.stringify({ ...metadata, response: text })),
    );
    await expect(
      new AiService(provider()).generateStructured(input),
    ).rejects.toMatchObject({ code: 'INVALID_JSON' });
  },
);
test.each([
  'not json',
  '{}',
  'null',
  '{"response":42,"done":true}',
  '{"response":"{}","done":false}',
  '{"response":"{}","done":true,"done_reason":"length"}',
  '{"response":"{}","done":true,"error":"private"}',
])('rejects malformed envelope', async (body) => {
  mockTransport().mockResolvedValue(new Response(body));
  await expect(provider().generate(input)).rejects.toMatchObject({
    code: 'MALFORMED_RESPONSE',
  });
});
test.each([400, 404, 429, 500, 503])(
  'sanitizes HTTP %s without reading error payload',
  async (status) => {
    mockTransport().mockResolvedValue(
      new Response('private upstream payload', { status }),
    );
    await expect(provider().generate(input)).rejects.toEqual(
      new AiError('UPSTREAM_HTTP_FAILURE'),
    );
  },
);
test('sanitizes connection failures', async () => {
  mockTransport().mockRejectedValue(new Error('private URL and payload'));
  await expect(provider().generate(input)).rejects.toEqual(
    new AiError('CONNECTION_FAILURE'),
  );
});
test('aborts a pending fetch at deadline', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  mockTransport().mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init!.signal!;
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      }),
  );
  const assertion = expect(provider().generate(input)).rejects.toEqual(
    new AiError('TIMEOUT'),
  );
  await jest.advanceTimersByTimeAsync(config.timeoutMs);
  await assertion;
  expect(signal!.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
test('deadline cancels stalled body reading and permits subsequent recovery', async () => {
  jest.useFakeTimers();
  const cancel = jest.fn<() => void>();
  const fetch = mockTransport()
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
    .mockResolvedValueOnce(envelope({ name: 'recovered' }));
  const service = new AiService(provider());
  const assertion = expect(service.generateStructured(input)).rejects.toEqual(
    new AiError('TIMEOUT'),
  );
  await jest.advanceTimersByTimeAsync(config.timeoutMs);
  await assertion;
  expect(cancel).toHaveBeenCalled();
  expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  expect(await service.generateStructured(input)).toEqual({
    name: 'recovered',
  });
  expect(jest.getTimerCount()).toBe(0);
});
test('enforces cumulative byte limit without trusting Content-Length', async () => {
  const cancel = jest.fn<() => void>();
  mockTransport().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
          controller.enqueue(new Uint8Array(1));
        },
        cancel,
      }),
      { headers: { 'Content-Length': '1' } },
    ),
  );
  await expect(provider().generate(input)).rejects.toEqual(
    new AiError('RESPONSE_TOO_LARGE'),
  );
  expect(cancel).toHaveBeenCalled();
});
test('handles multibyte UTF-8 split across chunks', async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ ...metadata, response: JSON.stringify({ name: 'é' }) }),
  );
  mockTransport().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    ),
  );
  expect(await new AiService(provider()).generateStructured(input)).toEqual({
    name: 'é',
  });
});
test('sanitizes body connection errors', async () => {
  mockTransport().mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('private'));
        },
      }),
    ),
  );
  await expect(provider().generate(input)).rejects.toEqual(
    new AiError('CONNECTION_FAILURE'),
  );
});
test('module initializes without connectivity and supports provider substitution', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  const module = await Test.createTestingModule({ imports: [AiModule] })
    .overrideProvider(AI_PROVIDER)
    .useValue({ generate: async () => '{"name":null}' })
    .compile();
  try {
    await module.init();
    expect(await module.get(AiService).generateStructured(input)).toEqual({
      name: null,
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});
test('configuration defaults and explicit values', () => {
  expect(config).toEqual({
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:4b',
    timeoutMs: 120000,
  });
  expect(
    aiConfig({
      OLLAMA_BASE_URL: 'https://[::1]:11434/',
      OLLAMA_MODEL: 'custom:tag',
      AI_REQUEST_TIMEOUT_MS: '1000',
    }),
  ).toMatchObject({
    baseUrl: 'https://[::1]:11434',
    model: 'custom:tag',
    timeoutMs: 1000,
  });
});
test.each([
  ['AI_PROVIDER', 'openai'],
  ['AI_PROVIDER', ''],
  ['OLLAMA_BASE_URL', 'file:///tmp'],
  ['OLLAMA_BASE_URL', 'http://user:secret@example.com'],
  ['OLLAMA_BASE_URL', 'http://example.com/path'],
  ['OLLAMA_BASE_URL', 'http://example.com/?secret=value'],
  ['OLLAMA_BASE_URL', 'http://example.com/#fragment'],
  ['OLLAMA_BASE_URL', ''],
  ['OLLAMA_MODEL', ''],
  ['OLLAMA_MODEL', ' model '],
  ['AI_REQUEST_TIMEOUT_MS', '999'],
  ['AI_REQUEST_TIMEOUT_MS', '300001'],
  ['AI_REQUEST_TIMEOUT_MS', '1.5'],
  ['AI_REQUEST_TIMEOUT_MS', 'NaN'],
  ['AI_REQUEST_TIMEOUT_MS', ''],
])('rejects invalid configuration %s without echoing value', (key, value) => {
  expect(() => aiConfig({ [key]: value })).toThrow(key);
});

test('accepts a response exactly at the byte limit', async () => {
  const base = JSON.stringify({ ...metadata, response: '{}' });
  const body = base + ' '.repeat(MAX_RESPONSE_BYTES - Buffer.byteLength(base));
  mockTransport().mockResolvedValue(new Response(body));
  expect(await provider().generate(input)).toBe('{}');
});

test('rejects malformed UTF-8 and absent bodies', async () => {
  mockTransport()
    .mockResolvedValueOnce(new Response(new Uint8Array([0xff])))
    .mockResolvedValueOnce(new Response(null));
  await expect(provider().generate(input)).rejects.toEqual(
    new AiError('MALFORMED_RESPONSE'),
  );
  await expect(provider().generate(input)).rejects.toEqual(
    new AiError('MALFORMED_RESPONSE'),
  );
});

test('clears successful request deadline without logging payloads', async () => {
  jest.useFakeTimers();
  const error = jest.spyOn(console, 'error');
  const warn = jest.spyOn(console, 'warn');
  const log = jest.spyOn(console, 'log');
  mockTransport().mockResolvedValue(envelope({ name: 'synthetic' }));
  await new AiService(provider()).generateStructured(input);
  expect(jest.getTimerCount()).toBe(0);
  expect(error).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

test('real module initializes without making an Ollama request', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  const module = await Test.createTestingModule({
    imports: [AiModule],
  }).compile();
  try {
    await module.init();
    expect(module.get(AiService)).toBeInstanceOf(AiService);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});

test.each([
  { type: 'object', required: 'name' },
  { type: 'object', required: [1] },
  { type: 'object', required: null },
  { type: 'object', required: undefined },
  {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name', 'name'],
  },
  { type: 'string', required: [] },
  { type: 'number', minLength: 1 },
  { type: 'string', minimum: 0 },
  { type: 'object', items: { type: 'string' } },
  { type: 'array', properties: {} },
  { type: 'string', additionalProperties: false },
  { type: 'object', properties: null },
  { type: 'object', properties: [] },
  { type: 'object', properties: 'invalid' },
  { type: 'object', properties: { name: null } },
  { type: 'object', properties: { name: true } },
  { type: 'array', items: null },
  { type: 'array', items: 'string' },
  { type: 'array', items: true },
  { type: 'array', items: {} },
  { type: 'array', items: { type: 'string', format: 'email' } },
  {
    type: 'array',
    items: {
      type: 'object',
      properties: { name: { type: 'string', default: 'hidden' } },
    },
  },
  { type: 'object', additionalProperties: { type: 'string' } },
  { type: 'unknown' },
  { type: ['unknown', 'null'] },
  { type: 'number', minimum: Infinity },
])('rejects malformed schema before transport: %j', async (invalid) => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(
    new AiService(provider()).generateStructured({ ...input, schema: invalid }),
  ).rejects.toEqual(new AiError('INVALID_SCHEMA'));
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['reject', 'pending'] as const)(
  'timeout cleanup handles %s cancellation and releases reader lock',
  async (mode) => {
    jest.useFakeTimers();
    const cancel = jest.fn<() => Promise<void>>(() =>
      mode === 'reject'
        ? Promise.reject(new Error('private cancellation diagnostic'))
        : new Promise<void>(() => {}),
    );
    const body = new ReadableStream<Uint8Array>({ cancel });
    mockTransport().mockResolvedValue(new Response(body));
    const assertion = expect(provider().generate(input)).rejects.toEqual(
      new AiError('TIMEOUT'),
    );
    await jest.advanceTimersByTimeAsync(config.timeoutMs);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('size-limit cleanup preserves error when cancellation rejects', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1));
    },
    cancel() {
      return Promise.reject(new Error('private cancellation diagnostic'));
    },
  });
  mockTransport().mockResolvedValue(new Response(body));
  await expect(provider().generate(input)).rejects.toEqual(
    new AiError('RESPONSE_TOO_LARGE'),
  );
  expect(body.locked).toBe(false);
});
