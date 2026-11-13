import { expect, test } from '@jest/globals';
import { CvMatchError } from '../../src/matching/cv-match.error.js';
import { CvSuggestionsError } from '../../src/matching/cv-suggestions.error.js';
import { InterviewPrepError } from '../../src/interview-prep/interview-prep.policy.js';
import { TailoredDraftError } from '../../src/tailored-cv/tailored-draft.contract.js';
import { SourceProfileError } from '../../src/tailored-cv/source-profile-proposal.js';

// These workflows run on Ollama or Gemini, so guidance must not assume local AI.
const messages: [string, string][] = [
  ...(
    [
      'CV_MATCH_TIMEOUT',
      'CV_MATCH_INVALID_OUTPUT',
      'CV_MATCH_INCOMPLETE',
      'CV_MATCH_UNAVAILABLE',
    ] as const
  ).map((c): [string, string] => [c, new CvMatchError(c).message]),
  ...(
    [
      'CV_SUGGESTIONS_INVALID_OUTPUT',
      'CV_SUGGESTIONS_UNAVAILABLE',
      'CV_SUGGESTIONS_TIMEOUT',
    ] as const
  ).map((c): [string, string] => [c, new CvSuggestionsError(c).message]),
  ...(
    [
      'INTERVIEW_TIMEOUT',
      'INTERVIEW_INVALID_OUTPUT',
      'INTERVIEW_AI_UNAVAILABLE',
      'INTERVIEW_TOO_FEW_QUESTIONS',
    ] as const
  ).map((c): [string, string] => [c, new InterviewPrepError(c).message]),
  ...(
    ['CV_DRAFT_INVALID_OUTPUT', 'CV_DRAFT_UNSUPPORTED_REFERENCE'] as const
  ).map((c): [string, string] => [c, new TailoredDraftError(c).message]),
  ...(['CV_PROFILE_INVALID_OUTPUT', 'CV_PROFILE_TIMEOUT'] as const).map(
    (c): [string, string] => [c, new SourceProfileError(c).message],
  ),
];

test.each(messages)('%s guidance is provider-neutral', (_code, message) => {
  expect(message).not.toMatch(/local (AI|model)/iu);
  // Ollama may be named only as conditional local-setup advice.
  if (/Ollama/u.test(message))
    expect(message).toMatch(/if you run AI locally/iu);
});

test('AI unavailable guidance keeps the conditional Ollama hint', () => {
  expect(new InterviewPrepError('INTERVIEW_AI_UNAVAILABLE').message).toBe(
    'The AI service is unavailable. If you run AI locally, check that Ollama is running, then try again.',
  );
  expect(new CvMatchError('CV_MATCH_UNAVAILABLE').message).toContain(
    'Check the AI service',
  );
});
