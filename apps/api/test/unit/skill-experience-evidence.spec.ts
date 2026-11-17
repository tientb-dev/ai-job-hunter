import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import { reviewedCvText } from '../../src/reviewed-cv/reviewed-cv.text.js';
import type { EligibleFact } from '../../src/tailored-cv/tailored-draft.contract.js';
import { draftJob } from '../support/tailored-draft-fixtures.js';

// Synthetic reviewed CV: PostgreSQL in Skills, E1 work without a duration,
// E2 with a duration but no PostgreSQL, and an education record with dates.
const fact = (
  sectionKind: EligibleFact['sectionKind'],
  entryId: string,
  id: string,
  field: string,
  value: string,
): EligibleFact => ({
  id,
  field,
  value,
  sectionId: `section-${sectionKind}`,
  sectionKind,
  entryId,
  confirmation: 'section',
  origin: 'source',
  evidence: [],
});
function cv(e1Work: string) {
  return reviewedCvText([
    fact('skills', 'S1', 's', 'skill', 'TypeScript, PostgreSQL, React'),
    fact('experience', 'E1', 'e1-employer', 'employer', 'Acme Logistics'),
    fact('experience', 'E1', 'e1-work', 'description', e1Work),
    fact('experience', 'E2', 'e2-employer', 'employer', 'Beta Retail'),
    fact('experience', 'E2', 'e2-dates', 'dates', '06/2016 – 02/2021'),
    fact(
      'experience',
      'E2',
      'e2-work',
      'description',
      '- Built React admin consoles for 5 years.',
    ),
    fact('education', 'D1', 'd1-inst', 'institution', 'Example University'),
    fact('education', 'D1', 'd1-dates', 'dates', '2012 – 2016'),
    fact(
      'education',
      'D1',
      'd1-work',
      'description',
      '- Built PostgreSQL thesis services for 4 years.',
    ),
  ]).text;
}
// Both job fields produce these rows (skill and experience categories).
function status(
  requirement: string,
  quote: string,
  text: string,
  field: 'skills' | 'experience',
) {
  const job = Object.assign(draftJob(''), {
    skills: '',
    experience: '',
    [field]: requirement,
    description: requirement,
  });
  const canonical = canonicalRequirements(job);
  return scoreCvMatch(
    canonical.map((row) => ({ ...row, cvQuote: quote })),
    text,
    matchJobText(job),
    canonical,
  ).requirements[0]!.status;
}
const skills = 'Skills: TypeScript, PostgreSQL, React';
const fields = ['skills', 'experience'] as const;

describe('skill-specific professional experience', () => {
  test.each(fields)(
    '1. skills-only PostgreSQL does not meet "3+ years PostgreSQL experience" (%s)',
    (field) => {
      const text = cv('- Built PostgreSQL queue services in production.');
      for (const requirement of [
        '3+ years of PostgreSQL experience',
        '3+ years of experience with PostgreSQL',
      ])
        // Unknown / needs evidence, not a stated lack.
        expect(status(requirement, skills, text, field)).toBe('NOT_EVIDENCED');
    },
  );

  test.each(fields)(
    '2. skills-only PostgreSQL does not meet production or hands-on professional experience (%s)',
    (field) => {
      const text = cv('- Built PostgreSQL queue services in production.');
      for (const requirement of [
        'Production experience with PostgreSQL',
        'Hands-on professional experience with PostgreSQL',
      ])
        expect(status(requirement, skills, text, field)).toBe('NOT_EVIDENCED');
    },
  );

  test.each(fields)(
    '3. same-record professional work meets the requirement (%s)',
    (field) => {
      const work =
        '- Built PostgreSQL queue services in production for 4 years.';
      const text = cv(work);
      expect(
        status('Production experience with PostgreSQL', work, text, field),
      ).toBe('EVIDENCED');
      expect(
        status(
          'Hands-on professional experience with PostgreSQL',
          work,
          text,
          field,
        ),
      ).toBe('EVIDENCED');
      expect(
        status('3+ years of PostgreSQL experience', work, text, field),
      ).toBe('EVIDENCED');
      // Same record, but a shorter stated duration is not enough.
      expect(
        status('5+ years of PostgreSQL experience', work, text, field),
      ).toBe('NOT_EVIDENCED');
    },
  );

  test.each(fields)(
    '4. a skill from E1 and a duration or dates from E2 never combine (%s)',
    (field) => {
      const e1 = '- Built PostgreSQL queue services in production.';
      const text = cv(e1);
      const requirement = '3+ years of PostgreSQL experience';
      // E1 names the skill but states no duration; E2 states years or dates only.
      expect(status(requirement, e1, text, field)).toBe('NOT_EVIDENCED');
      expect(
        status(
          requirement,
          '- Built React admin consoles for 5 years.',
          text,
          field,
        ),
      ).toBe('NOT_EVIDENCED');
      expect(status(requirement, 'Dates: 06/2016 – 02/2021', text, field)).toBe(
        'NOT_EVIDENCED',
      );
      // No allowed passage spans E1 and E2.
      expect(
        matchQuoteChoices(text).some(
          (quote) =>
            quote.includes('PostgreSQL queue') && quote.includes('Beta'),
        ),
      ).toBe(false);
    },
  );

  test.each(fields)(
    '5. education dates and education work are not professional experience (%s)',
    (field) => {
      const text = cv('- Built PostgreSQL queue services in production.');
      for (const quote of [
        'Dates: 2012 – 2016',
        '- Built PostgreSQL thesis services for 4 years.',
      ]) {
        expect(
          status('3+ years of PostgreSQL experience', quote, text, field),
        ).toBe('NOT_EVIDENCED');
        expect(
          status('Production experience with PostgreSQL', quote, text, field),
        ).toBe('NOT_EVIDENCED');
      }
    },
  );

  test.each(fields)(
    '6. knowledge of PostgreSQL may use the Skills declaration (%s)',
    (field) => {
      const text = cv('- Built PostgreSQL queue services in production.');
      expect(status('Knowledge of PostgreSQL', skills, text, field)).toBe(
        'EVIDENCED',
      );
      expect(status('PostgreSQL', skills, text, field)).toBe('EVIDENCED');
    },
  );
});
