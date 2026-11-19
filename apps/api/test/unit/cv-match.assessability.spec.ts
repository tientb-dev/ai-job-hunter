import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { notAssessable } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures only.
const cv = [
  'TECHNICAL SKILLS',
  'Backend: Java, Spring Boot',
  'Frontend: Vue.js, TypeScript',
  'AI-assisted Development: Claude, GitHub Copilot',
  'WORK EXPERIENCE',
  'Backend Developer, Example Co (2021 - 2024)',
  '- Built order REST APIs with Java and Spring Boot.',
].join('\n');
const job = (skills: string[], preferred: string[] = []) =>
  ({
    id: 'synthetic-cp2',
    title: 'Synthetic role',
    skills: skills.join('\n'),
    preferredSkills: preferred.join('\n'),
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-18T00:00:00.000Z'),
  }) as Opportunity;
// Empty model quotes: deterministic recovery only.
function assess(skills: string[], preferred: string[] = []) {
  const opportunity = job(skills, preferred);
  const canonical = canonicalRequirements(opportunity);
  const jd = matchJobText(opportunity);
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((row) => ({ ...row, cvQuote: '' })),
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}
const rowOf = (result: ReturnType<typeof assess>, start: string) =>
  result.requirements.find((r) => r.requirement.startsWith(start))!;

const technical = [
  'Experience with Java',
  'Experience with Spring Boot',
  'Experience with Vue.js',
  'Experience with RESTful APIs',
  'Experience with AI coding assistants such as GitHub Copilot, Claude, or similar tools',
];

describe('classification', () => {
  test.each([
    'Required Qualifications',
    'Preferred Qualifications:',
    'Technical Requirements',
    'Yêu cầu công việc',
    'Các năng lực, kinh nghiệm dưới đây là lợi thế lớn',
  ])('heading: %s', (text) => expect(notAssessable(text)).toBe('HEADING'));

  test.each([
    'Good communication skills',
    'Teamwork',
    'Responsibility',
    'Willingness to learn',
    'Kỹ năng giao tiếp tốt',
    'Có tinh thần làm việc nhóm',
    'Ham học hỏi',
    'Có kỹ năng giao tiếp tốt,kỹ năng làm việc đội nhóm, chủ động và có tinh thần trách nhiệm trong công việc',
  ])('subjective: %s', (text) =>
    expect(notAssessable(text)).toBe('SUBJECTIVE'),
  );

  test.each([
    ...technical,
    'Required experience with Java and Spring Boot',
    'Technical skills in Java',
    '3+ years of experience with Java',
    "Bachelor's degree in Computer Science",
    'AWS Certified Developer certification',
    'Business-level English communication skills',
    'Tiếng Nhật N3 trở lên là lợi thế',
    'Strong communication skills and experience with Java',
    'Problem-solving skills',
  ])('stays assessable: %s', (text) => expect(notAssessable(text)).toBeNull());
});

describe('scoring', () => {
  const soft = [
    'Required Qualifications',
    'Good communication skills',
    'Ham học hỏi',
  ];
  test('not-assessed rows stay in the output and add no score weight', () => {
    const plain = assess(technical);
    const withSoft = assess([...soft, ...technical]);
    expect(withSoft.score).toBe(plain.score);
    expect(withSoft.evaluability.weightedFraction).toBe(
      plain.evaluability.weightedFraction,
    );
    expect(withSoft.guidance?.confidence).toBe(plain.guidance?.confidence);
    for (const text of soft)
      expect(rowOf(withSoft, text)).toMatchObject({
        requirement: text,
        status: 'UNDECOMPOSED',
        credit: 0,
        notAssessed: text === soft[0] ? 'HEADING' : 'SUBJECTIVE',
      });
  });
  test('Java, Spring Boot, Vue.js, REST APIs and AI tools remain assessed', () => {
    const result = assess(technical);
    for (const text of technical) {
      const row = rowOf(result, text);
      expect(row).not.toHaveProperty('notAssessed');
      expect(['EVIDENCED', 'PARTIAL']).toContain(row.status);
    }
  });
  test.each([
    ['Strong communication skills and experience with Java', 'Java'],
    ['Có khả năng làm việc nhóm và sử dụng Spring Boot', 'Spring Boot'],
  ])('mixed row keeps its technical part: %s', (text, label) => {
    const row = rowOf(assess([text]), text);
    expect(row).not.toHaveProperty('notAssessed');
    expect(row.status).toBe('EVIDENCED');
    expect(row.coverage.components.map((c) => c.label)).toEqual([label]);
  });
  test('objective conditions are not silently excluded', () => {
    const result = assess([
      '3+ years of experience with Kotlin',
      "Bachelor's degree in Computer Science",
      'Tiếng Nhật N3 trở lên',
    ]);
    for (const row of result.requirements)
      expect(row).not.toHaveProperty('notAssessed');
  });
});
