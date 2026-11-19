import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const golden = JSON.parse(
  readFileSync(
    '../../docs/audits/fixtures/itviec-ai-solution-architect.golden.json',
    'utf8',
  ),
) as { mustHave: { quote: string }[] };
const requirement = golden.mustHave[5]!.quote;
const job = (skills = requirement, preferredSkills = '') =>
  ({
    title: 'Synthetic P6.9 CI/CD practices',
    skills,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  }) as Opportunity;
function assess(cv: string, quote = '', saved = job()) {
  const canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const proposals = canonical.map((parent) => ({ ...parent, cvQuote: quote }));
  return scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
}
const positive = [
  'Optimized GitLab CI/CD pipelines.',
  'Optimized GitLab CI/CD pipelines for faster builds, tests and deployments.',
  'Implemented automated CI/CD pipelines.',
  'Configured GitLab CI/CD pipelines.',
  'Designed CI/CD pipelines.',
  'CI/CD pipeline design experience.',
  'Designed CI/CD practices.',
  'Configured our existing GitLab CI/CD pipelines.',
  'Implemented continuous integration and continuous delivery pipelines.',
  'Implemented automated build, test and deployment pipelines.',
  'Configured automated build and deployment workflows.',
  'Experience implementing CI/CD pipelines.',
  'Experience optimizing GitLab CI/CD pipelines.',
  'Optimised CI/CD pipelines for deployments.',
  'Implemented REST APIs and GitLab CI/CD pipelines.',
];
test.each(positive)(
  'positive practice evidence earns only its own component: %s',
  (cv) => {
    for (const selection of ['', cv]) {
      const result = assess(cv, selection);
      expect(result).toMatchObject({
        coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
        requirements: [{ status: 'PARTIAL', credit: 0.2, cvQuote: cv }],
      });
      expect(
        result.requirements[0]!.coverage.components.filter(
          (row) => row.status === 'EVIDENCED',
        ),
      ).toEqual([
        expect.objectContaining({
          id: 'c5',
          label: 'CI/CD practices',
          cvQuote: cv,
        }),
      ]);
    }
  },
);

test.each([
  'Skills: GitLab CI/CD.',
  'GitLab CI/CD pipelines.',
  'Used GitLab.',
  'Implemented a pipeline.',
  'Optimized SQL queries.',
  'Optimized REST APIs using GitLab CI/CD pipelines.',
  'Configured RabbitMQ using CI/CD pipelines.',
  'Implemented CI/CD pipeline documentation.',
  'Never optimized GitLab CI/CD pipelines.',
  'No CI/CD experience.',
  'Did not implement CI/CD pipelines.',
  'Interested in optimizing CI/CD pipelines.',
  'I will implement CI/CD pipelines.',
  'I want to configure CI/CD pipelines.',
  'If I implemented CI/CD pipelines, builds would improve.',
  'Planned CI/CD pipelines.',
  'Implemented CI/CD pipelines, incomplete.',
  'Configured CI/CD pipelines for a tutorial.',
  'Designed CI/CD pipeline documentation.',
  'Designed SQL queries using CI/CD pipelines.',
  'Used Copilot for CI/CD pipeline examples.',
])('unsupported/non-positive/unrelated wording stays Unknown: %s', (cv) => {
  for (const selection of ['', cv]) {
    expect(assess(cv, selection)).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'NOT_EVIDENCED', credit: 0 }],
    });
  }
});

test('CI/CD implementation does not relax other component design requirements', () => {
  const cv =
    'Implemented REST APIs using microservices and RabbitMQ.\nOptimized GitLab CI/CD pipelines for AWS deployments.';
  const result = assess(cv);
  expect(result).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'PARTIAL', credit: 0.2 }],
  });
  expect(
    result.requirements[0]!.coverage.components.slice(0, 4).every(
      (row) => row.status === 'NOT_EVIDENCED',
    ),
  ).toBe(true);
});

test('only pipeline evidence changes when design wording is replaced by optimization wording', () => {
  const cv = 'Designed REST APIs.\nOptimized GitLab CI/CD pipelines.';
  expect(assess(cv)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'PARTIAL', credit: 0.4 }],
  });
});

test('source-backed contradictory CI/CD statements cause Conflict / zero parent credit', () => {
  const positive = 'Optimized GitLab CI/CD pipelines.',
    negative = 'Never implemented or optimized CI/CD pipelines.';
  const result = assess(`${positive}\n${negative}`);
  expect(result).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'CONFLICT', credit: 0 }],
  });
  expect(result.requirements[0]!.coverage.components[4]).toMatchObject({
    cvQuote: positive,
    conflictingQuotes: [negative],
    status: 'CONFLICT',
  });
});

test('equivalent automation context participates in the same conflict check', () => {
  const cv =
    'Implemented automated build and deployment pipelines.\nNever implemented automated build and deployment pipelines.';
  expect(assess(cv).requirements[0]!.status).toBe('CONFLICT');
});

test('component-specific equivalence does not change design-context OR semantics', () => {
  const cv = 'Optimized GitLab CI/CD pipelines.';
  const saved = job('Experience designing CI/CD practices or APIs');
  for (const selection of ['', cv]) {
    expect(assess(cv, selection, saved).requirements[0]).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
      cvQuote: '',
    });
  }
});

test('canonical parent weights and partial required recommendation guard remain', () => {
  const cv = 'Optimized GitLab CI/CD pipelines.\nSkills: Rust.';
  const saved = job(requirement, 'Rust\nKotlin'),
    canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const proposals = canonical.map((parent, index) => ({
    ...parent,
    cvQuote: index === 1 ? 'Skills: Rust.' : '',
  }));
  expect(
    scoreCvMatch(
      validateMatchAssessment(proposals, cv, jd, canonical),
      cv,
      jd,
      canonical,
    ),
  ).toMatchObject({
    score: Math.round(((75 / 5) * 3 + 40) / 5),
    coverageHidden: null,
    requirements: [{ credit: 0.2 }, { credit: 1 }, { credit: 0 }],
  });
});

test('fabricated/rejected parent and component quotations are never rescued by actual CI/CD experience', () => {
  const saved = job(`${requirement}\nPython`),
    canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const cv = 'Optimized GitLab CI/CD pipelines.\nBuilt Python services.';
  const proposals = canonical.map((parent, index) => ({
    ...parent,
    cvQuote: index ? 'Built Python services.' : 'Fabricated CI/CD claim.',
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  expect(
    scoreCvMatch(verified, cv, jd, canonical).requirements[0],
  ).toMatchObject({ status: 'NOT_EVIDENCED', credit: 0 });
  const component = requirementGroup(requirement, 'skill').components[4]!;
  expect(() =>
    validateMatchAssessment(
      [
        {
          ...canonical[0]!,
          components: [
            {
              componentId: component.id,
              jdQuote: component.jdQuote,
              cvQuote: 'Fabricated CI/CD claim.',
            },
          ],
        },
        proposals[1]!,
      ],
      cv,
      jd,
      canonical,
    ),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
  expect(() =>
    validateMatchAssessment(
      [{ ...canonical[0]!, jdQuote: 'Fabricated requirement' }, proposals[1]!],
      cv,
      jd,
      canonical,
    ),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
});

test('an API design statement that uses a pipeline does not claim pipeline design', () => {
  const cv = 'Designed REST APIs using CI/CD pipelines.';
  for (const selection of ['', cv]) {
    const result = assess(cv, selection);
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
    expect(
      result.requirements[0]!.coverage.components.filter(
        (row) => row.status === 'EVIDENCED',
      ).map((row) => row.label),
    ).toEqual(['APIs']);
  }
});
