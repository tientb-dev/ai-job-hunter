import { Inject, Injectable } from '@nestjs/common';
import { AI_CONFIG, GEMINI_MODEL } from './ai.config.js';
import type { AiConfig } from './ai.config.js';
import { PARTIAL_GENERATION_MAX_MS } from './ai-provider.js';
import type {
  AiProvider,
  GenerationRequest,
  OutputSchema,
} from './ai-provider.js';
import { AiError } from './ai.errors.js';
import { MAX_RESPONSE_BYTES } from './ollama.provider.js';
import { record } from './ollama.context.js';

// Bounds paid output per call; matches the Ollama profile's maximum.
export const GEMINI_MAX_OUTPUT_TOKENS = 4096;

/** One generateContent request; only transient 429/503 are retried, within the deadline. */
@Injectable()
export class GeminiProvider implements AiProvider {
  constructor(@Inject(AI_CONFIG) private readonly config: AiConfig) {}

  async generate(request: GenerationRequest): Promise<string> {
    const config = this.config;
    if (config.provider !== 'gemini' || config.model !== GEMINI_MODEL)
      throw new AiError('CONTEXT_UNVERIFIED');
    const partial = request.partial;
    if (partial && !Number.isFinite(partial.deadline))
      throw new AiError('TIMEOUT');
    const expires = partial
      ? Math.min(
          partial.deadline,
          performance.now() +
            Math.min(config.timeoutMs, PARTIAL_GENERATION_MAX_MS),
        )
      : performance.now() + config.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    // Bound waiting even when a broken transport ignores the AbortSignal.
    let rejectTimeout!: (error: AiError) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    void cancelled.catch(() => {});
    const expire = () => {
      timedOut = true;
      controller.abort();
      rejectTimeout(new AiError('TIMEOUT'));
    };
    const timer = setTimeout(expire, Math.max(0, expires - performance.now()));
    partial?.signal.addEventListener('abort', expire, { once: true });
    if (partial?.signal.aborted || performance.now() >= expires) expire();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      if (timedOut) throw new AiError('TIMEOUT');
      const body = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          temperature: 0,
          candidateCount: 1,
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseJsonSchema: geminiSchema(request.schema),
        },
      });
      let response: Response;
      for (let attempt = 1; ; attempt++) {
        response = await Promise.race([
          fetch(
            `${config.baseUrl}/v1beta/models/${config.model}:generateContent`,
            {
              method: 'POST',
              redirect: 'error',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey,
              },
              body,
            },
          ),
          cancelled,
        ]);
        if (response.ok) break;
        // Never surface the upstream body: it can echo request content.
        void response.body?.cancel().catch(() => {});
        const delay = retryDelay(response, attempt);
        // Fail fast instead of waiting past the request deadline.
        if (delay === null || performance.now() + delay >= expires)
          throw new AiError('UPSTREAM_HTTP_FAILURE');
        let wait: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          new Promise((resolve) => (wait = setTimeout(resolve, delay))),
          cancelled,
        ]).finally(() => clearTimeout(wait));
      }
      if (!response.body) throw new AiError('MALFORMED_RESPONSE');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await Promise.race([reader.read(), cancelled]);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new AiError('RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
      let envelope: unknown;
      try {
        envelope = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        throw new AiError('MALFORMED_RESPONSE');
      }
      return candidateText(envelope);
    } catch (error: unknown) {
      if (timedOut) throw new AiError('TIMEOUT');
      if (error instanceof AiError) throw error;
      throw new AiError('CONNECTION_FAILURE');
    } finally {
      clearTimeout(timer);
      partial?.signal.removeEventListener('abort', expire);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  }
}

export const GEMINI_MAX_ATTEMPTS = 3;
export const GEMINI_MAX_RETRY_DELAY_MS = 10_000;

/** Delay before retrying a transient 429/503, or null when it must not retry. */
export function retryDelay(
  response: Response,
  attempt: number,
  now = Date.now(),
  random = Math.random,
): number | null {
  if (![429, 503].includes(response.status) || attempt >= GEMINI_MAX_ATTEMPTS)
    return null;
  const header = response.headers.get('retry-after')?.trim();
  let delay = 1000 * 2 ** (attempt - 1) + Math.floor(random() * 250);
  if (header) {
    const seconds = /^\d+$/.test(header)
      ? Number(header) * 1000
      : Date.parse(header) - now;
    if (!Number.isFinite(seconds)) return null;
    delay = Math.max(0, seconds);
  }
  // A long server-requested wait (e.g. daily quota) is not worth holding a request.
  return delay > GEMINI_MAX_RETRY_DELAY_MS ? null : delay;
}

/**
 * Gemini rejects production schemas carrying larger maxItems bounds (HTTP 400),
 * so they are omitted from constrained decoding only. AiService still validates
 * the output against the complete schema, so the limits remain enforced.
 */
export function geminiSchema(schema: OutputSchema): OutputSchema {
  return JSON.parse(JSON.stringify(schema), (_key, value: unknown) => {
    if (record(value)) delete value.maxItems;
    return value;
  }) as OutputSchema;
}

export function candidateText(envelope: unknown): string {
  if (!record(envelope) || !Array.isArray(envelope.candidates))
    throw new AiError('MALFORMED_RESPONSE');
  if (envelope.candidates.length !== 1 || !record(envelope.candidates[0]))
    throw new AiError('MALFORMED_RESPONSE');
  const candidate = envelope.candidates[0];
  if (candidate.finishReason === 'MAX_TOKENS')
    throw new AiError('OUTPUT_LIMIT_EXCEEDED');
  // SAFETY, RECITATION, blocked prompts etc. are not usable output.
  if (candidate.finishReason !== 'STOP')
    throw new AiError('MALFORMED_RESPONSE');
  const content = candidate.content;
  if (!record(content) || !Array.isArray(content.parts))
    throw new AiError('MALFORMED_RESPONSE');
  let text = '';
  for (const part of content.parts) {
    if (!record(part)) throw new AiError('MALFORMED_RESPONSE');
    if (part.thought === true) continue;
    if (typeof part.text !== 'string') throw new AiError('MALFORMED_RESPONSE');
    text += part.text;
  }
  if (!text) throw new AiError('MALFORMED_RESPONSE');
  return text;
}
