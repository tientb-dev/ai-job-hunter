import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

const scenarios = [
  {
    name: 'AND CI/CD',
    requirement:
      'Experience designing cloud-based architectures, APIs, integrations, data flows, and CI/CD practices.',
    assertion: 'claim experience implementing CI/CD pipelines',
    positive: 'Implemented CI/CD pipelines.',
    component: 4,
    status: 'PARTIAL',
  },
  {
    name: 'technical OR',
    requirement: 'MCP or knowledge graphs',
    assertion: 'claim experience with MCP',
    positive: 'Built MCP servers.',
    component: 0,
    status: 'EVIDENCED',
  },
  {
    name: 'Education OR',
    requirement:
      "Bachelor's degree in Information Technology or equivalent practical experience",
    assertion: "claim a Bachelor's Degree in Information Technology",
    positive: "Bachelor's Degree in Information Technology",
    component: 0,
    status: 'EVIDENCED',
  },
] as const;
function assess(requirement: string, cv: string, selected = '') {
  const job = {
    title: 'Synthetic negation regression',
    skills: requirement,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  } as Opportunity;
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job);
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((parent) => ({ ...parent, cvQuote: selected })),
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}
const contractions = [
  "can't",
  'cannot',
  "couldn't",
  "don't",
  "doesn't",
  "didn't",
  "won't",
  "wouldn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "hasn't",
  "haven't",
  "hadn't",
];
for (const scenario of scenarios) {
  for (const contraction of contractions) {
    const variants = [
      ...new Set([
        contraction,
        contraction.replace("'", '’'),
        contraction.replace("'", ' \u00a0’\t '),
      ]),
    ];
    for (const variant of variants) {
      test(`${scenario.name}: ${variant} rejects omitted and selected denial`, () => {
        const cv = `I ${variant} ${scenario.assertion}.`;
        for (const selection of ['', cv]) {
          const result = assess(scenario.requirement, cv, selection);
          expect(result).toMatchObject({
            coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
            requirements: [{ status: 'NOT_EVIDENCED', credit: 0 }],
          });
          expect(
            result.requirements[0]!.coverage!.components[scenario.component],
          ).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
        }
      });
    }
  }
  test(`${scenario.name}: unrelated denial preserves exact positive evidence`, () => {
    const cv = `I can't speak Finnish.\n${scenario.positive}`;
    const result = assess(scenario.requirement, cv);
    expect(result).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: scenario.status }],
    });
    expect(
      result.requirements[0]!.coverage!.components[scenario.component],
    ).toMatchObject({ status: 'EVIDENCED', cvQuote: scenario.positive });
  });
  test(`${scenario.name}: genuine contraction contradiction earns no credit`, () => {
    const cv = `${scenario.positive}\nI can’t ${scenario.assertion}.`;
    const result = assess(scenario.requirement, cv);
    expect(result).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'CONFLICT', credit: 0 }],
    });
    expect(
      result.requirements[0]!.coverage!.components[scenario.component],
    ).toMatchObject({
      status: 'CONFLICT',
      conflictingQuotes: [`I can’t ${scenario.assertion}.`],
    });
  });
  test(`${scenario.name}: unrelated positive cannot rescue denied evidence`, () => {
    const result = assess(
      scenario.requirement,
      `I can't ${scenario.assertion}.\nBuilt Python services.`,
    );
    expect(result).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'NOT_EVIDENCED', credit: 0 }],
    });
  });
}

test.each([
  "I can't design CI/CD pipelines",
  'I can’t design CI/CD pipelines',
  "I can't use MCP",
  'I can’t use MCP',
  "I can't claim a Bachelor's Degree",
  'I can’t claim a Bachelor’s Degree',
])('%s earns zero recovered credit', (cv) => {
  const scenario = cv.includes('CI/CD')
    ? scenarios[0]
    : cv.includes('MCP')
      ? scenarios[1]
      : scenarios[2];
  expect(assess(scenario.requirement, cv)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'NOT_EVIDENCED', credit: 0 }],
  });
});
