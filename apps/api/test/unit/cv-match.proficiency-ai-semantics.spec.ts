import { MatchContexts } from '../../src/matching/match-context.js';
import { suggestionCandidates } from '../../src/matching/suggestion-policy.js';
import { expect, test } from '@jest/globals';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { resolveCvQuote } from '../../src/matching/cv-match.evidence.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
const database =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const ai =
  'Familiarity with or interest in AI-assisted development tools, code generation, and automation workflows';
const work = 'Developed enterprise features using SQL Server.';
const tooling =
  'Used Claude and ChatGPT for refactoring, prototyping and technical documentation in professional development workflows.';
const interest =
  'I am interested in AI-assisted development tools, code generation, and automation workflows.';
function assess(
  requirement: string,
  cv: string,
  selected = '',
  preferredSkills = '',
) {
  const job = {
    title: 'Synthetic',
    skills: requirement,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: requirement,
    jdText: '',
    postText: '',
  } as Opportunity;
  const canonical = canonicalRequirements(job),
    jd = matchJobText(job);
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((r, i) => ({ ...r, cvQuote: i === 0 ? selected : '' })),
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}
const row = (result: ReturnType<typeof assess>) => result.requirements[0]!;
test.each([
  'Skills: SQL Server, Oracle, MySQL',
  'SQL Server',
  'I plan to use SQL Server for enterprise features.',
  'I have never used SQL Server.',
])('database mentions and aspirations earn no credit: %s', (cv) => {
  const result = assess(database, cv, cv);
  expect(row(result).status).toBe('NOT_EVIDENCED');
  expect(row(result).credit).toBe(0);
});
test.each(['', 'Skills: SQL Server', work])(
  'database work recovers exact evidence and earns Partial, not proficiency: %s',
  (selected) => {
    const cv = `Skills: SQL Server\n${work}\nOptimized data-access logic and MyBatis queries.`;
    const result = assess(database, cv, selected, 'Rust');
    expect(row(result)).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
      cvQuote: work,
    });
    expect(row(result).coverage.components[2]).toMatchObject({
      status: 'PARTIAL',
      cvQuote: work,
      observations: expect.arrayContaining([
        { kind: 'experience', cvQuote: work },
      ]),
    });
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
    expect(row(result).coverage.reason).toContain('proficiency');
  },
);
test.each([
  'Proficient in SQL Server.',
  'Designed SQL Server database schemas for a production billing application.',
  'Thành thạo SQL Server.',
  'Independently designed SQL Server database schemas for a production billing application.',
  'Personally tuned SQL Server queries for an enterprise billing service.',
  'Independently troubleshot SQL Server production incidents for a commercial client.',
  'Administered production SQL Server databases with query tuning and indexing.',
])(
  'credible proficiency and independent database responsibility satisfy one OR alternative: %s',
  (cv) => {
    const result = assess(database, cv);
    expect(row(result)).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
      cvQuote: cv,
    });
    expect(
      row(result).coverage.components.filter((c) => c.status === 'EVIDENCED'),
    ).toHaveLength(1);
    expect(resolveCvQuote(cv, row(result).cvQuote)).toBe(cv);
  },
);
test('independent SQL Server work plus one year is neither rejected nor awarded on duration alone', () => {
  const strong =
    'Independently tuned SQL Server queries for a production billing service during one year.';
  expect(row(assess(database, strong)).status).toBe('EVIDENCED');
  expect(row(assess(database, 'One year using SQL Server.')).status).toBe(
    'NOT_EVIDENCED',
  );
});
test.each([
  'Our team independently tuned SQL Server queries for a production service.',
  'I plan to independently tune SQL Server queries for a production service.',
  'Independently designed SQL Server schemas in a personal tutorial.',
  'Proficient in Oracle Cloud.',
  'Optimized data-access logic and MyBatis queries.',
])(
  'database stronger claims cannot be inferred from weak or unsafe evidence: %s',
  (cv) => {
    expect(row(assess(database, cv, cv)).status).toBe('NOT_EVIDENCED');
  },
);
test('database OR takes the strongest alternative without summing Partial credit', () => {
  const other = 'Developed enterprise features using MySQL.';
  expect(row(assess(database, `${work}\n${other}`))).toMatchObject({
    status: 'PARTIAL',
    credit: 0.5,
  });
  expect(row(assess(database, `${work}\nProficient in Oracle.`))).toMatchObject(
    { status: 'EVIDENCED', credit: 1 },
  );
});
test('database denials preserve conflict and insufficient level preserves Partial', () => {
  const result = assess(database, `${work}\nI have never used SQL Server.`);
  expect(row(result)).toMatchObject({ status: 'CONFLICT', credit: 0 });
  expect(row(result).coverage.components[2]?.conflictingQuotes).toContain(
    'I have never used SQL Server.',
  );
  expect(
    row(assess(database, `${work}\nI am not proficient in SQL Server.`)),
  ).toMatchObject({ status: 'PARTIAL', credit: 0.5 });
});
test('database recovery retains contiguous project attribution and never borrows another entry', () => {
  const quote = `Employer: Synthetic North\nProject: Billing\n${work}`;
  const cv = `${quote}\nProject: Other\nIndependently tuned PostgreSQL queries for a production service.`;
  expect(row(assess(database, cv))).toMatchObject({
    status: 'PARTIAL',
    cvQuote: quote,
  });
});
test.each([
  tooling,
  interest,
  'Used GitHub Copilot for code generation.',
  'Familiar with AI-assisted development tools.',
])(
  'AI family accepts contextual familiarity or relevant interest with exact recovery: %s',
  (cv) => {
    const result = assess(ai, cv);
    expect(row(result)).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
      cvQuote: cv,
      coverage: { mode: 'OR' },
    });
    expect(resolveCvQuote(cv, row(result).cvQuote)).toBe(cv);
  },
);
test.each([
  'Skills: Claude, ChatGPT',
  'I am interested in AI.',
  'Used ChatGPT for a holiday itinerary.',
  'Used ChatGPT for technical documentation.',
  'I plan to use Claude.',
  'I have never used Claude for refactoring.',
  'I am not interested in AI-assisted development tools.',
])('AI tools, unrelated interest and negatives do not qualify: %s', (cv) => {
  expect(row(assess(ai, cv, cv))).toMatchObject({
    status: 'NOT_EVIDENCED',
    credit: 0,
    cvQuote: '',
  });
});
test('AI recovery is heading-independent and retains exact bounded role context', () => {
  for (const prefix of ['Skills: Claude, ChatGPT', 'Skills\nClaude, ChatGPT']) {
    const quote = `Role: Software Engineer\n${tooling}`;
    expect(
      row(assess(ai, `${prefix}\n${quote}`, 'Claude, ChatGPT')),
    ).toMatchObject({ status: 'EVIDENCED', cvQuote: quote });
  }
});
test('AI interest never invents familiarity, and use denial alone does not deny interest', () => {
  const result = assess(
    ai,
    `${interest}\nI have never used AI-assisted development tools.`,
  );
  expect(row(result).coverage.components.map((c) => c.status)).toEqual([
    'NOT_EVIDENCED',
    'EVIDENCED',
  ]);
  expect(row(result).cvQuote).toBe(interest);
});
test('AI contradictory use or interest remains Conflict with exact source quotes', () => {
  for (const [positive, negative] of [
    [tooling, 'I have never used Claude for refactoring.'],
    [interest, 'I am not interested in AI-assisted development tools.'],
  ]) {
    const result = assess(ai, `${positive}\n${negative}`);
    expect(row(result)).toMatchObject({ status: 'CONFLICT', credit: 0 });
    expect(
      row(result).coverage.components.flatMap((c) => c.conflictingQuotes),
    ).toContain(negative);
  }
});
test('rejected evidence suppression and unrelated AND/OR families remain unchanged', () => {
  for (const requirement of [database, ai])
    expect(
      evaluateCoverage(
        requirementGroup(requirement, 'skill'),
        [],
        `${work}\n${tooling}`,
        false,
      ).status,
    ).toBe('NOT_EVIDENCED');
  expect(
    requirementGroup(
      'Experience evaluating and integrating AI-assisted development tools into engineering workflows',
      'skill',
    ).mode,
  ).toBe('AND');
  expect(
    requirementGroup('Java or Python', 'skill').aiFamiliarityOrInterest,
  ).toBeUndefined();
});

test('Partial database quotes do not become affirmative proficiency wording in suggestions', () => {
  const result = assess(database, work);
  const snapshot = new MatchContexts().create(
    'synthetic-owner',
    'synthetic-job',
    {
      cvUpdatedAt: '2026-11-05T00:00:00.000Z',
      jobUpdatedAt: '2026-11-05T00:00:00.000Z',
    },
    result,
  );
  expect(suggestionCandidates(snapshot, work)[0]).toMatchObject({
    status: 'PARTIAL',
    kind: 'clarify',
    wording: null,
  });
});
