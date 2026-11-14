import { expect, test } from '@jest/globals';
import { resolveCvQuote } from '../../src/matching/cv-match.evidence.js';
import {
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
const row = (requirement: string, cvQuote = ''): MatchRequirement => ({
  requirement,
  cvQuote,
  jdQuote: requirement,
  priority: 'required',
  category: 'skill',
});
test('exact quotes are unchanged, including repeated verbatim text', () => {
  expect(resolveCvQuote('Java\nJava', 'Java')).toBe('Java');
});
test.each([
  ['Built Java\n  Spring Boot services.', 'Built Java Spring Boot services.'],
  [
    '6+\u00a0years\tbuilding\r\nenterprise software.',
    '6+ years building enterprise software.',
  ],
  ['Skills: Java  Spring Boot', 'Java Spring Boot'],
])(
  'whitespace-equivalent quote maps to the exact original contiguous span',
  (source, quote) => {
    const original = resolveCvQuote(source, quote)!;
    expect(original).not.toBeNull();
    expect(source).toContain(original);
    expect(original.replace(/\s+/gu, ' ')).toBe(quote);
  },
);
test.each([
  ['Java  Spring Boot; Java\nSpring Boot', 'Java Spring Boot'],
  ['Backend — Java', 'Backend - Java'],
  ['Công nghệ Java', 'Công nghệ Java'.normalize('NFD')],
  ['Java services', 'Scala services'],
  ['Java services', 'java services'],
])(
  'ambiguous or non-whitespace-equivalent evidence cannot resolve',
  (source, quote) => {
    expect(resolveCvQuote(source, quote)).toBeNull();
  },
);
test('one invalid model match is downgraded without recovering replacement evidence or losing valid matches', () => {
  const source =
    'Built Java\n  Spring Boot services.\nSkills: Java, Spring Boot\n6+ years building enterprise software.';
  const canonical = [
    row('Backend Java'),
    row('Experience'),
    row('Spring Boot'),
  ];
  const original = [
    row('Backend Java', 'Invented Scala experience'),
    row('Experience', '6+ years building enterprise software.'),
    row('Spring Boot', 'Built Java Spring Boot services.'),
  ];
  const snapshot = JSON.stringify(original);
  const verified = validateMatchAssessment(
    original,
    source,
    'Backend Java\nExperience\nSpring Boot',
    canonical,
  );
  const result = scoreCvMatch(
    verified,
    source,
    'Backend Java\nExperience\nSpring Boot',
    canonical,
  );
  expect(result.requirements[0]).toMatchObject({
    status: 'NOT_EVIDENCED',
    cvQuote: '',
  });
  expect(result.requirements[1]?.status).toBe('EVIDENCED');
  // Named-technology relevance: "Spring Boot" and the work verb sit on
  // different lines of a non-bullet wrap, which is not a reliably bounded unit
  // (PR67 boundaries), so it fails closed instead of linking across lines.
  expect(result.requirements[2]).toMatchObject({
    status: 'NOT_EVIDENCED',
  });
  expect(result.score).toBe(33);
  expect(
    result.requirements.every((item) => !('cvEvidenceUnverified' in item)),
  ).toBe(true);
  expect(JSON.stringify(original)).toBe(snapshot);
});
test('an assessment whose proposed matches all have unverifiable evidence fails instead of reporting zero', () => {
  expect(() =>
    validateMatchAssessment(
      [row('SQL', 'Fabricated SQL experience')],
      'Java experience',
      'SQL',
      [],
    ),
  ).toThrow(/evidence/i);
});
test('missing sources and incomplete assessment remain hard failures', () => {
  expect(() =>
    validateMatchAssessment([row('Java')], '', 'Java', [row('Java')]),
  ).toThrow(/CV/);
  expect(() =>
    validateMatchAssessment([row('Java')], 'CV', '', [row('Java')]),
  ).toThrow();
  expect(() =>
    validateMatchAssessment([], 'CV', 'Java', [row('Java')]),
  ).toThrow();
});
