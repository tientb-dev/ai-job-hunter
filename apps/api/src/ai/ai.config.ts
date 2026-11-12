export const AI_CONFIG = Symbol('AI_CONFIG');
interface BaseAiConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
}
export type AiConfig =
  | (BaseAiConfig & { readonly provider: 'ollama' })
  | (BaseAiConfig & { readonly provider: 'gemini'; readonly apiKey: string });

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
  };
  // Non-enumerable so logging or serializing the config never includes the key.
  return Object.defineProperty(config, 'apiKey', { value: apiKey }) as AiConfig;
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
