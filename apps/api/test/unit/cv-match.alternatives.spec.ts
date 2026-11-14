import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { mergeCandidates } from '../../src/opportunities/job-import.contract.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic ITviec-style requirement sentences; no real JD or CV content.
const degree =
  "Bachelor's degree in Computer Science, Software Engineering, Information Systems, or a related technical discipline";
const broker =
  'Experience with message brokers such as Kafka, RabbitMQ or equivalent';
const docker = 'Hands-on experience with Docker';
const description = `Requirements: ${degree}. ${broker}. ${docker}.`;
const job = (
  skills: string,
  preferredSkills = '',
  text = description,
): Opportunity =>
  ({
    title: 'Backend Engineer',
    skills,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: text,
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;
const assess = (
  saved: Opportunity,
  cv: string,
  quote: (requirement: string) => string = () => '',
) => {
  const canonical = canonicalRequirements(saved);
  const jd = matchJobText(saved);
  const proposals = canonical.map((item) => ({
    ...item,
    cvQuote: quote(item.requirement),
  }));
  return Object.fromEntries(
    scoreCvMatch(
      validateMatchAssessment(proposals, cv, jd, canonical),
      cv,
      jd,
      canonical,
    ).requirements.map((row) => [row.requirement, row]),
  );
};

describe('job import', () => {
  const candidates = (values: string[]) => ({
    candidates: values.map((value) => ({
      field: 'skills',
      value,
      source: 'jd',
      quote: description,
    })),
  });
  const skills = (values: string[], jd = description) =>
    mergeCandidates(candidates(values), '', jd).fields.find(
      (field) => field.field === 'skills',
    )?.value;

  test('inline alternative fragments save the whole source clause once', () => {
    expect(
      skills([
        'Computer Science',
        'Software Engineering',
        'Information Systems',
        'Kafka',
        'RabbitMQ',
      ]),
    ).toBe(`${degree}\n${broker}`);
  });

  test('a technology list without "or" keeps separate values', () => {
    const jd = 'Requirements: Java, Spring Boot and Docker.';
    expect(
      mergeCandidates(
        {
          candidates: ['Java', 'Docker'].map((value) => ({
            field: 'skills',
            value,
            source: 'jd',
            quote: jd,
          })),
        },
        '',
        jd,
      ).fields.find((field) => field.field === 'skills')?.value,
    ).toBe('Java\nDocker');
  });
});

describe('regrouping saved fragments', () => {
  test.each([
    [
      'separate rows',
      'Computer Science\nSoftware Engineering\nInformation Systems',
    ],
    [
      'one comma list',
      'Computer Science, Software Engineering, Information Systems',
    ],
  ])(
    '%s become one required OR requirement with the original sentence',
    (_, skills) => {
      const rows = canonicalRequirements(
        job(`${skills}\nKafka\nRabbitMQ\nDocker`),
      );
      expect(
        rows.map(({ requirement, jdQuote, priority }) => [
          requirement,
          jdQuote,
          priority,
        ]),
      ).toEqual([
        [degree, degree, 'required'],
        [broker, broker, 'required'],
        ['Docker', 'Docker', 'required'],
      ]);
      const jd = matchJobText(job(skills));
      for (const row of rows.slice(0, 2)) expect(jd).toContain(row.jdQuote);
    },
  );

  test('duplicate fragments do not create duplicate requirements', () => {
    expect(
      canonicalRequirements(job('Kafka\nRabbitMQ\nKafka\nRabbitMQ')).map(
        (row) => row.requirement,
      ),
    ).toEqual([broker]);
  });

  test.each([
    [
      'AND list in one sentence',
      'Docker\nKubernetes',
      'Experience with Docker and Kubernetes.',
    ],
    ['different sentences', 'Kafka\nDocker', description],
    [
      'comma list without or',
      'Java\nSpring Boot',
      'Requirements: Java, Spring Boot, Docker.',
    ],
  ])('no unintended grouping: %s', (_, skills, text) => {
    expect(
      canonicalRequirements(job(skills, '', text)).map(
        (row) => row.requirement,
      ),
    ).toEqual(skills.split('\n'));
  });

  test('rows with different priorities are not merged', () => {
    const rows = canonicalRequirements(job('Kafka', 'RabbitMQ'));
    expect(rows.map((row) => [row.requirement, row.priority])).toEqual([
      ['Kafka', 'required'],
      ['RabbitMQ', 'preferred'],
    ]);
  });
});

describe('degree alternatives', () => {
  const status = (cv: string) =>
    assess(
      job('Computer Science\nSoftware Engineering\nInformation Systems'),
      cv,
    )[degree]!;

  test.each([
    "Bachelor's Degree in Information Technology, Example University, 2018",
    'BSc Computer Science, Example University, 2016',
  ])(
    'a completed bachelor degree in an accepted field is evidenced: %s',
    (line) => {
      expect(status(`EDUCATION\n${line}`)).toMatchObject({
        status: 'EVIDENCED',
        credit: 1,
      });
    },
  );

  test.each([
    "Pursuing Bachelor's Degree in Information Technology (expected 2027)",
    "Bachelor's Degree in Marketing, Example University, 2018",
    'Example University — Information Technology, 2014–2018',
    "I do not hold a Bachelor's Degree in Information Technology.",
  ])(
    'no credit for incomplete, unsupported or attendance-only education: %s',
    (line) => {
      expect(status(`EDUCATION\n${line}`)).toMatchObject({ credit: 0 });
    },
  );
});

describe('broker alternatives', () => {
  const row = (cv: string) => assess(job('Kafka\nRabbitMQ'), cv)[broker]!;

  test('demonstrated use of one named technology satisfies the OR', () => {
    const result = row('- Built services consuming Kafka topics.');
    expect(result).toMatchObject({ status: 'EVIDENCED', credit: 1 });
    expect(result.coverage.components.map((c) => [c.label, c.status])).toEqual([
      ['Kafka', 'EVIDENCED'],
      ['RabbitMQ', 'NOT_EVIDENCED'],
    ]); // "or equivalent" is never a creditable component
  });

  test.each([
    'Skills: Kafka, RabbitMQ',
    'Backend: Kafka, RabbitMQ',
    'Interested in learning Kafka.',
    'Never used RabbitMQ or Kafka.',
  ])('no credit for skills lists, aspiration or negation: %s', (cv) => {
    expect(row(cv)).toMatchObject({ credit: 0 });
  });

  test('a denial of one alternative does not cancel demonstrated use of another', () => {
    expect(
      row('- Built services consuming Kafka topics.\nNever used RabbitMQ.'),
    ).toMatchObject({ status: 'EVIDENCED', credit: 1 });
  });
});

describe('Docker evidence relevance', () => {
  const work = '- Containerized services with Docker.';
  const row = (cv: string, quote = '') =>
    assess(job(docker, '', `Requirements: ${docker}.`), cv, () => quote)[
      docker
    ]!;

  test('a quote naming Docker is evidenced; recovery finds it without a quote', () => {
    expect(row(work, work)).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: work,
    });
    expect(row(work)).toMatchObject({ status: 'EVIDENCED', cvQuote: work });
  });

  test('a tools-list mention is not recovered', () => {
    expect(row('Tools: Git, Docker').status).toBe('NOT_EVIDENCED');
  });

  test('negation blocks recovery and contradicts a selected mention', () => {
    expect(row('Never used Docker in production.').status).toBe(
      'NOT_EVIDENCED',
    );
    expect(
      row(
        'Tools: Git, Docker\nNever used Docker in production.',
        'Tools: Git, Docker',
      ).status,
      // An experience row needs related professional use; a skills line is no
      // positive evidence, so there is nothing to conflict with (credit 0).
    ).toBe('NOT_EVIDENCED');
  });
});

test('existing AND aggregation is unchanged: one of two components is partial', () => {
  const requirement = 'Experience with Docker and Kubernetes';
  const result = assess(
    job(requirement, '', `Requirements: ${requirement}.`),
    '- Deployed services with Docker.',
    () => '- Deployed services with Docker.',
  )[requirement]!;
  expect(result).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
});
