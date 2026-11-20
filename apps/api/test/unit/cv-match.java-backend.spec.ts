import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import {
  evaluateCoverage,
  requirementGroup,
  simpleEvidenceStatus,
} from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures only. Generic prefixes ("Familiarity with", "Proficient in")
// on compound requirements must not stay in the first component label.
const description = `Java Software Engineer - Data Management
Requirements:
- Familiarity with Kafka or other messaging systems
- Proficient in Java, Spring Boot and Hibernate
- Hands-on experience with SQL databases (PostgreSQL, MySQL)
- Solid understanding of data modeling and data management`;
const job = {
  title: 'Java Software Engineer',
  skills: '',
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description,
  postText: '',
  jdText: '',
} as unknown as Opportunity;
const kafka = '- Implemented event streaming with Apache Kafka.';
const java = '- Developed Java 17 services with Spring Boot and Hibernate.';
const sql = '- Designed PostgreSQL and MySQL schemas for reporting.';
const cv = `Backend Engineer, Example Corp (Jan 2019 - Present)
${java}
${kafka}
${sql}`;

describe('Java backend CV match (Gemini path)', () => {
  test('compound labels drop generic prefixes', () => {
    const labels = (text: string) =>
      requirementGroup(text, 'skill').components.map((c) => c.label);
    // An open "other …" alternative is not a required or matchable component.
    expect(labels('Familiarity with Kafka or other messaging systems')).toEqual(
      ['Kafka'],
    );
    expect(labels('Proficient in Java, Spring Boot and Hibernate')).toEqual([
      'Java',
      'Spring Boot',
      'Hibernate',
    ]);
    expect(
      requirementGroup(
        'Hands-on experience with SQL databases (PostgreSQL, MySQL)',
        'skill',
      ).mode,
    ).toBe('SINGLE');
  });

  test('accepted quotes earn credit instead of staying unknown', () => {
    const canonical = canonicalRequirements(job);
    const jd = matchJobText(job);
    const quoteFor: Record<string, string> = {
      'Familiarity with Kafka or other messaging systems': kafka,
      'Proficient in Java, Spring Boot and Hibernate': java,
      'Hands-on experience with SQL databases (PostgreSQL, MySQL)': sql,
    };
    const proposals: MatchRequirement[] = canonical.map((row) => {
      const group = requirementGroup(row.requirement, row.category);
      const cvQuote = quoteFor[row.requirement] ?? '';
      return {
        ...row,
        cvQuote,
        ...(group.mode !== 'SINGLE'
          ? {
              components: group.components.map((c) => ({
                componentId: c.id,
                jdQuote: c.jdQuote,
                cvQuote,
              })),
            }
          : {}),
      };
    });
    const allowed = new Set(matchQuoteChoices(cv, canonical));
    const result = scoreCvMatch(
      validateMatchAssessment(proposals, cv, jd, canonical, allowed),
      cv,
      jd,
      canonical,
    );
    const status = Object.fromEntries(
      result.requirements.map((r) => [r.requirement, r.status]),
    );
    expect(status).toEqual({
      'Familiarity with Kafka or other messaging systems': 'EVIDENCED',
      'Proficient in Java, Spring Boot and Hibernate': 'EVIDENCED',
      'Hands-on experience with SQL databases (PostgreSQL, MySQL)': 'EVIDENCED',
      // No quote and no CV mention: stays honestly unsupported.
      'Solid understanding of data modeling and data management':
        'NOT_EVIDENCED',
    });
  });

  const credit = (requirement: string, quote: string, source: string) => {
    const group = requirementGroup(requirement, 'skill');
    return group.mode === 'SINGLE'
      ? Number(
          simpleEvidenceStatus(requirement, quote, source, 'skill') ===
            'EVIDENCED',
        )
      : evaluateCoverage(group, [quote], source, true).credit;
  };
  const withKafka = `Backend Engineer\n${kafka}`;
  const noKafka = `Backend Engineer\n${java}`;
  test.each([
    'Kafka',
    'Familiarity with Kafka',
    'Kafka or other messaging systems',
    'Familiarity with Kafka or other messaging systems',
  ])('equivalent phrasing %s: credited only when the CV names Kafka', (req) => {
    expect(credit(req, kafka, withKafka)).toBe(1);
    expect(credit(req, java, noKafka)).toBe(0);
    expect(credit(req, '', noKafka)).toBe(0);
  });
  test.each([
    'Proficient in Java and Kafka',
    'Familiarity with Java and Kafka',
    'Strong knowledge of Java and Kafka',
  ])('AND stays AND after prefix removal: %s', (req) => {
    const group = requirementGroup(req, 'skill');
    expect(group.mode).toBe('AND');
    expect(group.components.map((c) => c.label)).toEqual(['Java', 'Kafka']);
    // Java alone is half of the requirement, never full credit.
    expect(credit(req, java, noKafka)).toBe(0.5);
    expect(evaluateCoverage(group, [java], noKafka, true).status).not.toBe(
      'EVIDENCED',
    );
  });
});
