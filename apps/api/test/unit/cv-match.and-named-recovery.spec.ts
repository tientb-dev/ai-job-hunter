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

// Synthetic only. Plain AND requirement in the experience context.
const devops =
  'Experience using Docker, CI/CD pipelines, logging, monitoring, and automated deployment practices';
const job = {
  title: 'Backend Engineer',
  skills: `- ${devops}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements\n- ${devops}.`,
  postText: '',
  jdText: '',
} as unknown as Opportunity;
const canonical = canonicalRequirements(job);
const jd = matchJobText(job);
const group = requirementGroup(
  canonical[0]!.requirement,
  canonical[0]!.category,
);
const work = (...lines: string[]) =>
  ['EXPERIENCE', 'Backend Engineer, Example Co, 2019-2024', ...lines].join(
    '\n',
  );

type Quotes = Record<string, string>;
function coverage(cv: string, quotes: Quotes = {}) {
  const results = [new Set(matchQuoteChoices(cv, canonical)), undefined].map(
    (allowed) => {
      const proposals = canonical.map((row) => ({
        ...row,
        cvQuote: '',
        components: group.components.map((c) => ({
          componentId: c.id,
          jdQuote: c.jdQuote,
          cvQuote: quotes[c.label] ?? '',
        })),
      }));
      const row = scoreCvMatch(
        validateMatchAssessment(proposals, cv, jd, canonical, allowed),
        cv,
        jd,
        canonical,
      ).requirements[0]!;
      return {
        status: row.status,
        credit: row.credit,
        components: Object.fromEntries(
          row.coverage.components.map((c) => [c.label, c.status]),
        ),
        quotes: row.coverage.components.map((c) => c.cvQuote ?? ''),
      };
    },
  );
  expect(results[0]).toEqual(results[1]); // Gemini and Ollama paths agree
  for (const quote of results[0]!.quotes.filter(Boolean))
    expect(cv).toContain(quote); // provenance
  return results[0]!;
}
const NOT = 'NOT_EVIDENCED';
const dockerLine = '- Containerized Java services with Docker.';
const cicdLine =
  '- Built CI/CD pipelines with GitHub Actions for order services.';
const genuine = work(
  dockerLine,
  cicdLine,
  'SKILLS',
  'DevOps: Docker, CI/CD, Prometheus',
);

describe('named-technology AND components recover from genuine work evidence', () => {
  test('empty model quotes → PARTIAL 0.4 (Docker and CI/CD only)', () => {
    expect(coverage(genuine)).toMatchObject({
      status: 'PARTIAL',
      credit: 0.4,
      components: {
        Docker: 'EVIDENCED',
        'CI/CD pipelines': 'EVIDENCED',
        logging: NOT,
        monitoring: NOT,
        'automated deployment practices': NOT,
      },
    });
  });

  test('31-like and 34-like quote selections give the same coverage', () => {
    const cv = work(
      dockerLine,
      cicdLine,
      '- Deployed releases with Docker through CI/CD pipelines.',
      'SKILLS',
      'DevOps: Docker, CI/CD, Prometheus',
    );
    const like31 = coverage(cv, {
      Docker: dockerLine,
      'CI/CD pipelines': cicdLine,
    });
    const like34 = coverage(cv, {
      Docker: dockerLine,
      'CI/CD pipelines': cicdLine,
      'automated deployment practices':
        '- Deployed releases with Docker through CI/CD pipelines.',
    });
    expect(like31.credit).toBe(0.4);
    expect(like31.components).toEqual(like34.components);
    expect(like31.credit).toBe(like34.credit);
  });

  test('non-qualifying model quotes do not hide genuine evidence elsewhere', () => {
    expect(
      coverage(genuine, {
        Docker: 'DevOps: Docker, CI/CD, Prometheus',
        'CI/CD pipelines': 'DevOps: Docker, CI/CD, Prometheus',
      }).credit,
    ).toBe(0.4);
  });

  test('wrapped work bullet (PR67 unit) is recovered', () => {
    const cv = work(
      '- Containerized the order platform services with',
      'Docker for staging and production releases.',
    );
    expect(coverage(cv).components.Docker).toBe('EVIDENCED');
  });
});

describe('no recovery from weak or unrelated evidence', () => {
  test.each([
    [
      'skills-only list',
      ['SKILLS', 'DevOps: Docker, CI/CD pipelines, Prometheus'].join('\n'),
    ],
    [
      'technology stack line',
      work('- Tech stack: Java, Docker, CI/CD pipelines'),
    ],
    ['meetup', work('- Attended a Docker community meetup.')],
    ['third-party use', work('- Supported teams that used Docker.')],
    [
      'third-party use after an own verb',
      work('- Built tooling for teams that used Docker.'),
    ],
    [
      'third-party relative clause',
      work('- Mentored engineers who deployed Docker workloads.'),
    ],
    ['third-party enablement', work('- Ran onboarding for Docker users.')],
    ['training others', work('- Led Docker training for new engineers.')],
    [
      'mentoring others',
      work('- Mentored engineers on Docker best practices.'),
    ],
    ['negated', work('Never used Docker in production.')],
    ['uncertain', work('Maybe containerized services with Docker.')],
    [
      'verb in an unrelated bullet',
      work('- Built the billing service.', '- Docker images for staging.'),
    ],
    [
      'unjoinable wrap (previous line ends a sentence)',
      work('- Built the billing service.', 'Docker images for staging.'),
    ],
  ])('%s → Docker not recovered', (_, cv) => {
    expect(coverage(cv).components.Docker).toBe(NOT);
  });

  test('descriptive components are never recovered', () => {
    const cv = work(
      '- Built logging and monitoring dashboards for order services.',
      '- Implemented automated deployment practices for releases.',
    );
    expect(coverage(cv).components).toMatchObject({
      logging: NOT,
      monitoring: NOT,
      'automated deployment practices': NOT,
    });
  });
});

describe('eligibility is limited to Docker and CI/CD pipelines', () => {
  test('uppercase generic labels such as APIs are not eligible', () => {
    const apis = 'Experience with APIs and integrations';
    const apiJob = {
      ...job,
      skills: `- ${apis}`,
      description: `Requirements\n- ${apis}.`,
    } as Opportunity;
    const apiCanonical = canonicalRequirements(apiJob);
    const apiJd = matchJobText(apiJob);
    const cv = work(
      '- Designed temporal routing, flux circuits, APIs, integrations and data flows.',
    );
    for (const allowed of [
      new Set(matchQuoteChoices(cv, apiCanonical)),
      undefined,
    ]) {
      const row = scoreCvMatch(
        validateMatchAssessment(
          apiCanonical.map((r) => ({ ...r, cvQuote: '', components: [] })),
          cv,
          apiJd,
          apiCanonical,
          allowed,
        ),
        cv,
        apiJd,
        apiCanonical,
      ).requirements[0]!;
      expect(row).toMatchObject({ status: 'NOT_EVIDENCED', credit: 0 });
    }
  });

  test('other technologies (Kubernetes) are not recovered by this rule', () => {
    const pair = 'Experience with Docker and Kubernetes';
    const pairJob = {
      ...job,
      skills: `- ${pair}`,
      description: `Requirements\n- ${pair}.`,
    } as Opportunity;
    const pairCanonical = canonicalRequirements(pairJob);
    const pairJd = matchJobText(pairJob);
    const cv = work(
      '- Deployed services with Docker.',
      '- Deployed workloads to a Kubernetes cluster.',
    );
    const row = scoreCvMatch(
      validateMatchAssessment(
        pairCanonical.map((r) => ({ ...r, cvQuote: '', components: [] })),
        cv,
        pairJd,
        pairCanonical,
      ),
      cv,
      pairJd,
      pairCanonical,
    ).requirements[0]!;
    expect(row.coverage.components.map((c) => [c.label, c.status])).toEqual([
      ['Docker', 'EVIDENCED'],
      ['Kubernetes', 'NOT_EVIDENCED'],
    ]);
  });
});

/**
 * Known residual risk (not a blacklist): enablement wording that starts with an
 * accepted work verb and names Docker is still recovered. Pinned so any change
 * is deliberate; preventing it needs a reviewed lexicon or classifier.
 */
test('KNOWN RISK: "Led Docker onboarding sessions for new engineers." is recovered', () => {
  expect(
    coverage(work('- Led Docker onboarding sessions for new engineers.'))
      .components.Docker,
  ).toBe('EVIDENCED');
});

describe('existing safeguards', () => {
  test('a fabricated component quote still rejects the assessment', () => {
    expect(() =>
      coverage(genuine, { Docker: 'Ran Docker clusters at planetary scale' }),
    ).toThrow(
      expect.objectContaining({ errorCode: 'CV_MATCH_EVIDENCE_REJECTED' }),
    );
  });

  test('an ambiguous fragment still blocks recovery for the requirement (PR65)', () => {
    // On the Gemini path the repeated fragment is dropped and recovery blocked;
    // on the Ollama path the exact fragment resolves but is not work evidence.
    const gemini = scoreCvMatch(
      validateMatchAssessment(
        canonical.map((row) => ({
          ...row,
          cvQuote: '',
          components: group.components.map((c) => ({
            componentId: c.id,
            jdQuote: c.jdQuote,
            cvQuote: c.label === 'Docker' ? 'Docker' : '',
          })),
        })),
        genuine,
        jd,
        canonical,
        new Set(matchQuoteChoices(genuine, canonical)),
      ),
      genuine,
      jd,
      canonical,
    ).requirements[0]!;
    expect(gemini.credit).toBe(0);
  });
});
