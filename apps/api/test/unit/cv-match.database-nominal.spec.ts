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
  databaseAttributedQuoteChoices,
  resolveCvQuote,
} from '../../src/matching/cv-match.evidence.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const requirement =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const stack = 'Spring Boot · MyBatis · SQL Server · Thymeleaf';
const headers =
  'Employer: Synthetic Ledger\nRole: Backend Engineer\nProject: Synthetic invoices';
const nominal = 'Development of enterprise features using SQL Server.';
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
function assess(text: string, quote = stack, preferredSkills = '') {
  const canonical = canonicalRequirements({ ...job, preferredSkills }),
    jd = matchJobText({ ...job, preferredSkills });
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((r, i) => ({ ...r, cvQuote: i === 0 ? quote : '' })),
      text,
      jd,
      canonical,
    ),
    text,
    jd,
    canonical,
  );
}
const target = (r: ReturnType<typeof assess>) => r.requirements[0]!;
test.each([
  'Developed enterprise features using SQL Server.',
  nominal,
  'Implementation of database-backed application functionality with SQL Server.',
  'Responsible for developing enterprise features using SQL Server.',
  'Development of enterprise features using Spring Boot, MyBatis and SQL Server.',
])(
  'explicit verb-led or nominal professional work yields equivalent Partial credit: %s',
  (responsibility) => {
    const quote = `Role: Backend Engineer\n${responsibility}`,
      cv = `${stack}\n${quote}`;
    const result = assess(cv, stack, 'Rust');
    expect(target(result)).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
      cvQuote: quote,
    });
    expect(target(result).coverage.components[2]).toMatchObject({
      status: 'PARTIAL',
      cvQuote: quote,
    });
    expect(
      target(result).coverage.components.filter((c) => c.status === 'PARTIAL'),
    ).toHaveLength(1);
    expect(resolveCvQuote(cv, target(result).cvQuote)).toBe(quote);
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  },
);
test.each([
  nominal,
  'Development of enterprise features\nusing SQL Server.',
  'Implementation of database-backed application functionality\nwith SQL Server.',
  'Responsible for developing enterprise features\nusing SQL Server.',
])(
  'nominal responsibility retains bounded complete attribution and exact wraps: %s',
  (responsibility) => {
    const quote = `${headers}\n${responsibility}`,
      cv = `${stack}\n${quote}`;
    expect(databaseAttributedQuoteChoices(cv)).toEqual([quote]);
    expect(
      matchOutputSchema(cv, canonicalRequirements(job)).properties.requirements
        .items.properties.cvQuote.enum,
    ).toContain(quote);
    for (const selection of [stack, '', quote]) {
      const result = assess(cv, selection);
      expect(target(result)).toMatchObject({
        status: 'PARTIAL',
        credit: 0.5,
        cvQuote: quote,
      });
      expect(
        target(result).coverage.components[2]?.observations,
      ).toContainEqual({ kind: 'experience', cvQuote: quote });
      expect(
        cv.slice(cv.indexOf(quote), cv.indexOf(quote) + quote.length),
      ).toBe(target(result).cvQuote);
    }
  },
);
test('CRLF and bullet continuation survive nominal classification unchanged', () => {
  const quote = `${headers.replaceAll('\n', '\r\n')}\r\n• Development of enterprise features\r\n  using SQL Server.`;
  expect(target(assess(`${stack}\r\n${quote}`)).cvQuote).toBe(quote);
});
test.each([
  stack,
  'Enterprise project: SQL Server',
  'MyBatis query optimization',
  'Interested in learning SQL Server',
  'No responsibility for SQL Server development',
  'Development of enterprise features.\nSQL Server technology stack',
  `Development of enterprise features using Python.\n${stack}`,
  `Development of enterprise features\n${stack}`,
  'Development of enterprise features.\nusing SQL Server.',
  'Development of enterprise features\n\nusing SQL Server.',
  'Development of enterprise features\n• using SQL Server.',
  'Development of enterprise features\n- using SQL Server.',
  'Development of enterprise features\n2. using SQL Server.',
  'Development of enterprise features\nProject: Other\nusing SQL Server.',
  'Development of enterprise features\nResponsibilities:\nusing SQL Server.',
  'Plan to gain responsibility for developing enterprise features using SQL Server.',
  'Development of enterprise features using SQL Server in a tutorial only.',
  'Implementation of database-backed application functionality with SQL Server.', // No professional attribution.
  'Development of training material using SQL Server.',
  'Development of enterprise features with documentation about SQL Server.',
  'Development of enterprise features using SQL Server documentation.',
  'Development of enterprise features using Spring Boot and SQL Server manuals.',
  'Enterprise project: Development of enterprise features using SQL Server.',
  'Development of enterprise features using Python.\n• Implementation of application functionality with SQL Server.',
  'Implementation of application functionality with SQL Server.\nRole: Backend Engineer',
])(
  'names, incidental relationships, boundaries and unsafe claims remain Unknown: %s',
  (text) => {
    expect(target(assess(`${stack}\n${text}`))).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
      cvQuote: '',
    });
  },
);
test.each([
  'I have never used SQL Server.',
  'No responsibility for SQL Server development.',
  'I am not responsible for developing enterprise features using SQL Server.',
])('explicit contradictory work claims remain Conflict: %s', (denial) => {
  const quote = `${headers}\n${nominal}`,
    cv = `${stack}\n${quote}\n${denial}`;
  const result = assess(cv);
  expect(target(result)).toMatchObject({ status: 'CONFLICT', credit: 0 });
  expect(target(result).coverage.components[2]?.conflictingQuotes).toContain(
    denial,
  );
  expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
});
test('unverified proficiency or denied administration does not contradict ordinary development use', () => {
  for (const qualifier of [
    'I am not proficient in SQL Server.',
    'I am not responsible for SQL Server administration.',
  ])
    expect(
      target(assess(`${stack}\n${headers}\n${nominal}\n${qualifier}`)),
    ).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
});
test('OR uses strongest evidence without promoting nominal use to proficiency', () => {
  const cv = `${stack}\n${headers}\n${nominal}`;
  expect(
    target(assess(`${cv}\nDevelopment of enterprise features using MySQL.`)),
  ).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
  expect(target(assess(`${cv}\nProficient in Oracle.`))).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
  });
  const strong =
    'Designed SQL Server database schemas for a production billing application.';
  expect(target(assess(`${stack}\n${strong}`))).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
    cvQuote: strong,
  });
});
test('rejected-evidence suppression and unrelated requirement families retain their rules', () => {
  const group = requirementGroup(requirement, 'skill');
  expect(
    evaluateCoverage(group, [], `${headers}\n${nominal}`, false).status,
  ).toBe('NOT_EVIDENCED');
  const managed = requirementGroup(
    'Experience in at least one managed language such as Java, Scala, Go, C# or similar.',
    'skill',
  );
  expect(
    evaluateCoverage(
      managed,
      [],
      'Development of enterprise Java features.',
      true,
    ).status,
  ).toBe('NOT_EVIDENCED');
  expect(
    requirementGroup('Experience designing APIs and integrations', 'skill')
      .mode,
  ).toBe('AND');
});
