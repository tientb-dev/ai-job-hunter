import { HttpException } from '@nestjs/common';
const failures = {
  CV_MATCH_CV_UNAVAILABLE: [
    400,
    'Saved CV text is missing or empty. Save a readable CV PDF/DOCX again before analyzing.',
  ],
  CV_MATCH_TIMEOUT: [
    504,
    'CV matching timed out. Check that the AI service is available and retry; no new fit score was produced.',
  ],
  CV_MATCH_INVALID_OUTPUT: [
    503,
    'The AI model returned malformed or invalid matching output. Retry analysis; no new fit score was produced.',
  ],
  CV_MATCH_INCOMPLETE: [
    503,
    'The AI model did not evaluate all job requirements. Retry analysis; no new fit score was produced.',
  ],
  CV_MATCH_EVIDENCE_REJECTED: [
    503,
    'Matching evidence could not be verified against the saved sources. Retry analysis; no new fit score was produced.',
  ],
  CV_MATCH_UNAVAILABLE: [
    503,
    'CV matching is unavailable. Check the AI service and the configured model, then retry; no new fit score was produced.',
  ],
} as const;
// Internal failure cause for the CV_MATCH_FAILURE log; never sent to clients.
export type MatchFailureReason =
  | 'CV_TEXT_EMPTY'
  | 'NO_CANONICAL_REQUIREMENTS'
  | 'JD_TEXT_EMPTY'
  | 'NO_ASSESSMENTS'
  | 'REQUIREMENTS_UNLINKED'
  | 'PARENT_ID_UNLINKED'
  | 'COMPONENT_UNKNOWN'
  | 'COMPONENT_DUPLICATE'
  | 'COMPONENT_JD_SPAN_MISMATCH'
  | 'COMPONENT_JD_QUOTE_NOT_IN_JD'
  | 'COMPONENT_CV_QUOTE_NOT_ALLOWED_PASSAGE'
  | 'COMPONENT_CV_QUOTE_NOT_IN_CV'
  | 'COMPONENT_CV_QUOTE_AMBIGUOUS'
  | 'JD_QUOTE_EMPTY'
  | 'JD_QUOTE_NOT_VERBATIM'
  | 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT'
  | 'NO_VERIFIABLE_CV_QUOTES'
  | 'COMPLETION_COUNT'
  | 'COMPLETION_UNKNOWN_ID'
  | 'COMPLETION_DUPLICATE_ID'
  | 'COMPLETION_TEXT_MISMATCH';
export class CvMatchError extends HttpException {
  constructor(
    readonly errorCode: keyof typeof failures,
    readonly reasonCode?: MatchFailureReason,
    // Numeric aggregates only.
    readonly counts?: Readonly<Record<string, number>>,
  ) {
    const [status, message] = failures[errorCode];
    super(message, status);
  }
}
