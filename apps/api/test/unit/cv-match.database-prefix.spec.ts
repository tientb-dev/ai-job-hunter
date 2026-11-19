import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { resolveCvQuote } from '../../src/matching/cv-match.evidence.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const requirement =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const stack = 'SQL Server, MyBatis';
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
function assess(text: string) {
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job),
    cv = `${stack}\n${text}`;
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((r) => ({ ...r, cvQuote: stack })),
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
  'Led the implementation of production notification services with SQL Server.',
  'Led the development of commercial application functionality using SQL Server.',
  'Led the implementation of production notification services\nwith SQL Server.',
  'Led the development of enterprise services using Spring Boot and SQL Server.',
])(
  'leadership prefix preserves the nominal work object, database link and exact source quote',
  (quote) => {
    const result = assess(quote),
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
    expect(resolveCvQuote(`${stack}\n${quote}`, row.cvQuote)).toBe(quote);
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  },
);
test.each([
  'Led the project: SQL Server',
  'Led the development of enterprise services.\nSQL Server technology stack',
  'Led the development of enterprise services using Python.\nSQL Server technology stack',
  'Led the development of enterprise services.\nusing SQL Server.',
  'Led the development of enterprise services\n• using SQL Server.',
  'Led the development of enterprise services\nProject: Other\nusing SQL Server.',
  'Led the development of enterprise services\n\nusing SQL Server.',
  'I have not led the development of enterprise services using SQL Server.',
  'I hope to lead the development of enterprise services using SQL Server.',
  'Led the development of enterprise services using SQL Server manuals.',
  'Led the development of training material using SQL Server.',
])(
  'leadership words do not bypass database linkage, boundaries or evidence guards: %s',
  (text) => {
    expect(assess(text).requirements[0]).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
      cvQuote: '',
    });
  },
);
test('preceding professional attribution is retained, and later context cannot be borrowed', () => {
  const quote =
    'Role: Backend Engineer\nLed the implementation of application functionality with SQL Server.';
  expect(assess(quote).requirements[0]).toMatchObject({
    status: 'PARTIAL',
    cvQuote: quote,
  });
  expect(
    assess(
      'Led the implementation of application functionality with SQL Server.\nRole: Backend Engineer',
    ).requirements[0]?.status,
  ).toBe('NOT_EVIDENCED');
});
test('use denial remains Conflict and ordinary leadership work is never proficiency', () => {
  const work = 'Led the development of enterprise services using SQL Server.';
  expect(
    assess(`${work}\nI have never used SQL Server.`).requirements[0],
  ).toMatchObject({ status: 'CONFLICT', credit: 0 });
  expect(
    assess(`${work}\nI am not proficient in SQL Server.`).requirements[0],
  ).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
});
