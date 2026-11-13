import { aiConfig } from '../ai/ai.config.js';
import { databaseOptions } from '../database/database.config.js';

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (!['development', 'test', 'production'].includes(env.NODE_ENV ?? '')) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const port = env.API_PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  databaseOptions(env.NODE_ENV === 'test' ? 'test' : 'development', env);
  return {
    port: Number(port),
    ai: aiConfig(env),
    pdfParserDiagnostics: env.PDF_PARSER_DIAGNOSTICS === '1',
    cvMatchDiagnostics: env.CV_MATCH_DIAGNOSTICS === '1',
    aiGenerationDiagnostics: env.AI_GENERATION_DIAGNOSTICS === '1',
  };
}
