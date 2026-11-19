import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const java = 'Backend service experience in managed languages including Java';
const sql = 'Experience with SQL or NoSQL data stores';
function assess(requirement: string, cv: string, quote: string) {
  const job = {
    title: 'Synthetic coverage',
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
      canonical.map((row) => ({ ...row, cvQuote: quote })),
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}
test('single managed-language qualification retains exact resolved multiline evidence', () => {
  const cv = 'Backend — Java,\n Spring Boot, Node.js.';
  expect(requirementGroup(java, 'skill').mode).toBe('SINGLE');
  expect(
    assess(java, cv, 'Backend — Java, Spring Boot, Node.js.'),
  ).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'EVIDENCED', cvQuote: cv }],
  });
});
test.each([
  'Backend — JavaScript.',
  "Backend — I can't use Java.",
  'Aspiring to learn Java.',
  'Built Python services.',
])(
  'single-language qualification rejects unsupported selected evidence: %s',
  (cv) => {
    expect(assess(java, cv, cv)).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'NOT_EVIDENCED', cvQuote: '' }],
    });
  },
);
test('single-language qualification exposes source-backed contradictions', () => {
  const quote = 'Backend — Java.';
  expect(assess(java, `${quote}\nI can't use Java.`, quote)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [
      {
        status: 'CONFLICT',
        coverage: {
          components: [{ conflictingQuotes: ["I can't use Java."] }],
        },
      },
    ],
  });
});
test.each([
  'Databases — PostgreSQL / SQL Server.',
  'Databases: SQL.',
  'Databases — MongoDB.',
])(
  'shared data-store alternative accepts selected database declaration: %s',
  (quote) => {
    const result = assess(sql, quote, quote);
    // A skills declaration alone is coverage, not demonstrated work.
    expect(result).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'EVIDENCED', cvQuote: quote }],
    });
    expect(
      result.requirements[0]!.coverage.components.filter(
        (c) => c.status === 'EVIDENCED',
      ),
    ).toHaveLength(1);
  },
);
test.each([
  'Databases — I cannot use PostgreSQL.',
  'Databases — Interested in MongoDB.',
  'Tools — Python.',
])('database alternative rejects unsupported declaration: %s', (quote) => {
  expect(assess(sql, quote, quote)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'NOT_EVIDENCED' }],
  });
});
test('database alternatives retain canonical weight and conflict checks', () => {
  const quote = 'Databases — PostgreSQL.';
  expect(assess(sql, `${quote}\nI can't use SQL.`, quote)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [
      {
        status: 'CONFLICT',
        coverage: {
          components: [{ status: 'CONFLICT' }, { status: 'NOT_EVIDENCED' }],
        },
      },
    ],
  });
});
test('including multiple languages stays ambiguous rather than satisfying every language', () => {
  expect(requirementGroup(`${java} and C#`, 'skill').mode).toBe('UNKNOWN');
});

test('generic Experience assessment retains explicit work duration without requiring the literal word', () => {
  const quote = '6+ years building enterprise software.';
  expect(assess('Experience', quote, quote)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'EVIDENCED', cvQuote: quote }],
  });
});
test('independently verified production integration covers both AND components', () => {
  const quote =
    'Developed and deployed production AI/ML services and integrated LLM APIs.';
  const result = assess(
    'Production AI/ML and LLM API integration',
    quote,
    quote,
  );
  expect(result).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'EVIDENCED', cvQuote: quote }],
  });
  expect(
    result.requirements[0]!.coverage.components.map((c) => c.status),
  ).toEqual(['EVIDENCED', 'EVIDENCED']);
});
test('API usage alone cannot satisfy an explicit integration action', () => {
  const quote = 'Developed production AI/ML services and used LLM APIs.';
  expect(
    assess('Production AI/ML and LLM API integration', quote, quote),
  ).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'PARTIAL', credit: 0.5 }],
  });
});
