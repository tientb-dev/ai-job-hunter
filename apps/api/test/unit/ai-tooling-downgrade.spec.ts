import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { configureCvMatchDiagnostics } from '../../src/matching/cv-match.diagnostics.js';
import {
  validateMatchAssessment,
  scoreCvMatch,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
// The detailed rejection event is opt-in (CV_MATCH_DIAGNOSTICS=1).
beforeEach(() => {
  configureCvMatchDiagnostics(true);
});
afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});
const row = (
  requirement: string,
  cvQuote = '',
  priority: 'required' | 'preferred' = 'required',
): MatchRequirement => ({
  requirement,
  jdQuote: requirement,
  cvQuote,
  priority,
  category: 'skill',
});
const production = 'Production AI/ML and LLM API integration';
const java = 'Backend Java';
const javaQuote = 'Backend — Java, Spring Boot';
test.each([
  'Cursor',
  'Copilot',
  'ChatGPT',
  'Claude Code',
  'AI-assisted coding tools',
])(
  '%s use cannot inflate production match; other verified skills still count',
  (tool) => {
    const toolQuote = `Used ${tool} to assist coding.`;
    const cv = `${javaQuote}\n${toolQuote}`;
    const canonical = [row(java), row(production), row('Kotlin')];
    const proposals = [
      row(java, javaQuote),
      row(production, toolQuote),
      row('Kotlin'),
    ];
    const jd = `${java}\n${production}\nKotlin`;
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const verified = validateMatchAssessment(proposals, cv, jd, canonical);
    expect(verified[1]).toMatchObject({
      cvQuote: '',
      cvEvidenceUnverified: true,
    });
    const result = scoreCvMatch(verified, cv, jd, canonical);
    expect(result).toMatchObject({
      score: null,
      coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
    });
    expect(result.requirements[0]?.status).toBe('EVIDENCED');
    expect(result.requirements[1]).toMatchObject({
      status: 'NOT_EVIDENCED',
      cvQuote: '',
      priority: 'required',
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(write.mock.calls[0]![0]))).toMatchObject({
      event: 'CV_MATCH_EVIDENCE_DOWNGRADED',
      reason: 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT',
      requirementIndex: 1,
    });
    expect(String(write.mock.calls[0]![0])).not.toContain(toolQuote);
  },
);
test('independent verbatim production evidence is retained, even after an invalid proposal for the same requirement', () => {
  const toolQuote = 'Used Copilot for coding.';
  const actual =
    'Developed and deployed production AI/ML services and integrated LLM APIs.';
  const cv = `${toolQuote}\n${actual}`;
  const canonical = [row(production, '', 'preferred')];
  const verified = validateMatchAssessment(
    [
      row(production, toolQuote, 'preferred'),
      row(production, actual, 'preferred'),
    ],
    cv,
    production,
    canonical,
  );
  const result = scoreCvMatch(verified, cv, production, canonical);
  expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  expect(result.requirements).toHaveLength(1);
  expect(result.requirements[0]).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: actual,
    priority: 'preferred',
  });
});
test('tool-only rejected assessment still fails closed and emits one rejection', () => {
  const quote = 'Used Cursor for coding.';
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(() =>
    validateMatchAssessment([row(production, quote)], quote, production, [
      row(production),
    ]),
  ).toThrow(/evidence/i);
  expect(write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(write.mock.calls[0]![0]))).toMatchObject({
    event: 'CV_MATCH_EVIDENCE_REJECTED',
    reason: 'AI_TOOLING_FOR_PRODUCTION_REQUIREMENT',
  });
});

test.each([
  ['Deployed production ML models serving real users.', true, true],
  [
    'Deployed production ML models serving real users and used Copilot to write tests.',
    true,
    true,
  ],
  ['Used Copilot to write tests.', true, false],
  [
    'Never deployed production ML models and used Copilot to write tests.',
    true,
    false,
  ],
  [
    'Would have deployed production ML models and used Copilot to write tests.',
    true,
    false,
  ],
  ['Used Copilot to write tests for production ML models.', true, false],
  [
    'Deployed production ML models and used Copilot to write tests.',
    false,
    false,
  ],
] as const)(
  'verifies production deployment evidence independently of tooling (%s)',
  (quote, verbatim, qualifies) => {
    const requirement = 'Deploy production ML models';
    const cv = verbatim ? `${javaQuote}\n${quote}` : javaQuote;
    const jd = `${requirement}\n${java}`;
    const canonical = [row(requirement), row(java)];
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const verified = validateMatchAssessment(
      [row(requirement, quote), row(java, javaQuote)],
      cv,
      jd,
      canonical,
    );
    expect(verified[0]?.cvQuote).toBe(qualifies ? quote : '');
    expect(
      scoreCvMatch(verified, cv, jd, canonical).requirements[0]?.status,
    ).toBe(qualifies ? 'EVIDENCED' : 'NOT_EVIDENCED');
  },
);
