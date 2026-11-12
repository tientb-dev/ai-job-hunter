import { Module } from '@nestjs/common';
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
    AiService,
  ],
  exports: [AiService, AI_CONFIG],
})
export class AiModule {}
