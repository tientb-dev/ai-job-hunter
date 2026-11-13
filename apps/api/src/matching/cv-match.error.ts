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
export class CvMatchError extends HttpException {
  constructor(readonly errorCode: keyof typeof failures) {
    const [status, message] = failures[errorCode];
    super(message, status);
  }
}
