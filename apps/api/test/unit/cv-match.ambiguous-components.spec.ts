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
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
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
    // PR88: the fragment occurs once, in the list under SKILLS, so it aligns to
    // that skills declaration (same rule as "Technical skills: …" lines).
    expect(verified.component(or, 'RabbitMQ')).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: skills,
    });

    const fragments = assess(jobOf(or), cvRepeated, {
      Kafka: 'Kafka',
      RabbitMQ: 'RabbitMQ',
    });
    // The repeated "Kafka" fragment is never evidence itself; credit comes only
    // from the uniquely aligned skills declaration that names both options.
    expect(fragments.component(or, 'RabbitMQ').cvQuote).toBe(skills);
    expect(fragments.component(or, 'Kafka').cvQuote).not.toBe('Kafka');
    expect(
      fragments.result.requirements
        .flatMap((r) => r.coverage.components)
        .map((c) => c.cvQuote)
        .filter(Boolean)
        .every((quote) => quote === skills),
    ).toBe(true);
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

  test('no score inflation: independent evidence decides both compound parents', () => {
    const job = jobOf(and, or, 'Java');
    const recovered = assess(job, cvRepeated, {
      Docker: 'Docker',
      Kubernetes: kube,
      Kafka: kafka,
      RabbitMQ: 'RabbitMQ',
    }).result;
    const verified = assess(job, cvRepeated, {
      Kubernetes: kube,
      Kafka: kafka,
    }).result;
    const appliedAndListed = 75 + 5;
    const expected = Math.round((appliedAndListed + appliedAndListed) / 3);
    expect(verified).toMatchObject({ score: expected, coverageHidden: null });
    expect(recovered).toMatchObject({ score: expected, coverageHidden: null });
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

  test('a fabricated component quote earns nothing and flags uncertainty', () => {
    const { result } = assess(jobOf(and), cvRepeated, {
      Docker: 'Ran Docker clusters at scale',
    });
    const row = result.requirements.find((r) => r.requirement === and)!;
    const docker = row.coverage.components.find((c) => c.label === 'Docker')!;
    expect(docker).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
    expect(row.status).not.toBe('EVIDENCED');
    expect(row.evidence.review).toBe(true);
    expect(result.evidenceUncertain).toBe(true);
  });
});

describe('Coverage verification of individual components', () => {
  test('a verified AND component cannot recover a different skill', () => {
    const cv = [docker, 'Skills: Java, Spring Boot'].join('\n');
    const { result, component } = assess(
      jobOf(and, 'Java', 'Spring Boot'),
      cv,
      {
        Docker: docker,
        Kubernetes: 'Invented Kubernetes evidence',
      },
    );
    expect(result).toMatchObject({
      score: null,
      coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
    });
    expect(component(and, 'Kubernetes')).toMatchObject({ cvQuote: '' });
    expect(component(and, 'Kubernetes')).not.toHaveProperty('strength');
  });

  test('an unresolved OR alternative can still change a submaximal score', () => {
    const cv = [kafka, 'Skills: Java, Spring Boot'].join('\n');
    const { result } = assess(jobOf(or, 'Java', 'Spring Boot'), cv, {
      Kafka: kafka,
      RabbitMQ: 'Invented RabbitMQ evidence',
    });
    expect(result).toMatchObject({
      score: null,
      coverageHidden: 'EVIDENCE_VERIFICATION_FAILED',
    });
  });

  test('an unresolved OR alternative cannot change a capped strength', () => {
    const cv = [
      'Project: Orders',
      'Delivered Kafka consumers for order events.',
      'Project: Billing',
      'Implemented a Kafka workflow for overdue invoices.',
      'Project: Reporting',
      'Built Kafka pipelines for shipment data.',
      'Skills: Kafka, Java, Spring Boot',
    ].join('\n');
    const { result, component } = assess(jobOf(or, 'Java', 'Spring Boot'), cv, {
      Kafka: 'Delivered Kafka consumers for order events.',
      RabbitMQ: 'Invented RabbitMQ evidence',
    });
    expect(result).toMatchObject({
      score: Math.round((100 + 40 + 40) / 3),
      coverageHidden: null,
    });
    expect(component(or, 'RabbitMQ')).toMatchObject({ cvQuote: '' });
    expect(component(or, 'RabbitMQ')).not.toHaveProperty('strength');
  });
});
