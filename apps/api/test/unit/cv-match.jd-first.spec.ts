import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  canonicalRequirementsUnverified,
  matchJobText,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic JD with the section structure of an ITviec "Fetch URL → Save" job.
const itviecJd = [
  'Top 3 Reasons To Join Us',
  'Competitive salary and 13th-month bonus',
  'Hybrid working model',
  'The Job',
  'Design and build backend services for payment systems',
  'Collaborate with product owners',
  'Your Skills and Experience',
  '3+ years of experience in Java backend development',
  'Strong knowledge of Spring Boot and RESTful API design',
  'Experience with relational databases such as PostgreSQL or MySQL',
  'Familiar with Docker and CI/CD pipelines',
  'Good English communication skills',
  'Nice-to-have',
  'Experience with Kafka or RabbitMQ',
  'Knowledge of AWS',
  "Why You'll Love Working Here",
  'Annual health check',
  '15 days of paid leave',
  'Supplemental skill tags (not requirements): Java; Spring Boot; SQL',
  'ITviec Job Expertise: Backend Developer',
  'ITviec Job Domain:',
  'Banking',
  'Fintech',
  'End ITviec Job Domain',
].join('\n');
const job = (patch: Partial<Opportunity> = {}) =>
  ({
    id: 'synthetic',
    title: 'Synthetic Java Backend Engineer',
    skills: '',
    preferredSkills: '',
    experience: '',
    domain: 'Banking; Fintech',
    seniority: '',
    description: itviecJd,
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...patch,
  }) as Opportunity;
const quotes = (rows: { jdQuote: string; priority: string }[], p: string) =>
  rows.filter((row) => row.priority === p).map((row) => row.jdQuote);

test('ITviec-shaped JD: qualification sections are the requirements, counted by priority', () => {
  const rows = canonicalRequirements(job());
  expect(quotes(rows, 'required')).toEqual([
    '3+ years of experience in Java backend development',
    'Strong knowledge of Spring Boot and RESTful API design',
    'Experience with relational databases such as PostgreSQL or MySQL',
    'Familiar with Docker and CI/CD pipelines',
    'Good English communication skills',
  ]);
  expect(quotes(rows, 'preferred')).toEqual([
    'Experience with Kafka or RabbitMQ',
    'Knowledge of AWS',
  ]);
  // Exact JD evidence; nothing from benefits, the job description, tags or metadata.
  for (const row of rows) expect(itviecJd).toContain(row.jdQuote);
  const all = rows.map((row) => row.jdQuote).join('\n');
  for (const text of [
    'salary',
    'Hybrid',
    'Design and build',
    'health check',
    'paid leave',
    'Supplemental',
    'Banking',
    'Fintech',
    'Backend Developer',
  ])
    expect(all).not.toContain(text);
  expect(rows.some((row) => row.category === 'domain')).toBe(false);
  expect(canonicalRequirementsUnverified(job())).toBe(false);
});

test('section headers after the qualifications close them ("The Job" later in the page)', () => {
  const reordered = [
    'Your Skills and Experience',
    'Experience with Go',
    'The Job',
    'Build internal tools',
    'Top 3 Reasons To Join Us',
    'Free lunch',
  ].join('\n');
  expect(
    canonicalRequirements(job({ description: reordered })).map(
      (row) => row.jdQuote,
    ),
  ).toEqual(['Experience with Go']);
});

test('a complete ITviec requirement set scores normally (a real Low Fit stays Low Fit)', () => {
  const saved = job();
  const canonical = canonicalRequirements(saved);
  const result = scoreCvMatch(
    canonical.map((row) => ({ ...row })),
    'Synthetic CV: retail sales associate.',
    matchJobText(saved),
    canonical,
    canonicalRequirementsUnverified(saved),
  );
  expect(result.requirements).toHaveLength(7);
  expect(result.score).toBe(0);
  expect(result.recommendation).toBe('Low Fit');
});

test('a legitimate one-requirement JD stays a verified, scored result', () => {
  const saved = job({
    description: 'Requirements:\n- 2+ years of experience with Node.js',
    domain: '',
  });
  const canonical = canonicalRequirements(saved);
  expect(canonical.map((row) => [row.priority, row.jdQuote])).toEqual([
    ['required', '- 2+ years of experience with Node.js'],
  ]);
  expect(canonicalRequirementsUnverified(saved)).toBe(false);
  const result = scoreCvMatch(
    canonical,
    'Synthetic CV',
    matchJobText(saved),
    canonical,
  );
  expect(result.score).toBe(0);
  expect(result.recommendation).toBe('Low Fit');
});

test('no recognizable section, no skills, more requirement lines than scored: review state, no score', () => {
  const saved = job({
    description: [
      'We build payment software.',
      'Experience with Java is required',
      'Experience with Spring Boot is required',
      'Knowledge of Docker is required',
      'ITviec Job Domain:',
      'Banking',
      'End ITviec Job Domain',
    ].join('\n'),
    domain: 'Banking',
    experience: 'Minimum 3 years',
  });
  const canonical = canonicalRequirements(saved);
  // Fallback: only the experience field; ITviec domain metadata is not a requirement.
  expect(canonical.map((row) => row.category)).toEqual(['experience']);
  expect(canonicalRequirementsUnverified(saved)).toBe(true);
  const result = scoreCvMatch(
    canonical,
    'Synthetic CV',
    matchJobText(saved),
    canonical,
    true,
  );
  expect(result.score).toBeNull();
  expect(result.recommendation).toBe('Review requirements');
  expect(result.advice).toMatch(/may be incomplete/u);
});

test('field-only jobs are unchanged: a manually entered domain is still scored', () => {
  const saved = job({
    description: '',
    skills: 'Java, SQL',
    experience: 'Minimum 3 years',
    domain: 'Insurance',
  });
  expect(
    canonicalRequirements(saved).map((row) => [row.category, row.requirement]),
  ).toEqual([
    ['skill', 'Java'],
    ['skill', 'SQL'],
    ['experience', 'Minimum 3 years'],
    ['domain', 'Insurance'],
  ]);
  expect(canonicalRequirementsUnverified(saved)).toBe(false);
});

test('saved skills fields stay authoritative over JD sections (no double counting)', () => {
  const rows = canonicalRequirements(job({ skills: 'Java, Spring Boot' }));
  expect(rows.map((row) => row.requirement)).toEqual(['Java', 'Spring Boot']);
});

test('deduplication: a repeated line is one row (required wins); similar lines stay distinct', () => {
  const rows = canonicalRequirements(
    job({
      description: [
        'Your Skills and Experience',
        'Experience with Java',
        'Experience with JavaScript',
        'Nice-to-have',
        'Experience with Java',
      ].join('\n'),
    }),
  );
  expect(rows.map((row) => [row.priority, row.jdQuote])).toEqual([
    ['required', 'Experience with Java'],
    ['required', 'Experience with JavaScript'],
  ]);
});
