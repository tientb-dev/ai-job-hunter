import { expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';
import { resolveCvQuote } from '../../src/matching/cv-match.evidence.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

const requirement =
  'Experience in at least one managed language such as Java, Scala, Go, C# or similar.';
const work =
  'Professional experience: Developed Java services with Spring Boot for a commercial client.';
const skills = 'Java, Spring Boot';
const job = {
  title: 'Synthetic Axon engineer',
  skills: requirement,
  preferredSkills: 'Rust',
  experience: '',
  domain: '',
  seniority: '',
  description: requirement,
  postText: '',
  jdText: '',
} as Opportunity;
function assess(cv: string, quote: string, requirements = job) {
  const canonical = canonicalRequirements(requirements),
    jd = matchJobText(requirements);
  const proposed = canonical.map((row, index) => ({
    ...row,
    cvQuote: index === 0 ? quote : '',
    components:
      index === 0
        ? [{ componentId: 'c1', jdQuote: 'Java', cvQuote: quote }]
        : [],
  }));
  const verified = validateMatchAssessment(proposed, cv, jd, canonical);
  return scoreCvMatch(verified, cv, jd, canonical);
}
const target = (result: ReturnType<typeof assess>) => result.requirements[0]!;

test.each([`Skills: ${skills}\n${work}`, `Skills\n${skills}\n${work}`])(
  'inline and separate heading recover exactly the same substantive source quote',
  (cv) => {
    const result = assess(cv, skills);
    expect(target(result)).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
      cvQuote: work,
      coverage: {
        mode: 'OR',
        components: [
          { id: 'c1', status: 'EVIDENCED', cvQuote: work },
          { status: 'NOT_EVIDENCED' },
          { status: 'NOT_EVIDENCED' },
          { status: 'NOT_EVIDENCED' },
        ],
      },
    });
    expect(resolveCvQuote(cv, target(result).cvQuote)).toBe(work);
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  },
);

test('omitted evidence recovers a contiguous work-section heading with the original delimiters', () => {
  const quote =
    'Professional Experience\nDeveloped Java services with Spring Boot for 4 years.';
  const cv = `Skills\n${skills}\n${quote}`;
  const result = assess(cv, '');
  expect(target(result).cvQuote).toBe(quote);
  expect(target(result).status).toBe('EVIDENCED');
  expect(cv.slice(cv.indexOf(quote), cv.indexOf(quote) + quote.length)).toBe(
    target(result).cvQuote,
  );
});

test.each([
  'Skills: Java, Spring Boot',
  'Skills\nJava, Spring Boot',
  'Java',
  'Java and Spring Boot are technologies.',
  'Learning Projects\nDeveloped enterprise Java services.',
  'Personal Projects\nBuilt production Java applications.',
  'Used Java.',
  'I have never developed Java services professionally.',
  "I haven't developed Java services professionally.",
  'Aspiring to develop professional Java services.',
  'I plan to build production Java services.',
  'Developed Java services in a tutorial only.',
  'Built enterprise Java applications for a personal project.',
  'Professional experience: Developed enterprise services using Spring Boot.',
  'Professional experience: Developed JavaScript services with Spring Boot.',
  'Role: Java Backend Engineer\nDeveloped Python services for a commercial client.',
  'Skills: Java\nRole: Backend Engineer\nDeveloped Python services for a commercial client.',
])(
  'names, unrelated work, negation and aspirations never become professional Java credit: %s',
  (cv) => {
    const result = assess(cv, cv.includes('Java') ? 'Java' : '');
    expect(target(result)).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
      cvQuote: '',
    });
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  },
);

test('directly selected bare inline skills cannot bypass the managed-experience guard', () => {
  const cv = 'Skills: Java, Spring Boot';
  expect(target(assess(cv, cv))).toMatchObject({
    status: 'NOT_EVIDENCED',
    cvQuote: '',
  });
});

test('recovery preserves contradictory source statements instead of overriding a denial', () => {
  const denial = 'I have never used Java.';
  const cv = `Skills\n${skills}\n${work}\n${denial}`;
  const result = assess(cv, skills);
  expect(target(result)).toMatchObject({
    status: 'CONFLICT',
    credit: 0,
    cvQuote: work,
  });
  expect(target(result).coverage.components[0]).toMatchObject({
    status: 'CONFLICT',
    cvQuote: work,
    conflictingQuotes: [denial],
  });
  expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
});

test('multiple roles/projects keep Java work in its original attributed entry', () => {
  const quote =
    'Employer: Synthetic North\nRole: Backend Engineer; Project: Billing\nDeveloped enterprise Java services with Spring Boot.';
  const cv = `Skills\n${skills}\n${quote}\n\nEmployer: Synthetic South\nRole: Data Engineer; Project: Reporting\nDeveloped production Python applications.`;
  const result = assess(cv, skills);
  expect(target(result).cvQuote).toBe(quote);
  expect(target(result).status).toBe('EVIDENCED');
  expect(target(result).cvQuote).not.toContain('Synthetic South');
});

test('role/project boundaries cannot lend context from a later employer or project', () => {
  const cv =
    'Skills\nJava, Spring Boot\nProject: Learning Java\nDeveloped Java services.\nRole: Backend Engineer; Project: Reporting\nDeveloped Python applications for a commercial client.';
  expect(target(assess(cv, skills)).status).toBe('NOT_EVIDENCED');
});

test('a rejected model quote still suppresses recovery', () => {
  const group = requirementGroup(requirement, 'skill');
  expect(evaluateCoverage(group, [], work, false).status).toBe('NOT_EVIDENCED');
  expect(evaluateCoverage(group, [], work, true).status).toBe('EVIDENCED');
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job);
  const verified = validateMatchAssessment(
    canonical.map((row, index) => ({
      ...row,
      cvQuote: index === 0 ? 'Fabricated Java experience.' : work,
    })),
    work,
    jd,
    canonical,
  );
  const result = scoreCvMatch(verified, work, jd, canonical);
  expect(target(result)).toMatchObject({
    status: 'NOT_EVIDENCED',
    cvQuote: '',
  });
});

test('existing shared minimum-duration guard is reapplied to recovered evidence', () => {
  const group = { ...requirementGroup(requirement, 'skill'), minimumYears: 5 };
  expect(
    evaluateCoverage(
      group,
      [],
      'Professional experience: Developed Java services for 4 years.',
      true,
    ).status,
  ).toBe('NOT_EVIDENCED');
  expect(
    evaluateCoverage(
      group,
      [],
      'Professional experience: Developed Java services for 6 years.',
      true,
    ).status,
  ).toBe('EVIDENCED');
});

test('English AND and generic OR remain outside this specialized managed-language policy', () => {
  expect(
    requirementGroup('Experience designing APIs and integrations', 'skill')
      .managedLanguage,
  ).toBeUndefined();
  const group = requirementGroup('Java or Python', 'skill');
  expect(group.managedLanguage).toBeUndefined();
  expect(
    evaluateCoverage(group, ['Skills: Java'], 'Skills: Java', true).status,
  ).toBe('EVIDENCED');
});

test.each(['Java', 'Scala', 'Go', 'C#'])(
  'a named managed-language alternative requires its own professional passage: %s',
  (language) => {
    const quote = `Professional experience: Developed production ${language} services.`;
    const group = requirementGroup(requirement, 'skill');
    const result = evaluateCoverage(group, [], quote, true);
    expect(result.status).toBe('EVIDENCED');
    expect(
      result.components.filter(({ status }) => status === 'EVIDENCED'),
    ).toHaveLength(1);
    expect(
      result.components.find(({ label }) => label === language),
    ).toMatchObject({ status: 'EVIDENCED', cvQuote: quote });
  },
);

test('ordinary English go is not professional Go-language evidence', () => {
  const quote =
    'Professional experience: Developed production services that go live each month.';
  expect(
    evaluateCoverage(requirementGroup(requirement, 'skill'), [], quote, true)
      .status,
  ).toBe('NOT_EVIDENCED');
});

test('original CRLF and role/employment context survive recovery', () => {
  const quote =
    'Employer: Synthetic North\r\nRole: Backend Engineer; Project: Billing\r\nDeveloped enterprise Java services.';
  const result = assess(`Skills\r\nJava, Spring Boot\r\n${quote}`, skills);
  expect(target(result)).toMatchObject({ status: 'EVIDENCED', cvQuote: quote });
  expect(resolveCvQuote(quote, target(result).cvQuote)).toBe(quote);
});

test('paragraph breaks after a work heading preserve the same source-backed development decision', () => {
  const quote =
    'Professional Experience\r\n\r\nDeveloped Java services with Spring Boot for 4 years.';
  const result = assess(`Skills\r\n${skills}\r\n${quote}`, skills);
  expect(target(result)).toMatchObject({ status: 'EVIDENCED', cvQuote: quote });
  expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
});
