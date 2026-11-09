import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import { CvMatchError } from '../../src/matching/cv-match.error.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// P6.1 synthetic probes converted to approved P6.2 acceptance policy.
// The original observed behavior remains documented in the P6.1 audit report.
const live = JSON.parse(
  readFileSync(
    '../../docs/audits/fixtures/itviec-ai-solution-architect.live-p55d.json',
    'utf8',
  ),
) as { normalizedFields: { field: string; value: string }[] };
const lines = (field: string) =>
  live.normalizedFields.find((row) => row.field === field)!.value.split('\n');
const clauses = {
  or: lines('preferredSkills')[1]!,
  and: lines('skills')[5]!,
  mixed: lines('skills')[4]!,
  delivered: lines('skills')[3]!,
  education: lines('skills')[0]!,
};
const jobFor = (skills: string, preferredSkills = '') =>
  ({
    title: 'Synthetic audit role',
    skills,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  }) as Opportunity;
function assess(job: Opportunity, cv: string, quote: string) {
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const proposals = canonical.map((row) => ({ ...row, cvQuote: quote }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  return scoreCvMatch(verified, cv, jd, canonical);
}

test('P5.5 contextual source clauses are one stable parent; bare skill lists remain separate', () => {
  for (const clause of Object.values(clauses)) {
    const rows = canonicalRequirements(jobFor(clause));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ parentId: 'p1', requirement: clause });
  }
  expect(
    canonicalRequirements(jobFor('Python, Java; Rust')).map(
      (row) => row.requirement,
    ),
  ).toEqual(['Python', 'Java', 'Rust']);
});

const probes = [
  ['one OR alternative', clauses.or, 'Built MCP servers.', 100, 'EVIDENCED'],
  ['one AND component', clauses.and, 'Designed APIs.', 20, 'PARTIAL'],
  [
    'some AND components',
    clauses.and,
    'Designed APIs and integrations.',
    40,
    'PARTIAL',
  ],
  [
    'all AND components',
    clauses.and,
    'Designed cloud-based architectures, APIs, integrations, data flows, and CI/CD practices.',
    100,
    'EVIDENCED',
  ],
  ['knowledge subset', clauses.mixed, 'Skills: RAG.', 17, 'PARTIAL'],
  [
    'knowledge some',
    clauses.mixed,
    'Skills: RAG, vector search, tool calling.',
    50,
    'PARTIAL',
  ],
  [
    'knowledge all equivalent',
    clauses.mixed,
    'Working knowledge of retrieval-augmented generation, vector retrieval, agentic workflows, function calling, model selection, and AI system limitations.',
    100,
    'EVIDENCED',
  ],
  ['no evidence', clauses.and, '', 0, 'NOT_EVIDENCED'],
  [
    'conflicting evidence',
    clauses.or,
    'Built MCP servers.\nI have never used MCP.',
    0,
    'CONFLICT',
  ],
  ['negative only', clauses.or, 'I have never used MCP.', 0, 'NOT_EVIDENCED'],
  [
    'aspiration',
    clauses.or,
    'Interested in building MCP servers.',
    0,
    'NOT_EVIDENCED',
  ],
  ['unrelated passage', clauses.or, 'Built Java services.', 0, 'NOT_EVIDENCED'],
  [
    'delivered alternative',
    clauses.delivered,
    'Personally built and delivered one RAG application to production.',
    100,
    'EVIDENCED',
  ],
  [
    'prototype only',
    clauses.delivered,
    'Personally built a RAG prototype only.',
    0,
    'NOT_EVIDENCED',
  ],
  [
    'team delivery',
    clauses.delivered,
    'Our team built and delivered a RAG application to production.',
    0,
    'NOT_EVIDENCED',
  ],
  [
    'no delivery',
    clauses.delivered,
    'Personally built one RAG application.',
    0,
    'NOT_EVIDENCED',
  ],
  [
    'education practical alternative',
    clauses.education,
    'Equivalent practical experience: eight years building software systems.',
    100,
    'EVIDENCED',
  ],
  [
    'education degree',
    clauses.education,
    "Bachelor's degree in Computer Science.",
    100,
    'EVIDENCED',
  ],
  [
    'education incomplete',
    clauses.education,
    "Pursuing a Bachelor's degree in Computer Science.",
    0,
    'NOT_EVIDENCED',
  ],
  [
    'education unsupported equivalence',
    clauses.education,
    'Equivalent practical experience.',
    0,
    'NOT_EVIDENCED',
  ],
  ['education absent', clauses.education, '', 0, 'NOT_EVIDENCED'],
] as const;

test.each(probes)('%s', (_name, requirement, cvText, score, status) => {
  const cv = cvText || 'Synthetic CV: unrelated work.';
  const result = assess(jobFor(requirement), cv, cvText);
  expect(result.score).toBe(score);
  expect(result.requirements).toHaveLength(1);
  expect(result.requirements[0]!.status).toBe(status);
  expect(result.recommendation).toBe(
    score === 100 ? 'Apply' : score >= 40 ? 'Consider' : 'Low Fit',
  );
  for (const component of result.requirements[0]!.coverage!.components) {
    expect(requirement).toContain(component.jdQuote);
    if (component.cvQuote) expect(cv).toContain(component.cvQuote);
    for (const contradiction of component.conflictingQuotes)
      expect(cv).toContain(contradiction);
  }
});

test('intact AND partial evidence earns proportional credit', () => {
  expect(
    assess(
      jobFor('Experience designing APIs and integrations'),
      'Designed APIs.',
      'Designed APIs.',
    ),
  ).toMatchObject({ score: 50, recommendation: 'Consider' });
});

test('parent weight stays 3 regardless of component count and partial required blocks Apply', () => {
  const cv = 'Designed cloud-based architectures.';
  expect(assess(jobFor(clauses.and, 'Rust'), cv, cv).score).toBe(15);
  // Four of five required components plus a full preferred row = 85, still Consider.
  const text =
    'Designed cloud-based architectures, APIs, integrations and data flows. Skills: Rust.';
  expect(assess(jobFor(clauses.and, 'Rust'), text, text)).toMatchObject({
    score: 85,
    recommendation: 'Consider',
  });
  const preferred = assess(jobFor('Rust', clauses.and), text, text);
  expect(preferred).toMatchObject({ score: 95, recommendation: 'Apply' });
});

test('reordered and equivalent labels need exact canonical label or quote linkage', () => {
  const job = jobFor(clauses.or);
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const cv = 'Built MCP servers.';
  const proposal = {
    ...canonical[0]!,
    requirement: 'Document intelligence or MCP',
    cvQuote: cv,
  };
  expect(
    scoreCvMatch(
      validateMatchAssessment([proposal], cv, jd, canonical),
      cv,
      jd,
      canonical,
    ).requirements,
  ).toHaveLength(1);
  expect(() =>
    validateMatchAssessment(
      [{ ...proposal, jdQuote: 'MCP' }],
      cv,
      jd,
      canonical,
    ),
  ).toThrow(CvMatchError);
  for (const wording of [
    'MCP or document intelligence',
    'Document intelligence or MCP',
    'Model Context Protocol or document intelligence',
  ]) {
    expect(canonicalRequirements(jobFor(wording))).toHaveLength(1);
    expect(assess(jobFor(wording), cv, cv).score).toBe(100);
    expect(assess(jobFor(wording), cv, '').score).toBe(100);
  }
});

test('model-added requirements, duplicate parents and relabeling cannot inflate denominator or downgrade priority', () => {
  const job = jobFor('Python', 'Java');
  const canonical = canonicalRequirements(job);
  const jd = `${matchJobText(job)}\nRust`;
  const cv = 'Built Python services.';
  const proposals = canonical.map((row, index) => ({
    ...row,
    cvQuote: index ? '' : cv,
  }));
  const extra = {
    ...proposals[0]!,
    parentId: undefined,
    requirement: 'Rust',
    jdQuote: 'Rust',
    cvQuote: '',
  };
  const verified = validateMatchAssessment(
    [...proposals, extra, proposals[0]!],
    cv,
    jd,
    canonical,
  );
  expect(scoreCvMatch(verified, cv, jd, canonical)).toMatchObject({
    score: 75,
    recommendation: 'Apply',
  });
  expect(scoreCvMatch(verified, cv, jd, canonical).requirements).toHaveLength(
    2,
  );
  expect(
    scoreCvMatch(
      [{ ...proposals[0]!, priority: 'preferred' }],
      cv,
      jd,
      canonical,
    ).score,
  ).toBe(75);
});

test('separate component source passages support an AND without composing CV quotes', () => {
  const job = jobFor('Experience designing APIs and integrations');
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const cv = 'Designed APIs.\nDesigned integrations.';
  const proposal = {
    ...canonical[0]!,
    cvQuote: '',
    components: [
      { componentId: 'c1', jdQuote: 'APIs', cvQuote: 'Designed APIs.' },
      {
        componentId: 'c2',
        jdQuote: 'integrations',
        cvQuote: 'Designed integrations.',
      },
    ],
  };
  const result = scoreCvMatch(
    validateMatchAssessment([proposal], cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
  expect(result.score).toBe(100);
  expect(
    result.requirements[0]!.coverage!.components.map((row) => row.cvQuote),
  ).toEqual(cv.split('\n'));
});

test.each(['parent', 'component', 'duplicate', 'JD quote', 'CV quote'])(
  'fabricated %s metadata/evidence fails explicitly',
  (field) => {
    const job = jobFor('Experience designing APIs and integrations');
    const canonical = canonicalRequirements(job);
    const cv = 'Designed APIs.';
    const proposal = {
      ...canonical[0]!,
      cvQuote: '',
      components: [{ componentId: 'c1', jdQuote: 'APIs', cvQuote: cv }],
    };
    if (field === 'parent') proposal.parentId = 'p99';
    if (field === 'component') proposal.components[0]!.componentId = 'c99';
    if (field === 'duplicate')
      proposal.components.push(proposal.components[0]!);
    if (field === 'JD quote') proposal.components[0]!.jdQuote = 'fabricated';
    if (field === 'CV quote')
      proposal.components[0]!.cvQuote = 'Invented API design.';
    expect(() =>
      validateMatchAssessment([proposal], cv, matchJobText(job), canonical),
    ).toThrow(CvMatchError);
  },
);

test('ambiguous nested compounds and multiple-language quantities remain Unknown', () => {
  for (const text of [
    'Experience with Java and Python or Rust',
    'Experience with multiple managed languages such as Java, Scala or Go',
  ]) {
    const result = assess(
      jobFor(text),
      'Skills: Java, Python, Rust, Scala, Go.',
      'Skills: Java, Python, Rust, Scala, Go.',
    );
    expect(result).toMatchObject({ score: 0, recommendation: 'Low Fit' });
    expect(result.requirements[0]).toMatchObject({
      status: 'NOT_EVIDENCED',
      coverage: { mode: 'UNKNOWN' },
    });
  }
});

test('contradiction outside selected quote vetoes full credit; unrelated negative alternative does not', () => {
  const cv = 'Built MCP servers.\nI have never used MCP.';
  const result = assess(jobFor(clauses.or), cv, 'Built MCP servers.');
  expect(result.requirements[0]).toMatchObject({
    status: 'CONFLICT',
    credit: 0,
  });
  expect(
    result.requirements[0]!.coverage!.components[1]!.conflictingQuotes,
  ).toEqual(['I have never used MCP.']);
  const nonConflict = 'Built MCP servers.\nI have never used knowledge graphs.';
  expect(
    assess(jobFor(clauses.or), nonConflict, 'Built MCP servers.').score,
  ).toBe(100);
});

test('generic duration safeguards reject insufficient/negated selected evidence without changing duration weighting', () => {
  const job = { ...jobFor(''), experience: 'Minimum 3 years' };
  for (const quote of [
    '2 years of experience building software.',
    'No 6 years of experience building software.',
  ])
    expect(assess(job, quote, quote).score).toBe(0);
  const quote = '6 years of experience building software.';
  expect(assess(job, quote, quote).score).toBe(100);
});

test('compound shared minimum duration is not satisfied by a short or unstated duration', () => {
  const job = jobFor('At least 3 years of experience with Java or Rust');
  for (const cv of ['Skills: Rust.', '2 years of experience with Rust.'])
    expect(assess(job, cv, cv).score).toBe(0);
  expect(
    assess(
      job,
      '4 years of experience with Rust.',
      '4 years of experience with Rust.',
    ).score,
  ).toBe(100);
});

test('production delivery contradicted by prototype-only evidence needs review', () => {
  const positive =
    'Personally built and delivered one RAG application to production.';
  const cv = `${positive}\nI only built RAG prototypes.`;
  expect(
    assess(jobFor(clauses.delivered), cv, positive).requirements[0],
  ).toMatchObject({ status: 'CONFLICT', credit: 0 });
});

test('single skill contradictory source statements expose both quotations with zero credit', () => {
  const cv = 'Skills: Python.\nI have no Python experience.';
  const row = assess(jobFor('Python'), cv, 'Skills: Python.').requirements[0]!;
  expect(row).toMatchObject({ status: 'CONFLICT', credit: 0 });
  expect(row.coverage.components[0]!.conflictingQuotes).toEqual([
    'I have no Python experience.',
  ]);
});

test('new component evidence survives the actual structured-output schema and rejects fabricated selections', async () => {
  const { AiService } = await import('../../src/ai/ai.service.js');
  const { matchOutputSchema, matchPrompt } =
    await import('../../src/matching/cv-match.js');
  const job = jobFor('Experience designing APIs and integrations');
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const cv = 'Designed APIs.\nDesigned integrations.';
  const proposal = {
    ...canonical[0]!,
    cvQuote: '',
    components: [
      { componentId: 'c1', jdQuote: 'APIs', cvQuote: 'Designed APIs.' },
      {
        componentId: 'c2',
        jdQuote: 'integrations',
        cvQuote: 'Designed integrations.',
      },
    ],
  };
  const ai = new AiService({
    generate: async () => JSON.stringify({ requirements: [proposal] }),
  });
  const output = (await ai.generateStructured({
    prompt: matchPrompt(cv, jd, canonical),
    schema: matchOutputSchema(cv),
  })) as { requirements: (typeof proposal)[] };
  expect(
    scoreCvMatch(
      validateMatchAssessment(output.requirements, cv, jd, canonical),
      cv,
      jd,
      canonical,
    ).score,
  ).toBe(100);
  const prompt = JSON.parse(matchPrompt(cv, jd, canonical).split('\n').at(-1)!);
  expect(prompt.canonicalRequirements[0]).toMatchObject({
    parentId: 'p1',
    group: {
      mode: 'AND',
      components: [
        { id: 'c1', jdQuote: 'APIs' },
        { id: 'c2', jdQuote: 'integrations' },
      ],
    },
  });
  const invalid = new AiService({
    generate: async () =>
      JSON.stringify({
        requirements: [
          {
            ...proposal,
            components: [
              {
                componentId: 'c1',
                jdQuote: 'APIs',
                cvQuote: 'Fabricated design.',
              },
            ],
          },
        ],
      }),
  });
  await expect(
    invalid.generateStructured({ prompt: '', schema: matchOutputSchema(cv) }),
  ).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILURE' });
});

test('reordered conjunctions and explicit equivalent delivery/education wording keep the same credit', () => {
  const cv = 'Designed APIs and integrations.';
  for (const requirement of [
    'Experience designing APIs and integrations',
    'Experience designing integrations and APIs',
  ])
    expect(assess(jobFor(requirement), cv, cv).score).toBe(100);
  const delivery =
    'Personally developed and deployed one retrieval-augmented generation application to production.';
  expect(
    assess(
      jobFor(
        'Personally developed and deployed at least one RAG, LLM, or agent-based application to production',
      ),
      delivery,
      delivery,
    ).score,
  ).toBe(100);
  const education = "Bachelor's degree in Computer Science.";
  expect(
    assess(
      jobFor(
        "Equivalent practical experience or Bachelor's degree in Computer Science",
      ),
      education,
      education,
    ).score,
  ).toBe(100);
});

test('a negative AND component blocks full coverage without crediting a negated quote', () => {
  const cv = 'Designed APIs.\nI have never designed integrations.';
  expect(
    assess(jobFor('Experience designing APIs and integrations'), cv, cv),
  ).toMatchObject({ score: 50, recommendation: 'Consider' });
});

test('one-of alternative syntax is accepted but unsupported larger quantity is never inferred', () => {
  const cv = 'Skills: Rust.';
  expect(
    assess(jobFor('Experience with at least one of Java or Rust'), cv, cv)
      .score,
  ).toBe(100);
  expect(
    assess(
      jobFor('Experience with at least 20 Java or Rust applications'),
      cv,
      cv,
    ).score,
  ).toBe(0);
});

test('a degree in another field cannot satisfy an explicit education alternative', () => {
  const cv = "Bachelor's degree in Computer Science.";
  expect(
    assess(
      jobFor("Bachelor's degree in Physics or equivalent practical experience"),
      cv,
      cv,
    ).score,
  ).toBe(0);
});

test('a simple component-only quote is usable, but a negated skill plus unrelated positive text is not support', () => {
  const job = jobFor('Python');
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const cv = 'Built Python services.';
  const proposal = {
    ...canonical[0]!,
    cvQuote: '',
    components: [{ componentId: 'c1', jdQuote: 'Python', cvQuote: cv }],
  };
  expect(
    scoreCvMatch(
      validateMatchAssessment([proposal], cv, jd, canonical),
      cv,
      jd,
      canonical,
    ).score,
  ).toBe(100);
  const negative = 'No Python experience. Built Java services.';
  expect(assess(job, negative, negative).score).toBe(0);
});

const mixedQualification =
  "Bachelor's Degree in Computer Science or Engineering, OR 2+ years of relevant experience, OR coding boot camp";
const qualificationCases = [
  ['My colleague completed a coding boot camp.', 'NOT_EVIDENCED'],
  [
    'Completed a coding boot camp.\nThis qualification is incomplete.',
    'NOT_EVIDENCED',
  ],
  ['6 years of experience building irrigation systems.', 'NOT_EVIDENCED'],
  ['Completed a project; coding boot camp.', 'NOT_EVIDENCED'],
  ["Bachelor's Degree in Engineering Management.", 'NOT_EVIDENCED'],
  [
    '24 months of software development experience; 6 months of other work.',
    'NOT_EVIDENCED',
  ],
  ["Completed Bachelor's Degree in Computer Science.", 'EVIDENCED'],
  ["Completed Bachelor's Degree in Engineering.", 'EVIDENCED'],
  ["Bachelor's Degree in Information Technology", 'NOT_EVIDENCED'],
  ['6 years of relevant experience developing software systems.', 'EVIDENCED'],
  ['6+ years of experience building enterprise applications.', 'EVIDENCED'],
  ['2 years of relevant software development experience.', 'EVIDENCED'],
  ['24 months of software development experience.', 'EVIDENCED'],
  ['1 year 11 months of software development experience.', 'NOT_EVIDENCED'],
  ['1 year of relevant software development experience.', 'NOT_EVIDENCED'],
  ['6 years of unrelated work experience.', 'NOT_EVIDENCED'],
  ['Worked on engineering prototypes for three months.', 'NOT_EVIDENCED'],
  ['Completed a coding boot camp.', 'EVIDENCED'],
  ['Graduated from a software development boot camp.', 'EVIDENCED'],
  ['Attended a coding boot camp.', 'NOT_EVIDENCED'],
  ['Currently enrolled in a coding boot camp.', 'NOT_EVIDENCED'],
  ['Coding boot camp incomplete.', 'NOT_EVIDENCED'],
  ['Completed a coding boot camp; status: incomplete.', 'NOT_EVIDENCED'],
  ["Completed Bachelor's Degree in Engineering; not awarded.", 'NOT_EVIDENCED'],
  ['No completed coding boot camp.', 'NOT_EVIDENCED'],
  ['No software development experience.', 'NOT_EVIDENCED'],
  [
    'Planning 6 years of experience building software systems.',
    'NOT_EVIDENCED',
  ],
  ['0.6 years of software development experience.', 'NOT_EVIDENCED'],
  [
    'Approximately 6 years of software development experience.',
    'NOT_EVIDENCED',
  ],
  [
    '6 years of retail work; 1 year of software development experience.',
    'NOT_EVIDENCED',
  ],
  ['Software Developer: Mar 2020 – Present', 'NOT_EVIDENCED'],
  ['', 'NOT_EVIDENCED'],
] as const;

for (const category of ['skill', 'experience'] as const) {
  test.each(qualificationCases)(
    `typed qualification (${category}): %s`,
    (cv, status) => {
      const job =
        category === 'skill'
          ? jobFor(mixedQualification)
          : { ...jobFor(''), experience: mixedQualification };
      const row = assess(job, cv || 'No qualifications supplied.', cv)
        .requirements[0]!;
      expect(row.status).toBe(status);
      expect(row.coverage.mode).toBe('OR');
      expect(row.coverage.components).toHaveLength(3);
      expect(row.coverage.components.map((c) => c.jdQuote)).toEqual([
        "Bachelor's Degree in Computer Science or Engineering",
        '2+ years of relevant experience',
        'coding boot camp',
      ]);
      expect(
        requirementGroup(mixedQualification, category).components.map(
          (c) => c.qualification,
        ),
      ).toEqual([
        {
          kind: 'degree',
          level: 'bachelor',
          acceptedFields: ['computer science', 'engineering'],
        },
        { kind: 'experience', relevant: true, minimumMonths: 24 },
        { kind: 'bootcamp', completed: true },
      ]);
      for (const component of row.coverage.components)
        if (component.cvQuote)
          expect(cv.includes(component.cvQuote)).toBe(true);
      expect(row.credit).toBe(status === 'EVIDENCED' ? 1 : 0);
    },
  );
}

test.each([
  'coding boot camp; OR 24 months of relevant experience; OR Bachelor’s Degree in Engineering or Computer Science.',
  'CODING BOOT CAMP or 2 years of relevant experience or BACHELOR’S DEGREE IN ENGINEERING OR COMPUTER SCIENCE',
])('qualification branch order/capitalization/punctuation: %s', (clause) => {
  const row = assess(jobFor(clause), 'Completed a coding boot camp.', '')
    .requirements[0]!;
  expect(row).toMatchObject({
    parentId: 'p1',
    status: 'EVIDENCED',
    credit: 1,
    coverage: { mode: 'OR' },
  });
  expect(row.coverage.components).toHaveLength(3);
  expect(
    row.coverage.components.filter((c) => c.status === 'EVIDENCED'),
  ).toHaveLength(1);
});

test.each([
  "Bachelor's Degree in Computer Science or (2 years of relevant experience and equivalent practical experience)",
  "Bachelor's Degree in Computer Science or (Engineering and 2 years of relevant experience) or coding boot camp",
  "Bachelor's Degree in Computer Science and Engineering or coding boot camp",
  "Bachelor's Degree in Physics or 2 years of relevant experience or coding boot camp",
])('unsupported qualification grammar stays Unknown: %s', (clause) => {
  for (const category of ['skill', 'experience']) {
    const job =
      category === 'skill'
        ? jobFor(clause)
        : { ...jobFor(''), experience: clause };
    expect(
      assess(
        job,
        'Completed a coding boot camp.',
        'Completed a coding boot camp.',
      ).requirements[0],
    ).toMatchObject({ status: 'NOT_EVIDENCED', coverage: { mode: 'UNKNOWN' } });
  }
});

test.each([
  [
    "Completed Bachelor's Degree in Engineering.",
    "No Bachelor's Degree in Engineering.",
  ],
  ['Completed a coding boot camp.', 'Coding boot camp incomplete.'],
  [
    '6 years of software development experience.',
    'No software development experience.',
  ],
])(
  'contradictory typed qualification requires review: %s',
  (positive, negative) => {
    const row = assess(
      jobFor(mixedQualification),
      `${positive}\n${negative}`,
      positive,
    ).requirements[0]!;
    expect(row).toMatchObject({ status: 'CONFLICT', credit: 0 });
    expect(
      row.coverage.components.some((c) =>
        c.conflictingQuotes.includes(negative),
      ),
    ).toBe(true);
  },
);

test.each([
  [
    'Completed a coding boot camp.\nStatus: incomplete',
    'Completed a coding boot camp.',
  ],
  [
    "Bachelor's Degree in Engineering\nStatus: pending",
    "Bachelor's Degree in Engineering",
  ],
  [
    'Status: incomplete\nCompleted a coding boot camp.',
    'Completed a coding boot camp.',
  ],
])(
  'short selections cannot hide nearby qualification status: %s',
  (cv, selected) => {
    expect(
      assess(jobFor(mixedQualification), cv, selected).requirements[0]!.status,
    ).toBe('NOT_EVIDENCED');
  },
);

test('typed degree recovery preserves a contiguous multiline source span', () => {
  const cv = "EDUCATION\nBachelor's Degree\nEngineering\nStatus: awarded";
  const row = assess(jobFor(mixedQualification), cv, '').requirements[0]!;
  expect(row.status).toBe('EVIDENCED');
  expect(row.cvQuote).toBe("Bachelor's Degree\nEngineering\nStatus: awarded");
  expect(cv.includes(row.cvQuote)).toBe(true);
});

test('typed component validation rejects fabricated quotations and legacy identities', () => {
  const job = jobFor(mixedQualification);
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const cv = 'Completed a coding boot camp.';
  for (const component of [
    {
      componentId: 'c3',
      jdQuote: 'coding boot camp',
      cvQuote: 'Invented completed coding boot camp.',
    },
    { componentId: 'c4', jdQuote: 'coding boot camp', cvQuote: cv },
    { componentId: 'c2', jdQuote: 'Engineering', cvQuote: cv },
  ])
    expect(() =>
      validateMatchAssessment(
        [{ ...canonical[0]!, cvQuote: '', components: [component] }],
        cv,
        jd,
        canonical,
      ),
    ).toThrow(CvMatchError);
});
