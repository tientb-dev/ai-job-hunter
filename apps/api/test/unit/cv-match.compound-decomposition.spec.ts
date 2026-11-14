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

// Synthetic JD/CV only.
const exact =
  'Hands-on experience designing and developing RESTful APIs, backend integration services, and asynchronous processing systems';
const withoutHandsOn =
  'Experience designing and developing RESTful APIs, backend integration services, and asynchronous processing systems';
const components = [
  'RESTful APIs',
  'backend integration services',
  'asynchronous processing systems',
];

describe('decomposition', () => {
  test.each([exact, withoutHandsOn, `${exact}.`])(
    '%s → AND of three',
    (text) => {
      const group = requirementGroup(text, 'skill');
      expect(group.mode).toBe('AND');
      expect(group.context).toBe('design'); // shared "designing and developing"
      expect(group.components.map((c) => c.label)).toEqual(components);
    },
  );

  test.each([
    'Hands-on experience designing and developing RESTful APIs, including backend integration services',
    'Hands-on experience designing and developing RESTful APIs or backend integration services',
    'Hands-on experience designing and developing APIs for payments, backend integration services, and batch jobs',
    'Hands-on experience designing and developing RESTful APIs with Spring Boot, and integration services',
    'Hands-on experience designing and developing RESTful APIs',
    'Ability to design and develop RESTful APIs, backend integration services, and asynchronous processing systems',
  ])('ambiguous or unsupported structure stays UNKNOWN: %s', (text) => {
    expect(requirementGroup(text, 'skill').mode).toBe('UNKNOWN');
  });

  test('existing "Experience designing X" handling is unchanged', () => {
    expect(
      requirementGroup('Experience designing RESTful APIs', 'skill'),
    ).toMatchObject({
      mode: 'SINGLE',
      context: 'design',
    });
  });
});

describe('scoring the decomposed requirement (no new evidence acceptance)', () => {
  const job = {
    title: 'Backend Engineer',
    skills: `- ${exact}`,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: `Requirements\n- ${exact}.`,
    postText: '',
    jdText: '',
  } as unknown as Opportunity;
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  // Skills-only REST APIs plus RabbitMQ messaging work, like the beta CV shape.
  const cv = [
    'SKILLS',
    'Backend: Java, Spring Boot, REST APIs, RabbitMQ',
    'EXPERIENCE',
    'Backend Engineer, Example Co, 2020-2024',
    '- Led the redesign of the Example Orders platform into a',
    'microservices architecture with asynchronous communication using RabbitMQ.',
  ].join('\n');
  const lines = cv.split('\n');
  const linked: Record<string, string> = {
    'RESTful APIs': lines[1]!,
    'asynchronous processing systems': lines.slice(4, 6).join('\n'),
  };

  test.each([
    ['no model quotes', false],
    ['model links components to the Skills line and RabbitMQ bullet', true],
  ])('%s: uncredited on Gemini and Ollama paths', (_, link) => {
    const results = [new Set(matchQuoteChoices(cv, canonical)), undefined].map(
      (allowed) => {
        const proposals = canonical.map((row) => ({
          ...row,
          cvQuote: '',
          components: requirementGroup(
            row.requirement,
            row.category,
          ).components.map((c) => ({
            componentId: c.id,
            jdQuote: c.jdQuote,
            cvQuote: link ? (linked[c.label] ?? '') : '',
          })),
        }));
        const row = scoreCvMatch(
          validateMatchAssessment(proposals, cv, jd, canonical, allowed),
          cv,
          jd,
          canonical,
        ).requirements[0]!;
        return {
          mode: row.coverage.mode,
          status: row.status,
          credit: row.credit,
          components: row.coverage.components.map((c) => [c.label, c.status]),
        };
      },
    );
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual({
      mode: 'AND',
      status: 'NOT_EVIDENCED',
      credit: 0,
      components: components.map((label) => [label, 'NOT_EVIDENCED']),
    });
  });
});
