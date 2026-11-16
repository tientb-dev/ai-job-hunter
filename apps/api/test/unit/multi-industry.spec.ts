import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchPrompt,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import { sectionCandidates } from '../../src/opportunities/job-import.sections.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic JDs only.
const values = (text: string) =>
  sectionCandidates(text, 'jd').map((c) => [c.field, c.value]);
const job = (skills: string): Opportunity =>
  ({
    title: 'Role',
    skills,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;

describe('multi-industry requirements', () => {
  test('IT plain stack lists still split into skills', () => {
    expect(values('Requirements\nTypeScript, React, PostgreSQL')).toEqual([
      ['skills', 'TypeScript'],
      ['skills', 'React'],
      ['skills', 'PostgreSQL'],
    ]);
  });

  test('marketing competency with a shared head noun stays one requirement', () => {
    expect(values('Requirements\nCommunication, negotiation skills')).toEqual([
      ['skills', 'Communication, negotiation skills'],
    ]);
  });

  test('sales target with grouped digits is never split at commas', () => {
    const line = 'Monthly revenue target 1,500,000,000 VND';
    expect(values(`Requirements\n${line}`)).toEqual([['skills', line]]);
    expect(canonicalRequirements(job(line)).map((r) => r.requirement)).toEqual([
      line,
    ]);
    expect(
      requirementGroup(`Experience in B2B sales, quota 2,000,000 USD`, 'skill')
        .mode,
    ).toBe('SINGLE');
  });

  test('match prompt covers non-technical metrics without invented evidence', () => {
    const prompt = matchPrompt('CV', 'JD');
    expect(prompt).toMatch(/marketing, sales, business/u);
    expect(prompt).toMatch(/never infer or compute numbers/u);
  });
});

// Synthetic IT CV shared by the CV Match reliability cases below.
const itCv = [
  'Backend Software Engineer',
  'SUMMARY',
  'Backend engineer with 5 years of experience building web services in TypeScript and Java.',
  'SKILLS',
  'TypeScript, Node.js, NestJS, Java, PostgreSQL, Docker, Git',
  'EXPERIENCE',
  '- Built REST APIs in NestJS and PostgreSQL for an internal billing platform.',
  '- Containerized services with Docker and maintained CI pipelines.',
  'EDUCATION',
  'Bachelor of Engineering in Computer Science, Example University, 2019',
].join('\n');
const summary = itCv.split('\n')[2]!;
const skillsLine = itCv.split('\n')[4]!;
const jdJob = (jd: string, experience = ''): Opportunity =>
  ({ ...job(''), description: jd, experience }) as unknown as Opportunity;
// Model output shaped like Gemini's: every server component echoed.
function assess(saved: Opportunity, quotes: Record<string, string>) {
  const canonical = canonicalRequirements(saved);
  const jd = matchJobText(saved);
  const proposals: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: quotes[row.requirement] ?? '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quotes[c.label] ?? '',
      }),
    ),
  }));
  const result = scoreCvMatch(
    validateMatchAssessment(proposals, itCv, jd, canonical),
    itCv,
    jd,
    canonical,
  );
  return Object.fromEntries(
    result.requirements.map((r) => [r.requirement, r.status]),
  );
}
const itJd = `Requirements
- 3+ years of experience in backend development
- Strong proficiency in TypeScript and Node.js
- Experience with PostgreSQL, Docker
- Bachelor's degree in Computer Science or a related field`;

describe('CV Match reliability (PR88 Gemini acceptance)', () => {
  test('a derived component span is verified through its verbatim parent quote', () => {
    const saved = jdJob(itJd);
    expect(() =>
      assess(saved, { 'Experience with backend development': summary }),
    ).not.toThrow();
  });

  test('a parent JD quote differing only by bullet/case is restored; a fabricated one is rejected', () => {
    const saved = jdJob(itJd);
    const canonical = canonicalRequirements(saved);
    const jd = matchJobText(saved);
    const withQuote = (jdQuote: string) =>
      canonical.map((row, i) => (i === 3 ? { ...row, jdQuote } : row));
    const restored = validateMatchAssessment(
      withQuote("BACHELOR'S DEGREE IN COMPUTER SCIENCE OR A RELATED FIELD"),
      itCv,
      jd,
      canonical,
    );
    expect(restored[3]!.jdQuote).toBe(canonical[3]!.jdQuote);
    expect(() =>
      validateMatchAssessment(
        withQuote("Bachelor's degree in any field"),
        itCv,
        jd,
        canonical,
      ),
    ).toThrow();
  });

  test('IT baseline credits skills under a SKILLS heading, Docker work and the CS degree', () => {
    expect(
      assess(jdJob(itJd), {
        'Experience with backend development': summary,
        TypeScript: skillsLine,
        'Node.js': skillsLine,
        PostgreSQL:
          '- Built REST APIs in NestJS and PostgreSQL for an internal billing platform.',
        Docker:
          '- Containerized services with Docker and maintained CI pipelines.',
      }),
    ).toEqual({
      '3+ years of experience in backend development': 'EVIDENCED',
      'Strong proficiency in TypeScript and Node.js': 'EVIDENCED',
      'Experience with PostgreSQL, Docker': 'EVIDENCED',
      "Bachelor's degree in Computer Science or a related field": 'EVIDENCED',
    });
  });

  test.each([
    ['2+ years of experience in digital marketing'],
    ['2+ years of B2B sales experience'],
  ])('backend years never satisfy "%s"', (requirement) => {
    const saved = jdJob(`Requirements\n- ${requirement}`, 'Minimum 2 years');
    // The bare experience field restates the role requirement; it is not kept.
    expect(canonicalRequirements(saved).map((r) => r.requirement)).toEqual([
      requirement,
    ]);
    expect(
      assess(saved, {
        [requirement]: summary,
        [requirementGroup(requirement, 'skill').components[0]!.label]: summary,
      }),
    ).toEqual({ [requirement]: 'NOT_EVIDENCED' });
  });

  test('a bare years field with no role-specific restatement is unchanged', () => {
    const saved = {
      ...job('Experience with Docker'),
      experience: 'Minimum 2 years',
    } as Opportunity;
    expect(canonicalRequirements(saved).map((r) => r.requirement)).toContain(
      'Minimum 2 years',
    );
  });
});
