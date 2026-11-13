import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Fabricated CV mirroring the reported layout: Skills, a project technology
// stack and a work bullet wrapped by PDF extraction.
const broker =
  'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies';
const job = {
  title: 'Backend Engineer',
  skills: `- ${broker}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements\n- ${broker}.`,
  postText: '',
  jdText: '',
} as unknown as Opportunity;
const canonical = canonicalRequirements(job);
const jd = matchJobText(job);
const wrapped =
  '- Led the redesign of the Example Orders platform into a microservices\narchitecture with asynchronous communication using RabbitMQ.';
const cvOf = (...work: string[]) =>
  [
    'SKILLS',
    'Messaging: RabbitMQ, Redis',
    'EXPERIENCE',
    'Senior Backend Engineer, Example Retail Co, 2020-2024',
    ...work,
    'PROJECTS',
    'Example Orders Platform',
    'Technologies: Java, Spring Boot, RabbitMQ, PostgreSQL',
  ].join('\n');

function assess(cv: string, rabbitQuote = '', provider = true) {
  const proposals = canonical.map((row) => ({
    ...row,
    cvQuote: '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: c.label === 'RabbitMQ' ? rabbitQuote : '',
      }),
    ),
  }));
  const row = scoreCvMatch(
    validateMatchAssessment(
      proposals,
      cv,
      jd,
      canonical,
      provider ? new Set(matchQuoteChoices(cv, canonical)) : undefined,
    ),
    cv,
    jd,
    canonical,
  ).requirements[0]!;
  const component = (label: string) =>
    row.coverage.components.find((c) => c.label === label)!;
  return { row, rabbit: component('RabbitMQ'), kafka: component('Kafka') };
}

describe('wrapped work bullet is one evidence unit', () => {
  test.each([
    ['independent recovery', ''],
    ['Gemini quotes the whole wrapped bullet', wrapped],
    ['Gemini quotes only the continuation line', wrapped.split('\n')[1]!],
  ])('%s: RabbitMQ credited from the work bullet', (_, quote) => {
    const cv = cvOf(wrapped);
    const { row, rabbit, kafka } = assess(cv, quote);
    expect(row).toMatchObject({ status: 'EVIDENCED', credit: 1 });
    expect(rabbit.status).toBe('EVIDENCED');
    expect(kafka.status).not.toBe('EVIDENCED');
    // Provenance: the exact original bullet text, never Skills or the stack.
    expect(rabbit.cvQuote).toBe(wrapped);
    expect(cv).toContain(rabbit.cvQuote);
  });

  test('reverse direction: broker named before the work verb', () => {
    const reverse =
      '- Order events flow through RabbitMQ queues, which I\nintegrated into the fulfilment services.';
    expect(assess(cvOf(reverse)).rabbit).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: reverse,
    });
  });

  test('Ollama path (no allowed set) recognizes the same unit', () => {
    expect(assess(cvOf(wrapped), wrapped, false).rabbit.status).toBe(
      'EVIDENCED',
    );
  });
});

describe('boundaries fail closed', () => {
  test.each([
    [
      'verb in a different bullet',
      '- Led the Example Orders platform redesign.\n- Asynchronous communication using RabbitMQ.',
    ],
    [
      'heading between',
      '- Led the Example Orders platform redesign into\nPROJECTS\nasynchronous communication using RabbitMQ.',
    ],
    [
      'blank line between',
      '- Led the Example Orders platform redesign into\n\nasynchronous communication using RabbitMQ.',
    ],
    [
      'skills line between',
      '- Led the Example Orders platform redesign into\nSkills: RabbitMQ',
    ],
    [
      'previous line ends a sentence',
      '- Led the Example Orders platform redesign.\nAsynchronous communication using RabbitMQ.',
    ],
  ])('%s', (_, work) => {
    expect(assess(cvOf(work)).rabbit.status).not.toBe('EVIDENCED');
  });

  test.each(['negated', 'uncertain'])(
    '%s anywhere in the joined bullet prevents credit',
    (kind) => {
      const work =
        kind === 'negated'
          ? '- Led the Example Orders platform redesign but never\nused RabbitMQ in production.'
          : '- Led an Example Orders platform plan that may\nuse RabbitMQ, maybe next year.';
      expect(assess(cvOf(work)).rabbit.status).not.toBe('EVIDENCED');
    },
  );

  test('Skills and project technology lists alone stay uncredited', () => {
    expect(
      assess(cvOf('- Led backend reviews for the Example team.')).row,
    ).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
    });
  });

  test('Kafka-only work evidence still satisfies the OR', () => {
    const { row, kafka } = assess(
      cvOf('- Built services consuming Kafka topics.'),
    );
    expect(row.status).toBe('EVIDENCED');
    expect(kafka.status).toBe('EVIDENCED');
  });
});
