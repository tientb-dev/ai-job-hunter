import { Inject, Injectable } from '@nestjs/common';
import { AI_CONFIG } from './ai.config.js';
import type { AiConfig } from './ai.config.js';
import { PARTIAL_GENERATION_MAX_MS } from './ai-provider.js';
import type { AiProvider, GenerationRequest } from './ai-provider.js';
import { AiError } from './ai.errors.js';

import {
  OLLAMA_CONTEXT_PROFILE as profile,
  verifyProfile,
  verifyAllocation,
  validateGeneration,
  outputBudget,
} from './ollama.context.js';

export const MAX_RESPONSE_BYTES = 1024 * 1024;

@Injectable()
export class OllamaProvider implements AiProvider {
  constructor(@Inject(AI_CONFIG) private readonly config: AiConfig) {}

  async generate(request: GenerationRequest): Promise<string> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timedOut = false;
    let readerCancelled = false;
    const cancelReader = (): void => {
      if (!reader || readerCancelled) return;
      readerCancelled = true;
      // Do not await: an underlying source's cancellation may never settle.
      // Handle rejection immediately so cleanup cannot leak an unhandled rejection.
      void reader.cancel().catch(() => {});
    };
    const partial = request.partial;
    const expires = partial
      ? Math.min(
          partial.deadline,
          performance.now() +
            Math.min(this.config.timeoutMs, PARTIAL_GENERATION_MAX_MS),
        )
      : performance.now() + this.config.timeoutMs;
    const expire = () => {
      timedOut = true;
      controller.abort();
      cancelReader();
    };
    const ensureLive = () => {
      if (partial && (partial.signal.aborted || performance.now() >= expires))
        expire();
      if (timedOut) throw new AiError('TIMEOUT');
    };
    // Bound waiting even when a mocked/broken transport ignores AbortSignal.
    // The actual HTTP request still receives the aborted signal and is cancelled.
    let rejectCancellation!: (error: AiError) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    void cancellation.catch(() => {});
    const onCancelled = () => rejectCancellation(new AiError('TIMEOUT'));
    controller.signal.addEventListener('abort', onCancelled, { once: true });
    const bounded = <T>(pending: Promise<T>): Promise<T> =>
      partial ? Promise.race([pending, cancellation]) : pending;
    const timer = setTimeout(expire, Math.max(0, expires - performance.now()));
    partial?.signal.addEventListener('abort', expire, { once: true });
    try {
      if (partial && !Number.isFinite(partial.deadline))
        throw new AiError('TIMEOUT');
      ensureLive();
      if (
        this.config.provider !== 'ollama' ||
        this.config.model !== profile.model
      )
        throw new AiError('CONTEXT_UNVERIFIED');
      // Snapshot once: both passes must use the same prompt/schema/template behavior.
      const common = JSON.stringify({
        model: profile.model,
        prompt: request.prompt,
        stream: false,
        think: false,
        truncate: false,
        shift: false,
        format: request.schema,
      });
      const call = async (path: string, body?: string): Promise<unknown> => {
        ensureLive();
        const pending = fetch(`${this.config.baseUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (partial)
          void pending.then(
            (response) => {
              if (controller.signal.aborted)
                void response.body?.cancel().catch(() => {});
            },
            () => {},
          );
        const response = await bounded(pending);
        ensureLive();
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new AiError('UPSTREAM_HTTP_FAILURE');
        }
        if (!response.body) throw new AiError('MALFORMED_RESPONSE');
        reader = response.body.getReader();
        readerCancelled = false;
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await bounded(reader.read());
          ensureLive();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES)
            throw new AiError('RESPONSE_TOO_LARGE');
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
        reader.releaseLock();
        reader = undefined;
        return envelope;
      };
      verifyProfile(await call('/api/version'), await call('/api/tags'));
      const generate = (numPredict: number) =>
        call(
          '/api/generate',
          JSON.stringify({
            ...JSON.parse(common),
            options: {
              num_ctx: profile.contextTokens,
              num_predict: numPredict,
              temperature: 0,
            },
          }),
        );
      if (partial) {
        // One generation only. Reserve 2048 output tokens against the pinned
        // 6080-prompt/8192-context profile; validate actual usage after the call.
        // No measurement, repair, retry or fallback generation is allowed here.
        const generated = validateGeneration(
          await generate(profile.outputTokens),
          false,
          profile.outputTokens,
        );
        await call('/api/ps').then(verifyAllocation);
        ensureLive();
        return generated.text;
      }
      const measured = validateGeneration(await generate(1), true);
      await call('/api/ps').then(verifyAllocation);
      const outputTokenLimit = outputBudget(measured.promptTokens);
      const generated = validateGeneration(
        await generate(outputTokenLimit),
        false,
        outputTokenLimit,
      );
      if (generated.promptTokens !== measured.promptTokens)
        throw new AiError('CONTEXT_UNVERIFIED');
      // Snapshot checks are evidence, not an atomic lock on the local daemon.
      await call('/api/ps').then(verifyAllocation);
      return generated.text;
    } catch (error: unknown) {
      ensureLive();
      if (error instanceof AiError) throw error;
      throw new AiError('CONNECTION_FAILURE');
    } finally {
      clearTimeout(timer);
      partial?.signal.removeEventListener('abort', expire);
      controller.signal.removeEventListener('abort', onCancelled);
      controller.abort();
      if (reader) {
        cancelReader();
        // The read has settled before finally; cancellation completion is not required.
        reader.releaseLock();
      }
    }
  }
}
