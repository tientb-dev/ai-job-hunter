import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiUsageService } from './ai-usage.js';
import { AI_PROVIDER, type AiProvider } from './ai-provider.js';
import { AI_CONFIG, aiConfig } from './ai.config.js';
import { AiService } from './ai.service.js';
import type { AiConfig, AiSettings } from './ai.config.js';
import { GeminiProvider } from './gemini.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import { OllamaProvider } from './ollama.provider.js';

const ADAPTER_CONFIG = Symbol('ADAPTER_CONFIG');

@Module({
  providers: [
    { provide: ADAPTER_CONFIG, useFactory: () => aiConfig() },
    {
      provide: AI_CONFIG,
      inject: [ADAPTER_CONFIG],
      useFactory: (config: AiConfig): AiSettings => {
        if (config.provider === 'ollama') return config;
        const { provider, baseUrl, model, timeoutMs, limits } = config;
        return { provider, baseUrl, model, timeoutMs, limits };
      },
    },
    {
      provide: AI_PROVIDER,
      inject: [ADAPTER_CONFIG],
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
      inject: [AI_CONFIG, { token: DataSource, optional: true }],
      useFactory: (config: AiSettings, db?: DataSource) => {
        if (config.provider === 'ollama') return null;
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
        config: AiSettings,
        usage: AiUsageService | null,
      ) =>
        new AiService(
          provider,
          config.provider === 'ollama' ? null : usage,
          config,
        ),
    },
  ],
  exports: [AiService, AI_CONFIG],
})
export class AiModule {}
