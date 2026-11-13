import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic only.
const lang =
  'Strong proficiency in at least one programming language such as Java, Python, or equivalent';
const job = {
  title: 'Backend Engineer',
  skills: `- ${lang}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements\n- ${lang}.`,
  postText: '',
  jdText: '',
} as unknown as Opportunity;
const canonical = canonicalRequirements(job);
const jd = matchJobText(job);
const assess = (cv: string, quote = '') => {
  const proposals = canonical.map((row) => ({
    ...row,
    cvQuote: '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quote.includes(c.label) ? quote : '',
      }),
    ),
  }));
  const row = scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  ).requirements[0]!;
  return {
    status: row.status,
    credit: row.credit,
    components: Object.fromEntries(
      row.coverage.components.map((c) => [c.label, c.status]),
    ),
  };
};

test('modelled as OR over the named languages; "or equivalent" is no component', () => {
  const group = requirementGroup(lang, 'skill');
  expect(group).toMatchObject({ mode: 'OR', languageProficiency: true });
  expect(group.components.map((c) => c.label)).toEqual(['Java', 'Python']);
});

describe('professional use is PARTIAL, never full proficiency', () => {
  test.each([
    [
      'Java only',
      '- Developed Java Spring Boot services for order processing.',
      'Java',
    ],
    [
      'Python only',
      '- Built Python data pipelines for reporting services.',
      'Python',
    ],
  ])('%s: one alternative is enough for PARTIAL 0.5', (_, line, label) => {
    const result = assess(`EXPERIENCE\n${line}`);
    expect(result).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
    expect(result.components[label]).toBe('PARTIAL');
  });

  test('a model-selected work line gives the same PARTIAL', () => {
    const line = '- Developed Java Spring Boot services for order processing.';
    expect(assess(`EXPERIENCE\n${line}`, line)).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
    });
  });
});

describe('no credit', () => {
  test.each([
    ['skills list only', 'SKILLS\nLanguages: Java, Python, TypeScript', ''],
    [
      'skills list selected by the model',
      'SKILLS\nLanguages: Java, Python, TypeScript',
      'Languages: Java, Python, TypeScript',
    ],
    [
      'skills list with a level word',
      'SKILLS\nLanguages: Java expert, Python',
      '',
    ],
    ['negated use', 'EXPERIENCE\nNever used Python in production.', ''],
    ['negated proficiency', 'SUMMARY\nNot proficient in Java yet.', ''],
    [
      'only an unlisted "equivalent" language',
      'EXPERIENCE\n- Developed Go services for payments.',
      '',
    ],
    [
      'coursework',
      'EDUCATION\n- Built Java applications in a university course.',
      '',
    ],
  ])('%s', (_, cv, quote) => {
    expect(assess(cv, quote)).toMatchObject({ credit: 0 });
  });
});

test('an explicit stated proficiency level is full credit', () => {
  const line = 'Proficient in Java with 6 years of backend development.';
  for (const quote of ['', line])
    expect(assess(`SUMMARY\n${line}`, quote)).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
    });
});

test('unrelated rules are unchanged', () => {
  expect(
    requirementGroup(
      'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies',
      'skill',
    ),
  ).toMatchObject({ mode: 'OR', demonstratedUse: true });
  expect(
    requirementGroup(
      'Backend service experience in at least one managed language such as Java, Go, or similar',
      'skill',
    ),
  ).toMatchObject({ mode: 'OR', managedLanguage: true });
  expect(
    requirementGroup(
      'Proficiency in multiple programming languages such as Java, Python',
      'skill',
    ).mode,
  ).toBe('UNKNOWN');
});
