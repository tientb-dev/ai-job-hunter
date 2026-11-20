import { aiConfig } from '../ai/ai.config.js';
import {
  databaseOptions,
  databaseTarget,
} from '../database/database.config.js';

const DIAGNOSTICS = [
  'PDF_PARSER_DIAGNOSTICS',
  'CV_MATCH_DIAGNOSTICS',
  'AI_GENERATION_DIAGNOSTICS',
] as const;

/** https://host, or http://localhost[:port] for the documented local production test. */
function publicOrigin(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(
      'PUBLIC_ORIGIN must be an origin such as https://beta.example.com',
    );
  }
  const local = url.protocol === 'http:' && url.hostname === 'localhost';
  if (
    (url.protocol !== 'https:' && !local) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error(
      'PUBLIC_ORIGIN must be https://<host> (or http://localhost:<port> for local testing), without path or credentials',
    );
  return url.origin;
}

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (!['development', 'test', 'production'].includes(env.NODE_ENV ?? '')) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const production = env.NODE_ENV === 'production';
  const port = env.API_PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  // 0.0.0.0 only inside the production container, whose port is never published.
  const host = env.API_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && !(production && host === '0.0.0.0'))
    throw new Error('API_HOST must be 127.0.0.1 (0.0.0.0 only in production)');
  if (env.TRUST_PROXY !== undefined && !(production && env.TRUST_PROXY === '1'))
    throw new Error('TRUST_PROXY may only be 1, and only in production');
  if (production) {
    publicOrigin(env.PUBLIC_ORIGIN);
    if (env.AI_PROVIDER !== 'gemini' && env.AI_PROVIDER !== 'openai')
      throw new Error('Production requires AI_PROVIDER to be openai or gemini');
    // These logs may include CV/JD text or personal data.
    for (const name of DIAGNOSTICS)
      if (env[name]) throw new Error(`${name} must be unset in production`);
  } else if (env.PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN is for production only');
  }
  // Per-source link import; off unless explicitly enabled (content-use review).
  for (const name of ['JOB_URL_FETCH_TOPCV', 'JOB_URL_FETCH_VIETNAMWORKS'])
    if (env[name] !== undefined && !['0', '1'].includes(env[name]))
      throw new Error(`${name} must be 0 or 1`);
  databaseOptions(databaseTarget(env), env);
  return {
    port: Number(port),
    host,
    trustProxy: env.TRUST_PROXY === '1',
    ai: aiConfig(env),
    pdfParserDiagnostics: env.PDF_PARSER_DIAGNOSTICS === '1',
    cvMatchDiagnostics: env.CV_MATCH_DIAGNOSTICS === '1',
    aiGenerationDiagnostics: env.AI_GENERATION_DIAGNOSTICS === '1',
  };
}
