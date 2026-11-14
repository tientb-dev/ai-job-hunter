/**
 * CV Matching Golden Dataset (S01–S30) — deterministic beta regression suite.
 *
 * Source: the final beta audit on main 33a5a10, re-run after PR #71. The
 * fixtures below are the exact synthetic CV lines, JD requirements and model
 * quotes used in that audit; nothing is reconstructed. See
 * docs/cv-match-golden-dataset.md.
 *
 * Offline: no Gemini/Ollama calls and no keys. "Model output" is a controlled
 * proposal per scenario, validated on both deterministic paths:
 * - GEMINI: quotes restricted server-side to the allowed CV passages (#63–#65);
 * - OLLAMA: no allowed-passage set (the schema enum constrains quotes).
 *
 * PROPOSED scenarios assert today's accepted conservative behaviour, not the
 * desired future behaviour; they document limitations, not failures.
 */
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

const BROKER =
  'Experience working with message brokers or streaming platforms such as Kafka, RabbitMQ, or equivalent technologies';
const LANG =
  'Strong proficiency in at least one programming language such as Java, Python, or equivalent';
const COMPOUND =
  'Hands-on experience designing and developing RESTful APIs, backend integration services, and asynchronous processing systems';
const work = (...lines: string[]) => [
  'EXPERIENCE',
  'Backend Engineer, Example Co, 2019-2024',
  ...lines,
];

type Status = 'EVIDENCED' | 'PARTIAL' | 'NOT_EVIDENCED';
interface Scenario {
  id: string;
  description: string;
  requirement: string;
  cv: string[];
  // Controlled model quote: one string, or one quote per component label.
  quote: string | Record<string, string>;
  status: Status;
  credit: number;
  policy: 'CURRENT' | 'PROPOSED';
  rationale: string;
}

const golden: Scenario[] = [
  {
    id: 'S01',
    description: 'skills-only REST APIs for an experience row',
    requirement: 'Experience with REST APIs',
    cv: ['SKILLS', 'Backend: Java, REST APIs'],
    quote: 'Backend: Java, REST APIs',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'A skills declaration is not professional experience (PR #68).',
  },
  {
    id: 'S02',
    description: 'skills-only Terraform for a familiarity row',
    requirement: 'Familiarity with Terraform',
    cv: ['SKILLS', 'Tools: Git, Terraform'],
    quote: 'Tools: Git, Terraform',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'A selected skills declaration supports familiarity (PR57).',
  },
  {
    id: 'S03',
    description: 'work bullet with REST APIs',
    requirement: 'Experience with REST APIs',
    cv: work('- Developed REST APIs for order services.'),
    quote: '- Developed REST APIs for order services.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Work verb and technology in one clause.',
  },
  {
    id: 'S04',
    description: 'project narrative "Title: work sentence"',
    requirement: 'Experience with REST APIs',
    cv: [
      'PROJECTS',
      'Example Orders Platform: Developed REST APIs for order processing.',
    ],
    quote: 'Example Orders Platform: Developed REST APIs for order processing.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Classified by content, not the colon (PR #70).',
  },
  {
    id: 'S05',
    description: 'timeline without Skills section or headings',
    requirement: 'Experience with REST APIs',
    cv: [
      '2019-2024 Example Co, Backend Engineer',
      'Developed REST APIs for order services.',
    ],
    quote: 'Developed REST APIs for order services.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Headings and a Skills section are not required.',
  },
  {
    id: 'S06',
    description: 'narrative paragraph',
    requirement: 'Experience with REST APIs',
    cv: [
      'At Example Co (2019-2024) I developed REST APIs for order services and mentored two engineers.',
    ],
    quote:
      'At Example Co (2019-2024) I developed REST APIs for order services and mentored two engineers.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Bullet markers are not required.',
  },
  {
    id: 'S07',
    description: 'wrapped bullet joined by a connector',
    requirement: 'Experience with REST APIs',
    cv: work(
      '- Developed the order platform as microservices with',
      'REST APIs for partner integrations.',
    ),
    quote: 'REST APIs for partner integrations.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'A safely bounded wrapped bullet is one unit (PR #67).',
  },
  {
    id: 'S08',
    description: 'RESTful APIs in the CV, REST APIs in the JD',
    requirement: 'Experience with REST APIs',
    cv: work('- Developed RESTful APIs for order services.'),
    quote: '- Developed RESTful APIs for order services.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'PROPOSED',
    rationale:
      'Accepted limitation: only REST API/REST APIs are equivalent; no RESTful alias.',
  },
  {
    id: 'S09',
    description: 'REST API (singular)',
    requirement: 'Experience with REST APIs',
    cv: work('- Developed a REST API for order services.'),
    quote: '- Developed a REST API for order services.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Approved singular/plural form (PR #68).',
  },
  {
    id: 'S10',
    description: 'wrapped RabbitMQ bullet for the broker OR',
    requirement: BROKER,
    cv: work(
      '- Led the redesign of the Example Orders platform into a',
      'microservices architecture using RabbitMQ.',
    ),
    quote: '',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'One demonstrated alternative satisfies the OR (PR #67).',
  },
  {
    id: 'S11',
    description: 'RabbitMQ messaging for asynchronous processing systems',
    requirement: 'Experience with asynchronous processing systems',
    cv: work(
      '- Led the redesign of the Example Orders platform into a',
      'microservices architecture with asynchronous communication using RabbitMQ.',
    ),
    quote:
      'microservices architecture with asynchronous communication using RabbitMQ.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Messaging is not asynchronous processing (PR #71 blocker).',
  },
  {
    id: 'S12',
    description: 'Docker work',
    requirement: 'Hands-on experience with Docker',
    cv: work('- Containerized services with Docker.'),
    quote: '- Containerized services with Docker.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Demonstrated professional use.',
  },
  {
    id: 'S13',
    description: 'CI/CD automation work',
    requirement: 'Experience with CI/CD pipelines',
    cv: work(
      '- Automated build and test pipelines with GitHub Actions for CI/CD.',
    ),
    quote:
      '- Automated build and test pipelines with GitHub Actions for CI/CD.',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'CI/CD pipelines is a named capability (PR #68).',
  },
  {
    id: 'S14',
    description: 'Java work for strong language proficiency',
    requirement: LANG,
    cv: work('- Developed Java Spring Boot services for order processing.'),
    quote: '',
    status: 'PARTIAL',
    credit: 0.5,
    policy: 'CURRENT',
    rationale: 'Professional use; the stated level stays unverified (F3).',
  },
  {
    id: 'S15',
    description: 'declared proficiency',
    requirement: LANG,
    cv: ['SUMMARY', 'Proficient in Java with 6 years of backend development.'],
    quote: '',
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'An explicit proficiency declaration is full credit (F3).',
  },
  {
    id: 'S16',
    description: 'Kubernetes meetup',
    requirement: 'Experience with Kubernetes',
    cv: work('- Attended a Kubernetes community meetup.'),
    quote: '- Attended a Kubernetes community meetup.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'A passing mention is not experience (PR #68).',
  },
  {
    id: 'S17',
    description: 'interest only',
    requirement: 'Kubernetes',
    cv: ['Interested in Kubernetes and service meshes.'],
    quote: 'Interested in Kubernetes and service meshes.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Aspiration is not evidence.',
  },
  {
    id: 'S18',
    description: 'negated',
    requirement: 'Experience with Kubernetes',
    cv: work('Never used Kubernetes in production.'),
    quote: 'Never used Kubernetes in production.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Negation blocks credit.',
  },
  {
    id: 'S19',
    description: 'uncertain',
    requirement: 'Experience with Kubernetes',
    cv: work('Maybe deployed Kubernetes workloads.'),
    quote: 'Maybe deployed Kubernetes workloads.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Uncertainty blocks credit.',
  },
  {
    id: 'S20',
    description: 'irrelevant Kafka/Docker passage for REST APIs',
    requirement: 'Experience with REST APIs',
    cv: work(
      '- Built services consuming Kafka topics.',
      '- Containerized services with Docker.',
    ),
    quote:
      '- Built services consuming Kafka topics.\n- Containerized services with Docker.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'The technology must be named (PR #68).',
  },
  {
    id: 'S21',
    description: 'compound AND: skills-only REST plus RabbitMQ messaging',
    requirement: COMPOUND,
    cv: [
      'SKILLS',
      'Backend: Java, REST APIs',
      ...work(
        '- Led the redesign of the Example Orders platform into a',
        'microservices architecture with asynchronous communication using RabbitMQ.',
      ),
    ],
    quote: '',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Decomposed AND (PR #69) without new evidence acceptance.',
  },
  {
    id: 'S22',
    description: 'AND fully evidenced, one quote per component',
    requirement: 'Experience with Docker and Kubernetes',
    cv: work(
      '- Deployed services with Docker.',
      '- Deployed workloads to a Kubernetes cluster.',
    ),
    quote: {
      Docker: '- Deployed services with Docker.',
      Kubernetes: '- Deployed workloads to a Kubernetes cluster.',
    },
    status: 'EVIDENCED',
    credit: 1,
    policy: 'CURRENT',
    rationale: 'Every AND component has its own work evidence.',
  },
  {
    id: 'S23',
    description: 'AND half evidenced',
    requirement: 'Experience with Docker and Kubernetes',
    cv: work('- Deployed services with Docker.'),
    quote: { Docker: '- Deployed services with Docker.' },
    status: 'PARTIAL',
    credit: 0.5,
    policy: 'CURRENT',
    rationale: 'AND credit is the share of evidenced components.',
  },
  {
    id: 'S24',
    description: 'Python-only work for strong language proficiency',
    requirement: LANG,
    cv: work('- Built Python data pipelines for reporting services.'),
    quote: '',
    status: 'PARTIAL',
    credit: 0.5,
    policy: 'CURRENT',
    rationale: 'Any one listed language satisfies the OR (F3).',
  },
  {
    id: 'S25',
    description: 'missing evidence',
    requirement: 'Experience with GraphQL',
    cv: work('- Developed REST APIs for order services.'),
    quote: '',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Absent from the CV.',
  },
  {
    id: 'S26',
    description: 'unsupported wording (multiple languages)',
    requirement:
      'Proficiency in multiple programming languages such as Java, Python',
    cv: work(
      '- Developed Java services.',
      '- Built Python tools for reporting services.',
    ),
    quote: '',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'Quantities are UNKNOWN and never credited.',
  },
  {
    id: 'S27',
    description: 'work verb outside the accepted list ("Configured")',
    requirement: 'Experience with Kafka',
    cv: work('- Configured Kafka consumers for order events.'),
    quote: '- Configured Kafka consumers for order events.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'PROPOSED',
    rationale: 'Accepted limitation: the work-verb vocabulary is fixed.',
  },
  {
    id: 'S28',
    description: 'project title only',
    requirement: 'Experience with Kafka',
    cv: ['PROJECTS', 'Project: Kafka Streaming Platform'],
    quote: 'Project: Kafka Streaming Platform',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'CURRENT',
    rationale: 'A title alone is a declaration, not work (PR #70).',
  },
  {
    id: 'S29',
    description: 'K8s alias for Kubernetes',
    requirement: 'Experience with Kubernetes',
    cv: work('- Deployed services to K8s clusters.'),
    quote: '- Deployed services to K8s clusters.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'PROPOSED',
    rationale: 'Accepted limitation: no K8s alias.',
  },
  {
    id: 'S30',
    description: 'unmarked wrap with the verb on the first line',
    requirement: 'Spring Boot',
    cv: ['Built Java', '  Spring Boot services.'],
    quote: 'Built Java\n  Spring Boot services.',
    status: 'NOT_EVIDENCED',
    credit: 0,
    policy: 'PROPOSED',
    rationale:
      'Accepted limitation: wraps without a bullet marker are not joined.',
  },
];

const PATHS = ['GEMINI', 'OLLAMA'] as const;

function evaluate(
  requirement: string,
  cvLines: string[],
  quote: Scenario['quote'],
  path: (typeof PATHS)[number],
) {
  const cv = cvLines.join('\n');
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
  const allowed =
    path === 'GEMINI' ? new Set(matchQuoteChoices(cv, canonical)) : undefined;
  const proposals = canonical.map((row) => {
    const group = requirementGroup(row.requirement, row.category);
    const single = typeof quote === 'string' && group.mode === 'SINGLE';
    return {
      ...row,
      cvQuote: single ? quote : '',
      components: group.components.map((c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        // Component-specific evidence only; never one quote for every component.
        cvQuote: typeof quote === 'string' ? '' : (quote[c.label] ?? ''),
      })),
    };
  });
  const row = scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical, allowed),
    cv,
    jd,
    canonical,
  ).requirements[0]!;
  const quotes = [
    row.cvQuote,
    ...row.coverage.components.map((c) => c.cvQuote ?? ''),
  ].filter((q) => q.trim());
  return { status: row.status, credit: row.credit, cv, quotes };
}

describe('Golden Dataset S01–S30', () => {
  test('dataset shape: 30 scenarios, 26 CURRENT and 4 PROPOSED', () => {
    expect(golden.map((s) => s.id)).toEqual(
      Array.from(
        { length: 30 },
        (_, i) => `S${String(i + 1).padStart(2, '0')}`,
      ),
    );
    expect(golden.filter((s) => s.policy === 'CURRENT')).toHaveLength(26);
    expect(golden.filter((s) => s.policy === 'PROPOSED')).toHaveLength(4);
  });

  describe.each(PATHS)('%s validation path', (path) => {
    test.each(
      golden.map((s) => [`${s.id} [${s.policy}] ${s.description}`, s] as const),
    )('%s', (_, s) => {
      const actual = evaluate(s.requirement, s.cv, s.quote, path);
      const label = `${s.id} on ${path}: ${s.rationale}`;
      expect({
        id: label,
        status: actual.status,
        credit: actual.credit,
      }).toEqual({
        id: label,
        status: s.status,
        credit: s.credit,
      });
      // Provenance: every displayed quote is exact CV text.
      for (const quote of actual.quotes)
        expect({
          id: s.id,
          path,
          quoteInCv: actual.cv.includes(quote),
        }).toEqual({
          id: s.id,
          path,
          quoteInCv: true,
        });
    });
  });

  test('no unsupported Matched/Partial on CURRENT negatives; paths agree; repeatable', () => {
    const failures: string[] = [];
    for (const s of golden)
      for (const path of PATHS) {
        const runs = Array.from({ length: 5 }, () =>
          evaluate(s.requirement, s.cv, s.quote, path),
        );
        const keys = new Set(runs.map((r) => `${r.status}/${r.credit}`));
        if (keys.size > 1) failures.push(`${s.id} ${path}: not repeatable`);
        if (s.policy === 'CURRENT' && s.credit === 0 && runs[0]!.credit > 0)
          failures.push(`${s.id} ${path}: unsupported ${runs[0]!.status}`);
      }
    for (const s of golden) {
      const [g, o] = PATHS.map((p) =>
        evaluate(s.requirement, s.cv, s.quote, p),
      );
      if (`${g!.status}/${g!.credit}` !== `${o!.status}/${o!.credit}`)
        failures.push(`${s.id}: GEMINI and OLLAMA paths disagree`);
    }
    expect(failures).toEqual([]);
  });
});

/**
 * Accepted beta limitations: characterization only. These pin today's
 * behaviour so any change is deliberate; they are not endorsements.
 */
describe('Accepted beta limitations (characterization)', () => {
  const both = (
    requirement: string,
    cv: string[],
    quote: Scenario['quote'],
  ) => {
    const [g, o] = PATHS.map((p) => evaluate(requirement, cv, quote, p));
    expect(`${g!.status}/${g!.credit}`).toBe(`${o!.status}/${o!.credit}`);
    return `${g!.status}/${g!.credit}`;
  };

  test('L1 model-dependent selection: familiarity is not recovered without a quote', () => {
    expect(
      both(
        'Familiarity with Terraform',
        ['SKILLS', 'Tools: Git, Terraform'],
        '',
      ),
    ).toBe('NOT_EVIDENCED/0');
  });

  // L2 partly superseded (PO-approved PR #74): in plain experience AND groups,
  // only Docker and CI/CD pipelines are recovered from the candidate's own work.
  test('L2 (partly superseded) only Docker/CI/CD AND components recover without quotes', () => {
    expect(
      both(
        'Experience with Docker and Kubernetes',
        work(
          '- Deployed services with Docker.',
          '- Deployed workloads to a Kubernetes cluster.',
        ),
        {},
      ),
    ).toBe('PARTIAL/0.5'); // Docker recovered; Kubernetes is not in scope
  });

  test('L3 conservative descriptive matching: different wording is not matched', () => {
    const line = '- Built async job pipelines for order events.';
    expect(
      both('Experience with asynchronous processing systems', work(line), line),
    ).toBe('NOT_EVIDENCED/0');
  });

  test('L4 the older "<phrase> experience" suffix keeps trusting the selected passage', () => {
    // Known risk: outside PR #71 scope, a linked work line is still accepted.
    const line = '- Built services consuming Kafka topics.';
    expect(both('Distributed systems experience', work(line), line)).toBe(
      'EVIDENCED/1',
    );
  });

  test('L5 descriptive compound components need their exact phrase', () => {
    const line = '- Developed integration services for payment providers.';
    expect(
      both(COMPOUND, work(line), { 'backend integration services': line }),
    ).toBe('NOT_EVIDENCED/0');
  });
});
