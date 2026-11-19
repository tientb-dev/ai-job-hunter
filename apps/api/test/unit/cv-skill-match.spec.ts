import { expect, test } from '@jest/globals';
import { buildCvSkillMatch } from '../../src/matching/cv-skill-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { reviewedCvText } from '../../src/reviewed-cv/reviewed-cv.text.js';

function match(
  jdText: string,
  skills: string[],
  work: string[] = [],
  saved: Partial<Opportunity> = {},
) {
  return buildCvSkillMatch(
    {
      jdText,
      description: '',
      postText: '',
      skills: '',
      preferredSkills: '',
      experience: '',
      domain: '',
      ...saved,
    } as Opportunity,
    reviewedCvText(
      [...skills, ...work].map((value, index) => ({
        id: String(index),
        field: index < skills.length ? 'skill' : 'bullet',
        value,
        sectionId: index < skills.length ? 'skills' : 'work',
        sectionKind: index < skills.length ? 'skills' : 'experience',
        entryId: String(index),
        confirmation: 'field',
        origin: 'user_entered',
        evidence: [],
      })),
    ),
  );
}

test.each([
  [['Java, Spring Boot, RESTful APIs'], []],
  [
    [],
    [
      'Used Java for billing.',
      'Migrated a service built with Spring Boot.',
      'Built RESTful APIs.',
    ],
  ],
])(
  'counts explicit skills and experience mentions with JD and CV references',
  (skills, work) => {
    const jd = 'Required skills\nJava and Spring Boot\nREST API';
    const result = match(jd, skills, work);
    expect(result).toMatchObject({
      score: 100,
      matchedCount: 3,
      totalCount: 3,
    });
    expect(result.rows.map(({ skills }) => skills[0]?.name)).toEqual([
      'Java',
      'Spring Boot',
      'REST API',
    ]);
    for (const row of result.rows) {
      expect(jd.slice(row.source.start, row.source.end)).toBe(row.source.quote);
      expect(row.skills[0]?.evidence).toMatchObject({ origin: 'user_entered' });
    }
  },
);

test('recognizes explicit REST terminology without counting the prose word rest', () => {
  expect(
    match('Required: RESTful API', [], ['Designed REST endpoints.']).score,
  ).toBe(100);
  expect(
    match('Required: REST API', [], ['Moved the rest of the service.']).score,
  ).toBe(0);
});

test('an OR group counts once and required skills weigh three times preferred skills', () => {
  const jd = 'Requirements\nPostgreSQL or MySQL\nPreferred skills\nAWS';
  expect(match(jd, ['Postgres, MySQL'])).toMatchObject({
    score: 75,
    matchedCount: 1,
    totalCount: 2,
  });
  expect(match(jd, ['AWS'])).toMatchObject({
    score: 25,
    matchedCount: 1,
    totalCount: 2,
  });
  expect(match(jd, ['AWS, MySQL'])).toMatchObject({
    score: 100,
    matchedCount: 2,
    totalCount: 2,
  });
});

test('separate technology names, negated experience and Conditions earn no overlap', () => {
  const jd = 'Requirements\nPostgreSQL\nCloud\nEnglish B2\nBachelor’s degree';
  expect(
    match(jd, ['MySQL, AWS'], ['No experience with PostgreSQL.']),
  ).toMatchObject({
    score: 0,
    matchedCount: 0,
    totalCount: 2,
  });
});

test('keeps partial scores separate and excludes overlapping groups', () => {
  expect(match('Requirements\nJava and UnknownTool', ['Java'])).toMatchObject({
    score: null,
    partialScore: 100,
    limitation: 'INCOMPLETE_INVENTORY',
  });
  expect(
    match('Requirements\nJava and Spring Boot', ['Java'], [], {
      skills: 'Java',
    }),
  ).toMatchObject({
    score: null,
    partialScore: 50,
    limitation: 'INCOMPLETE_INVENTORY',
  });
  expect(match('Requirements\nJava or Kotlin\nJava', ['Java'])).toMatchObject({
    score: null,
    partialScore: null,
    limitation: 'INCOMPLETE_INVENTORY',
  });
});

test('deduplicates repeated requirements and safely reuses saved alternatives', () => {
  expect(
    match('Requirements\nJava or Kotlin', ['Kotlin'], [], {
      skills: 'Java\nKotlin',
      description: 'Requirements\nJava or Kotlin',
    }),
  ).toMatchObject({ score: 100, matchedCount: 1, totalCount: 1 });
});

test('scores recognized AND items with unresolved components excluded', () => {
  const list = 'Java, JavaScript, UnknownTool, and CSS';
  expect(
    match(`Requirements\n${list}`, ['Java'], [], { skills: list }),
  ).toMatchObject({
    score: null,
    partialScore: 100 / 3,
    limitation: 'INCOMPLETE_INVENTORY',
    unresolved: ['UnknownTool'],
    matchedCount: 1,
    totalCount: 3,
    rows: [
      { skills: [{ name: 'Java', evidence: expect.any(Object) }] },
      { skills: [{ name: 'JavaScript', evidence: null }] },
      { skills: [{ name: 'CSS', evidence: null }] },
    ],
  });
});

test('an unresolved or mixed-operator alternative cannot earn partial credit', () => {
  for (const clause of ['Java or UnknownTool', 'Java and Kotlin or CSS']) {
    expect(
      match(`Requirements\n${clause}\nJavaScript`, ['Java']),
    ).toMatchObject({
      score: null,
      partialScore: 0,
      limitation: 'INCOMPLETE_INVENTORY',
      unresolved: [clause],
      matchedCount: 0,
      totalCount: 1,
      rows: [{ skills: [{ name: 'JavaScript', evidence: null }] }],
    });
  }
});

test('reconciles all eight technologies in wrapped original and saved qualifications', () => {
  const jd =
    'Requirements\n- Experience with Java, JavaScript, AJAX, CSS,\n  jQuery, DB2, SQL and MVC Framework\nBachelor’s degree\n3 years of professional experience in software development\nStrong communication and teamwork skills\nGood communication skills and ability to work well in a team';
  const skills =
    'Experience with Java, JavaScript, AJAX, CSS, jQuery, DB2, SQL and MVC Framework\nBachelor’s degree\nStrong communication and teamwork skills';
  const cv = ['Java, JavaScript, AJAX, CSS, jQuery, DB2, SQL, MVC Frameworks'];
  const saved = { skills, experience: '3 years of professional experience' };
  const result = match(jd, cv, [], saved);
  expect(result).toMatchObject({
    score: 100,
    limitation: null,
    unresolved: [],
    matchedCount: 8,
    totalCount: 8,
  });
  expect(result.rows.map(({ skills }) => skills[0]?.name)).toEqual([
    'Java',
    'JavaScript',
    'AJAX',
    'CSS',
    'jQuery',
    'DB2',
    'SQL',
    'MVC Framework',
  ]);
  const { start, end, quote } = result.rows[0]!.source;
  expect(jd.slice(start, end)).toBe(quote);
  expect(quote).toContain('\n');
  expect(match('', cv, [], saved).score).toBe(100);
});

test('standalone SQL, DB2 and MVC Framework do not match related products', () => {
  expect(
    match(
      'Requirements\nSQL, DB2 and MVC Framework',
      ['SQL Server, PostgreSQL, Spring MVC'],
      ['Used SQL Server, DB2-compatible tooling and Spring MVC.'],
    ),
  ).toMatchObject({ score: 0, matchedCount: 0, totalCount: 3 });
  expect(match('Requirements\nSQL Server', ['SQL']).score).toBe(0);
});

test('a duration with an unknown technical scope remains unresolved', () => {
  expect(
    match('Requirements\nJava\n3 years of SyntheticTool experience', ['Java']),
  ).toMatchObject({
    score: null,
    partialScore: 100,
    limitation: 'INCOMPLETE_INVENTORY',
    matchedCount: 1,
    unresolved: [],
    unclassifiedRequirementCount: 1,
  });
});

test('a frequency-free score uses only identified skills and keeps a verbatim requirement reference', () => {
  const jd =
    'Job title: Java engineer\nRequirements\nJava\nSpring Boot\nKotlin';
  const result = match(jd, [], ['Used Java.', 'Used Java again.']);
  expect(result).toMatchObject({
    score: 100 / 3,
    matchedCount: 1,
    totalCount: 3,
  });
  expect(result.rows[0]?.source.start).toBe(jd.lastIndexOf('Java'));
  expect(match('Requirements\nEnglish B2', ['Java'])).toMatchObject({
    score: null,
    limitation: 'NO_SKILLS',
    totalCount: 0,
  });
});

test('retains the first named skill and the unresolved introduction across a wrapped list', () => {
  const label =
    'Có kiến thức tốt về kỹ thuật lập trình: Java, JavaScript, teamwork';
  const result = match(
    'Requirements\n- ' + label.replace('kỹ thuật', 'kỹ\nthuật'),
    ['JavaScript'],
    [],
    { skills: label },
  );
  expect(
    result.rows.map((row) => [row.skills[0]?.name, !!row.skills[0]?.evidence]),
  ).toEqual([
    ['Java', false],
    ['JavaScript', true],
  ]);
  expect(result.unresolved).toContain('Có kiến thức tốt về kỹ thuật lập trình');
  expect(result.partialScore).toBe(50);
});

test('saved alternatives cannot rescue an unknown original OR', () => {
  expect(
    match('Requirements\nJava or UnknownTool', ['Java'], [], {
      skills: 'Java',
    }),
  ).toMatchObject({
    score: null,
    partialScore: null,
    totalCount: 0,
    unresolved: expect.arrayContaining(['Java or UnknownTool']),
  });
});

test('uses original priorities and explicitly reports saved-field disagreement', () => {
  expect(
    match('Requirements\nJava\nPreferred skills\nCSS', ['Java'], [], {
      skills: 'Java\nCSS',
    }),
  ).toMatchObject({
    partialScore: 75,
    score: null,
    fieldConflict: true,
    totalCount: 2,
  });
});

test.each([
  ['Spring', ['Spring Boot'], [], 100],
  ['Spring', [], ['Built services with Spring Boot.'], 100],
  ['Spring Boot', ['Spring'], [], 0],
  ['Spring Boot', ['Java'], [], 0],
  ['Spring', ['Java'], [], 0],
  ['Spring', [], ['No experience with Spring Boot.'], 0],
])(
  'uses directional reviewed evidence for %s with score %s',
  (jd, skills, work, score) => {
    const result = match(jd, skills, work);
    expect(result.score).toBe(score);
    if (score === 100)
      expect(result.rows[0]?.skills[0]?.evidence).toMatchObject({
        quote: expect.stringContaining('Spring Boot'),
        factId: '0',
        origin: 'user_entered',
      });
  },
);

test('excludes qualifications and recovers grounded technology phrases', () => {
  const result = match(
    'Requirements\nEssential qualifications\n5 years of experience in Java Full Stack development\nEnglish communication skills\nBack-end development using Spring Boot\nJava and Kotlin or CSS\nCI/CD pipelines',
    ['Spring Boot'],
  );
  expect(result).toMatchObject({
    score: null,
    partialScore: 100,
    totalCount: 1,
    unresolved: ['Java and Kotlin or CSS', 'CI/CD pipelines'],
    mixedGroups: ['Java and Kotlin or CSS'],
  });
});

test.each([
  ['VueJS', 'Vue.js'],
  ['Vue', 'VueJS'],
  ['NuxtJS', 'Nuxt.js'],
  ['Nuxt', 'NuxtJS'],
  ['Spring Boot', 'SpringBoot'],
  ['SpringBoot', 'Spring Boot'],
])(
  'recognizes %s and %s as the same technology in skills or work',
  (jd, cv) => {
    expect(match(jd, [cv]).matchedCount).toBe(1);
    expect(
      match(jd, [], ['Built a service using ' + cv + '.']).matchedCount,
    ).toBe(1);
  },
);

test.each(['PostgreSQL', 'SQL Server', 'Oracle'])(
  'requires explicit linked query work for %s to support SQL',
  (product) => {
    expect(match('SQL', [product]).matchedCount).toBe(0);
    expect(
      match('SQL', [], ['Built a service using ' + product + '.']).matchedCount,
    ).toBe(0);
    expect(
      match('SQL', [], ['No experience writing queries in ' + product + '.'])
        .matchedCount,
    ).toBe(0);
    expect(match(product, ['SQL']).matchedCount).toBe(0);
    const result = match('SQL', [], ['Optimized queries in ' + product + '.']);
    expect(result.rows[0]?.skills[0]?.evidence).toMatchObject({
      sectionKind: 'experience',
      factId: '0',
      origin: 'user_entered',
      relationship: { from: product, reason: 'EXPLICIT_SQL_WORK' },
    });
  },
);

test('matches confirmed Projects without Skills and retains fact offsets', () => {
  const cv = reviewedCvText([
    {
      id: 'project-fact',
      field: 'description',
      value: 'Built a Vue.js dashboard.',
      sectionId: 'projects',
      sectionKind: 'projects',
      entryId: 'project',
      confirmation: 'field',
      origin: 'source',
      evidence: [],
    },
  ]);
  const result = buildCvSkillMatch(
    {
      jdText: 'React OR VueJS',
      description: '',
      postText: '',
      skills: '',
      preferredSkills: '',
      experience: '',
      domain: '',
    } as Opportunity,
    cv,
  );
  expect(result).toMatchObject({ score: 100, totalCount: 1 });
  const evidence = result.rows[0]?.skills.find(
    ({ name }) => name === 'Vue',
  )?.evidence;
  expect(evidence).toMatchObject({
    factId: 'project-fact',
    sectionKind: 'projects',
    origin: 'source',
    quote: 'Built a Vue.js dashboard.',
  });
  expect(cv.text.slice(evidence?.start, evidence?.end)).toBe(evidence?.quote);
  expect(match('React OR VueJS', ['JavaScript']).matchedCount).toBe(0);
});

test.each([
  [
    'VueJS/NuxtJS and JavaScript or related frontend tools',
    ['Vue.js', 'Nuxt.js', 'JavaScript'],
    ['VueJS', 'NuxtJS', 'JavaScript'],
  ],
  [
    'Spring/Spring Boot and Java or equivalent',
    ['Spring Boot', 'Java'],
    ['Spring Boot', 'Java'],
  ],
  [
    'CRM/lead generation and B2B Sales or equivalent',
    ['CRM', 'Lead generation', 'B2B Sales'],
    ['CRM', 'lead generation', 'B2B Sales'],
  ],
  [
    'SEO/Google Ads and GA4 or equivalent',
    ['SEO', 'Google Ads', 'Google Analytics 4'],
    ['SEO', 'Google Ads', 'GA4'],
  ],
] as const)(
  'shows named matches independently of the clause: %s',
  (clause, skills, names) => {
    const jd = 'Required skills\n' + clause;
    const result = match(jd, [...skills]);
    expect(
      result.findings.filter((f) => f.kind === 'skill').map((f) => f.label),
    ).toEqual(names);
    expect(result.findings.some((f) => f.kind === 'clause')).toBe(true);
    for (const f of result.findings.filter((f) => f.kind === 'skill')) {
      expect(f.evidence?.factId).toBeTruthy();
      for (const source of f.sources)
        expect(jd.slice(source.start, source.end)).toBe(source.quote);
    }
  },
);

test('separates duration, qualifying query work, illustrations and related sales evidence', () => {
  const result = match(
    'Required skills\n2 years of experience with Java\nJava\nSQL (such as Oracle or SQL Server)\nCRM/lead generation and B2B Sales or equivalent',
    ['Java', 'Oracle', 'Salesforce'],
  );
  expect(result.findings.filter((f) => f.label === 'Java')).toHaveLength(1);
  expect(result.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'skill', label: 'Java' }),
      expect.objectContaining({ kind: 'requirement', label: 'SQL' }),
      expect.objectContaining({ kind: 'related', label: 'CRM' }),
    ]),
  );
  expect(
    result.findings.some((f) => ['SQL Server', 'Oracle'].includes(f.label)),
  ).toBe(false);
});

test('an explicit Sales requirement can lack documentation without becoming a scored group', () => {
  const result = match('Required skills\nLead generation', ['Salesforce']);
  expect(result.findings).toEqual([
    expect.objectContaining({ kind: 'requirement', label: 'Lead generation' }),
  ]);
  expect(result.totalCount).toBe(0);
});
