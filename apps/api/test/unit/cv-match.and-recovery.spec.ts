import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
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
    title: 'Synthetic P6.7 architecture',
    skills,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  }) as Opportunity;
function assess(cv: string, saved = job()) {
  const canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const proposals = canonical.map((parent) => ({ ...parent, cvQuote: '' }));
  return scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
}
const evidence = [
  ['cloud-based architectures', 'Architected cloud-based architectures.'],
  ['APIs', 'Designed REST APIs.'],
  ['integrations', 'Designed service integrations using RabbitMQ.'],
  ['data flows', 'Designed data flows between services.'],
  ['CI/CD practices', 'Designed GitLab CI/CD pipelines.'],
] as const;

test.each(evidence)(
  'explicit %s recovers one component as Partial, never a full parent',
  (label, quote) => {
    const result = assess(quote);
    expect(result).toMatchObject({
      score: 20,
      recommendation: 'Low Fit',
      requirements: [{ status: 'PARTIAL', credit: 0.2 }],
    });
    expect(
      result.requirements[0]!.coverage.components.filter(
        (row) => row.status === 'EVIDENCED',
      ),
    ).toEqual([expect.objectContaining({ label, cvQuote: quote })]);
  },
);

test.each([
  'Designed application programming interfaces.',
  'REST API design experience.',
  'Experience designing REST APIs.',
])('bounded equivalent API design wording is recognized: %s', (quote) => {
  expect(assess(quote).requirements[0]!.coverage.components[1]).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: quote,
  });
});

test('three supported design components preserve exact source quotes and score 60 / Consider', () => {
  const quotes = [evidence[1][1], evidence[2][1], evidence[4][1]];
  const result = assess(quotes.join('\r\n'));
  expect(result).toMatchObject({
    score: 60,
    recommendation: 'Consider',
    requirements: [{ status: 'PARTIAL', credit: 0.6 }],
  });
  expect(
    result.requirements[0]!.coverage.components.filter(
      (row) => row.status === 'EVIDENCED',
    ).map((row) => row.cvQuote),
  ).toEqual(quotes);
});

test('five independently verified components are required for Matched / Apply', () => {
  const result = assess(evidence.map(([, quote]) => quote).join('\n'));
  expect(result).toMatchObject({
    score: 100,
    recommendation: 'Apply',
    requirements: [{ status: 'EVIDENCED', credit: 1 }],
  });
  expect(
    result.requirements[0]!.coverage.components.every(
      (row) => row.cvQuote && row.status === 'EVIDENCED',
    ),
  ).toBe(true);
  for (const [missing] of evidence) {
    const partial = assess(
      evidence
        .filter(([label]) => label !== missing)
        .map(([, quote]) => quote)
        .join('\n'),
    );
    expect(partial).toMatchObject({
      score: 80,
      recommendation: 'Consider',
      requirements: [{ status: 'PARTIAL', credit: 0.8 }],
    });
    expect(
      partial.requirements[0]!.coverage.components.find(
        (row) => row.label === missing,
      )!.status,
    ).toBe('NOT_EVIDENCED');
  }
});

test.each([
  'Synthetic unrelated work.',
  'AWS.',
  'Skills: AWS, REST APIs, RabbitMQ, GitLab CI/CD, microservices.',
  'Used AWS and RabbitMQ.',
  'Designed AWS deployments.',
  'Designed RabbitMQ queues.',
  'Implemented REST APIs.',
  'Never designed REST APIs.',
  'No GitLab CI/CD design experience.',
  'Aspiring REST API designer.',
  'I want REST API design experience.',
  'I will design GitLab CI/CD pipelines.',
  'Incomplete REST API design experience.',
  'Planned REST API design experience.',
  'If I had REST API design experience.',
  'Designed REST API documentation.',
  'Used Copilot for REST API design experience.',
])(
  'keywords, implementation-only, unsupported and non-positive evidence stay Unknown: %s',
  (cv) => {
    expect(assess(cv)).toMatchObject({
      score: 0,
      requirements: [{ status: 'NOT_EVIDENCED', credit: 0 }],
    });
  },
);

test('AWS/RabbitMQ in otherwise valid API and CI/CD work cannot fill the remaining components', () => {
  const cv =
    'Designed REST APIs using AWS and RabbitMQ.\nDesigned GitLab CI/CD pipelines.';
  const result = assess(cv);
  expect(result).toMatchObject({
    score: 40,
    recommendation: 'Consider',
    requirements: [{ status: 'PARTIAL', credit: 0.4 }],
  });
  expect(
    result.requirements[0]!.coverage.components.filter(
      (row) => row.status === 'EVIDENCED',
    ).map((row) => row.label),
  ).toEqual(['APIs', 'CI/CD practices']);
});

test('contradictory positive/negative design assertions cause Conflict with zero parent credit', () => {
  const positive = 'Designed REST APIs.',
    negative = 'Never designed REST APIs.';
  const result = assess(
    `${positive}\n${negative}\nDesigned GitLab CI/CD pipelines.`,
  );
  expect(result).toMatchObject({
    score: 0,
    requirements: [{ status: 'CONFLICT', credit: 0 }],
  });
  expect(result.requirements[0]!.coverage.components[1]).toMatchObject({
    status: 'CONFLICT',
    cvQuote: positive,
    conflictingQuotes: [negative],
  });
});

test('unrecognized, ambiguous and non-design AND groups gain no new recovery', () => {
  for (const text of [
    'Experience designing temporal routing and flux circuits',
    'Experience with APIs and integrations',
    'Working knowledge of RAG and vector search',
    'Experience designing APIs and integrations or data flows',
  ]) {
    expect(
      assess(
        'Designed temporal routing, flux circuits, APIs, integrations and data flows. Skills: RAG, vector search.',
        job(text),
      ).score,
    ).toBe(0);
  }
});

test('rejected parent and fabricated component/JD evidence cannot be rescued by valid design text', () => {
  const saved = job(`${requirement}\nPython`),
    canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const cv = `${evidence.map(([, quote]) => quote).join('\n')}\nBuilt Python services.`;
  const proposals = canonical.map((parent, index) => ({
    ...parent,
    cvQuote: index
      ? 'Built Python services.'
      : 'Fabricated design qualification.',
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  expect(
    scoreCvMatch(verified, cv, jd, canonical).requirements[0],
  ).toMatchObject({ status: 'NOT_EVIDENCED', credit: 0 });
  const component = requirementGroup(requirement, 'skill').components[1]!;
  expect(() =>
    validateMatchAssessment(
      [
        {
          ...canonical[0]!,
          cvQuote: '',
          components: [
            {
              componentId: component.id,
              jdQuote: component.jdQuote,
              cvQuote: 'Invented APIs.',
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
      [{ ...canonical[0]!, jdQuote: 'Fabricated JD clause' }, proposals[1]!],
      cv,
      jd,
      canonical,
    ),
  ).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
  );
});

test('required/preferred parent weights and denominator remain unchanged', () => {
  const cv = 'Designed REST APIs.\nBuilt MCP servers.';
  expect(
    assess(cv, job(requirement, 'MCP or knowledge graphs.')),
  ).toMatchObject({ score: 40, recommendation: 'Consider' });
});

test('full public JD with omitted selections gains only the three explicit architecture design components', () => {
  const live = JSON.parse(
    readFileSync(
      '../../docs/audits/fixtures/itviec-ai-solution-architect.live-p55d.json',
      'utf8',
    ),
  ) as { normalizedFields: { field: string; value: string }[] };
  const fields = Object.fromEntries(
    live.normalizedFields.map((row) => [row.field, row.value]),
  );
  const saved = {
    ...job(),
    skills: fields.skills!,
    preferredSkills: fields.preferredSkills!,
    experience: fields.experience!,
    domain: fields.domain!,
  };
  const cv =
    "EDUCATION\nSynthetic University\nBachelor's Degree in Information Technology\nGraduated: 2019\nProfessional Summary: 6 years of experience building software systems.\nDesigned REST APIs.\nDesigned service integrations using RabbitMQ.\nDesigned GitLab CI/CD pipelines.";
  const result = assess(cv, saved);
  expect(result.score).toBe(22);
  expect(
    result.requirements.filter((row) => row.status === 'EVIDENCED'),
  ).toHaveLength(2);
  expect(
    result.requirements.filter((row) => row.status === 'PARTIAL'),
  ).toHaveLength(1);
  expect(
    result.requirements.filter((row) => row.status === 'NOT_EVIDENCED'),
  ).toHaveLength(12);
  expect(
    result.requirements.find(
      (row) => row.requirement === requirement.replace(/\.$/u, ''),
    ),
  ).toMatchObject({ status: 'PARTIAL', credit: 0.6 });
});

test('retained synthetic P6.7 raw live response validates and replays without model-output edits', () => {
  const capture = JSON.parse(
    readFileSync(
      '../../docs/audits/fixtures/p67-synthetic-and-match.json',
      'utf8',
    ),
  ) as {
    fixture: { cv: string; required: string; preferred: string };
    rawModelOutput: { requirements: MatchRequirement[] };
  };
  const saved = job(capture.fixture.required, capture.fixture.preferred),
    cv = capture.fixture.cv;
  const canonical = canonicalRequirements(saved),
    jd = matchJobText(saved);
  const snapshot = JSON.stringify(capture.rawModelOutput);
  expect(
    scoreCvMatch(
      validateMatchAssessment(
        capture.rawModelOutput.requirements,
        cv,
        jd,
        canonical,
      ),
      cv,
      jd,
      canonical,
    ),
  ).toMatchObject({
    score: 70,
    recommendation: 'Consider',
    requirements: [
      { status: 'PARTIAL', credit: 0.6 },
      { status: 'EVIDENCED', credit: 1 },
    ],
  });
  expect(JSON.stringify(capture.rawModelOutput)).toBe(snapshot);
});
