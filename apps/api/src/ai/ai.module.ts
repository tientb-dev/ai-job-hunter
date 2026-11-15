import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiUsageService } from './ai-usage.js';
import { AI_PROVIDER } from './ai-provider.js';
import { AI_CONFIG, aiConfig } from './ai.config.js';
import { AiService } from './ai.service.js';
import type { AiConfig } from './ai.config.js';
import { GeminiProvider } from './gemini.provider.js';
import { OllamaProvider } from './ollama.provider.js';

@Module({
  providers: [
    { provide: AI_CONFIG, useFactory: () => aiConfig() },
    {
      provide: AI_PROVIDER,
      inject: [AI_CONFIG],
      useFactory: (config: AiConfig) =>
        config.provider === 'gemini'
          ? new GeminiProvider(config)
          : new OllamaProvider(config),
    },
    {
      provide: AiUsageService,
      inject: [AI_CONFIG, { token: DataSource, optional: true }],
      useFactory: (config: AiConfig, db?: DataSource) => {
        if (config.provider !== 'gemini') return null;
        // Hosted AI must be metered; refuse to start without the database.
        if (!db) throw new Error('Gemini usage limits require the database');
        return new AiUsageService(db, config.limits);
      },
    },
    AiService,
  ],
  exports: [AiService, AI_CONFIG],
})
export class AiModule {}
