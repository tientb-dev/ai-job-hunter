import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { configureCvMatchDiagnostics } from '../../src/matching/cv-match.diagnostics.js';
import {
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import { CvMatchError } from '../../src/matching/cv-match.error.js';
// The detailed rejection event is opt-in (CV_MATCH_DIAGNOSTICS=1).
beforeEach(() => {
  configureCvMatchDiagnostics(true);
});
afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});
const cv = 'PRIVATE_SYNTHETIC_CV_SENTINEL';
const jd = 'Production AI/ML model development\nPRIVATE_SYNTHETIC_JD_SENTINEL';
const row = (changes: Partial<MatchRequirement> = {}): MatchRequirement => ({
  requirement: 'PRIVATE_REQUIREMENT_LABEL',
  priority: 'required',
  category: 'skill',
  jdQuote: 'PRIVATE_SYNTHETIC_JD_SENTINEL',
  cvQuote: cv,
  ...changes,
});
test.each([
  ['JD_QUOTE_EMPTY', row({ jdQuote: '  ' })],
  ['JD_QUOTE_NOT_VERBATIM', row({ jdQuote: 'PRIVATE_FABRICATED_JD_QUOTE' })],
  [
    'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT',
    row({
      requirement: 'Production AI/ML model development',
      jdQuote: 'Production AI/ML model development',
      cvQuote: 'PRIVATE_COPILOT_QUOTE',
    }),
  ],
  [
    'NO_VERIFIABLE_CV_QUOTES',
    row({ cvQuote: 'PRIVATE_FABRICATED_CV_QUOTE', category: 'experience' }),
  ],
] as const)(
  '%s emits one safe diagnostic and preserves the public failure contract',
  (reason, invalid) => {
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const good = row();
    // For the all-CV-rejected case, no other nonempty CV quote may survive.
    const proposals = [
      [
        'NO_VERIFIABLE_CV_QUOTES',
        'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT',
      ].includes(reason)
        ? row({ cvQuote: '' })
        : good,
      invalid,
    ];
    let caught: unknown;
    try {
      validateMatchAssessment(proposals, cv, jd, []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CvMatchError);
    const error = caught as CvMatchError;
    expect(error.errorCode).toBe('CV_MATCH_EVIDENCE_REJECTED');
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toBe(
      'Matching evidence could not be verified against the saved sources. Retry analysis; no new fit score was produced.',
    );
    expect(write).toHaveBeenCalledTimes(1);
    const log = String(write.mock.calls[0]![0]);
    const parsed = JSON.parse(log);
    expect(parsed).toEqual({
      event: 'CV_MATCH_EVIDENCE_REJECTED',
      reason,
      requirementIndex: 1,
      category: invalid.category,
      counts: {
        requirements: 2,
        cvAccepted:
          reason === 'NO_VERIFIABLE_CV_QUOTES'
            ? 0
            : reason === 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT'
              ? 0
              : 2,
        cvRejected:
          reason === 'NO_VERIFIABLE_CV_QUOTES' ||
          reason === 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT'
            ? 1
            : 0,
        cvEmpty: [
          'NO_VERIFIABLE_CV_QUOTES',
          'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT',
        ].includes(reason)
          ? 1
          : 0,
        jdAccepted: reason.startsWith('JD_QUOTE') ? 1 : 2,
        jdRejected: reason.startsWith('JD_QUOTE') ? 1 : 0,
      },
    });
    expect(log).not.toContain('PRIVATE');
    expect(JSON.stringify(error.getResponse())).not.toContain(reason);
  },
);
test('successful and partially downgraded assessments emit no rejection event', () => {
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(
    validateMatchAssessment(
      [row(), row({ cvQuote: 'PRIVATE_INVALID' })],
      cv,
      jd,
      [],
    ),
  ).toHaveLength(2);
  expect(write).not.toHaveBeenCalled();
});
test('unexpected category text is omitted and logging failure does not alter rejection', () => {
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(() =>
    validateMatchAssessment(
      [
        row({
          category: 'PRIVATE_CATEGORY' as 'skill',
          jdQuote: 'PRIVATE_INVALID',
        }),
      ],
      cv,
      jd,
      [],
    ),
  ).toThrow(CvMatchError);
  expect(JSON.parse(String(write.mock.calls[0]![0]))).not.toHaveProperty(
    'category',
  );
  expect(String(write.mock.calls[0]![0])).not.toContain('PRIVATE');
  write.mockImplementation(() => {
    throw new Error('synthetic logger failure');
  });
  expect(() =>
    validateMatchAssessment([row({ jdQuote: 'PRIVATE_INVALID' })], cv, jd, []),
  ).toThrow('Matching evidence could not be verified');
});
