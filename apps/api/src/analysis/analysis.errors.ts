import { AiError } from '../ai/ai.errors.js';
import { sanitizeDiagnostic } from '../extraction/extraction.diagnostics.js';
import type { AnalysisErrorDto } from './analysis.contracts.js';

export const ANALYSIS_HTTP_STATUS = Object.freeze({
  INVALID_REQUEST: 400,
  INVALID_INPUT: 400,
  LOCAL_REQUEST_DENIED: 403,
  UPLOAD_TIMEOUT: 408,
  REQUEST_TOO_LARGE: 413,
  DOCUMENT_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNSUPPORTED_FILE_TYPE: 415,
  INVALID_JSON: 422,
  SCHEMA_VALIDATION_FAILURE: 422,
  INVALID_OUTPUT: 422,
  INVALID_EVIDENCE: 422,
  DUPLICATE_FACT: 422,
  OUTPUT_TOO_LARGE: 422,
  PROMPT_TOO_LARGE: 422,
  CONTEXT_LIMIT_EXCEEDED: 422,
  OUTPUT_LIMIT_EXCEEDED: 422,
  RESPONSE_TOO_LARGE: 422,
  PARSING_FAILED: 422,
  PASSWORD_PROTECTED_DOCUMENT: 422,
  RESOURCE_ACCESS_DENIED: 422,
  NO_EXTRACTABLE_TEXT: 422,
  ANALYSIS_BUSY: 429,
  EXTRACTION_BUSY: 429,
  PARSER_BUSY: 429,
  ANALYSIS_UNAVAILABLE: 503,
  EXTRACTION_UNAVAILABLE: 503,
  PARSER_UNAVAILABLE: 503,
  CONTEXT_UNVERIFIED: 503,
  CONNECTION_FAILURE: 503,
  // Hosted AI usage limits (ai/ai-usage.ts).
  AI_DAILY_USER_LIMIT: 429,
  AI_DAILY_GLOBAL_LIMIT: 429,
  AI_BUSY: 429,
  AI_UNAVAILABLE: 503,
  UPSTREAM_HTTP_FAILURE: 503,
  MALFORMED_RESPONSE: 503,
  ANALYSIS_TIMEOUT: 504,
  TIMEOUT: 504,
  PARSING_TIMEOUT: 504,
  INVALID_SCHEMA: 500,
  INVALID_SOURCE: 500,
  INVALID_MATCHING_INPUT: 500,
  INSUFFICIENT_MATCHING_INPUT: 422,
  EXTRACTION_FAILED: 500,
  ANALYSIS_FAILED: 500,
} as const);
export type AnalysisErrorCode = keyof typeof ANALYSIS_HTTP_STATUS;
export class AnalysisError extends Error {
  constructor(readonly code: AnalysisErrorCode) {
    super(code);
  }
}
export function analysisError(
  error: unknown,
  stage: AnalysisErrorDto['stage'] = 'REQUEST',
): AnalysisErrorDto {
  // Fixed own data properties only; never inspect messages, causes or AJV paths.
  try {
    const properties =
      error && typeof error === 'object'
        ? Object.getOwnPropertyDescriptors(error)
        : {};
    const candidate: unknown = properties.code?.value;
    const code =
      typeof candidate === 'string' &&
      Object.hasOwn(ANALYSIS_HTTP_STATUS, candidate)
        ? (candidate as AnalysisErrorCode)
        : 'ANALYSIS_FAILED';
    const diagnostic =
      code === 'INVALID_JSON' || code === 'SCHEMA_VALIDATION_FAILURE'
        ? (new AiError(code).diagnostic ?? null)
        : (sanitizeDiagnostic(code, properties.diagnostic?.value) ?? null);
    return { stage, code, diagnostic };
  } catch {
    return { stage, code: 'ANALYSIS_FAILED', diagnostic: null };
  }
}
