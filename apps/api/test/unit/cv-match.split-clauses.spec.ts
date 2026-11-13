import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { sectionCandidates } from '../../src/opportunities/job-import.sections.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic ITviec-style lines; mirrors the saved-job shape from the beta UI.
const degree =
  "Bachelor's degree or higher in Computer Science, Software Engineering, Information Systems, or a related technical discipline";
const broker =
  'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ';
const docker = 'Hands-on experience with Docker';
const jdOf = (...lines: string[]) =>
  `Requirements\n${lines.map((line) => `- ${line}.`).join('\n')}`;
const jd = jdOf(degree, broker, docker);
// Rows saved by the pre-v5 import split (import order).
const fragments = [
  "- Bachelor's degree or higher in Computer Science",
  'Software Engineering',
  'Information Systems',
  'or a related technical discipline',
  '- Experience working with message brokers or streaming platforms such as Kafka',
  'RabbitMQ',
  `- ${docker}`,
];
// RequirementInputs saves technical lines before education lines.
const uiOrder = [...fragments.slice(1), fragments[0]!];
const job = (
  skills: string[],
  description = jd,
  preferredSkills: string[] = [],
): Opportunity =>
  ({
    title: 'Backend Engineer',
    skills: skills.join('\n'),
    preferredSkills: preferredSkills.join('\n'),
    experience: '',
    domain: '',
    seniority: '',
    description,
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;
const labels = (saved: Opportunity) =>
  canonicalRequirements(saved).map((row) => row.requirement);
const cv = [
  'EDUCATION',
  "Bachelor's Degree in Information Technology, Example University, 2018",
  'EXPERIENCE',
  '- Built services consuming Kafka topics.',
  '- Containerized services with Docker.',
].join('\n');
const assess = (saved: Opportunity, source = cv) => {
  const canonical = canonicalRequirements(saved);
  const text = matchJobText(saved);
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((row) => ({ ...row })),
      source,
      text,
      canonical,
    ),
    source,
    text,
    canonical,
  );
};

describe('import keeps continued alternative clauses intact', () => {
  test('degree and broker lines stay one value each', () => {
    expect(
      sectionCandidates(jd, 'jd').map((candidate) => candidate.value),
    ).toEqual([`- ${degree}`, `- ${broker}`, `- ${docker}`]);
  });

  test.each([
    [
      'OR group followed by separate requirements',
      'Java or Kotlin, Spring Boot, Docker',
      ['- Java or Kotlin', 'Spring Boot', 'Docker'],
    ],
    [
      'OR group plus a separate item',
      'Experience with Kafka or RabbitMQ, plus Docker',
      ['- Experience with Kafka or RabbitMQ', 'plus Docker'],
    ],
    [
      'AND list',
      'Experience with Kafka, RabbitMQ, and Docker',
      ['- Experience with Kafka, RabbitMQ, and Docker'],
    ],
  ])('%s keeps its existing split', (_, line, expected) => {
    expect(
      sectionCandidates(jdOf(line), 'jd').map((candidate) => candidate.value),
    ).toEqual(expected);
  });
});

describe('read-time repair of saved fragments', () => {
  test.each([
    ['import order', fragments],
    ['UI order', uiOrder],
  ])('%s: each clause is rebuilt once, independent rows kept', (_, saved) => {
    const rows = canonicalRequirements(job(saved));
    expect(
      rows.map(({ requirement, jdQuote, priority }) => [
        requirement,
        jdQuote,
        priority,
      ]),
    ).toEqual(
      // A rebuilt clause takes the position of its first saved fragment.
      [degree, broker, docker].map((text) => [
        text,
        // Untouched rows keep their original saved line as jdQuote (PR58).
        text === docker ? `- ${docker}` : text,
        'required',
      ]),
    );
    for (const row of rows)
      expect(matchJobText(job(saved))).toContain(row.jdQuote);
  });

  test('a saved duplicate of the full clause is not counted twice', () => {
    expect(labels(job([...fragments, degree]))).toEqual([
      degree,
      broker,
      docker,
    ]);
  });

  test('missing fragment: nothing is repaired', () => {
    const saved = fragments.filter((row) => row !== 'Information Systems');
    expect(labels(job(saved)).slice(0, 3)).toEqual([
      "Bachelor's degree or higher in Computer Science",
      'Software Engineering',
      'or a related technical discipline',
    ]);
  });

  test('mixed priorities: nothing is repaired', () => {
    const saved = job(
      fragments.filter((row) => row !== 'RabbitMQ'),
      jd,
      ['RabbitMQ'],
    );
    const rows = canonicalRequirements(saved);
    expect(rows.map((row) => row.requirement)).toContain(
      'Experience working with message brokers or streaming platforms such as Kafka',
    );
    expect(rows.find((row) => row.requirement === 'RabbitMQ')?.priority).toBe(
      'preferred',
    );
  });

  test('ambiguous duplicate fragment: nothing is repaired', () => {
    expect(labels(job([...fragments, 'RabbitMQ']))).toContain('RabbitMQ');
  });

  test('a fragment that is also its own JD requirement is never consumed', () => {
    const description = jdOf(degree, broker, docker, 'RabbitMQ');
    expect(labels(job([...fragments], description))).toEqual(
      expect.arrayContaining([
        'Experience working with message brokers or streaming platforms such as Kafka',
        'RabbitMQ',
      ]),
    );
  });

  test.each([
    [
      'AND list',
      ['Kafka', 'RabbitMQ', 'Docker'],
      'Experience with Kafka, RabbitMQ, and Docker',
    ],
    [
      'OR group plus separate item',
      ['Experience with Kafka or RabbitMQ', 'plus Docker'],
      'Experience with Kafka or RabbitMQ, plus Docker',
    ],
    [
      'unrelated comma requirements',
      ['Java or Kotlin', 'Spring Boot', 'Docker'],
      'Java or Kotlin, Spring Boot, Docker',
    ],
  ])('%s is not merged', (_, saved, line) => {
    expect(labels(job(saved, jdOf(line)))).toEqual(saved);
  });
});

describe('scoring the repaired clauses', () => {
  test('degree and broker OR clauses count once with exact CV evidence', () => {
    for (const saved of [fragments, uiOrder]) {
      const result = assess(job(saved));
      expect(result.score).toBe(100);
      expect(result.requirements).toHaveLength(3);
      for (const row of result.requirements) {
        expect(row.status).toBe('EVIDENCED');
        expect(cv).toContain(row.cvQuote);
        expect(row.cvQuote.trim()).not.toBe('');
      }
      const byLabel = Object.fromEntries(
        result.requirements.map((row) => [row.requirement, row]),
      );
      expect(byLabel[degree]!.cvQuote).toBe(
        "Bachelor's Degree in Information Technology, Example University, 2018",
      );
      expect(byLabel[broker]!.cvQuote).toBe(
        '- Built services consuming Kafka topics.',
      );
    }
  });

  test.each([
    "Pursuing Bachelor's Degree in Information Technology (expected 2027)",
    "Bachelor's Degree in Marketing, Example University, 2018",
    'Example University — Information Technology, 2014–2018',
  ])('no degree credit: %s', (line) => {
    const result = assess(job(fragments), `EDUCATION\n${line}`);
    expect(
      result.requirements.find((row) => row.requirement === degree),
    ).toMatchObject({
      credit: 0,
    });
  });

  test.each(['Skills: Kafka, RabbitMQ', 'Never used Kafka or RabbitMQ.'])(
    'no broker credit: %s',
    (line) => {
      const result = assess(job(fragments), line);
      expect(
        result.requirements.find((row) => row.requirement === broker),
      ).toMatchObject({
        credit: 0,
      });
    },
  );
});
