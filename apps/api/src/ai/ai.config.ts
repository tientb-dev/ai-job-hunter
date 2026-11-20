export const CV_MATCH_AI_CONFIG = Symbol('CV_MATCH_AI_CONFIG');
export const TAILORED_CV_AI_CONFIG = Symbol('TAILORED_CV_AI_CONFIG');
export const AI_CONFIG = Symbol('AI_CONFIG');
interface BaseAiConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}
/** Hosted usage limits; Ollama runs locally and is not limited. */
export interface AiLimits {
  readonly dailyPerUser: number;
  readonly dailyGlobal: number;
  readonly concurrent: number;
}
export type AiConfig =
  | (BaseAiConfig & { readonly provider: 'ollama' })
  | (BaseAiConfig & {
      readonly provider: 'gemini' | 'openai';
      readonly apiKey: string;
      readonly limits: AiLimits;
    });

function limit(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max: number,
): number {
  const value = env[name] ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  return Number(value);
}

// Pinned like the Ollama digest: prompts and guards are verified per model.
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

function timeoutMs(env: NodeJS.ProcessEnv): number {
  const timeout = env.AI_REQUEST_TIMEOUT_MS ?? '120000';
  if (
    !/^\d+$/.test(timeout) ||
    Number(timeout) < 1000 ||
    Number(timeout) > 300000
  ) {
    throw new Error(
      'AI_REQUEST_TIMEOUT_MS must be an integer between 1000 and 300000',
    );
  }
  return Number(timeout);
}

function geminiConfig(env: NodeJS.ProcessEnv): AiConfig {
  if ((env.GEMINI_MODEL ?? GEMINI_MODEL) !== GEMINI_MODEL)
    throw new Error(`GEMINI_MODEL must be ${GEMINI_MODEL}`);
  const apiKey = env.GEMINI_API_KEY ?? '';
  if (!/^[A-Za-z0-9._-]{20,256}$/.test(apiKey))
    throw new Error('GEMINI_API_KEY must be set to a valid API key');
  const config = {
    provider: 'gemini' as const,
    baseUrl: GEMINI_BASE_URL,
    model: GEMINI_MODEL,
    timeoutMs: timeoutMs(env),
    limits: hostedLimits(env),
  };
  // Non-enumerable so logging or serializing the config never includes the key.
  return Object.defineProperty(config, 'apiKey', { value: apiKey }) as AiConfig;
}

function hostedLimits(env: NodeJS.ProcessEnv): AiLimits {
  return {
    dailyPerUser: limit(env, 'AI_DAILY_USER_LIMIT', 100, 100_000),
    dailyGlobal: limit(env, 'AI_DAILY_GLOBAL_LIMIT', 500, 1_000_000),
    concurrent: limit(env, 'AI_MAX_CONCURRENT', 4, 64),
  };
}

export const OPENAI_MODEL = 'gpt-5.4-mini-2026-03-17';
export const OPENAI_BASE_URL = 'https://api.openai.com';

export function tailoredCvAiConfig(
  fallback: AiConfig,
  env: NodeJS.ProcessEnv = process.env,
): AiConfig {
  return scopedAiConfig(fallback, 'TAILORED_CV_AI_PROVIDER', env);
}

export function cvMatchAiConfig(
  fallback: AiConfig,
  env: NodeJS.ProcessEnv = process.env,
): AiConfig {
  return scopedAiConfig(fallback, 'CV_MATCH_AI_PROVIDER', env);
}

function scopedAiConfig(
  fallback: AiConfig,
  name: 'CV_MATCH_AI_PROVIDER' | 'TAILORED_CV_AI_PROVIDER',
  env: NodeJS.ProcessEnv,
): AiConfig {
  const override = env[name];
  if (override === undefined) return fallback;
  if (override !== 'openai') throw new Error(`${name} must be openai or unset`);
  const apiKey = env.OPENAI_API_KEY ?? '';
  if (!/^[A-Za-z0-9._-]{20,512}$/.test(apiKey))
    throw new Error('OPENAI_API_KEY must be set to a valid API key');
  return Object.defineProperty(
    {
      provider: 'openai',
      baseUrl: OPENAI_BASE_URL,
      model: OPENAI_MODEL,
      timeoutMs: timeoutMs(env),
      limits: hostedLimits(env),
    },
    'apiKey',
    { value: apiKey },
  ) as AiConfig;
}

export function aiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const provider = env.AI_PROVIDER ?? 'ollama';
  if (provider === 'gemini') return geminiConfig(env);
  if (provider !== 'ollama') {
    throw new Error('AI_PROVIDER must be ollama or gemini');
  }
  let url: URL;
  try {
    const origin = env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    // Check the literal authority before URL normalizes IPv4 shorthand, hex or IPv6.
    if (!/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]+)?\/?$/.test(origin))
      throw new Error();
    url = new URL(origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new Error(
      'OLLAMA_BASE_URL must be an HTTP(S) origin at literal 127.0.0.1 or [::1] without credentials, path, query or fragment',
    );
  }
  const model = env.OLLAMA_MODEL ?? 'qwen3:4b';
  if (!model.trim() || model !== model.trim() || /\s/.test(model)) {
    throw new Error(
      'OLLAMA_MODEL must be a nonempty model name without whitespace',
    );
  }
  return {
    provider: 'ollama',
    baseUrl: url.origin,
    model,
    timeoutMs: timeoutMs(env),
  };
}
