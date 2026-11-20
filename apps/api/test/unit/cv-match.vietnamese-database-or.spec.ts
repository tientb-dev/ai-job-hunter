import { expect, test } from '@jest/globals';
import {
  requirementGroup,
  evaluateCoverage,
} from '../../src/matching/cv-match.coverage.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const requirement =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';

test.each([
  requirement,
  'Thành thạo một trong các hệ quản trị cơ sở dữ liệu: MySQL, Oracle hoặc SQL Server',
  'Sử dụng thành thạo ít nhất một cơ sở dữ liệu: PostgreSQL / MariaDB / Oracle',
])(
  'one Vietnamese quantified database parent preserves exact alternatives and proficiency: %s',
  (text) => {
    const job = {
      skills: text,
      preferredSkills: '',
      experience: '',
      domain: '',
      title: '',
      seniority: '',
      description: text,
      postText: '',
      jdText: '',
    } as Opportunity;
    const canonical = canonicalRequirements(job);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]?.jdQuote).toBe(text);
    const group = requirementGroup(text, 'skill');
    expect(group).toMatchObject({ mode: 'OR', context: 'proficiency' });
    expect(group.components).toHaveLength(3);
    for (const component of group.components)
      expect(text).toContain(component.jdQuote);
  },
);

test.each([
  [
    'Proficient in MySQL for production database administration.',
    'EVIDENCED',
    1,
  ],
  ['Thành thạo SQL Server trong công việc quản trị dữ liệu.', 'EVIDENCED', 1],
  ['Expert in Oracle for production database administration.', 'EVIDENCED', 1],
  ['Proficient in MySQL and SQL Server.', 'EVIDENCED', 2],
  [
    'Administered production MySQL databases with query tuning, indexing and replication.',
    'EVIDENCED',
    1,
  ],
  ['Proficient in Oracle Cloud.', 'NOT_EVIDENCED', 0],
  ['Skills: MySQL, SQL Server', 'NOT_EVIDENCED', 0],
  ['Used MySQL for a small internal application.', 'NOT_EVIDENCED', 0],
  ['I have never used MySQL or SQL Server.', 'NOT_EVIDENCED', 0],
  ['I plan to learn Oracle.', 'NOT_EVIDENCED', 0],
  ['Dự định thành thạo Oracle.', 'NOT_EVIDENCED', 0],
  ['Tôi chưa thành thạo SQL Server.', 'NOT_EVIDENCED', 0],
  ['Basic MySQL use; advanced plans for Oracle.', 'NOT_EVIDENCED', 0],
  ['Proficient in Java and used MySQL.', 'NOT_EVIDENCED', 0],
  [
    'Our team administered production MySQL databases with query tuning and replication.',
    'NOT_EVIDENCED',
    0,
  ],
  ['Proficient in MySQL. I have never used MySQL.', 'CONFLICT', 0],
] as const)('level-qualified source evidence: %s', (cv, status, count) => {
  const group = requirementGroup(requirement, 'skill');
  const coverage = evaluateCoverage(group, [cv], cv, true);
  expect(coverage.status).toBe(status);
  expect(
    coverage.components.filter((component) => component.status === 'EVIDENCED'),
  ).toHaveLength(count);
  expect(coverage.credit).toBe(status === 'EVIDENCED' ? 1 : 0);
  for (const component of coverage.components) {
    if (component.cvQuote) expect(cv).toContain(component.cvQuote);
    for (const quote of component.conflictingQuotes)
      expect(cv).toContain(quote);
  }
  if (status === 'NOT_EVIDENCED')
    expect(coverage.reason).toContain('requested level');
});

test('bounded omitted-quote recovery honors proficiency and rejected evidence suppression', () => {
  const group = requirementGroup(requirement, 'skill');
  const cv = 'Proficient in Oracle.';
  expect(evaluateCoverage(group, [], cv, true).status).toBe('EVIDENCED');
  expect(evaluateCoverage(group, [], cv, false).status).toBe('NOT_EVIDENCED');
  expect(evaluateCoverage(group, [], 'Skills: Oracle', true).status).toBe(
    'NOT_EVIDENCED',
  );
});

test('a validated database OR parent contributes its strongest alternative and required weight once', () => {
  const job = {
    skills: requirement,
    preferredSkills: 'Rust\nKotlin',
    experience: '',
    domain: '',
    title: '',
    seniority: '',
    description: requirement,
    postText: '',
    jdText: '',
  } as Opportunity;
  const cv = 'Proficient in MySQL.';
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const proposals = canonical.map((row) => ({
    ...row,
    cvQuote: row.requirement === requirement ? cv : '',
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  const result = scoreCvMatch(verified, cv, jd, canonical);
  expect(result.requirements).toHaveLength(3);
  expect(result.requirements[0]).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
    coverage: { mode: 'OR' },
  });
  expect(result.score).toBe(Math.round((3 * 40) / (3 + 1 + 1)));
});

test('unrecognized quantities and unrelated requirement families retain conservative parsing', () => {
  expect(
    requirementGroup(
      'Thành thạo ít nhất hai hệ quản trị cơ sở dữ liệu: MySQL, Oracle',
      'skill',
    ).mode,
  ).toBe('UNKNOWN');
  expect(
    requirementGroup('Experience designing APIs and integrations', 'skill')
      .mode,
  ).toBe('AND');
  expect(
    evaluateCoverage(
      requirementGroup('Java or Python', 'skill'),
      ['Skills: Java'],
      'Skills: Java',
    ).status,
  ).toBe('EVIDENCED');
});
