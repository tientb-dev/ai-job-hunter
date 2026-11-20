import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { AiError } from '../../src/ai/ai.errors.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';
import {
  clearDecompositionCache,
  needsDecomposition,
  validateDecomposition,
} from '../../src/matching/cv-match.decomposition.js';
import {
  canonicalRequirements,
  groupOf,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import {
  JobMatchService,
  MATCH_MAX_OUTPUT_TOKENS,
} from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import {
  CV_JAVA_CLARIFIED,
  CV_JAVA_INCOMPLETE,
  CV_MARKETING,
  CV_SKILLS_ONLY,
  JD_JAVA_EN,
  JD_JAVA_VI,
  JD_LOW_EVALUABILITY,
  REQ,
  job,
} from '../support/cv-match-acceptance-corpus.js';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { reviewedAsIs } from '../support/reviewed-cv.stub.js';

const labels = (text: string, category = 'skill') => {
  const group = requirementGroup(text, category);
  return { mode: group.mode, labels: group.components.map((c) => c.label) };
};

/**
 * Simulates the model: picks a CV line per component (or parent) by a
 * substring hint. Over-eager picks (GitLab for Git, SQL Server for SQL
 * queries) are deliberate: the server must not credit them.
 */
function assess(
  cv: string,
  saved: Opportunity,
  hints: Record<string, string> = {},
) {
  const canonical = canonicalRequirements(saved);
  const jd = matchJobText(saved);
  const line = (hint?: string) =>
    (hint && cv.split('\n').find((row) => row.includes(hint))) || '';
  const proposals: MatchRequirement[] = canonical.map((parent) => ({
    ...parent,
    cvQuote: line(hints[parent.requirement]),
    components: groupOf(parent).components.map((c) => ({
      componentId: c.id,
      jdQuote: c.jdQuote,
      cvQuote: line(hints[c.label]),
    })),
  }));
  return scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
}
const row = (result: ReturnType<typeof assess>, requirement: string) =>
  result.requirements.find((item) => item.requirement === requirement)!;
const component = (
  result: ReturnType<typeof assess>,
  requirement: string,
  label: string,
) =>
  row(result, requirement).coverage.components.find((c) => c.label === label)!;
const greedy: Record<string, string> = {
  Git: 'GitLab',
  SVN: 'GitLab',
  'các công cụ quản lý mã nguồn': 'GitHub Actions',
  'viết câu truy vấn SQL': 'SQL Server',
  'phân tích dữ liệu': 'SQL Server',
  'xử lý logic nghiệp vụ': 'business logic',
  'Java Core': 'Developed Java',
  OOP: 'Developed Java',
  'ability to maintain, debug, and enhance existing applications':
    'Maintained and debugged',
  Java: 'Summary',
  'Spring Boot': 'Summary',
  'lập trình Java': 'Developed Java',
  [REQ.git]: 'GitLab',
  Docker: 'Skills:',
};

describe('1–3, 8: decomposition of the named requirements', () => {
  test('1 EN Java Core/OOP keeps the ability clause as one capability', () => {
    expect(labels(REQ.javaCoreOop)).toEqual({
      mode: 'AND',
      labels: [
        'Java Core',
        'OOP',
        'ability to maintain, debug, and enhance existing applications',
      ],
    });
  });
  test('2 VI SQL-writing/data-analysis/business-logic is AND of three', () => {
    expect(labels(REQ.sqlVi)).toEqual({
      mode: 'AND',
      labels: [
        'viết câu truy vấn SQL',
        'phân tích dữ liệu',
        'xử lý logic nghiệp vụ',
      ],
    });
  });
  test('3 VI Git/SVN/source-control tools is OR', () => {
    expect(labels(REQ.gitVi)).toEqual({
      mode: 'OR',
      labels: ['Git', 'SVN', 'các công cụ quản lý mã nguồn'],
    });
  });
  test.each([
    ['Experience with Java or Kotlin', 'OR'],
    ['Kinh nghiệm với Java hoặc Kotlin', 'OR'],
    ['Experience with Java and Kotlin', 'AND'],
    ['Kinh nghiệm với Java và Kotlin', 'AND'],
  ])('8 %s → %s with the same components', (text, mode) => {
    expect(labels(text)).toEqual({ mode, labels: ['Java', 'Kotlin'] });
  });
  test('8 coordination is decomposed regardless of category', () => {
    expect(labels(REQ.javaSpringYears, 'experience')).toEqual({
      mode: 'AND',
      labels: ['Java', 'Spring Boot'],
    });
    expect(
      requirementGroup(REQ.javaSpringYears, 'experience').minimumYears,
    ).toBe(3);
    expect(labels('Fintech', 'domain').mode).toBe('SINGLE');
  });
  test('8 Java and/or semantics are scored conservatively', () => {
    const cv = '- Developed Java services for payments.';
    const result = assess(
      cv,
      job(['Experience with Java or Kotlin', 'Kinh nghiệm với Java và Kotlin']),
      { Java: 'Developed Java' },
    );
    expect(row(result, 'Experience with Java or Kotlin')).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
    });
    expect(row(result, 'Kinh nghiệm với Java và Kotlin')).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
    });
  });
});

describe('4–7, 15: Java scenarios with a relevant but incompletely worded CV', () => {
  test('A (EN): Java work counts; OOP and Git stay unproven; guidance encourages', () => {
    const result = assess(CV_JAVA_INCOMPLETE, JD_JAVA_EN, greedy);
    expect(component(result, REQ.javaCoreOop, 'Java Core')).toMatchObject({
      status: 'EVIDENCED',
      cvQuote:
        '- Developed Java Spring Boot microservices for payment processing.',
    });
    // A Java line is not proof of OOP; no credit for the unsupported part.
    expect(component(result, REQ.javaCoreOop, 'OOP').status).toBe(
      'NOT_EVIDENCED',
    );
    // "Maintained and debugged" does not state the third action (enhance).
    expect(
      component(
        result,
        REQ.javaCoreOop,
        'ability to maintain, debug, and enhance existing applications',
      ).status,
    ).toBe('NOT_EVIDENCED');
    expect(row(result, REQ.javaSpringYears)).toMatchObject({
      status: 'EVIDENCED',
    });
    // 7: GitLab CI/CD is not Git version-control evidence.
    expect(row(result, REQ.git)).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
    });
    expect(result.guidance).toMatchObject({
      recommendation: 'WORTH_APPLYING',
      confidence: 'NORMAL',
      demonstratedWork: true,
    });
    expect(result.guidance!.actions).toEqual([
      expect.objectContaining({ capability: 'oop' }),
      expect.objectContaining({ capability: 'maintain-debug-enhance' }),
      expect.objectContaining({ code: 'ADD_EXAMPLE', label: 'Git' }),
    ]);
  });

  test('B (VI): SQL Server and GitLab CI/CD earn nothing; Java work still encourages', () => {
    const result = assess(CV_JAVA_INCOMPLETE, JD_JAVA_VI, greedy);
    // 6: SQL Server mention ≠ writing SQL queries; no data-analysis evidence.
    expect(component(result, REQ.sqlVi, 'viết câu truy vấn SQL').status).toBe(
      'NOT_EVIDENCED',
    );
    expect(component(result, REQ.sqlVi, 'phân tích dữ liệu').status).toBe(
      'NOT_EVIDENCED',
    );
    expect(component(result, REQ.sqlVi, 'xử lý logic nghiệp vụ')).toMatchObject(
      {
        status: 'EVIDENCED',
        cvQuote: '- Implemented business logic for loan approval workflows.',
      },
    );
    expect(row(result, REQ.sqlVi).credit).toBeCloseTo(1 / 3);
    // 7: GitHub Actions / GitLab are not source-control tool usage.
    expect(row(result, REQ.gitVi)).toMatchObject({
      status: 'NOT_EVIDENCED',
      credit: 0,
    });
    expect(row(result, REQ.javaSpringVi).status).toBe('EVIDENCED');
    expect(result.guidance!.recommendation).toBe('WORTH_APPLYING');
    expect(result.guidance!.actions).toEqual([
      expect.objectContaining({ capability: 'sql-writing' }),
      expect.objectContaining({ capability: 'data-analysis' }),
      expect.objectContaining({ code: 'ADD_EXAMPLE', label: 'Git' }),
    ]);
  });

  test('B2: Java work alone with SQL and Git unshown is Consider carefully, not Stretch', () => {
    const cv = [
      'Summary: 5 years of experience with Java and Spring Boot.',
      '- Developed Java Spring Boot microservices for payment processing.',
    ].join('\n');
    const result = assess(cv, JD_JAVA_VI, {
      ...greedy,
      Java: 'Developed Java',
      'Spring Boot': 'Developed Java',
    });
    expect(result.guidance).toMatchObject({
      recommendation: 'CONSIDER_CAREFULLY',
      confidence: 'NORMAL',
      demonstratedWork: true,
    });
  });

  test('6, 7: explicit SQL-writing and Git usage are credited once stated', () => {
    const result = assess(CV_JAVA_CLARIFIED, JD_JAVA_VI, {
      ...greedy,
      'viết câu truy vấn SQL': 'SQL queries',
      'phân tích dữ liệu': 'Analyzed transaction data',
      Git: 'Used Git',
    });
    expect(row(result, REQ.sqlVi)).toMatchObject({
      status: 'EVIDENCED',
      credit: 1,
    });
    expect(row(result, REQ.gitVi)).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: '- Used Git for feature branching and code reviews.',
    });
    expect(result.guidance!.recommendation).toBe('WORTH_APPLYING');
  });
});

describe('9–11, 16: evidence kinds and mismatches', () => {
  test('9 a skills list alone is not demonstrated work and not a capability', () => {
    const result = assess(CV_SKILLS_ONLY, JD_JAVA_VI, {
      ...greedy,
      'viết câu truy vấn SQL': 'Skills:',
      'lập trình Java': 'Skills:',
      'Spring Boot': 'Skills:',
      Git: 'Skills:',
    });
    expect(component(result, REQ.sqlVi, 'viết câu truy vấn SQL').status).toBe(
      'NOT_EVIDENCED',
    );
    expect(result.guidance!.demonstratedWork).toBe(false);
    expect(result.guidance!.recommendation).not.toBe('WORTH_APPLYING');
  });

  test('10 technology years are not inferred from use or general tenure', () => {
    const cv = [
      'Summary: 8 years of software development experience.',
      '- Developed Java and Spring Boot services.',
    ].join('\n');
    const result = assess(cv, job([REQ.javaSpringYears]), {
      Java: 'Developed Java',
      'Spring Boot': 'Developed Java',
    });
    expect(row(result, REQ.javaSpringYears).status).toBe('NOT_EVIDENCED');
    expect(result.guidance!.actions[0]).toMatchObject({
      code: 'STATE_DURATION',
      years: 3,
    });
  });

  test('11, 16 a mismatched candidate gets no positive guidance', () => {
    const result = assess(CV_MARKETING, JD_JAVA_EN, {
      'Java Core': 'Planned',
      [REQ.git]: 'Managed',
    });
    expect(
      result.requirements.every((item) => item.status === 'NOT_EVIDENCED'),
    ).toBe(true);
    expect(result.guidance).toMatchObject({
      recommendation: 'STRETCH_OPPORTUNITY',
      demonstratedWork: false,
    });
    expect(result.recommendation).toBe('Low Fit');
  });
});

describe('12, 17: undecomposable requirements and evaluability', () => {
  test('12 ambiguous rows are Needs review, not missing evidence', () => {
    const result = assess(CV_JAVA_INCOMPLETE, JD_LOW_EVALUABILITY);
    const undecomposed = result.requirements.filter(
      (item) => item.status === 'UNDECOMPOSED',
    );
    expect(undecomposed).toHaveLength(3);
    expect(undecomposed.every((item) => item.credit === 0)).toBe(true);
  });
  test('17 low evaluability withholds a confident recommendation', () => {
    const result = assess(CV_JAVA_INCOMPLETE, JD_LOW_EVALUABILITY, greedy);
    expect(result.evaluability).toMatchObject({
      total: 4,
      evaluated: 1,
      low: true,
    });
    expect(result.guidance).toMatchObject({
      recommendation: 'CONSIDER_CAREFULLY',
      confidence: 'LOW',
    });
    expect(result.recommendation).toBe('Review requirements');
    // Too little of the JD is evaluable: no score rather than a misleading one.
    expect(result.score).toBeNull();
  });
  test('whole-sentence prose no longer earns credit from an active verb', () => {
    const text =
      'Proven record of delivering reliable payment platforms for regional banks';
    const result = assess(CV_JAVA_INCOMPLETE, job([text]), {
      [text]: 'Developed Java',
    });
    expect(row(result, text)).toMatchObject({
      status: 'UNDECOMPOSED',
      credit: 0,
    });
  });
});

describe('13: exact quote provenance', () => {
  test.each([
    ['paraphrased', '- Built Java microservices for payments.'],
    [
      'merged records',
      '- Developed Java Spring Boot microservices for payment processing. - Implemented business logic for loan approval workflows.',
    ],
  ])('%s quotes never earn credit', (_kind, quote) => {
    const saved = job([REQ.javaSpringVi]);
    const canonical = canonicalRequirements(saved);
    const jd = matchJobText(saved);
    const proposals = canonical.map((parent) => ({
      ...parent,
      cvQuote: quote,
      components: groupOf(parent).components.map((c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quote,
      })),
    }));
    let credit = 0;
    try {
      const result = scoreCvMatch(
        validateMatchAssessment(proposals, CV_JAVA_INCOMPLETE, jd, canonical),
        CV_JAVA_INCOMPLETE,
        jd,
        canonical,
      );
      const item = result.requirements[0]!;
      credit = item.coverage.components.some((c) => c.cvQuote === quote)
        ? 1
        : 0;
      expect(item.cvQuote).not.toBe(quote);
    } catch (error) {
      expect(String(error)).toMatch(/evidence|quote|output/iu);
    }
    expect(credit).toBe(0);
  });
});

describe('14: AI decomposition — validation, cache, and provider failures', () => {
  const frameworkRequirement =
    'Có kinh nghiệm với Spring/Spring Boot OR các Java framework tương đương';
  const springWork = '- Developed Spring Boot services for a retail platform.';

  test('a validated named framework alternative receives credit for documented work', () => {
    const parent = canonicalRequirements(job([frameworkRequirement]))[0]!;
    expect(groupOf(parent)).toMatchObject({
      mode: 'UNKNOWN',
      openAlternative: 'các Java framework tương đương',
    });
    expect(needsDecomposition(parent)).toBe(true);
    const group = validateDecomposition(parent, {
      mode: 'OR',
      components: ['Spring', 'Spring Boot'],
    });
    expect(group).toMatchObject({
      mode: 'OR',
      context: 'experience',
      openAlternative: 'các Java framework tương đương',
      components: [
        { label: 'Spring', jdQuote: 'Spring' },
        { label: 'Spring Boot', jdQuote: 'Spring Boot' },
      ],
    });
    if (typeof group === 'string') throw new Error(group);
    const genericJava = '- Developed enterprise applications in Java.';
    expect(evaluateCoverage(group, [genericJava], genericJava).credit).toBe(0);
    expect(
      validateDecomposition(parent, {
        mode: 'OR',
        components: ['Spring', 'Spring Boot', 'các Java framework tương đương'],
      }),
    ).toBe('UNSUPPORTED_TAIL');
  });

  test('non-technical alternatives and compound requirements preserve their credit rules', () => {
    const campaign = '- Developed email marketing campaigns for a retailer.';
    const alternatives = requirementGroup(
      'Experience with email marketing or event planning',
      'skill',
    );
    const compound = requirementGroup(
      'Experience with email marketing and event planning',
      'skill',
    );
    expect(evaluateCoverage(alternatives, [campaign], campaign).credit).toBe(1);
    expect(evaluateCoverage(compound, [campaign], campaign).credit).toBe(0.5);
  });

  const row14 = {
    parentId: 'p1',
    requirement: REQ.cloudIncluding,
    category: 'skill',
  };
  test('only literal spans with matching connectors are accepted', () => {
    expect(needsDecomposition(row14)).toBe(true);
    expect(
      validateDecomposition(row14, {
        mode: 'OR',
        components: ['AWS', 'GCP', 'Azure'],
      }),
    ).toMatchObject({ mode: 'OR', components: [{ label: 'AWS' }, {}, {}] });
    // Invented / paraphrased components.
    expect(
      validateDecomposition(row14, {
        mode: 'OR',
        components: ['Amazon Web Services', 'GCP', 'Azure'],
      }),
    ).toBe('INVALID_SPAN');
    // AND contradicts the JD's "or".
    expect(
      validateDecomposition(row14, {
        mode: 'AND',
        components: ['AWS', 'GCP', 'Azure'],
      }),
    ).toBe('CLOUD_PREFIX_REQUIRES_OR');
    // Out of order / overlapping.
    expect(
      validateDecomposition(row14, {
        mode: 'OR',
        components: ['GCP', 'AWS', 'Azure'],
      }),
    ).toBe('INVALID_SPAN');
    expect(
      validateDecomposition(row14, { mode: 'UNSAFE', components: [] }),
    ).toBe('UNSAFE');
    // Quantities keep their deliberate UNKNOWN; no AI call.
    expect(
      needsDecomposition({
        requirement:
          'Proficiency in multiple programming languages such as Java, Python',
        category: 'skill',
      }),
    ).toBe(false);
  });

  test.each([
    [
      'Vue/Svelte as well as testing tools',
      ['Vue', 'Svelte', 'testing tools'],
      'INVALID_CONNECTOR',
    ],
    [
      'Vue/Svelte as well as testing tools',
      ['Vue/Svelte', 'testing tools'],
      'INVALID_CONNECTOR',
    ],
    [
      'Vue as well as Svelte or React',
      ['Vue', 'Svelte or React'],
      'INVALID_CONNECTOR',
    ],
    [
      'event brokers as well as cloud platforms in production',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_TAIL',
    ],
    [
      'event brokers as well as cloud platforms only',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_TAIL',
    ],
    [
      'event brokers as well as cloud platforms outside staging',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_TAIL',
    ],
    [
      'event brokers as well as cloud platforms without supervision',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_TAIL',
    ],
    [
      'event brokers as well as cloud platforms for 2 years',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_TAIL',
    ],
    [
      'event brokers as well as cloud platforms for at least 2 years',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_STRUCTURE',
    ],
    [
      'no event brokers as well as cloud platforms',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_NEGATION',
    ],
    [
      '2 event brokers as well as cloud platforms',
      ['event brokers', 'cloud platforms'],
      'UNSUPPORTED_PREFIX',
    ],
    ['React as well as Python', ['R', 'Python'], 'INVALID_SPAN'],
    ['X as well as Python', ['X', 'Python'], 'SHORT_COMPONENT_LABEL'],
    ['cloud platforms', ['cloud', 'platforms'], 'INVALID_CONNECTOR'],
    [
      'event brokers as well as cloud platforms in production',
      ['event brokers', 'cloud platforms', 'in production'],
      'INVALID_CONNECTOR',
    ],
    ['R as well as R', ['R', 'R'], 'DUPLICATE_COMPONENT_LABEL'],
    ['R as well as Python', ['R', 'python'], 'INVALID_SPAN'],
  ])('rejects an unsafe split of %s', (text, components, reason) => {
    expect(
      validateDecomposition(
        {
          ...row14,
          requirement: `Experience designing and developing ${text}`,
        },
        { mode: 'AND', components },
      ),
    ).toBe(reason);
  });

  test.each([
    [
      'Experience designing and developing R as well as Python',
      ['R', 'Python'],
    ],
    ['Experience with CI/CD and testing tools', ['CI/CD', 'testing tools']],
    ['Experience with Git and Docker skills', ['Git', 'Docker']],
    ['Experience with Git, Docker, and Kafka', ['Git', 'Docker', 'Kafka']],
  ])('preserves literal AND components in %s', (requirement, components) => {
    expect(
      validateDecomposition(
        { ...row14, requirement },
        { mode: 'AND', components },
      ),
    ).toMatchObject({
      mode: 'AND',
      components: components.map((jdQuote) => ({ jdQuote })),
    });
  });

  test.each([
    ['Có kiến thức về Git cũng như Docker', 'knowledge'],
    ['Có kinh nghiệm với Git cũng như Docker', 'experience'],
  ])('preserves shared context for %s', (requirement, context) => {
    expect(
      validateDecomposition(
        { ...row14, requirement },
        {
          mode: 'AND',
          components: ['Git', 'Docker'],
        },
      ),
    ).toMatchObject({
      mode: 'AND',
      context,
      components: [{ jdQuote: 'Git' }, { jdQuote: 'Docker' }],
    });
  });

  test.each(['C', 'C++', 'C#'])(
    'accepts the exact technology %s',
    (technology) => {
      expect(
        validateDecomposition(
          {
            ...row14,
            requirement: `Experience with Go as well as ${technology}`,
          },
          {
            mode: 'AND',
            components: ['Go', technology],
          },
        ),
      ).toMatchObject({
        components: [{ jdQuote: 'Go' }, { jdQuote: technology }],
      });
    },
  );

  test.each([
    [
      'No experience with Git as well as Docker',
      ['No experience with Git', 'Docker'],
      'AND',
      'UNSUPPORTED_NEGATION',
    ],
    [
      'No experience with Git as well as Docker',
      ['Git', 'Docker'],
      'AND',
      'UNSUPPORTED_NEGATION',
    ],
    [
      'Proficiency in Git as well as Docker',
      ['Git', 'Docker'],
      'AND',
      'UNSUPPORTED_PROFICIENCY',
    ],
    [
      'Sử dụng thành thạo Git và Docker',
      ['Sử dụng thành thạo Git', 'Docker'],
      'AND',
      'UNSUPPORTED_PROFICIENCY',
    ],
    ['Experience with Go as well as COBOL', ['Go', 'C'], 'AND', 'INVALID_SPAN'],
    ['Experience with Go as well as C++', ['Go', 'C'], 'AND', 'INVALID_SPAN'],
    ['Experience with Go as well as C#', ['Go', 'C'], 'AND', 'INVALID_SPAN'],
    ['Experience with Go as well as C', [], 'AND', 'INVALID_COMPONENT_COUNT'],
    [
      'Experience with Go as well as C',
      ['Go as well as C'],
      'AND',
      'INVALID_COMPONENT_COUNT',
    ],
    [
      'Có kiến thức về Git hoặc Mercurial cũng như Docker',
      ['Git', 'Mercurial cũng như Docker'],
      'OR',
      'INVALID_CONNECTOR',
    ],
    [
      'Có kiến thức về Git hoặc Mercurial cũng như Docker',
      ['Git', 'Mercurial', 'Docker'],
      'AND',
      'INVALID_CONNECTOR',
    ],
  ] as const)(
    'rejects unsafe decomposition of %s with %j',
    (requirement, components, mode, reason) => {
      expect(
        validateDecomposition(
          { ...row14, requirement },
          { mode, components: [...components] },
        ),
      ).toBe(reason);
    },
  );

  test('allows explicit OR without splitting an atomic slash technology', () => {
    const row = {
      ...row14,
      requirement: 'Experience with CI/CD or testing tools',
    };
    expect(
      validateDecomposition(row, {
        mode: 'OR',
        components: ['CI/CD', 'testing tools'],
      }),
    ).toMatchObject({ mode: 'OR' });
    expect(
      validateDecomposition(row, {
        mode: 'OR',
        components: ['CI', 'CD', 'testing tools'],
      }),
    ).toBe('INVALID_SPAN');
  });

  const cvText = '- Deployed Java services on AWS.';
  const saved = job([REQ.cloudIncluding]);
  function harness(
    decompose: () => Promise<string>,
    savedJob: Opportunity = saved,
    evidence = cvText,
    supportedComponent = 'AWS',
  ) {
    const cvRow = {
      text: evidence,
      updatedAt: savedJob.updatedAt,
      fileName: 'synthetic.pdf',
    };
    // Answers with the groups the match prompt actually sent, as a model would.
    const match = (prompt: string) => {
      const sent = JSON.parse(prompt.slice(prompt.lastIndexOf('\n{"cv"') + 1))
        .canonicalRequirements as (MatchRequirement & {
        group: { components: { id: string; jdQuote: string }[] };
      })[];
      return JSON.stringify({
        requirements: sent.map(({ group, ...parent }) => ({
          ...parent,
          cvQuote: '',
          components: group.components.map((c) => ({
            componentId: c.id,
            jdQuote: c.jdQuote,
            cvQuote: c.jdQuote === supportedComponent ? evidence : '',
          })),
        })),
      });
    };
    const provider = {
      generate: jest.fn(async (request: { prompt: string }) =>
        request.prompt.startsWith('Split each job requirement')
          ? decompose()
          : match(request.prompt),
      ),
    };
    const service = new JobMatchService(
      {
        findOne: async () => cvRow,
        findOneBy: async () => cvRow,
      } as unknown as Repository<SavedCv>,
      {} as ExtractionService,
      new AiService(provider as never),
      new MatchingService(),
      { get: async () => savedJob } as unknown as OpportunitiesService,
      memoryMatchRows(),
      reviewedAsIs(),
    );
    const calls = () =>
      provider.generate.mock.calls.filter(([request]) =>
        request.prompt.startsWith('Split each job requirement'),
      ).length;
    return { service, calls, provider };
  }
  const reply = (mode: string, components: string[]) => async () =>
    JSON.stringify({ items: [{ parentId: 'p1', mode, components }] });

  test.each([
    ['timeout', async () => Promise.reject(new AiError('TIMEOUT'))],
    ['invalid JSON', async () => 'not json'],
    ['schema-invalid output', async () => JSON.stringify({ items: 'x' })],
    ['rejected decomposition', reply('OR', ['Amazon', 'Google', 'Microsoft'])],
  ])(
    '%s falls back to Needs review; analysis still succeeds',
    async (_k, fn) => {
      clearDecompositionCache();
      const { service } = harness(fn as () => Promise<string>);
      const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
      expect(result.requirements[0]).toMatchObject({
        status: 'UNDECOMPOSED',
        credit: 0,
      });
      expect(result.guidance?.confidence).toBe('LOW');
    },
  );

  test('reports one fixed reason per target and correlates fresh persistence', async () => {
    clearDecompositionCache();
    const rows = [
      'Experience with Git',
      REQ.cloudIncluding,
      'Experience designing and developing R as well as Python',
      'Experience designing and developing event brokers as well as cloud platforms in production',
      'Experience designing and developing Vue/Svelte as well as testing tools',
      'Experience designing and developing queues as well as caches',
      'Experience designing and developing proxies as well as servers',
      'Experience designing and developing pipelines as well as data warehouses',
    ];
    const items = [
      { parentId: 'p2', mode: 'OR', components: ['AWS', 'GCP', 'Azure'] },
      { parentId: 'p2', mode: 'OR', components: ['AWS', 'GCP', 'Azure'] },
      { parentId: 'p3', mode: 'AND', components: ['R', 'Python'] },
      {
        parentId: 'p4',
        mode: 'AND',
        components: ['event brokers', 'cloud platforms'],
      },
      {
        parentId: 'p5',
        mode: 'AND',
        components: ['Vue', 'Svelte', 'testing tools'],
      },
      { parentId: 'p6', mode: 'UNSAFE', components: [] },
      {
        parentId: 'p7',
        mode: 'AND',
        components: ['PRIVATE_PROVIDER_CANARY', 'servers'],
      },
    ];
    const { service } = harness(
      async () => JSON.stringify({ items }),
      job(rows),
    );
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    const lines = write.mock.calls.map(([line]) => String(line));
    const events = lines.map(
      (line) => JSON.parse(line) as { event: string; attempt: string },
    );
    const decomposition = events.find(
      ({ event }) => event === 'CV_MATCH_DECOMPOSITION',
    );
    expect(decomposition).toEqual({
      event: 'CV_MATCH_DECOMPOSITION',
      attempt: expect.any(String),
      outcome: 'PARTIAL',
      counts: { targets: 7, requested: 7, accepted: 1 },
      targets: [
        { index: 1, reason: 'DUPLICATE_PARENT' },
        { index: 2, reason: 'ACCEPTED' },
        { index: 3, reason: 'UNSUPPORTED_TAIL' },
        { index: 4, reason: 'INVALID_CONNECTOR' },
        { index: 5, reason: 'UNSAFE' },
        { index: 6, reason: 'INVALID_SPAN' },
        { index: 7, reason: 'OMITTED' },
      ],
    });
    expect(
      events.find(({ event }) => event === 'CV_MATCH_PERSISTENCE'),
    ).toEqual({
      event: 'CV_MATCH_PERSISTENCE',
      attempt: decomposition?.attempt,
      outcome: 'PERSISTED_FRESH',
    });
    expect(
      result.requirements.find(({ parentId }) => parentId === 'p2')?.status,
    ).toBe('UNDECOMPOSED');
    for (const privateValue of [
      ...rows,
      cvText,
      'PRIVATE_PROVIDER_CANARY',
      result.matchId,
      'synthetic-job',
    ])
      expect(lines.join('')).not.toContain(privateValue);
  });

  test('duplicate valid proposals cannot complete a batch with a missing parent', async () => {
    clearDecompositionCache();
    const proposal = {
      parentId: 'p1',
      mode: 'OR',
      components: ['AWS', 'GCP', 'Azure'],
    };
    const { service } = harness(
      async () => JSON.stringify({ items: [proposal, proposal] }),
      job([
        REQ.cloudIncluding,
        'Experience designing and developing R as well as Python',
      ]),
    );
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    await service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    const lines = write.mock.calls.map(([line]) => String(line));
    expect(
      lines.find((line) => line.includes('CV_MATCH_DECOMPOSITION')),
    ).toContain(
      '"outcome":"PARTIAL","counts":{"targets":2,"requested":2,"accepted":0}',
    );
  });

  test('accepted decomposition is scored and cached by JD content', async () => {
    clearDecompositionCache();
    const first = harness(reply('OR', ['AWS', 'GCP', 'Azure']));
    const result = await first.service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    expect(result.requirements[0]).toMatchObject({
      status: 'EVIDENCED',
      cvQuote: '- Deployed Java services on AWS.',
      coverage: { mode: 'OR' },
    });
    expect(first.calls()).toBe(1);
    const again = harness(reply('OR', ['AWS', 'GCP', 'Azure']));
    await again.service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    expect(again.calls()).toBe(0);
    // A changed JD row has a different hash and is decomposed again.
    const edited = harness(
      reply('OR', ['AWS', 'Azure']),
      job(['Experience with cloud platforms, including AWS or Azure']),
    );
    await edited.service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    expect(edited.calls()).toBe(1);
  });

  test('the analyzer sends the named alternatives and fallback, then saves Spring Boot evidence', async () => {
    const { service, provider } = harness(
      reply('OR', ['Spring', 'Spring Boot']),
      job([frameworkRequirement]),
      springWork,
      'Spring Boot',
    );
    const result = await service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0].prompt).toContain(
      '"openAlternative":"các Java framework tương đương"',
    );
    expect(result.requirements[0]).toMatchObject({
      jdQuote: frameworkRequirement,
      status: 'EVIDENCED',
      coverage: {
        mode: 'OR',
        credit: 1,
        components: expect.arrayContaining([
          expect.objectContaining({
            label: 'Spring Boot',
            status: 'EVIDENCED',
            cvQuote: springWork,
          }),
        ]),
      },
    });
  });

  test('large requirement set with cached decomposition: Match-only output budget; MAX_TOKENS fails once, without a score', async () => {
    clearDecompositionCache();
    const large = job([
      REQ.cloudIncluding,
      ...Array.from({ length: 30 }, (_, i) => `Synthetic skill ${i + 1}`),
    ]);
    const first = harness(reply('OR', ['AWS', 'GCP', 'Azure']), large);
    await first.service.analyze(LOCAL_OWNER_ID, 'synthetic-job');
    const sent = (
      first.provider.generate.mock.calls as unknown as [
        { prompt: string; maxOutputTokens?: number },
      ][]
    ).map(([request]) => request);
    // Decomposition keeps the provider default; Match requests the larger budget.
    expect(sent.map((request) => request.maxOutputTokens)).toEqual([
      undefined,
      MATCH_MAX_OUTPUT_TOKENS,
    ]);
    expect(MATCH_MAX_OUTPUT_TOKENS).toBe(16_384);

    const truncated = harness(reply('OR', ['AWS', 'GCP', 'Azure']), large);
    truncated.provider.generate.mockImplementation(async () => {
      throw new AiError('OUTPUT_LIMIT_EXCEEDED', undefined, undefined, {
        candidatesTokenCount: 16_384,
      });
    });
    await expect(
      truncated.service.analyze(LOCAL_OWNER_ID, 'synthetic-job'),
    ).rejects.toMatchObject({
      errorCode: 'CV_MATCH_OUTPUT_LIMIT',
      reasonCode: 'OUTPUT_LIMIT_EXCEEDED',
      status: 422,
    });
    // Cached decomposition: the only call is the INITIAL Match; never resent.
    expect(truncated.calls()).toBe(0);
    expect(truncated.provider.generate).toHaveBeenCalledTimes(1);
  });
});

// Backend → UI: the web test renders exactly what scoring returns here. Run
// with UPDATE_CV_MATCH_FIXTURE=1 to regenerate after an intended change.
describe('backend output shared with the web Match Summary test', () => {
  test('fixture equals current scoring output', () => {
    const path = '../web/test/fixtures/cv-match-guidance.json';
    const actual = JSON.parse(
      JSON.stringify({
        worth: assess(CV_JAVA_INCOMPLETE, JD_JAVA_EN, greedy),
        low: assess(CV_JAVA_INCOMPLETE, JD_LOW_EVALUABILITY, greedy),
        stretch: assess(CV_MARKETING, JD_JAVA_EN, {
          'Java Core': 'Planned',
          [REQ.git]: 'Managed',
        }),
      }),
    ) as unknown;
    if (process.env.UPDATE_CV_MATCH_FIXTURE)
      writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(actual);
  });
});
