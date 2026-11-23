import { expect, test } from '@jest/globals';
import { proposeEntryOrder } from '../../src/tailored-cv/experience-order.js';
import type { DraftFact } from '../../src/tailored-cv/tailored-draft.contract.js';

const fact = (
  id: string,
  acceptedText: string,
  field = 'description',
  relevance: DraftFact['relevance'] = [],
): DraftFact => ({
  id,
  field,
  acceptedText,
  selected: true,
  relevance,
  proposedWording: null,
  provenance: {
    profileFactId: id,
    origin: 'source',
    confirmation: 'field',
    evidence: [],
  },
});
const job = {
  skills: 'Java, Spring Boot, PostgreSQL',
  preferredSkills: 'Kafka',
};
const requirements = [
  {
    id: 'r1',
    text: 'Build REST APIs',
    priority: 'required',
    status: 'MET',
    mode: 'ALL',
    credit: 1,
    components: [],
  },
  {
    id: 'r2',
    text: 'Mentoring',
    priority: 'preferred',
    status: 'MET',
    mode: 'ALL',
    credit: 1,
    components: [],
  },
];
const evidence = (requirementId: string): DraftFact['relevance'] => [
  { requirementId, componentIds: ['c'], kind: 'source_passage_support' },
];
const role = () => [
  fact('role', 'Backend Engineer', 'role'),
  fact('dates', '2021 – 2024', 'dates'),
  fact('a', 'Organised team lunches and onboarding docs'),
  fact('b', 'Built Spring Boot services in Java on PostgreSQL'),
  fact('c', 'Maintained a React admin page'),
];

test('moves the JD-relevant bullet up and explains why', () => {
  const facts = role();
  const before = structuredClone(facts);
  const result = proposeEntryOrder({ facts }, requirements, job)!;
  expect(result.originalFactIds).toEqual(['role', 'dates', 'a', 'b', 'c']);
  expect(result.factIds).toEqual(['role', 'dates', 'b', 'a', 'c']);
  expect(result.reasons).toEqual({ b: ['Java', 'Spring Boot', 'PostgreSQL'] });
  // Pure: input untouched, same fact set, titles/dates in place.
  expect(facts).toEqual(before);
  expect([...result.factIds].sort()).toEqual(
    [...result.originalFactIds].sort(),
  );
});

test('CV Match evidence counts, and required outranks preferred', () => {
  const facts = [
    fact('a', 'Coached two junior developers', 'description', evidence('r2')),
    fact(
      'b',
      'Designed the public order endpoints',
      'description',
      evidence('r1'),
    ),
  ];
  const result = proposeEntryOrder({ facts }, requirements, job)!;
  expect(result.factIds).toEqual(['b', 'a']);
  expect(result.reasons).toEqual({ b: ['Build REST APIs'] });
});

test('ai_relevance_only and unknown requirements earn nothing', () => {
  const facts = [
    fact('a', 'Wrote docs'),
    fact('b', 'Refactored modules', 'description', [
      { requirementId: 'r1', componentIds: [], kind: 'ai_relevance_only' },
      {
        requirementId: 'gone',
        componentIds: ['c'],
        kind: 'source_passage_support',
      },
    ]),
  ];
  expect(proposeEntryOrder({ facts }, requirements, job)).toBeNull();
});

test('keeps an already good order and skips small gains', () => {
  const good = [
    fact('a', 'Java and Spring Boot APIs'),
    fact('b', 'Java tooling'),
  ];
  expect(proposeEntryOrder({ facts: good }, requirements, job)).toBeNull();
  // Preferred-only gain (1) is below the threshold of one required skill.
  const small = [fact('a', 'Wrote docs'), fact('b', 'Used Kafka')];
  expect(proposeEntryOrder({ facts: small }, requirements, job)).toBeNull();
});

test('no evidence or empty JD skills: no proposal', () => {
  const facts = role();
  expect(
    proposeEntryOrder({ facts }, [], { skills: '', preferredSkills: '' }),
  ).toBeNull();
  expect(proposeEntryOrder({ facts: [] }, requirements, job)).toBeNull();
});

test('stable: ties keep original order and the result is deterministic', () => {
  const facts = [
    fact('a', 'Wrote docs'),
    fact('b', 'Java batch jobs on PostgreSQL'),
    fact('c', 'Java reporting on PostgreSQL'),
    fact('d', 'Ran retros'),
  ];
  const first = proposeEntryOrder({ facts }, requirements, job)!;
  expect(first.factIds).toEqual(['b', 'c', 'a', 'd']);
  expect(proposeEntryOrder({ facts }, requirements, job)).toEqual(first);
});

test('never moves bullets across a heading/title boundary', () => {
  const facts = [
    fact('h1', 'Project A', 'project'),
    fact('a', 'Wrote docs'),
    fact('h2', 'Project B', 'project'),
    fact('b', 'Java and Spring Boot core'),
  ];
  expect(proposeEntryOrder({ facts }, requirements, job)).toBeNull();
  const two = [
    ...facts.slice(0, 2),
    fact('x', 'Java on PostgreSQL'),
    ...facts.slice(2),
  ];
  expect(proposeEntryOrder({ facts: two }, requirements, job)!.factIds).toEqual(
    ['h1', 'x', 'a', 'h2', 'b'],
  );
});

test('skill matching is word-bounded, not substring', () => {
  const facts = [fact('a', 'Wrote docs'), fact('b', 'Used JavaScript widgets')];
  expect(proposeEntryOrder({ facts }, requirements, job)).toBeNull();
});

test('first bullet already best, later bullets misordered: still proposed', () => {
  const facts = [
    fact('a', 'Led Java and Spring Boot migration'),
    fact('b', 'Ran retros'),
    fact('c', 'Tuned PostgreSQL queries for Java services'),
  ];
  const result = proposeEntryOrder({ facts }, requirements, job)!;
  expect(result.factIds).toEqual(['a', 'c', 'b']);
  expect(result.reasons).toEqual({ c: ['Java', 'PostgreSQL'] });
});

test('reasons use component labels and never copy long JD text', () => {
  const long = {
    ...requirements[0]!,
    id: 'r3',
    text: 'Design, build and operate highly available REST APIs used by millions of customers worldwide',
  };
  const labelled = {
    ...long,
    id: 'r4',
    components: [{ id: 'c', label: 'REST APIs', status: 'EVIDENCED' }],
  };
  const run = (id: string) =>
    proposeEntryOrder(
      {
        facts: [
          fact('a', 'Wrote docs'),
          fact('b', 'Owned endpoints', 'description', evidence(id)),
        ],
      },
      [long, labelled],
      job,
    )!.reasons.b!;
  expect(run('r4')).toEqual(['REST APIs']);
  const [text] = run('r3');
  expect(text!.length).toBeLessThanOrEqual(40);
  expect(text!.endsWith('…')).toBe(true);
});

test('dates and titles stay fixed; each run is ranked on its own', () => {
  const facts = [
    fact('role', 'Engineer', 'role'),
    fact('a', 'Wrote docs'),
    fact('b', 'Java services on PostgreSQL'),
    fact('dates', '2020', 'dates'),
    fact('c', 'Ran retros'),
    fact('d', 'Spring Boot APIs in Java'),
  ];
  const result = proposeEntryOrder({ facts }, requirements, job)!;
  expect(result.factIds).toEqual(['role', 'b', 'a', 'dates', 'd', 'c']);
});

test('role boundary: one entry never receives another entry bullets', () => {
  const first = [
    fact('a1', 'Wrote docs'),
    fact('b1', 'Java services on PostgreSQL'),
  ];
  const second = [
    fact('a2', 'Spring Boot APIs in Java'),
    fact('b2', 'Ran retros'),
  ];
  const one = proposeEntryOrder({ facts: first }, requirements, job)!;
  expect(one.factIds).toEqual(['b1', 'a1']);
  // Second role is already in a good order and is left alone.
  expect(proposeEntryOrder({ facts: second }, requirements, job)).toBeNull();
});

test('equal scores never swap', () => {
  const facts = [
    fact('a', 'Java batch'),
    fact('b', 'PostgreSQL tuning'),
    fact('c', 'Spring Boot APIs'),
  ];
  expect(proposeEntryOrder({ facts }, requirements, job)).toBeNull();
});

// Regression: real Java Backend JD (synthetic copy) where skills arrive as
// Vietnamese requirement sentences, not a skill list.
const backendJd = {
  skills: [
    'Có tối thiểu 3 năm kinh nghiệm phát triển Backend với Java',
    'Java, Spring Boot, Spring MVC, JPA/Hibernate và RESTful API',
    'Có kinh nghiệm thực tế với kiến trúc Microservices',
    'Sử dụng tốt Git; có tư duy Clean Code và khả năng chủ động debug',
    'Biết sử dụng các công cụ AI hỗ trợ lập trình như ChatGPT, GitHub Copilot, Claude',
    'Kinh nghiệm làm việc với Kafka, RabbitMQ OR các giải pháp xử lý bất đồng bộ',
    'Kinh nghiệm sử dụng Docker, Kubernetes, CI/CD OR các nền tảng Cloud',
  ].join('\n'),
  preferredSkills: 'Điểm cộng nếu bạn có:',
};
const leadRole = () => [
  fact('lead', 'Led a 6-member engineering team delivering ERP modules'),
  fact('sprint', 'Owned sprint planning, backlog prioritization and delivery'),
  fact(
    'arch',
    'Led the design of a microservices architecture with RabbitMQ messaging',
  ),
  fact('ai', 'Introduced AI-assisted development workflows using Claude Code'),
  fact(
    'cicd',
    'Optimized GitLab CI/CD pipelines for automated Docker image builds',
  ),
];

test('Java Backend JD: a lone CI/CD + Docker bullet never jumps above leadership or architecture', () => {
  const result = proposeEntryOrder({ facts: leadRole() }, [], backendJd)!;
  // Only the architecture bullet (two core backend requirements) moves up.
  expect(result.factIds).toEqual(['arch', 'lead', 'sprint', 'ai', 'cicd']);
  expect(result.reasons).toEqual({ arch: ['Microservices', 'RabbitMQ'] });
});

test('one JD requirement of alternatives counts once; weak signals give no proposal', () => {
  // Docker and CI/CD are alternatives of one requirement: a single signal.
  const facts = leadRole().filter((f) => f.id !== 'arch');
  expect(proposeEntryOrder({ facts }, [], backendJd)).toBeNull();
  // "Clean Code" is one term: "Claude Code" does not match it.
  const ai = [fact('x', 'Wrote docs'), fact('ai', 'Used Claude Code daily')];
  expect(proposeEntryOrder({ facts: ai }, [], backendJd)).toBeNull();
});

test('DevOps JD: CI/CD and container work rightly moves up', () => {
  const devops = {
    skills: 'Docker, Kubernetes, GitLab CI/CD, Terraform',
    preferredSkills: '',
  };
  const result = proposeEntryOrder({ facts: leadRole() }, [], devops)!;
  expect(result.factIds[0]).toBe('cicd');
  expect(result.reasons.cicd).toEqual(['Docker', 'GitLab CI/CD']);
  // The rest keep the author's order.
  expect(result.factIds.slice(1)).toEqual(['lead', 'sprint', 'arch', 'ai']);
});

test('leadership is not favoured by default: it rises only when the JD asks for it', () => {
  const facts = [
    fact('code', 'Built Java services'),
    fact('lead', 'Led a 6-member engineering team and mentored engineers'),
  ];
  expect(proposeEntryOrder({ facts }, [], backendJd)).toBeNull();
  const lead = {
    skills: 'Technical leadership, Mentoring, Agile',
    preferredSkills: '',
  };
  const team = [
    fact('code', 'Built Java services'),
    fact('lead', 'Technical leadership of 6 engineers, Mentoring and Agile'),
  ];
  expect(proposeEntryOrder({ facts: team }, [], lead)!.factIds).toEqual([
    'lead',
    'code',
  ]);
});
