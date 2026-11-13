const messages = {
  CONTEXT_UNVERIFIED: 'AI context profile could not be verified',
  CONTEXT_LIMIT_EXCEEDED: 'AI prompt exceeds the context budget',
  OUTPUT_LIMIT_EXCEEDED: 'AI generation exceeded the output token limit',
  INVALID_SCHEMA: 'Invalid or unsupported AI output schema',
  TIMEOUT: 'AI request timed out',
  CONNECTION_FAILURE: 'AI provider connection failed',
  UPSTREAM_HTTP_FAILURE: 'AI provider returned an unsuccessful HTTP status',
  MALFORMED_RESPONSE: 'AI provider returned a malformed response',
  INVALID_JSON: 'AI output is not valid JSON',
  SCHEMA_VALIDATION_FAILURE: 'AI output does not match the required schema',
  RESPONSE_TOO_LARGE: 'AI provider response exceeds the size limit',
} as const;

export type AiDiagnostic =
  | {
      readonly stage: 'AI_DECODE';
      readonly rule: 'JSON_INVALID';
      readonly field: 'output';
    }
  | {
      readonly stage: 'AI_SCHEMA';
      readonly rule: 'SCHEMA_MISMATCH';
      readonly field: 'output';
    };

export class AiError extends Error {
  readonly diagnostic?: AiDiagnostic;
  constructor(
    public readonly code: keyof typeof messages,
    // Upstream HTTP status only (an integer); never a body, header or message.
    readonly httpStatus?: number,
  ) {
    super(messages[code]);
    this.name = 'AiError';
    // Derive only from the allowlisted code, never provider/error payloads.
    if (code === 'INVALID_JSON')
      this.diagnostic = Object.freeze({
        stage: 'AI_DECODE',
        rule: 'JSON_INVALID',
        field: 'output',
      });
    if (code === 'SCHEMA_VALIDATION_FAILURE')
      this.diagnostic = Object.freeze({
        stage: 'AI_SCHEMA',
        rule: 'SCHEMA_MISMATCH',
        field: 'output',
      });
  }
}
