import { afterEach, describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  groupOf,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import {
  recordMonths,
  simpleEvidenceStatus,
} from '../../src/matching/cv-match.coverage.js';
import {
  cachedDecomposition,
  clearDecompositionCache,
  rememberDecomposition,
  validateDecomposition,
} from '../../src/matching/cv-match.decomposition.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic only. Covers the COMPONENT_JD_SPAN_MISMATCH isolation and the
// Vietnamese Java-duration requirement seen in a real (unseen) Match.
const java = 'Có từ 02 năm kinh nghiệm phát triển phần mềm với Java';
const jobOf = (...requirements: string[]) =>
  ({
    title: 'Fullstack Java Developer',
    skills: requirements.join('\n'),
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: `Yêu cầu:\n${requirements.join('\n')}`,
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;

function score(
  job: Opportunity,
  cv: string,
  answer: (row: MatchRequirement) => Partial<MatchRequirement>,
  canonical = canonicalRequirements(job),
) {
  const jd = matchJobText(job);
  const proposals = canonical.map((row) => ({
    ...row,
    cvQuote: '',
    ...answer(row),
  }));
  return scoreCvMatch(
    validateMatchAssessment(
      proposals,
      cv,
      jd,
      canonical,
      new Set(matchQuoteChoices(cv, canonical)),
    ),
    cv,
    jd,
    canonical,
  );
}
const echo = (row: MatchRequirement, quotes: Record<string, string> = {}) =>
  groupOf(row).components.map((c) => ({
    componentId: c.id,
    jdQuote: c.jdQuote,
    cvQuote: quotes[c.label] ?? '',
  }));

afterEach(clearDecompositionCache);

describe('component JD spans', () => {
  const pairs = 'Experience with Docker and Kubernetes';
  const cv = [
    'EXPERIENCE',
    '- Deployed services with Docker.',
    '- Deployed workloads to a Kubernetes cluster.',
  ].join('\n');
  const quotes = {
    Docker: '- Deployed services with Docker.',
    Kubernetes: '- Deployed workloads to a Kubernetes cluster.',
  };

  test('a span echoed with only case, spacing or Unicode-form drift keeps its credit', () => {
    const result = score(jobOf(pairs), cv, (row) => ({
      components: echo(row, quotes).map((c) => ({
        ...c,
        jdQuote: ` ${c.jdQuote.toLowerCase().normalize('NFD')} `,
      })),
    }));
    expect(result.requirements[0]).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
    });
  });

  test('a malformed span with a valid CV quote gets no credit and is not Matched or Partial', () => {
    const job = jobOf('Kafka', pairs);
    const result = score(
      job,
      `${cv}\n- Built consumers for Kafka topics.`,
      (row) =>
        row.requirement === 'Kafka'
          ? { cvQuote: '- Built consumers for Kafka topics.' }
          : {
              components: echo(row, quotes).map((c, i) =>
                i ? c : { ...c, jdQuote: 'Docker Swarm' },
              ),
            },
    );
    expect(result.requirements.map((r) => [r.status, r.credit])).toEqual([
      ['EVIDENCED', 1],
      ['UNDECOMPOSED', 0],
    ]);
    // The unevaluable row is excluded; half the weighted JD unread: no score.
    expect(result.score).toBeNull();
    expect(result.evaluability).toMatchObject({ total: 2, evaluated: 1 });
  });

  test('a cached AI decomposition is what the model sees and what validation checks', () => {
    const text = 'Sử dụng thành thạo Git và Docker';
    const job = jobOf(text);
    const [row] = canonicalRequirements(job);
    const group = validateDecomposition(row!, {
      mode: 'AND',
      components: ['Git', 'Docker'],
    });
    expect(group).not.toBeNull();
    rememberDecomposition(row!, group!);
    // As JobMatchService.decompose attaches it on a later (cached) run.
    const canonical = canonicalRequirements(job).map((item) => ({
      ...item,
      decomposition: cachedDecomposition(item),
    }));
    const cvText = [
      'EXPERIENCE',
      '- Managed release branches with Git.',
      '- Deployed services with Docker.',
    ].join('\n');
    const ok = score(
      job,
      cvText,
      (item) => ({
        components: echo(item, {
          Git: '- Managed release branches with Git.',
          Docker: '- Deployed services with Docker.',
        }),
      }),
      canonical,
    );
    expect(ok.requirements[0]!.status).not.toBe('UNDECOMPOSED');
    expect(ok.requirements[0]!.credit).toBeGreaterThan(0);
    const bad = score(
      job,
      cvText,
      (item) => ({
        components: echo(item).map((c, i) =>
          i ? c : { ...c, jdQuote: 'GitHub' },
        ),
      }),
      canonical,
    );
    expect(bad.requirements[0]).toMatchObject({
      status: 'UNDECOMPOSED',
      credit: 0,
    });
  });
});

describe('Vietnamese Java duration requirement', () => {
  const cv = [
    'EXPERIENCE',
    'Java Developer | Example Co | 01/2021 - 12/2023',
    '- Developed REST APIs with Java Spring Boot.',
    'Intern | Sample Ltd | 06/2020 - 09/2020',
    '- Built internal tools with Java.',
    'SKILLS',
    'Java, Spring Boot, SQL Server, GitLab CI/CD',
  ].join('\n');
  test.each([
    [
      'dated role of 36 months',
      '- Developed REST APIs with Java Spring Boot.',
      'EVIDENCED',
    ],
    ['a 4-month role', '- Built internal tools with Java.', 'NOT_EVIDENCED'],
    [
      'a skills list only',
      'Java, Spring Boot, SQL Server, GitLab CI/CD',
      'NOT_EVIDENCED',
    ],
  ])('%s', (_, quote, status) => {
    expect(simpleEvidenceStatus(java, quote, cv, 'skill')).toBe(status);
  });
  test('a stated duration still counts; a record never borrows an earlier record’s dates', () => {
    expect(
      simpleEvidenceStatus(
        java,
        '- Developed Java services for 3 years.',
        'EXPERIENCE\n- Developed Java services for 3 years.',
      ),
    ).toBe('EVIDENCED');
    const undated = [
      'Backend Developer | Example Co | 2018 - 2022',
      '- Maintained payment services.',
      'Freelance Developer',
      '- Developed REST APIs with Java.',
    ].join('\n');
    expect(
      recordMonths('- Developed REST APIs with Java.', undated),
    ).toBeNull();
    // Year-only ranges take the shortest span they could mean (2021–2023 ≥ 14 months).
    expect(recordMonths('- x', 'Dev | 2021 - 2023\n- x')).toBe(14);
  });
  test('the match scores the row and an unmet duration asks for dates, not a generic example', () => {
    const job = jobOf(java);
    const met = score(job, cv, () => ({
      cvQuote: '- Developed REST APIs with Java Spring Boot.',
    }));
    expect(met.requirements[0]!.status).toBe('EVIDENCED');
    const unmet = score(job, cv, () => ({
      cvQuote: '- Built internal tools with Java.',
    }));
    expect(unmet.requirements[0]!.status).toBe('NOT_EVIDENCED');
    expect(unmet.guidance!.actions[0]).toMatchObject({
      code: 'STATE_DURATION',
      years: 2,
    });
  });
});

describe('project participation periods (general, not Java-specific)', () => {
  const python = '2+ years of experience with Python';
  test.each([
    [
      'dated project, Tech Lead, Java work',
      java,
      'EXPERIENCE\nSenior Engineer | Example Co | 2019 - 2024\nProject: Payment Platform | 03/2020 - 06/2022\nRole: Tech Lead\n- Developed payment services with Java Spring Boot.',
      '- Developed payment services with Java Spring Boot.',
      'EVIDENCED',
    ],
    [
      'dated project, Developer, Python work',
      python,
      'EXPERIENCE\nProject: Data Pipeline | 01/2021 - 06/2023\nRole: Developer\n- Built ETL jobs with Python.',
      '- Built ETL jobs with Python.',
      'EVIDENCED',
    ],
    [
      'only the project technology is named; no relevant work',
      java,
      'EXPERIENCE\nProject: Payment Platform (Java) | 03/2020 - 06/2022\nRole: Team Lead\n- Coordinated sprint planning.',
      '- Coordinated sprint planning.',
      'NOT_EVIDENCED',
    ],
    [
      'dated project shorter than required',
      python,
      'EXPERIENCE\nProject: Data Pipeline | 01/2023 - 06/2023\n- Built ETL jobs with Python.',
      '- Built ETL jobs with Python.',
      'NOT_EVIDENCED',
    ],
    [
      'undated project inside a long role never takes the role dates',
      java,
      'EXPERIENCE\nDeveloper | Example Co | 01/2019 - 12/2023\nProject: Billing\n- Developed billing jobs with Java.',
      '- Developed billing jobs with Java.',
      'NOT_EVIDENCED',
    ],
  ])('%s', (_, requirement, cv, quote, status) => {
    expect(simpleEvidenceStatus(requirement, quote, cv, 'skill')).toBe(status);
  });
});

test('SQL Server does not prove SQL query writing; GitLab CI/CD does not prove Git', () => {
  const cv = 'SKILLS\nJava, SQL Server, GitLab CI/CD';
  const list = 'Java, SQL Server, GitLab CI/CD';
  expect(
    simpleEvidenceStatus('Có kinh nghiệm viết câu truy vấn SQL', list, cv),
  ).not.toBe('EVIDENCED');
  expect(simpleEvidenceStatus('Experience with Git', list, cv)).not.toBe(
    'EVIDENCED',
  );
});

test('a relevant Java candidate is not discouraged; a mismatched one is not encouraged', () => {
  const job = jobOf(java, 'Vue.js', 'PostgreSQL', 'Docker', 'Kafka', 'Redis');
  const relevant = [
    'EXPERIENCE',
    'Java Developer | Example Co | 01/2021 - 12/2023',
    '- Developed REST APIs with Java Spring Boot.',
    '- Built admin screens with Vue.js.',
  ].join('\n');
  const good = score(job, relevant, (row) =>
    row.requirement === java
      ? { cvQuote: '- Developed REST APIs with Java Spring Boot.' }
      : row.requirement === 'Vue.js'
        ? { cvQuote: '- Built admin screens with Vue.js.' }
        : {},
  );
  // Low numeric coverage, but described core work: never a stretch verdict.
  expect(good.score).toBeLessThan(50);
  expect(good.guidance!.recommendation).not.toBe('STRETCH_OPPORTUNITY');
  const mismatched = score(
    job,
    'EXPERIENCE\n- Managed retail store inventory.',
    () => ({}),
  );
  expect(mismatched.guidance!.recommendation).not.toBe('WORTH_APPLYING');
});
