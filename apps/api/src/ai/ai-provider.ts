export const AI_PROVIDER = Symbol('AI_PROVIDER');

// Application-owned JSON Schema; validated at runtime before transport.
export type OutputSchema = Readonly<Record<string, unknown>>;
export const PARTIAL_GENERATION_MAX_MS = 90_000;
export interface PartialGenerationExecution {
  readonly signal: AbortSignal;
  // Absolute monotonic deadline (performance.now), shared by CV and JD.
  readonly deadline: number;
}
export interface GenerationRequest {
  readonly partial?: PartialGenerationExecution;
  readonly prompt: string;
  readonly schema: OutputSchema;
  // Ollama sampling seed for repeatability; output is still not guaranteed identical.
  readonly seed?: number;
  // Gemini only: per-call output cap; omitted keeps GEMINI_MAX_OUTPUT_TOKENS.
  readonly maxOutputTokens?: number;
}
export interface AiProvider {
  generate(request: GenerationRequest): Promise<string>;
}
