import { setTimeout as wait } from 'node:timers/promises';
import { OPENAI_BASE_URL, OPENAI_MODEL, type AiConfig } from './ai.config.js';
import {
  PARTIAL_GENERATION_MAX_MS,
  type AiProvider,
  type GenerationRequest,
  type OutputSchema,
} from './ai-provider.js';
import { AiError } from './ai.errors.js';
import { record } from './ollama.context.js';
import { MAX_RESPONSE_BYTES } from './ollama.provider.js';

const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;
const MAX_OUTPUT_TOKENS = 4096;

// Strict output requires all properties. Optional values use null on the wire;
// the original schema remains the authority for decoded application values.
function strictSchema(schema: OutputSchema): OutputSchema {
  const wire = { ...schema };
  delete wire.minLength;
  delete wire.maxLength;
  if (record(schema.items)) wire.items = strictSchema(schema.items);
  if (record(schema.properties)) {
    const required = new Set(
      Array.isArray(schema.required) ? schema.required : [],
    );
    wire.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => {
        if (!record(child)) throw new AiError('INVALID_SCHEMA');
        const converted = strictSchema(child);
        return [
          key,
          required.has(key)
            ? converted
            : { anyOf: [converted, { type: 'null' }] },
        ];
      }),
    );
    wire.required = Object.keys(schema.properties);
    wire.additionalProperties = false;
  }
  return wire;
}

function omitOptionalNulls(value: unknown, schema: OutputSchema): void {
  if (Array.isArray(value) && record(schema.items)) {
    for (const item of value) omitOptionalNulls(item, schema.items);
  } else if (record(value) && record(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const [key, child] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, key) || !record(child)) continue;
      if (value[key] === null && !required.includes(key)) delete value[key];
      else omitOptionalNulls(value[key], child);
    }
  }
}

async function readEnvelope(
  response: Response,
  cancelled: Promise<never>,
): Promise<unknown> {
  if (!response.body) throw new AiError('MALFORMED_RESPONSE');
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), cancelled]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new AiError('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new AiError('MALFORMED_RESPONSE');
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function outputText(envelope: Record<string, unknown>): string {
  if (
    envelope.status === 'incomplete' &&
    record(envelope.incomplete_details) &&
    envelope.incomplete_details.reason === 'max_output_tokens'
  )
    throw new AiError('OUTPUT_LIMIT_EXCEEDED');
  if (envelope.status !== 'completed' || !Array.isArray(envelope.output))
    throw new AiError('MALFORMED_RESPONSE');
  let text: string | undefined;
  for (const item of envelope.output) {
    if (record(item) && item.type === 'reasoning') continue;
    if (
      !record(item) ||
      item.type !== 'message' ||
      item.role !== 'assistant' ||
      item.status !== 'completed' ||
      !Array.isArray(item.content) ||
      item.content.length !== 1 ||
      text !== undefined
    )
      throw new AiError('MALFORMED_RESPONSE');
    const part: unknown = item.content[0];
    // Refusals never pass through as application output.
    if (
      !record(part) ||
      part.type !== 'output_text' ||
      typeof part.text !== 'string'
    )
      throw new AiError('MALFORMED_RESPONSE');
    text = part.text;
  }
  if (!text) throw new AiError('MALFORMED_RESPONSE');
  return text;
}

function collectUsage(usage: Record<string, number>, value: unknown): void {
  if (!record(value)) return;
  const counts = {
    input_tokens: value.input_tokens,
    output_tokens: value.output_tokens,
    cached_tokens: record(value.input_tokens_details)
      ? value.input_tokens_details.cached_tokens
      : undefined,
    reasoning_tokens: record(value.output_tokens_details)
      ? value.output_tokens_details.reasoning_tokens
      : undefined,
  };
  for (const [key, count] of Object.entries(counts)) {
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
      usage[key] = (usage[key] ?? 0) + count;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')?.trim();
  if (!header)
    return 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
  if (/^\d+(?:\.\d+)?$/.test(header)) return Number(header) * 1000;
  return Math.max(0, Date.parse(header) - Date.now());
}

export class OpenAiProvider implements AiProvider {
  constructor(private readonly config: AiConfig) {}

  async generate(request: GenerationRequest): Promise<string> {
    const config = this.config;
    if (
      config.provider !== 'openai' ||
      config.model !== OPENAI_MODEL ||
      config.baseUrl !== OPENAI_BASE_URL
    )
      throw new AiError('CONTEXT_UNVERIFIED');
    const { partial } = request;
    const began = performance.now();
    const providerDeadline =
      began +
      (partial
        ? Math.min(config.timeoutMs, PARTIAL_GENERATION_MAX_MS)
        : config.timeoutMs);
    const expires = Math.min(partial?.deadline ?? Infinity, providerDeadline);
    const controller = new AbortController();
    let cancel!: (error: AiError) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = reject;
    });
    void cancelled.catch(() => {});
    const expire = () => {
      cancel(new AiError('TIMEOUT'));
      controller.abort();
    };
    const timer = setTimeout(expire, Math.max(0, expires - performance.now()));
    partial?.signal.addEventListener('abort', expire, { once: true });
    const checkDeadline = () => {
      if (
        controller.signal.aborted ||
        partial?.signal.aborted ||
        !Number.isFinite(expires) ||
        (partial && !Number.isFinite(partial.deadline)) ||
        performance.now() >= expires
      )
        throw new AiError('TIMEOUT');
    };
    const usage: Record<string, number> = {};
    let attempts = 0;
    let timedOut = false;
    try {
      checkDeadline();
      if (request.schema.type !== 'object') throw new AiError('INVALID_SCHEMA');
      const body = JSON.stringify({
        model: config.model,
        input: request.prompt,
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: 'json_schema',
            name: 'structured_output',
            strict: true,
            schema: strictSchema(request.schema),
          },
        },
      });
      for (;;) {
        checkDeadline();
        attempts++;
        const response = await Promise.race([
          fetch(`${config.baseUrl}/v1/responses`, {
            method: 'POST',
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            signal: controller.signal,
            body,
          }),
          cancelled,
        ]);
        checkDeadline();
        if (response.ok) {
          const envelope = await readEnvelope(response, cancelled);
          checkDeadline();
          if (!record(envelope)) throw new AiError('MALFORMED_RESPONSE');
          collectUsage(usage, envelope.usage);
          const text = outputText(envelope);
          let decoded: unknown;
          try {
            decoded = JSON.parse(text);
          } catch {
            throw new AiError('INVALID_JSON');
          }
          omitOptionalNulls(decoded, request.schema);
          return JSON.stringify(decoded);
        }
        let transient = [500, 502, 503, 504].includes(response.status);
        if (response.status === 429) {
          const envelope = await readEnvelope(response, cancelled);
          transient =
            record(envelope) &&
            record(envelope.error) &&
            envelope.error.code === 'rate_limit_exceeded';
        } else {
          void response.body?.cancel().catch(() => {});
        }
        checkDeadline();
        const delay = retryDelay(response, attempts);
        if (
          !transient ||
          attempts >= MAX_ATTEMPTS ||
          !Number.isFinite(delay) ||
          delay > MAX_RETRY_DELAY_MS ||
          performance.now() + delay >= expires
        )
          throw new AiError('UPSTREAM_HTTP_FAILURE', response.status, attempts);
        await Promise.race([
          wait(delay, undefined, { signal: controller.signal }),
          cancelled,
        ]);
      }
    } catch (error) {
      try {
        checkDeadline();
      } catch (deadlineError) {
        timedOut = true;
        throw deadlineError;
      }
      if (error instanceof AiError) {
        if (error.code === 'OUTPUT_LIMIT_EXCEEDED')
          throw new AiError(error.code, undefined, attempts, usage);
        throw error;
      }
      throw new AiError('CONNECTION_FAILURE');
    } finally {
      clearTimeout(timer);
      partial?.signal.removeEventListener('abort', expire);
      controller.abort();
      (request.onProviderTiming ?? partial?.onProviderTiming)?.({
        attempts,
        retries: Math.max(0, attempts - 1),
        elapsedMs: Math.round(performance.now() - began),
        ...(Object.keys(usage).length ? { usage } : {}),
        timeout: timedOut
          ? partial?.signal.aborted ||
            (partial?.deadline ?? Infinity) <= providerDeadline
            ? 'overall'
            : 'provider'
          : undefined,
      });
    }
  }
}
