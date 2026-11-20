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
  // Hosted usage limits (ai-usage.ts); messages are shown to users as-is.
  AI_DAILY_USER_LIMIT:
    'You have used today’s AI requests. The limit resets at midnight (Vietnam time).',
  AI_DAILY_GLOBAL_LIMIT:
    'The beta has used today’s AI requests. The limit resets at midnight (Vietnam time).',
  AI_BUSY: 'AI is busy with other requests. Try again in a minute.',
  AI_UNAVAILABLE: 'AI is unavailable. Try again later.',
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

export interface AiSchemaIssue {
  readonly schemaPath: string;
  readonly keyword: string;
  readonly limit?: number;
}

export class AiError extends Error {
  readonly diagnostic?: AiDiagnostic;
  constructor(
    public readonly code: keyof typeof messages,
    // Upstream HTTP status only (an integer); never a body, header or message.
    readonly httpStatus?: number,
    // Upstream requests sent for this call, including transient retries.
    readonly attempts?: number,
    // Provider token counts (integers only), e.g. on OUTPUT_LIMIT_EXCEEDED.
    readonly usage?: Readonly<Record<string, number>>,
    readonly schemaIssue?: AiSchemaIssue,
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
