import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic only. Gemini path: allowed passages are enforced server-side, and a
// component fragment found in several CV places is dropped (fail closed).
const and = 'Experience with Docker and Kubernetes';
const or = 'Experience with Kafka or RabbitMQ';
const broker =
  'Experience with message brokers such as Kafka, RabbitMQ or equivalent';
const docker = '- Deployed services with Docker.';
const kube = '- Deployed workloads to a Kubernetes cluster.';
const kafka = '- Built event consumers for Kafka topics.';
const skills = 'Docker, Kubernetes, Kafka, RabbitMQ';
const cvRepeated = ['EXPERIENCE', docker, kube, kafka, 'SKILLS', skills].join(
  '\n',
);

const jobOf = (...requirements: string[]) =>
  ({
    title: 'Backend Engineer',
    skills: requirements.join('\n'),
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: `Requirements: ${requirements.join('. ')}.`,
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;

function assess(
  job: Opportunity,
  cv: string,
  quotes: Record<string, string>,
  topLevel: Record<string, string> = {},
) {
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const proposals: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: topLevel[row.requirement] ?? '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quotes[c.label] ?? '',
      }),
    ),
  }));
  const result = scoreCvMatch(
    validateMatchAssessment(
      proposals,
      cv,
      jd,
      canonical,
      new Set(matchQuoteChoices(cv, canonical)),
    ),
    cv,
    jd,
    canonical,
  );
  // Invariant 8: every canonical requirement stays in the assessment.
  expect(result.requirements.map((r) => r.requirement)).toEqual(
    canonical.map((r) => r.requirement),
  );
  const row = (requirement: string) =>
    result.requirements.find((r) => r.requirement === requirement)!;
  const component = (requirement: string, label: string) =>
    row(requirement).coverage.components.find((c) => c.label === label)!;
  return { result, row, component };
}

describe('ambiguous component quotes fail closed without failing the analysis', () => {
  test('skill repeated in a skills list and a work line: no credit from the fragment', () => {
    const { component, result } = assess(jobOf(and), cvRepeated, {
      Docker: 'Docker',
      Kubernetes: 'Kubernetes',
    });
    expect(component(and, 'Docker').status).not.toBe('EVIDENCED');
    expect(component(and, 'Kubernetes').status).not.toBe('EVIDENCED');
    expect(result.score).toBe(0);
  });

  test('repeated positive and negated mentions: neither occurrence is chosen', () => {
    const cv = [
      'EXPERIENCE',
      '- Used RabbitMQ for task queues.',
      'Never used RabbitMQ in production.',
    ].join('\n');
    const { component, row } = assess(jobOf(or), cv, { RabbitMQ: 'RabbitMQ' });
    // The existing contradiction scan may surface both lines for review; no credit.
    expect(component(or, 'RabbitMQ').status).not.toBe('EVIDENCED');
    expect(row(or).credit).toBe(0);
  });

  test('AND: an ambiguous mandatory component keeps the requirement from Matched', () => {
    const { row, component } = assess(jobOf(and), cvRepeated, {
      Docker: 'Docker',
      Kubernetes: kube,
    });
    expect(component(and, 'Kubernetes').status).toBe('EVIDENCED');
    expect(component(and, 'Docker').status).not.toBe('EVIDENCED');
    expect(row(and).status).not.toBe('EVIDENCED');
    expect(row(and).credit).toBeLessThan(1);
  });

  test('OR: only an independently verified alternative contributes', () => {
    const verified = assess(jobOf(or), cvRepeated, {
      Kafka: kafka,
      RabbitMQ: 'RabbitMQ',
    });
    expect(verified.row(or)).toMatchObject({ status: 'EVIDENCED', credit: 1 });
    expect(verified.component(or, 'Kafka').cvQuote).toBe(kafka);
    expect(verified.component(or, 'RabbitMQ').status).not.toBe('EVIDENCED');

    const neither = assess(jobOf(or), cvRepeated, {
      Kafka: 'Kafka',
      RabbitMQ: 'RabbitMQ',
    });
    expect(neither.row(or).credit).toBe(0);
  });

  test('rejected ambiguous evidence is not restored by recovery', () => {
    const cv = [
      'EXPERIENCE',
      '- Built services consuming Kafka topics.',
      'SKILLS',
      'Kafka, RabbitMQ',
    ].join('\n');
    // Without a quote, deterministic recovery finds the work line...
    expect(assess(jobOf(broker), cv, {}).row(broker).status).toBe('EVIDENCED');
    // ...but after an ambiguous Kafka fragment it must not.
    const { row } = assess(jobOf(broker), cv, { Kafka: 'Kafka' });
    expect(row(broker).status).not.toBe('EVIDENCED');
    expect(row(broker).credit).toBe(0);
  });

  test('no score inflation: the score equals the verified-evidence-only score', () => {
    const job = jobOf(and, or);
    const withAmbiguous = assess(job, cvRepeated, {
      Docker: 'Docker',
      Kubernetes: kube,
      Kafka: kafka,
      RabbitMQ: 'RabbitMQ',
    }).result.score;
    const verifiedOnly = assess(job, cvRepeated, {
      Kubernetes: kube,
      Kafka: kafka,
    }).result.score;
    expect(withAmbiguous).toBeLessThanOrEqual(verifiedOnly!);
  });
});

describe('other component evidence is unchanged', () => {
  test('a unique fragment still aligns to its full allowed line', () => {
    const { component } = assess(jobOf(or), cvRepeated, {
      Kafka: 'event consumers for Kafka',
    });
    expect(component(or, 'Kafka')).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: kafka,
    });
  });

  test('a fabricated component quote still rejects the assessment', () => {
    expect(() =>
      assess(jobOf(and), cvRepeated, {
        Docker: 'Ran Docker clusters at scale',
      }),
    ).toThrow(
      expect.objectContaining({ reasonCode: 'COMPONENT_CV_QUOTE_NOT_IN_CV' }),
    );
  });
});
