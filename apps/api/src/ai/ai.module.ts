import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiUsageService } from './ai-usage.js';
import { AI_PROVIDER, type AiProvider } from './ai-provider.js';
import {
  AI_CONFIG,
  CV_MATCH_AI_CONFIG,
  TAILORED_CV_AI_CONFIG,
  aiConfig,
  cvMatchAiConfig,
  tailoredCvAiConfig,
} from './ai.config.js';
import { AiService } from './ai.service.js';
import type { AiConfig } from './ai.config.js';
import { GeminiProvider } from './gemini.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import { OllamaProvider } from './ollama.provider.js';

export const CV_MATCH_AI = Symbol('CV_MATCH_AI');

function scopedClient(
  fallback: AiService,
  config: AiConfig,
  usage: AiUsageService | null,
) {
  if (config.provider !== 'openai') return fallback;
  if (!usage) throw new Error('OpenAI usage limits are required');
  return new AiService(new OpenAiProvider(config), usage);
}

export const TAILORED_CV_AI = Symbol('TAILORED_CV_AI');

@Module({
  providers: [
    { provide: AI_CONFIG, useFactory: () => aiConfig() },
    {
      provide: CV_MATCH_AI_CONFIG,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => cvMatchAiConfig(config),
    },
    {
      provide: TAILORED_CV_AI_CONFIG,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) => tailoredCvAiConfig(config),
    },
    {
      provide: AI_PROVIDER,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig): AiProvider => {
        switch (config.provider) {
          case 'gemini':
            return new GeminiProvider(config);
          case 'openai':
            return new OpenAiProvider(config);
          case 'ollama':
            return new OllamaProvider(config);
        }
      },
    },
    {
      provide: AiUsageService,
      inject: [
        AI_CONFIG,
        TAILORED_CV_AI_CONFIG,
        CV_MATCH_AI_CONFIG,
        { token: DataSource, optional: true },
      ],
      useFactory: (
        global: AiConfig,
        draft: AiConfig,
        match: AiConfig,
        db?: DataSource,
      ) => {
        const config = [global, draft, match].find(
          (candidate) => candidate.provider !== 'ollama',
        );
        if (!config) return null;
        // Hosted AI must be metered; refuse to start without the database.
        if (!db) throw new Error('Hosted AI usage limits require the database');
        return new AiUsageService(db, config.limits);
      },
    },
    {
      provide: AiService,
      inject: [AI_PROVIDER, AI_CONFIG, AiUsageService],
      useFactory: (
        provider: AiProvider,
        config: AiConfig,
        usage: AiUsageService | null,
      ) => new AiService(provider, config.provider === 'ollama' ? null : usage),
    },
    {
      provide: TAILORED_CV_AI,
      inject: [AiService, TAILORED_CV_AI_CONFIG, AiUsageService],
      useFactory: scopedClient,
    },
    {
      provide: CV_MATCH_AI,
      inject: [AiService, CV_MATCH_AI_CONFIG, AiUsageService],
      useFactory: scopedClient,
    },
  ],
  exports: [
    AiService,
    AI_CONFIG,
    TAILORED_CV_AI,
    TAILORED_CV_AI_CONFIG,
    CV_MATCH_AI,
    CV_MATCH_AI_CONFIG,
  ],
})
export class AiModule {}
