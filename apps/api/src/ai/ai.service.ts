import { Inject, Injectable, Optional } from '@nestjs/common';
import { AiUsageService } from './ai-usage.js';
import { AI_PROVIDER } from './ai-provider.js';
import type {
  AiProvider,
  GenerationRequest,
  OutputSchema,
  PartialGenerationExecution,
} from './ai-provider.js';
import { AiError } from './ai.errors.js';
import { compileOutputSchema } from './ai.schema.js';

@Injectable()
export class AiService {
  constructor(
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    // Null for local Ollama; hosted requests always go through limits.
    // Explicit token: a union type would make Nest look up `Object` and skip it.
    @Optional()
    @Inject(AiUsageService)
    private readonly usage: AiUsageService | null = null,
  ) {}

  async generateStructured(request: GenerationRequest): Promise<unknown> {
    return this.generate(request, request.schema);
  }

  // Partial extraction validates candidate items independently after decoding.
  // Keep the stricter model-facing schema while checking its envelope here.
  generatePartialStructured(
    request: GenerationRequest & {
      readonly partial: PartialGenerationExecution;
    },
    envelopeSchema: OutputSchema,
  ): Promise<unknown> {
    return this.generate(request, envelopeSchema);
  }

  private async generate(
    request: GenerationRequest,
    runtimeSchema: OutputSchema,
  ): Promise<unknown> {
    const { schema, validate: validateModel } = compileOutputSchema(
      request.schema,
    );
    const validate =
      runtimeSchema === request.schema
        ? validateModel
        : compileOutputSchema(runtimeSchema).validate;
    const send = () =>
      this.provider.generate({
        ...(request.partial ? { partial: request.partial } : {}),
        ...(request.onProviderTiming
          ? { onProviderTiming: request.onProviderTiming }
          : {}),
        prompt: request.prompt,
        schema,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
      });
    const text = await (this.usage ? this.usage.run(send) : send());
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      throw new AiError('INVALID_JSON');
    }
    if (!validate(result)) throw new AiError('SCHEMA_VALIDATION_FAILURE');
    return result;
  }
}
