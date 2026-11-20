import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchOutputSchema,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';
import {
  cvQuoteChoices,
  databaseAttributedQuoteChoices,
  resolveCvQuote,
} from '../../src/matching/cv-match.evidence.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const requirement =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const headers = [
  'Employer: Synthetic North',
  'Role: Backend Engineer',
  'Project: Synthetic billing',
];
const stack = 'Spring Boot · MyBatis · SQL Server · Thymeleaf';
const work = 'Developed enterprise features using SQL Server.';
const wrapped = 'Developed enterprise features\nusing SQL Server.';
const job = {
  title: 'Synthetic',
  skills: requirement,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: requirement,
  postText: '',
  jdText: '',
} as Opportunity;
const canonical = canonicalRequirements(job),
  jd = matchJobText(job);
function assess(cv: string, selected = stack) {
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((r) => ({ ...r, cvQuote: selected })),
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
  work,
  wrapped,
  wrapped.replace('\n', '\r\n'),
  '• Developed enterprise features\n  using SQL Server.',
])(
  'single-line and soft-wrapped clauses return original work evidence: %s',
  (quote) => {
    const cv = `${stack}\n${quote}`;
    const result = assess(cv),
      row = result.requirements[0]!;
    expect(row).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
      cvQuote: quote,
    });
    expect(row.coverage.components[2]).toMatchObject({
      status: 'PARTIAL',
      cvQuote: quote,
    });
    expect(resolveCvQuote(cv, row.cvQuote)).toBe(quote);
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  },
);
test.each([work, wrapped])(
  'complete attributed candidates recover the minimum exact context: %s',
  (clause) => {
    const quote = [...headers, clause].join('\n'),
      cv = `${stack}\n${quote}\nOptimized data-access logic and MyBatis queries.`;
    expect(cvQuoteChoices(cv)).not.toContain(quote); // Generic window is still three spans.
    expect(databaseAttributedQuoteChoices(cv)).toEqual([quote]);
    const result = assess(cv),
      row = result.requirements[0]!;
    expect(row).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
      cvQuote: quote,
    });
    expect(
      row.coverage.components.filter((c) => c.status === 'PARTIAL'),
    ).toHaveLength(1);
    expect(row.coverage.components[2]?.observations).toContainEqual({
      kind: 'experience',
      cvQuote: quote,
    });
    expect(cv.slice(cv.indexOf(quote), cv.indexOf(quote) + quote.length)).toBe(
      row.cvQuote,
    );
    const choices = matchOutputSchema(cv, canonical).properties.requirements
      .items.properties.cvQuote.enum;
    expect(choices).toContain(quote);
    expect(choices.filter((q) => q === quote)).toHaveLength(1);
    expect(
      matchOutputSchema(cv).properties.requirements.items.properties.cvQuote
        .enum,
    ).not.toContain(quote);
  },
);
test('a model-selected complete exact candidate and recovery make the same decision', () => {
  const quote = [...headers, wrapped].join('\n'),
    cv = `${stack}\n${quote}`;
  // Same decision; only the model-quote diagnostic differs.
  const decision = (selected?: string) => {
    const row = { ...assess(cv, selected).requirements[0]! };
    delete (row as { evidence?: unknown }).evidence;
    return row;
  };
  expect(decision(quote)).toEqual(decision());
  expect(decision('')).toEqual(decision());
});
test.each([
  stack,
  `Project: Enterprise billing\n${stack}`,
  `Project: Enterprise billing using SQL Server.\nDeveloped enterprise features for this application.`,
  `${stack}\nOptimized data-access logic and MyBatis queries.`,
  'Developed enterprise features.\nusing SQL Server.',
  'Developed enterprise features;\nusing SQL Server.',
  'Developed enterprise features\n\nusing SQL Server.',
  'Developed enterprise features\n• using SQL Server.',
  'Developed enterprise features\n- using SQL Server.',
  'Developed enterprise features\n2. using SQL Server.',
  'Developed enterprise features\nResponsibilities:\nusing SQL Server.',
  'Developed enterprise features\nProject: Other\nusing SQL Server.',
  'Developed enterprise features\nUsing SQL Server:',
  'I have never developed enterprise features\nusing SQL Server.',
  'I plan to develop enterprise features\nusing SQL Server.',
  `${stack}\nProject: Reporting\nDeveloped enterprise features using PostgreSQL.`,
])(
  'lists, unrelated context, boundaries, negation and aspiration remain uncredited: %s',
  (text) => {
    const cv = `${stack}\n${text}`;
    expect(assess(cv)).toMatchObject({
      coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
      requirements: [{ status: 'NOT_EVIDENCED', credit: 0, cvQuote: '' }],
    });
  },
);
test('contradiction still wins over exact wrapped professional work', () => {
  const quote = [...headers, wrapped].join('\n'),
    denial = 'I have never used SQL Server.';
  const result = assess(`${stack}\n${quote}\n${denial}`);
  expect(result.requirements[0]).toMatchObject({
    status: 'CONFLICT',
    credit: 0,
    cvQuote: quote,
  });
  expect(
    result.requirements[0]?.coverage.components[2]?.conflictingQuotes,
  ).toContain(denial);
  expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
});
test('strong database responsibility stays Matched without changing policy', () => {
  const quote = [
    ...headers,
    'Designed SQL Server database schemas for a production billing application.',
  ].join('\n');
  expect(assess(`${stack}\n${quote}`)).toMatchObject({
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
    requirements: [{ status: 'EVIDENCED', credit: 1, cvQuote: quote }],
  });
});
test('extra database candidates are capped, bounded and never cross duplicate attribution entries', () => {
  const cv = Array.from(
    { length: 30 },
    (_, i) =>
      `Employer: Synthetic ${i}\nRole: Backend Engineer\nProject: Billing ${i}\n${wrapped}`,
  ).join('\n\n');
  const choices = databaseAttributedQuoteChoices(cv);
  expect(choices).toHaveLength(20);
  expect(new Set(choices).size).toBe(20);
  for (const quote of choices) {
    expect(quote.length).toBeLessThanOrEqual(2000);
    expect(quote.split('\n')).toHaveLength(5);
    expect(quote.match(/Employer:/gu)).toHaveLength(1);
    expect(resolveCvQuote(cv, quote)).toBe(quote);
  }
  const huge = `Employer: ${'x'.repeat(2000)}\nRole: Backend Engineer\nProject: Billing\n${wrapped}`;
  expect(databaseAttributedQuoteChoices(huge)).toEqual([]);
  const separate = `Employer: Synthetic\nRole: Backend Engineer\n\nProject: Billing\n${wrapped}`;
  expect(databaseAttributedQuoteChoices(separate)).toEqual([]);
});
test('rejected evidence suppression, strongest OR alternative and unrelated recovery remain unchanged', () => {
  const cv = [...headers, wrapped].join('\n'),
    group = requirementGroup(requirement, 'skill');
  expect(evaluateCoverage(group, [], cv, false).status).toBe('NOT_EVIDENCED');
  expect(evaluateCoverage(group, [], cv, true)).toMatchObject({
    status: 'PARTIAL',
    credit: 0.5,
  });
  expect(
    evaluateCoverage(
      group,
      [],
      `${cv}\nDeveloped enterprise features using MySQL.`,
      true,
    ),
  ).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
  expect(
    evaluateCoverage(group, [], `${cv}\nProficient in Oracle.`, true),
  ).toMatchObject({ status: 'EVIDENCED', credit: 1 });
  const managed = requirementGroup(
    'Experience in at least one managed language such as Java, Scala, Go, C# or similar.',
    'skill',
  );
  const java = [...headers, 'Developed enterprise Java services.'].join('\n');
  expect(evaluateCoverage(managed, [], java, true).status).toBe(
    'NOT_EVIDENCED',
  ); // No global window increase.
});
