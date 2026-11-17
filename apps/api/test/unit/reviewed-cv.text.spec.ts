import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import { withCvOrigins } from '../../src/matching/job-match.service.js';
import {
  quoteOrigin,
  reviewedCvText,
} from '../../src/reviewed-cv/reviewed-cv.text.js';
import type { EligibleFact } from '../../src/tailored-cv/tailored-draft.contract.js';
import { draftJob } from '../support/tailored-draft-fixtures.js';

// Synthetic reviewed profile: skills, two roles, education, one correction
// (Beta Retail dates) and one user-entered certification.
function fact(
  sectionKind: EligibleFact['sectionKind'],
  entryId: string,
  id: string,
  field: string,
  value: string,
  extra: Partial<EligibleFact> = {},
): EligibleFact {
  return {
    id,
    field,
    value,
    sectionId: `section-${sectionKind}`,
    sectionKind,
    entryId,
    confirmation: 'section',
    origin: 'source',
    evidence: [
      {
        sourceRevisionId: 'source-1',
        start: 0,
        end: value.length,
        quote: value,
      },
    ],
    ...extra,
  };
}
const facts: EligibleFact[] = [
  fact('contact', 'c', 'name', 'name', 'Name: Synthetic Quinn'),
  fact(
    'skills',
    'S1',
    'skills',
    'skill',
    'TypeScript, PostgreSQL, React, Docker',
  ),
  fact('experience', 'E1', 'e1-employer', 'employer', 'Acme Logistics'),
  fact('experience', 'E1', 'e1-role', 'role', 'Senior Backend Engineer'),
  fact('experience', 'E1', 'e1-dates', 'dates', '03/2021 – Present'),
  fact(
    'experience',
    'E1',
    'e1-work',
    'description',
    '- Cut invoice processing time by 40% by moving batch jobs to PostgreSQL queues.',
  ),
  fact('experience', 'E2', 'e2-employer', 'employer', 'Beta Retail'),
  fact('experience', 'E2', 'e2-role', 'role', 'Software Engineer'),
  // Correction of the source "2018 – 2021"; keeps the original's evidence.
  fact('experience', 'E2', 'e2-dates-fixed', 'dates', '06/2018 – 02/2021', {
    replacesFactId: 'e2-dates',
    confirmation: 'field',
  }),
  fact(
    'experience',
    'E2',
    'e2-work',
    'description',
    '- Built a React admin console used by 30 store managers.',
  ),
  fact(
    'education',
    'D1',
    'd1-inst',
    'institution',
    'Hanoi University of Science and Technology',
  ),
  fact('education', 'D1', 'd1-qual', 'qualification', 'BSc Computer Science'),
  fact('education', 'D1', 'd1-dates', 'dates', '2014 – 2018'),
  fact(
    'certifications',
    'C1',
    'c1',
    'certification',
    'AWS Certified Developer – Associate (2023)',
    { origin: 'user_entered', evidence: [], confirmation: 'field' },
  ),
];
const reviewed = reviewedCvText(facts);

describe('reviewed CV text', () => {
  test('renders confirmed facts per record with matching-compatible shapes', () => {
    expect(reviewed.text).toBe(
      [
        'SKILLS',
        'Skills: TypeScript, PostgreSQL, React, Docker',
        '',
        '',
        'WORK EXPERIENCE',
        'Employer: Acme Logistics',
        'Role: Senior Backend Engineer',
        'Dates: 03/2021 – Present',
        '- Cut invoice processing time by 40% by moving batch jobs to PostgreSQL queues.',
        '',
        '',
        'Employer: Beta Retail',
        'Role: Software Engineer',
        'Dates: 06/2018 – 02/2021',
        '- Built a React admin console used by 30 store managers.',
        '',
        '',
        'EDUCATION',
        'Institution: Hanoi University of Science and Technology',
        'Qualification: BSc Computer Science',
        'Dates: 2014 – 2018',
        '',
        '',
        'CERTIFICATIONS',
        'Certification: AWS Certified Developer – Associate (2023)',
      ].join('\n'),
    );
    // Contact details never reach matching.
    expect(reviewed.text).not.toContain('Quinn');
    // Every rendered fact line maps back to its fact and record.
    const line = reviewed.lines.find((l) => l.factId === 'e2-dates-fixed')!;
    expect(reviewed.text.slice(line.start, line.end)).toBe(
      'Dates: 06/2018 – 02/2021',
    );
    expect(line).toMatchObject({ entryId: 'E2', sectionKind: 'experience' });
  });

  test('no allowed quote spans two records', () => {
    const entryOf = (quote: string) => {
      const start = reviewed.text.indexOf(quote);
      return new Set(
        reviewed.lines
          .filter((l) => l.start < start + quote.length && l.end > start)
          .map((l) => l.entryId),
      );
    };
    const exact = matchQuoteChoices(reviewed.text).filter(
      (quote) => quote && reviewed.text.includes(quote),
    );
    expect(exact.length).toBeGreaterThan(10);
    for (const quote of exact)
      expect(entryOf(quote).size).toBeLessThanOrEqual(1);
    // Explicitly: E1 work and E2 dates are never one passage.
    expect(
      matchQuoteChoices(reviewed.text).some(
        (q) => q.includes('PostgreSQL queues') && q.includes('06/2018'),
      ),
    ).toBe(false);
  });

  test('user-entered facts keep user_entered provenance', () => {
    expect(
      quoteOrigin(
        reviewed,
        'Certification: AWS Certified Developer – Associate (2023)',
      ),
    ).toBe('user_entered');
    expect(quoteOrigin(reviewed, 'Role: Software Engineer')).toBe('source');
    expect(quoteOrigin(reviewed, 'Not in this CV')).toBeNull();
  });

  test('duration evidence comes only from one record, never a skills list', () => {
    const two = reviewedCvText([
      fact('skills', 'S1', 'skills', 'skill', 'PostgreSQL, Java'),
      fact('experience', 'A', 'a-role', 'role', 'Backend Developer'),
      fact(
        'experience',
        'A',
        'a-work',
        'description',
        '- Built PostgreSQL queue services.',
      ),
      fact('experience', 'B', 'b-role', 'role', 'Software Engineer'),
      fact(
        'experience',
        'B',
        'b-work',
        'description',
        '- 4 years of software development experience building enterprise applications.',
      ),
    ]);
    const job = Object.assign(draftJob(''), {
      skills: '',
      experience:
        'At least 3 years of relevant software development experience',
      description:
        'At least 3 years of relevant software development experience',
    });
    const canonical = canonicalRequirements(job);
    const status = (quote: string) =>
      withCvOrigins(
        scoreCvMatch(
          canonical.map((row) => ({ ...row, cvQuote: quote })),
          two.text,
          matchJobText(job),
          canonical,
        ),
        two,
      ).requirements[0]!;
    // Existing qualification rule: an explicit duration statement in one passage.
    expect(
      status(
        '- 4 years of software development experience building enterprise applications.',
      ),
    ).toMatchObject({ status: 'EVIDENCED', cvOrigin: 'source' });
    expect(status('Skills: PostgreSQL, Java').status).toBe('NOT_EVIDENCED');
    // Record A's skill work and record B's duration are never one passage.
    expect(
      matchQuoteChoices(two.text).some(
        (q) => q.includes('PostgreSQL queue') && q.includes('4 years'),
      ),
    ).toBe(false);
  });
});
