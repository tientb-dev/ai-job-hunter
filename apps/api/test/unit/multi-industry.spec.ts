import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchPrompt,
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
