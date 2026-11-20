import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const golden = JSON.parse(
  readFileSync(
    '../../docs/audits/fixtures/itviec-ai-solution-architect.golden.json',
    'utf8',
  ),
) as { mustHave: { quote: string }[] };
const requirement = golden.mustHave[0]!.quote;
const degree = "Bachelor's Degree in Information Technology";
const job = (skills = requirement) =>
  ({
    title: 'Synthetic degree recovery',
    skills,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  }) as Opportunity;
function assess(cv: string, selection = '') {
  const canonical = canonicalRequirements(job()),
    jd = matchJobText(job());
  return scoreCvMatch(
    validateMatchAssessment(
      [{ ...canonical[0]!, cvQuote: selection }],
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}

test.each([
  degree,
  `${degree}\nGraduated: 2019`,
  'Bachelor’s Degree in Information Technology\r\nGraduated: 2019',
  "Bachelor's Degree in\nInformation Technology\nGraduated: 2019",
  "Bachelor's Degree\nMajor: Information Technology\nCompleted: 2019",
])(
  'omitted completed degree recovers the exact bounded original quote: %s',
  (quote) => {
    const cv = `EDUCATION\nSynthetic University\n${quote}`;
    const result = assess(cv);
    expect(result).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'EVIDENCED', credit: 1, cvQuote: quote }],
    });
    expect(result.requirements[0]!.coverage.components[0]!.cvQuote).toBe(quote);
    expect(result.requirements[0]!.coverage.components[1]!.status).toBe(
      'NOT_EVIDENCED',
    );
    expect(cv).toContain(result.requirements[0]!.cvQuote);
  },
);

test.each([
  'Nong Lam University\nGraduated: 2019',
  'University attendance, Information Technology, 2019',
  "Attended a Bachelor's Degree in Information Technology program.",
  "Bachelor's Degree in Physics\nGraduated: 2019",
  'Six years of experience building software systems.',
  'Equivalent practical experience: eight years building software systems.',
  "Bachelor's Degree in\n\nInformation Technology",
  "Bachelor's Degree in\nAnother University\nInformation Technology",
  "Bachelor's Degree in Physics\nInformation Technology",
  "Bachelor's Degree\nMaster's Degree in Information Technology",
  `No ${degree}`,
  `Never completed ${degree}`,
  `Pursuing ${degree}`,
  `${degree}\nStatus: pending`,
  `In progress\n${degree}`,
  `${degree}\nExpected graduation: 2028`,
  `${degree}\nDegree not awarded`,
  `${degree}\nAwaiting completion`,
  `I intend to earn ${degree}`,
  `If I had a ${degree}`,
  `I plan to earn ${degree}`,
  'I have no degree.',
])('unsupported attendance/degree/context remains Unknown: %s', (cv) => {
  expect(assess(cv)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'NOT_EVIDENCED', credit: 0, cvQuote: '' }],
  });
});

test('a selected degree-only line cannot hide adjacent pending status', () => {
  expect(
    assess(`${degree}\nStatus: pending`, degree).requirements[0]!.status,
  ).toBe('NOT_EVIDENCED');
});

test('contradictory degree statements retain positive and negative source quotations with zero credit', () => {
  const negative = `Never completed ${degree}`;
  const cv = `${degree}\n\n${negative}`;
  const row = assess(cv).requirements[0]!;
  expect(row).toMatchObject({ status: 'CONFLICT', credit: 0, cvQuote: degree });
  expect(row.coverage.components[0]!.conflictingQuotes).toEqual([negative]);
});

test('rejected model parent evidence is not rescued by an actual degree elsewhere in the CV', () => {
  const saved = job(`${requirement}\nPython`),
    canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const cv = `${degree}\nBuilt Python services.`;
  const proposals = canonical.map((row, index) => ({
    ...row,
    cvQuote: index ? 'Built Python services.' : 'Invented degree quotation.',
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  expect(
    scoreCvMatch(verified, cv, jd, canonical).requirements[0]!.status,
  ).toBe('NOT_EVIDENCED');
});

test('fabricated component and fabricated-only parent selections preserve typed rejection', () => {
  const canonical = canonicalRequirements(job()),
    jd = matchJobText(job());
  const fabricated = {
    ...canonical[0]!,
    cvQuote: 'Invented degree quotation.',
  };
  expect(() =>
    validateMatchAssessment([fabricated], degree, jd, canonical),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
  expect(() =>
    validateMatchAssessment(
      [
        {
          ...canonical[0]!,
          components: [
            {
              componentId: 'c1',
              jdQuote: requirement.replace(
                /, or equivalent practical experience\.$/u,
                '',
              ),
              cvQuote: 'Invented degree quotation.',
            },
          ],
        },
      ],
      degree,
      jd,
      canonical,
    ),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
});

test('a blanket degree denial conflicts with a positive degree declaration', () => {
  const cv = `${degree}\n\nI have no degree.`;
  expect(assess(cv).requirements[0]).toMatchObject({
    status: 'CONFLICT',
    credit: 0,
  });
});

test('a recovered bachelor degree cannot satisfy a higher or unspecified canonical degree', () => {
  for (const requirement of [
    "Master's degree in Information Technology or equivalent practical experience",
    'Degree in Information Technology or equivalent practical experience',
  ]) {
    const saved = job(requirement),
      canonical = canonicalRequirements(saved),
      jd = matchJobText(saved);
    const proposals = canonical.map((row) => ({ ...row, cvQuote: '' }));
    expect(
      scoreCvMatch(
        validateMatchAssessment(proposals, degree, jd, canonical),
        degree,
        jd,
        canonical,
      ).requirements[0],
    ).toMatchObject({ credit: 0, cvQuote: '' });
  }
});

test('a pending second degree in a different field does not contradict a completed IT degree', () => {
  const cv = `${degree}\nGraduated: 2019\n\nPursuing Bachelor's Degree in Computer Science`;
  expect(assess(cv).requirements[0]).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
    cvQuote: `${degree}\nGraduated: 2019`,
  });
});

test('a graduation-date-only component cannot rescue a rejected parent by borrowing the degree from nearby text', () => {
  const saved = job(`${requirement}\nPython`),
    canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const cv = `${degree}\nGraduated: 2019\nBuilt Python services.`;
  const proposals = canonical.map((row, index) => ({
    ...row,
    cvQuote: index ? 'Built Python services.' : 'Fabricated degree.',
    ...(index
      ? {}
      : {
          components: [
            {
              componentId: 'c1',
              jdQuote: requirementGroup(requirement, 'skill').components[0]!
                .jdQuote,
              cvQuote: 'Graduated: 2019',
            },
          ],
        }),
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  expect(
    scoreCvMatch(verified, cv, jd, canonical).requirements[0],
  ).toMatchObject({ status: 'NOT_EVIDENCED', credit: 0 });
});
