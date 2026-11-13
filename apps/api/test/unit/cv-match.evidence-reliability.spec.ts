import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from '@jest/globals';
import { parsePdf } from '../../src/extraction/pdf.parser.js';
import { createExtractionSource } from '../../src/extraction/extraction.validation.js';
import {
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';

// Synthetic beta job (docs/beta-local-gemini-setup.md) and parsed fixture PDFs.
const canonical: MatchRequirement[] = (
  [
    ['3+ years of experience with Node.js and TypeScript', 'required', 'skill'],
    ['Experience with PostgreSQL', 'required', 'skill'],
    ['Familiarity with Docker', 'preferred', 'skill'],
    ['Experience with Kubernetes', 'preferred', 'skill'],
    ['Minimum 3 years', 'required', 'experience'],
  ] as const
).map(([requirement, priority, category], index) => ({
  requirement,
  priority,
  category,
  jdQuote: requirement,
  cvQuote: '',
  parentId: `p${index + 1}`,
}));
const jd = canonical.map((item) => item.requirement).join('\n');
const nodeTs = canonical[0]!.requirement;
const fixture = async (name: string) =>
  createExtractionSource(
    (
      await parsePdf(
        new Uint8Array(
          readFileSync(
            new URL(
              `../../../../../docs/beta-samples/${name}`,
              import.meta.url,
            ),
          ),
        ),
      )
    ).source,
  ).text;
const assess = (cv: string, quote: (item: MatchRequirement) => string) => {
  const proposals = canonical.map((item) => ({
    ...item,
    cvQuote: quote(item),
  }));
  const result = scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
  return Object.fromEntries(
    result.requirements.map((item) => [item.requirement, item]),
  );
};

let scenarioA = '';
let scenarioB = '';
beforeAll(async () => {
  [scenarioA, scenarioB] = await Promise.all([
    fixture('synthetic-cv.pdf'),
    fixture('synthetic-cv-4-years.pdf'),
  ]);
});

describe.each([
  ['empty quotes', () => ''],
  ['an irrelevant exact quote', () => 'Alex Example'],
])('with %s', (_, quote) => {
  test('Scenario A: minimum experience recovered; Node/TS duration observed only', () => {
    const result = assess(scenarioA, quote);
    expect(result['Minimum 3 years']).toMatchObject({
      status: 'EVIDENCED',
      cvQuote:
        'Backend developer with 4 years of experience building REST APIs.',
    });
    expect(result[nodeTs]).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
    });
    for (const component of result[nodeTs]!.coverage.components)
      expect(component.observations).toEqual([
        {
          kind: 'experience',
          cvQuote: '- Built REST APIs with Node.js, TypeScript and NestJS.',
        },
      ]);
  });

  test('Scenario B: stated technology duration and minimum experience recovered', () => {
    const line =
      'Backend developer with 4 years of professional experience with Node.js and TypeScript.';
    const result = assess(scenarioB, quote);
    expect(result[nodeTs]).toMatchObject({ status: 'EVIDENCED', credit: 1 });
    for (const component of result[nodeTs]!.coverage.components) {
      expect(component).toMatchObject({ status: 'EVIDENCED', cvQuote: line });
      expect(component.observations).toBeUndefined();
    }
    expect(result['Minimum 3 years']).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: line,
    });
  });

  test.each([
    ['synthetic-cv.pdf', () => scenarioA],
    ['synthetic-cv-4-years.pdf', () => scenarioB],
  ])(
    '%s: PostgreSQL recovered from work; Docker and Kubernetes not matched',
    (_, cv) => {
      const result = assess(cv(), quote);
      expect(result['Experience with PostgreSQL']).toMatchObject({
        status: 'EVIDENCED',
        cvQuote: '- Designed PostgreSQL schemas and wrote migrations.',
      });
      // Docker appears only in a tools list: a keyword mention is not recovered.
      expect(result['Familiarity with Docker']!.status).toBe('NOT_EVIDENCED');
      expect(result['Experience with Kubernetes']).toMatchObject({
        status: 'NOT_EVIDENCED',
        cvQuote: '',
      });
    },
  );
});

test('a relevant model quote is still used', () => {
  const result = assess(scenarioA, (item) =>
    item.requirement === 'Familiarity with Docker'
      ? 'Tools: Git, Docker, Jest'
      : '',
  );
  expect(result['Familiarity with Docker']).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: 'Tools: Git, Docker, Jest',
  });
});

test('negation and aspiration block recovery', () => {
  const cv = [
    'I have never used PostgreSQL in production.',
    'Seeking to work with 5 years of experience in Node.js.',
    'Backend developer with 4 years of experience building REST APIs.',
  ].join('\n');
  const result = assess(
    cv,
    () => 'Backend developer with 4 years of experience building REST APIs.',
  );
  expect(result['Experience with PostgreSQL']!.status).toBe('NOT_EVIDENCED');
  expect(result[nodeTs]!.status).toBe('NOT_EVIDENCED');
});

test('insufficient general experience is not recovered', () => {
  const cv = 'Backend developer with 2 years of experience building REST APIs.';
  expect(assess(cv, () => '')['Minimum 3 years']!.status).toBe('NOT_EVIDENCED');
});

const coverage = (cv: string) =>
  evaluateCoverage(requirementGroup(nodeTs, 'skill'), [], cv, true);

test('AND duration needs every technology named with sufficient years', () => {
  const partial = coverage(
    '4 years of experience with Node.js. Used TypeScript daily.',
  );
  expect(partial).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
  expect(
    coverage('2 years of experience with Node.js and TypeScript.'),
  ).toMatchObject({
    credit: 0,
  });
});

test('job tenure or general experience never establishes technology duration', () => {
  const result = coverage(
    'Software Engineer — Jan 2018 to Present (6 years)\n6 years of experience building APIs with Node.js and TypeScript.',
  );
  expect(result.credit).toBe(0);
});
