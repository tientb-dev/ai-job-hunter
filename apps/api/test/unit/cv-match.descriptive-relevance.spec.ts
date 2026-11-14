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

// Synthetic only; each case runs on the Gemini (allowed set) and Ollama paths.
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
const work = (...lines: string[]) =>
  ['EXPERIENCE', 'Backend Engineer, Example Co, 2019-2024', ...lines].join(
    '\n',
  );
const async = 'Experience with asynchronous processing systems';
const distributed = 'Experience with distributed systems';
const integration = 'Experience with backend integration services';

describe('negative: no unsupported credit', () => {
  test.each([
    [
      'RabbitMQ asynchronous communication alone',
      async,
      work(
        '- Led the redesign of the Example Orders platform into a',
        'microservices architecture with asynchronous communication using RabbitMQ.',
      ),
      'microservices architecture with asynchronous communication using RabbitMQ.',
    ],
    [
      'unrelated Kafka work',
      distributed,
      work('- Built services consuming Kafka topics.'),
      '- Built services consuming Kafka topics.',
    ],
    [
      'unrelated REST API work',
      integration,
      work('- Developed REST APIs for order services.'),
      '- Developed REST APIs for order services.',
    ],
    [
      'workshop about asynchronous processing',
      async,
      work('- Attended a workshop on asynchronous processing systems.'),
      '- Attended a workshop on asynchronous processing systems.',
    ],
    [
      'work verb and keywords in unrelated clauses',
      async,
      work(
        '- Built the billing service after studying asynchronous processing systems.',
      ),
      '- Built the billing service after studying asynchronous processing systems.',
    ],
    [
      'skills-only declaration',
      distributed,
      ['SKILLS', 'Architecture: distributed systems, microservices'].join('\n'),
      'Architecture: distributed systems, microservices',
    ],
    [
      'negated',
      distributed,
      work('Never built distributed systems in production.'),
      'Never built distributed systems in production.',
    ],
    [
      'uncertain',
      distributed,
      work('Maybe built distributed systems later.'),
      'Maybe built distributed systems later.',
    ],
    // "distributed systems" needs both words: one word is not the capability.
    [
      'partial keyword',
      distributed,
      work('- Built distributed tracing dashboards.'),
      '- Built distributed tracing dashboards.',
    ],
  ])('%s → Not Matched', (_, requirement, cv, quote) => {
    expect(status(requirement, cv, quote)).toBe('NOT_EVIDENCED/0');
  });
});

describe('positive: explicit professional work is Matched', () => {
  test.each([
    [
      async,
      work('- Implemented asynchronous processing pipelines for order events.'),
    ],
    [
      distributed,
      work('- Built distributed systems handling payment reconciliation.'),
    ],
    [
      integration,
      work('- Developed backend integration services for payment providers.'),
    ],
    [
      'Hands-on experience with distributed systems',
      work('- Designed and built distributed systems for logistics tracking.'),
    ],
  ])('%s', (requirement, cv) => {
    expect(status(requirement, cv, cv.split('\n').at(-1)!)).toBe('EVIDENCED/1');
  });

  test('project narrative without standard headings', () => {
    const line =
      'Example Payments Platform: Developed backend integration services for partner banks.';
    expect(status(integration, line, line)).toBe('EVIDENCED/1');
  });

  test('safely bounded wrapped work bullet', () => {
    const cv = work(
      '- Implemented asynchronous processing pipelines with',
      'retries for order events.',
    );
    expect(
      status(async, cv, '- Implemented asynchronous processing pipelines with'),
    ).toBe('EVIDENCED/1');
    const reverse = work(
      '- Order events now flow through asynchronous processing',
      'systems that I built for the fulfilment team.',
    );
    expect(
      status(async, reverse, 'systems that I built for the fulfilment team.'),
    ).toBe('EVIDENCED/1');
  });
});

describe('preserved behaviour', () => {
  test('soft-skill and legacy "<phrase> experience" rows keep their path', () => {
    const team = '- Led cross-team design reviews for the order platform.';
    expect(status('Strong communication skills', work(team), team)).toBe(
      'EVIDENCED/1',
    );
    const summary = 'Summary: 6+ years of professional software engineering.';
    expect(status('Software engineering experience', summary, summary)).toBe(
      'EVIDENCED/1',
    );
  });

  test('named technologies keep PR68 rules', () => {
    const line = '- Developed REST APIs for order services.';
    expect(status('Experience with REST APIs', work(line), line)).toBe(
      'EVIDENCED/1',
    );
  });
});
