import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { EVIDENCE_STRENGTH as S } from '../../src/matching/cv-match.evidence-strength.js';
import { MATCHING_POLICY_VERSION } from '../../src/matching/match-context.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures only; empty model quotes (deterministic evidence).
const work = (...bullets: string[]) =>
  ['Developer, Example Co (2020 - 2024)', ...bullets.map((b) => `- ${b}`)].join(
    '\n',
  );
const SKILLS =
  'TECHNICAL SKILLS\nBackend: Java, Spring Boot, Docker\nFrontend: Vue.js';
function assess(
  cv: string,
  required: string[],
  preferred: string[] = [],
  quotes: Readonly<Record<string, string>> = {},
) {
  const job = {
    id: 'synthetic-cp4',
    title: 'x',
    skills: required.join('\n'),
    preferredSkills: preferred.join('\n'),
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-18T00:00:00.000Z'),
  } as Opportunity;
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((r) => ({ ...r, cvQuote: quotes[r.requirement] ?? '' })),
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}

test('policy version marks old saved scores stale', () => {
  expect(MATCHING_POLICY_VERSION).toBe('evidence-strength/v3');
});

describe('formula', () => {
  test('skills-only CV scores its LISTED strength, not 0', () => {
    const r = assess(SKILLS, ['Java', 'Spring Boot', 'Docker']);
    expect(r).toMatchObject({ score: S.LISTED, coverageHidden: null });
  });
  test('a missing assessable skill contributes 0 and is not unassessable', () => {
    const r = assess(SKILLS, ['Java', 'Spring Boot', 'Kotlin']);
    expect(r.coverageHidden).toBeNull();
    expect(r.score).toBe(Math.round((S.LISTED * 2) / 3));
  });
  test('required weight 3, preferred weight 1', () => {
    const r = assess(SKILLS, ['Java', 'Spring Boot', 'Docker'], ['Kotlin']);
    expect(r.score).toBe(Math.round((S.LISTED * 9) / 10));
  });
  test('OR: strongest alternative, counted once', () => {
    const r = assess(SKILLS, [
      'Experience with Kotlin or Java',
      'Spring Boot',
      'Docker',
    ]);
    expect(r.score).toBe(S.LISTED);
    expect(r.requirements).toHaveLength(3);
  });
  test('AND: mean of the parts, counted once', () => {
    const r = assess(SKILLS, [
      'Experience with Java and Kotlin',
      'Spring Boot',
      'Docker',
    ]);
    expect(r.score).toBe(Math.round((S.LISTED / 2 + S.LISTED * 2) / 3));
  });
  test('stronger evidence raises coverage', () => {
    const cv = `${SKILLS}\n${work('Built order APIs in Java.')}`;
    expect(assess(cv, ['Java', 'Spring Boot', 'Docker']).score).toBeGreaterThan(
      S.LISTED,
    );
  });
});

describe('excluded rows', () => {
  const base = ['Java', 'Spring Boot', 'Docker'];
  test('headings, soft skills and conditions do not change coverage', () => {
    const plain = assess(SKILLS, base);
    const extra = assess(SKILLS, [
      'Required Qualifications',
      ...base,
      'Good communication skills',
      "Bachelor's degree in Computer Science",
      'Business-level English communication skills',
    ]);
    expect(extra.score).toBe(plain.score);
    expect(extra.coverageHidden).toBeNull();
  });
  test('a skill row mentioning English or years stays a skill row', () => {
    const r = assess(SKILLS, [...base, '3+ years of experience with Kotlin']);
    expect(r.score).toBe(Math.round((S.LISTED * 3) / 4));
  });
});

describe('confidence', () => {
  test('fewer than 3 assessable skills hides the score', () => {
    const r = assess(SKILLS, [
      'Java',
      'Spring Boot',
      'Good communication skills',
    ]);
    expect(r).toMatchObject({
      score: null,
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    });
  });
  test('more than 40% unreadable weight hides the score', () => {
    const r = assess(SKILLS, [
      'Java',
      'Spring Boot',
      'Docker',
      'Experience with at least 2 MCP or RAG applications',
      'MCP and RAG or tool calling',
      'Experience with multiple languages such as Go, Rust',
    ]);
    expect(r).toMatchObject({
      score: null,
      coverageHidden: 'TOO_MUCH_UNASSESSABLE',
    });
  });
  test('weak evidence alone never hides the score', () => {
    const r = assess('Summary: backend developer.', [
      'Java',
      'Spring Boot',
      'Docker',
    ]);
    expect(r).toMatchObject({ score: 0, coverageHidden: null });
  });
});

test('equivalent English and Vietnamese wording gives the same coverage', () => {
  const cv = `${SKILLS}\n${work('Built order APIs in Java and Spring Boot.')}`;
  const en = assess(cv, [
    'Experience with Java',
    'Experience with Spring Boot',
    'Experience with Docker',
  ]);
  const vi = assess(cv, [
    'Có kinh nghiệm sử dụng Java',
    'Có kinh nghiệm với Spring Boot',
    'Có kinh nghiệm với Docker',
  ]);
  expect(vi.score).toBe(en.score);
  expect(en.score).not.toBeNull();
});

test.each([
  ['Experience with Kubernetes', 'Kubernetes'],
  ['3+ years Kubernetes', 'Kubernetes'],
  ['Java backend experience', 'Java'],
  ['Experience with Java', 'Java'],
])('%s resolves to %s for Coverage', (requirement, skill) => {
  const result = assess(`Skills: ${skill}, Docker, Spring Boot`, [
    requirement,
    'Docker',
    'Spring Boot',
  ]);
  expect(result.score).toBe(S.LISTED);
});

test('English experience is a standalone condition', () => {
  expect(
    assess(SKILLS, ['Java', 'Docker', 'Spring Boot', 'Experience in English']),
  ).toMatchObject({ score: S.LISTED, coverageHidden: null });
});

test('a rejected quote cannot remove a missing technical requirement', () => {
  const required = ['Java', 'Docker', 'Spring Boot', 'Kotlin'];
  expect(assess(SKILLS, required).score).toBe(30);
  const rejected = assess(SKILLS, required, [], {
    Java: 'Backend: Java, Spring Boot, Docker',
    Kotlin: 'Invented Kotlin evidence',
  });
  expect(rejected).toMatchObject({
    score: null,
    coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
    evidenceUncertain: true,
  });
  expect(
    rejected.requirements.find((row) => row.requirement === 'Kotlin'),
  ).toMatchObject({ cvQuote: '', status: 'NOT_EVIDENCED' });
});

test('independent listed evidence resolves a rejected technical selection', () => {
  const result = assess(SKILLS, ['Java', 'Docker', 'Spring Boot'], [], {
    Java: 'Invented Java evidence',
    Docker: 'Backend: Java, Spring Boot, Docker',
  });
  expect(result).toMatchObject({ score: S.LISTED, coverageHidden: null });
  expect(
    result.requirements.find((row) => row.requirement === 'Java')?.cvQuote,
  ).toBe('');
});

test('exactly 40% genuinely unassessable technical weight still shows Coverage', () => {
  const result = assess(SKILLS, [
    'Java',
    'Docker',
    'Spring Boot',
    'MCP and RAG or tool calling',
    'Experience with multiple languages such as Go, Rust',
  ]);
  expect(result).toMatchObject({ score: S.LISTED, coverageHidden: null });
});

test.each(['Experience with Java or Docker', 'Experience with Docker or Java'])(
  '%s uses the strongest alternative regardless of order',
  (alternatives) => {
    const cv = `${SKILLS}\n${work('Built order APIs in Java.')}`;
    expect(assess(cv, [alternatives, 'Spring Boot', 'Kotlin']).score).toBe(
      Math.round((S.APPLIED + S.ALSO_LISTED + S.LISTED) / 3),
    );
  },
);

test('unverified JD takes precedence over evidence verification and parent count', () => {
  const jd = 'Java\nKotlin';
  const canonical = ['Java', 'Kotlin'].map((requirement) => ({
    requirement,
    priority: 'required' as const,
    category: 'skill' as const,
    jdQuote: requirement,
    cvQuote: '',
  }));
  const verified = validateMatchAssessment(
    [
      { ...canonical[0]!, cvQuote: 'Backend: Java, Spring Boot, Docker' },
      { ...canonical[1]!, cvQuote: 'Invented Kotlin evidence' },
    ],
    SKILLS,
    jd,
    canonical,
  );
  expect(scoreCvMatch(verified, SKILLS, jd, canonical)).toMatchObject({
    score: null,
    coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
  });
  expect(scoreCvMatch(verified, SKILLS, jd, canonical, true)).toMatchObject({
    score: null,
    coverageHidden: 'UNVERIFIED_JD',
    guidance: null,
  });
});

test('unresolved technical prose remains unassessable when no CV quote is selected', () => {
  const prose = 'Design robust interfaces across multiple technical systems';
  expect(assess(SKILLS, ['Java', 'Docker', prose])).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    score: null,
  });
});

describe('technical targets with duration and language conditions', () => {
  const cv = 'Skills: Java, Docker, Spring Boot, Kotlin';

  test.each(['Kotlin', 'Kotlin (3 years)', '3+ years working with Kotlin'])(
    '%s contributes the same listed Kotlin strength',
    (requirement) => {
      const result = assess(cv, ['Java', 'Docker', requirement]);
      expect(result).toMatchObject({ score: S.LISTED, coverageHidden: null });
      expect(
        result.requirements.find((row) => row.requirement === requirement),
      ).toMatchObject({
        coverage: {
          components: [{ strength: { level: 'LISTED', strength: S.LISTED } }],
        },
      });
    },
  );

  test('fluency in German does not satisfy the minimum technical parent count', () => {
    expect(assess(cv, ['Java', 'Docker', 'Fluent in German'])).toMatchObject({
      score: null,
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    });
  });

  test('an English condition contributes no component to technical Coverage', () => {
    expect(
      assess(cv, ['Java', 'Docker', 'Experience with Kotlin and English']),
    ).toMatchObject({ score: S.LISTED, coverageHidden: null });
  });
});

describe('spoken and technical language classification', () => {
  const cv = 'Skills: Java, Docker, Spring Boot, Kotlin, Python, Go';

  test('French fluency stays in the JD and does not count as a technical parent', () => {
    const requirement = 'Fluent in French';
    const result = assess(cv, ['Java', 'Docker', requirement]);
    expect(result).toMatchObject({
      score: null,
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    });
    expect(
      result.requirements.find((row) => row.requirement === requirement),
    ).toMatchObject({ jdQuote: requirement });
  });

  test('French contributes no strength to a mixed Kotlin requirement', () => {
    const result = assess(cv, [
      'Java',
      'Docker',
      'Experience with Kotlin and French',
    ]);
    expect(result).toMatchObject({ score: S.LISTED, coverageHidden: null });
    expect(
      result.requirements[2]?.coverage.components.find(
        (part) => part.label === 'French',
      ),
    ).not.toHaveProperty('strength');
  });

  test.each(['Java', 'Python', 'Go'])(
    '%s remains a technical language',
    (language) => {
      expect(
        assess(cv, ['Docker', 'Spring Boot', `Proficient in ${language}`]),
      ).toMatchObject({ score: S.LISTED, coverageHidden: null });
    },
  );
});

test('SQL query-writing has a target even without CV evidence', () => {
  const required = ['Java', 'Docker', 'Experience writing SQL queries'];
  for (const cv of [
    'Used SQL Server.',
    'Wrote GraphQL queries.',
    'Skills: SQL queries',
  ])
    expect(assess(cv, required)).toMatchObject({
      score: 0,
      coverageHidden: null,
    });
  expect(assess('Wrote SQL queries for invoices.', required).score).toBe(25);
});

test('unsupported short prose cannot satisfy the minimum', () => {
  expect(
    assess(SKILLS, ['Java', 'Docker', 'Design scalable APIs']),
  ).toMatchObject({
    score: null,
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
  });
});

test('wrapped CI/CD activity retains exact source and the 19-point control', () => {
  const required = ['CI/CD pipelines', 'Docker', 'Java', 'Kotlin'];
  const bullet = '- Automated build and test\r\n  pipelines.';
  for (const quote of [bullet, '- Automated build and test pipelines.']) {
    const cv = `Project: Synthetic\r\n${quote}`;
    const result = assess(cv, required);
    expect(result.score).toBe(19);
    const component = result.requirements[0]?.coverage.components[0];
    expect(component?.cvQuote).toBe(quote);
    expect(component).toMatchObject({
      strength: {
        quotes: [
          { quote, start: cv.indexOf(quote), end: cv.length, level: 'APPLIED' },
        ],
      },
    });
  }
});

test.each([
  ['empty', '', 'EMPTY'],
  ['irrelevant exact', 'Skills: Java, Docker', 'UNSUPPORTING'],
  ['supporting exact', 'Built Kotlin services.', 'ACCEPTED'],
  ['fabricated', 'Invented Kotlin services.', 'REJECTED'],
])(
  'Kotlin assessability is invariant with a %s selection',
  (_, quote, modelQuote) => {
    const cv = 'Skills: Java, Docker\nBuilt Kotlin services.';
    const result = assess(
      cv,
      ['Java', 'Docker', 'Experience with Kotlin'],
      [],
      {
        Java: 'Skills: Java, Docker',
        'Experience with Kotlin': quote,
      },
    );
    expect(result).toMatchObject({ score: 52, coverageHidden: null });
    expect(result.requirements[2]).toMatchObject({
      evidence: { modelQuote },
      coverage: { components: [{ strength: { strength: S.APPLIED } }] },
    });
    if (modelQuote === 'REJECTED')
      expect(result.requirements[2]?.cvQuote).toBe('');
  },
);

test.each([
  ['', null],
  ['Kotlin', null],
  ['Configure advanced pipelines', 'TOO_MUCH_UNASSESSABLE'],
])(
  '40 percent boundary with preferred parent %j',
  (preferred, coverageHidden) => {
    const result = assess(
      SKILLS,
      [
        'Java',
        'Docker',
        'Spring Boot',
        'Design scalable APIs',
        'Maintain reliable integrations',
      ],
      preferred ? [preferred] : [],
    );
    expect(result.coverageHidden).toBe(coverageHidden);
    expect(result.score).toBe(coverageHidden ? null : preferred ? 36 : 40);
  },
);

test('all fabricated quotes cause validation failure before Coverage', () => {
  expect(() =>
    assess(SKILLS, ['Java', 'Docker', 'Kotlin'], [], {
      Java: 'Invented Java work',
      Kotlin: 'Invented Kotlin work',
    }),
  ).toThrow(expect.objectContaining({ reasonCode: 'NO_VERIFIABLE_CV_QUOTES' }));
});

test.each([
  ['- Automated build and test\n- pipelines.', 0],
  ['- Automated build and test,\nProject: Pipelines\npipelines.', 0],
  ['- Never automated build and test\n  pipelines.', 0],
  ['- Deployed a service using GitLab CI/CD.', 0],
  ['Skills: CI/CD pipelines', 10],
])(
  'CI/CD activity keeps work, declarations and record boundaries distinct for %j',
  (cv, score) => {
    const result = assess(cv, ['CI/CD pipelines', 'Docker', 'Java', 'Kotlin']);
    expect(result.score).toBe(score);
    expect(result.requirements[0]?.coverage.components[0]).not.toMatchObject({
      strength: { level: 'APPLIED' },
    });
  },
);

test('a named capability preserves a required modifier', () => {
  const cv = '- Designed APIs using Java and Docker.';
  const result = assess(cv, [
    'Java',
    'Docker',
    'Kotlin',
    'Experience with scalable APIs',
  ]);
  expect(result.requirements[3]?.coverage.components[0]).not.toHaveProperty(
    'strength',
  );
});

test.each([
  [''],
  ['Skills: Java, Docker'],
  ['Design robust interfaces across multiple technical systems'],
])(
  'an exact CV selection cannot make unresolved JD prose assessable: %j',
  (quote) => {
    const prose = 'Design robust interfaces across multiple technical systems';
    const cv = 'Skills: Java, Docker\n' + prose;
    const result = assess(cv, ['Java', 'Docker', prose], [], {
      Java: 'Skills: Java, Docker',
      [prose]: quote,
    });
    expect(result).toMatchObject({
      score: null,
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    });
  },
);

test('a fabricated selection on unresolved prose is isolated as evidence rejection', () => {
  const prose = 'Design robust interfaces across multiple technical systems';
  const result = assess('Skills: Java, Docker', ['Java', 'Docker', prose], [], {
    Java: 'Skills: Java, Docker',
    [prose]: 'Invented technical evidence',
  });
  expect(result).toMatchObject({
    score: null,
    coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
  });
  expect(result.requirements[2]).toMatchObject({
    cvQuote: '',
    evidence: { modelQuote: 'REJECTED' },
  });
});
