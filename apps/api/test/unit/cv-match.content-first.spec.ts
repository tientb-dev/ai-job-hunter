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

// Synthetic only. Every case runs on the Gemini (allowed set) and Ollama paths.
function status(requirement: string, cv: string, quote: string) {
  const job = {
    title: 'Backend Engineer',
    skills: `- ${requirement}`,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: `Requirements\n- ${requirement}.`,
    postText: '',
    jdText: '',
  } as unknown as Opportunity;
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const results = [new Set(matchQuoteChoices(cv, canonical)), undefined].map(
    (allowed) => {
      const proposals = canonical.map((row) => ({
        ...row,
        cvQuote: quote,
        components: requirementGroup(
          row.requirement,
          row.category,
        ).components.map((c) => ({
          componentId: c.id,
          jdQuote: c.jdQuote,
          cvQuote: '',
        })),
      }));
      const row = scoreCvMatch(
        validateMatchAssessment(proposals, cv, jd, canonical, allowed),
        cv,
        jd,
        canonical,
      ).requirements[0]!;
      return `${row.status}/${row.credit}`;
    },
  );
  expect(results[0]).toBe(results[1]);
  return results[0];
}
const single = (requirement: string, line: string) =>
  status(requirement, ['PROJECTS', line].join('\n'), line);
const broker =
  'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies';

describe('"Title: work sentence" is professional project evidence', () => {
  test.each([
    [
      'Experience with REST APIs',
      'Example Orders Platform: Developed REST APIs for order processing.',
    ],
    [
      'Experience with Kafka',
      'Example Orders Platform: Built services consuming Kafka topics.',
    ],
    [
      'Experience with Spring Boot',
      'Responsibilities: I implemented services using Spring Boot.',
    ],
  ])('%s ← %s', (requirement, line) => {
    expect(single(requirement, line)).toBe('EVIDENCED/1');
  });

  test('a narrative paragraph without headings stays eligible', () => {
    const line =
      'At Example Co (2019-2024) I developed REST APIs for order services.';
    expect(status('Experience with REST APIs', line, line)).toBe('EVIDENCED/1');
  });
});

describe('declarations stay declarations', () => {
  test.each([
    ['Experience with REST APIs', 'Backend: Java, REST APIs'],
    ['Experience with Git', 'Tools used: Git'],
    // A project title alone is not experience.
    ['Experience with Kafka', 'Project: Kafka Streaming Platform'],
  ])('experience row: %s ← %s → Not Matched', (requirement, line) => {
    expect(single(requirement, line)).toBe('NOT_EVIDENCED/0');
  });

  test('"Technologies: Java, RabbitMQ" never proves broker use', () => {
    const line = 'Technologies: Java, RabbitMQ';
    expect(status(broker, ['PROJECTS', line].join('\n'), '')).toBe(
      'NOT_EVIDENCED/0',
    );
  });

  test.each([
    ['REST APIs', 'Backend: Java, REST APIs'],
    ['Familiarity with Git', 'Tools used: Git'],
  ])('declaration still supports %s (PR57)', (requirement, line) => {
    expect(single(requirement, line)).toBe('EVIDENCED/1');
  });
});

describe('ambiguous, negated and uncertain fail closed', () => {
  test.each([
    ['list before the verb', 'Summary: Java, developed REST APIs'],
    ['too short to be a sentence', 'Role: Developed REST APIs'],
    ['negated', 'Example Platform: Never developed REST APIs in production.'],
    ['uncertain', 'Example Platform: Maybe developed REST APIs later.'],
  ])('%s', (_, line) => {
    expect(single('Experience with REST APIs', line)).toBe('NOT_EVIDENCED/0');
  });
});
