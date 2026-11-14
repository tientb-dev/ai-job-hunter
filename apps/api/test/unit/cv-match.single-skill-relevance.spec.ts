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

// Synthetic fixtures only. Each case runs on the Gemini path (allowed-passage
// set) and the Ollama path (no set); both must agree.
const jobOf = (...requirements: string[]) =>
  ({
    title: 'Backend Engineer',
    skills: requirements.map((r) => `- ${r}`).join('\n'),
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: `Requirements\n${requirements.map((r) => `- ${r}.`).join('\n')}`,
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;

function status(requirement: string, cv: string, quote: string) {
  const job = jobOf(requirement);
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
  expect(results[0]).toBe(results[1]); // Gemini and Ollama paths agree
  return results[0];
}
const cvOf = (...lines: string[]) =>
  ['EXPERIENCE', 'Backend Engineer, Example Co, 2019-2024', ...lines].join(
    '\n',
  );

describe('positive: related professional use is Matched', () => {
  test.each([
    ['Experience with REST APIs', '- Developed REST APIs for order services.'],
    ['Experience with REST APIs', '- Developed a REST API for order services.'],
    ['REST APIs', '- Developed REST APIs for order services.'],
    [
      'Experience with Spring Boot',
      '- Implemented services using Spring Boot.',
    ],
    ['Experience with Kubernetes', '- Deployed Kubernetes workloads.'],
    [
      'Hands-on experience with Docker',
      '- Containerized services with Docker.',
    ],
    ['Kubernetes experience', '- Deployed Kubernetes workloads.'],
  ])('%s ← %s', (requirement, line) => {
    expect(status(requirement, cvOf(line), line)).toBe('EVIDENCED/1');
  });

  test('wrapped bullet: action and technology on different physical lines', () => {
    const bullet =
      '- Developed the order platform as microservices with\nREST APIs for partner integrations.';
    expect(
      status('Experience with REST APIs', cvOf(bullet), bullet.split('\n')[1]!),
    ).toBe('EVIDENCED/1');
  });
});

describe('negative: unrelated or weak evidence is not Matched', () => {
  const kafkaDocker =
    '- Built services consuming Kafka topics.\n- Containerized services with Docker.';
  test.each([
    ['Experience with REST APIs', cvOf(kafkaDocker), kafkaDocker],
    ['REST APIs', cvOf(kafkaDocker), kafkaDocker],
    [
      'Experience with REST APIs',
      cvOf('- Developed Docker tooling after attending a REST APIs workshop.'),
      '- Developed Docker tooling after attending a REST APIs workshop.',
    ],
    [
      'Experience with Kubernetes',
      cvOf('- Attended a Kubernetes meetup.'),
      '- Attended a Kubernetes meetup.',
    ],
    [
      'Kubernetes',
      cvOf('- Attended a Kubernetes meetup.'),
      '- Attended a Kubernetes meetup.',
    ],
    [
      'Experience with Kubernetes',
      cvOf('Interested in Kubernetes.'),
      'Interested in Kubernetes.',
    ],
    [
      'Experience with Terraform',
      cvOf('SKILLS', 'Tools: Git, Docker, Terraform'),
      'Tools: Git, Docker, Terraform',
    ],
    [
      'Experience with Kubernetes',
      cvOf(
        '- Deployed the billing service.',
        '- Kubernetes certification in progress.',
      ),
      '- Deployed the billing service.\n- Kubernetes certification in progress.',
    ],
    [
      'Experience with Kubernetes',
      cvOf('Never used Kubernetes in production.'),
      'Never used Kubernetes in production.',
    ],
    [
      'Experience with Kubernetes',
      cvOf('Maybe deployed Kubernetes workloads.'),
      'Maybe deployed Kubernetes workloads.',
    ],
  ])('%s ← %j', (requirement, cv, quote) => {
    expect(status(requirement, cv, quote)).not.toBe('EVIDENCED/1');
    expect(status(requirement, cv, quote)).toMatch(/\/0$/u);
  });
});

test('an unreliably bounded wrap fails closed (PR67 boundaries)', () => {
  const bullet =
    '- Developed the order platform as microservices, exposing\nREST APIs for partner integrations.';
  expect(
    status('Experience with REST APIs', cvOf(bullet), bullet.split('\n')[1]!),
  ).toBe('NOT_EVIDENCED/0');
});

describe('policy preservation', () => {
  test('skills declarations support familiarity and bare rows (PR57)', () => {
    const cv = cvOf('SKILLS', 'Tools: Git, Docker, Terraform');
    expect(
      status('Familiarity with Terraform', cv, 'Tools: Git, Docker, Terraform'),
    ).toBe('EVIDENCED/1');
    expect(status('Terraform', cv, 'Tools: Git, Docker, Terraform')).toBe(
      'EVIDENCED/1',
    );
  });

  test('descriptive soft-skill labels keep the existing path', () => {
    const team = '- Led cross-team design reviews for the order platform.';
    expect(status('Strong communication skills', cvOf(team), team)).toBe(
      'EVIDENCED/1',
    );
  });

  test('Java strong proficiency stays PARTIAL from professional use', () => {
    const line = '- Developed Java Spring Boot services for order processing.';
    expect(
      status(
        'Strong proficiency in at least one programming language such as Java, Python, or equivalent',
        cvOf(line),
        '',
      ),
    ).toBe('PARTIAL/0.5');
  });

  test('wrapped RabbitMQ bullet keeps the broker OR Matched', () => {
    const bullet =
      '- Led the redesign of the Example Orders platform into a\nmicroservices architecture using RabbitMQ.';
    expect(
      status(
        'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies',
        cvOf(bullet),
        '',
      ),
    ).toBe('EVIDENCED/1');
  });
});

describe('CI/CD pipelines is a named capability (PR68)', () => {
  test.each([
    [
      'Experience with CI/CD pipelines',
      '- Built CI/CD pipelines with GitHub Actions for order services.',
    ],
    [
      'Experience with CI/CD pipelines',
      '- Implemented CI/CD for the billing service.',
    ],
    [
      'CI/CD pipelines',
      '- Automated build and test pipelines with GitHub Actions for CI/CD.',
    ],
    ['CI/CD pipeline', '- Built a CI/CD pipeline for the billing service.'],
  ])('related CI/CD work: %s ← %s', (requirement, line) => {
    expect(status(requirement, cvOf(line), line)).toBe('EVIDENCED/1');
  });

  const kafkaDocker =
    '- Built services consuming Kafka topics.\n- Containerized services with Docker.';
  test.each([
    ['unrelated Kafka/Docker work', kafkaDocker],
    [
      'other DevOps work without CI/CD',
      '- Deployed Kubernetes workloads and monitored them with Prometheus.',
    ],
    ['passing mention', '- Attended a CI/CD workshop.'],
    ['negated', 'Never built CI/CD pipelines.'],
  ])('%s → Not Matched', (_, quote) => {
    expect(
      status(
        'Experience with CI/CD pipelines',
        cvOf(...quote.split('\n')),
        quote,
      ),
    ).toBe('NOT_EVIDENCED/0');
  });

  const skills = 'Tools: Docker, CI/CD, Terraform';
  test('skills-only CI/CD is not experience', () => {
    expect(
      status('Experience with CI/CD pipelines', cvOf('SKILLS', skills), skills),
    ).toBe('NOT_EVIDENCED/0');
  });

  test.each(['CI/CD pipelines', 'Familiarity with CI/CD pipelines'])(
    'a skills declaration still supports %s (PR57)',
    (requirement) => {
      expect(status(requirement, cvOf('SKILLS', skills), skills)).toBe(
        'EVIDENCED/1',
      );
    },
  );
});
