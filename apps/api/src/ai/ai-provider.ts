export const AI_PROVIDER = Symbol('AI_PROVIDER');

// Application-owned JSON Schema; validated at runtime before transport.
export type OutputSchema = Readonly<Record<string, unknown>>;
export const PARTIAL_GENERATION_MAX_MS = 90_000;
export interface ProviderTiming {
  readonly attempts: number;
  readonly retries: number;
  readonly elapsedMs: number;
  readonly usage?: Readonly<Record<string, number>>;
  readonly timeout?: 'provider' | 'overall';
}
export interface PartialGenerationExecution {
  readonly signal: AbortSignal;
  // Absolute monotonic deadline (performance.now), shared by CV and JD.
  readonly deadline: number;
  readonly onProviderTiming?: (timing: ProviderTiming) => void;
}
export interface GenerationRequest {
  readonly workflow?: string;
  readonly partial?: PartialGenerationExecution;
  readonly onProviderTiming?: (timing: ProviderTiming) => void;
  readonly prompt: string;
  readonly schema: OutputSchema;
  // Ollama sampling seed for repeatability; output is still not guaranteed identical.
  readonly seed?: number;
  // Per-call output cap for hosted providers.
  readonly maxOutputTokens?: number;
}
export interface AiProvider {
  generate(request: GenerationRequest): Promise<string>;
}
