import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const job = {
  title: 'Synthetic AI developer',
  skills: 'Python',
  preferredSkills: 'Java',
  experience: '3 years',
  domain: 'Insurance',
  seniority: '',
  description: 'Python required, Java preferred',
  postText: '',
  jdText: '',
} as Opportunity;
const cv = 'Built Python applications. Developed Java services.';
const jd = matchJobText(job);
const item = (
  requirement: string,
  cvQuote = '',
  priority: 'required' | 'preferred' = 'required',
): MatchRequirement => ({
  requirement,
  priority,
  category: 'skill',
  jdQuote: requirement,
  cvQuote,
});
test('required evidence outweighs preferred and omitted canonical gaps remain visible', () => {
  const required = scoreCvMatch(
    [item('Python', 'Built Python applications.')],
    cv,
    jd,
    canonicalRequirements(job),
  );
  const preferred = scoreCvMatch(
    [item('Java', 'Developed Java services.', 'preferred')],
    cv,
    jd,
    canonicalRequirements(job),
  );
  // An omitted model link is recovered from an exact CV work passage naming the skill.
  expect(required.score).toBe(50);
  expect(preferred.score).toBe(50);
  expect(
    required.requirements.find((row) => row.requirement === 'Java'),
  ).toMatchObject({ status: 'EVIDENCED', cvQuote: 'Developed Java services.' });
  expect(
    required.requirements.find((row) => row.category === 'experience')?.status,
  ).toBe('NOT_EVIDENCED');
  expect(
    required.requirements.find((row) => row.category === 'domain')?.status,
  ).toBe('NOT_EVIDENCED');
  expect(required.advice).toContain('accurate');
});
test('rejects fabricated quotes, prevents priority downgrade and never asserts absent abilities', () => {
  const result = scoreCvMatch(
    [
      // validateMatchAssessment marks unresolvable quotes; recovery must not restore them.
      {
        ...item('Python', 'Invented Python expertise', 'preferred'),
        cvEvidenceUnverified: true,
      },
      item('Invented certification', 'Built Python applications.'),
    ],
    cv,
    jd,
    canonicalRequirements(job),
  );
  // Only the omitted preferred Java link is recovered from CV work.
  expect(result.score).toBe(13);
  expect(
    result.requirements.find((row) => row.requirement === 'Python'),
  ).toMatchObject({
    priority: 'required',
    cvQuote: '',
    status: 'NOT_EVIDENCED',
  });
  expect(
    result.requirements.some(
      (row) => row.requirement === 'Invented certification',
    ),
  ).toBe(false);
});
test('empty evidence produces no misleading numeric fit score', () => {
  expect(scoreCvMatch([], cv, '').score).toBeNull();
});
test('fully supported required skills can recommend Apply; reanalysis reflects new CV evidence', () => {
  const seed = [item('Python'), item('Java', '', 'preferred')];
  expect(
    scoreCvMatch([item('Python', 'Built Python applications.')], cv, jd, seed),
  ).toMatchObject({ score: 100, recommendation: 'Apply' });
  expect(
    scoreCvMatch(
      [item('Python', 'Built Python applications.')],
      'Updated CV without evidence.',
      jd,
      seed,
    ),
  ).toMatchObject({ score: 0, recommendation: 'Low Fit' });
});

const reviewedCv = [
  'Technical Skills',
  'Backend — Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, Express.js, PHP, Laravel',
  'Led the development of core enterprise features using Java Spring Boot, MyBatis, JavaScript/Thymeleaf, and SQL Server.',
  'Professional Summary: 6+ years of experience building enterprise applications',
  'Work Experience: Mar 2020 – Aug 2026 · 6 yrs 6 mos',
  'Tools: AI-assisted coding with Copilot.',
].join('\n');
const reviewedJob = {
  ...job,
  skills: 'Python, AI/ML, AI application development',
  preferredSkills: 'Backend Java',
  experience: 'Minimum 3 years',
  domain: '',
  description: '',
};

test('recovers explicit backend Java and sufficient overall experience when the model omits both', () => {
  const result = scoreCvMatch(
    [],
    reviewedCv,
    matchJobText(reviewedJob),
    canonicalRequirements(reviewedJob),
  );
  for (const requirement of ['Backend Java', 'Minimum 3 years']) {
    const row = result.requirements.find(
      (item) => item.requirement === requirement,
    )!;
    expect(row.status).toBe('EVIDENCED');
    expect(row.cvQuote).not.toBe('');
    expect(reviewedCv).toContain(row.cvQuote);
  }
  expect(
    result.requirements
      .filter((item) => item.status === 'NOT_EVIDENCED')
      .map((item) => item.requirement),
  ).toEqual(['Python', 'AI/ML', 'AI application development']);
  expect(result.score).toBe(31);
});

test('equivalent model labels link to canonical requirements without duplicate score entries', () => {
  const proposals: MatchRequirement[] = [
    {
      ...item('Java Spring Boot', reviewedCv.split('\n')[2]!, 'preferred'),
      jdQuote: 'Backend Java',
    },
    {
      ...item('3 years', reviewedCv.split('\n')[3]!),
      category: 'experience',
      jdQuote: 'Minimum 3 years',
    },
  ];
  const result = scoreCvMatch(
    proposals,
    reviewedCv,
    matchJobText(reviewedJob),
    canonicalRequirements(reviewedJob),
  );
  expect(result.requirements).toHaveLength(5);
  expect(result.score).toBe(31);
});

test('explicit work duration supports the generic minimum without adding overlapping roles', () => {
  const result = scoreCvMatch(
    [],
    'Work Experience: Mar 2020 – Aug 2026 · 6 yrs 6 mos',
    matchJobText(reviewedJob),
    canonicalRequirements(reviewedJob),
  );
  expect(
    result.requirements.find((item) => item.category === 'experience'),
  ).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: 'Work Experience: Mar 2020 – Aug 2026 · 6 yrs 6 mos',
  });
});

test('recovery rejects JavaScript, negated experience, short duration and skill-specific experience inference', () => {
  for (const text of [
    'Skills: JavaScript, Spring Boot',
    'No experience with Java Spring Boot.\nOnly 2 years of experience building enterprise applications.',
    'Seeking Java Spring Boot work.\nInterested in 6 years of experience building enterprise applications.',
  ]) {
    const result = scoreCvMatch(
      [],
      text,
      matchJobText(reviewedJob),
      canonicalRequirements(reviewedJob),
    );
    expect(result.score).toBe(0);
  }
  const specific = {
    ...reviewedJob,
    experience: 'Minimum 3 years of AI production experience',
  };
  expect(
    scoreCvMatch(
      [],
      reviewedCv,
      matchJobText(specific),
      canonicalRequirements(specific),
    ).requirements.find((item) => item.category === 'experience')?.status,
  ).toBe('NOT_EVIDENCED');
});

test('backend Java recovery accepts the skills line and Spring Boot work evidence independently', () => {
  for (const excerpt of [
    reviewedCv.split('\n')[1]!,
    reviewedCv.split('\n')[2]!,
  ]) {
    const result = scoreCvMatch(
      [],
      excerpt,
      matchJobText(reviewedJob),
      canonicalRequirements(reviewedJob),
    );
    expect(
      result.requirements.find((item) => item.requirement === 'Backend Java'),
    ).toMatchObject({ status: 'EVIDENCED', cvQuote: excerpt });
  }
});
