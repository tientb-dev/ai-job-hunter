import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { AiError } from '../../src/ai/ai.errors.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
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
    // UNDECOMPOSED rows stay in the denominator: the score is not inflated.
    expect(result.score).toBeLessThanOrEqual(10);
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
    ).toBeNull();
    // AND contradicts the JD's "or".
    expect(
      validateDecomposition(row14, {
        mode: 'AND',
        components: ['AWS', 'GCP', 'Azure'],
      }),
    ).toBeNull();
    // Out of order / overlapping.
    expect(
      validateDecomposition(row14, {
        mode: 'OR',
        components: ['GCP', 'AWS', 'Azure'],
      }),
    ).toBeNull();
    expect(
      validateDecomposition(row14, { mode: 'UNSAFE', components: [] }),
    ).toBeNull();
    // Quantities keep their deliberate UNKNOWN; no AI call.
    expect(
      needsDecomposition({
        requirement:
          'Proficiency in multiple programming languages such as Java, Python',
        category: 'skill',
      }),
    ).toBe(false);
  });

  const cvText = '- Deployed Java services on AWS.';
  const saved = job([REQ.cloudIncluding]);
  function harness(
    decompose: () => Promise<string>,
    savedJob: Opportunity = saved,
  ) {
    const cvRow = {
      text: cvText,
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
            cvQuote: c.jdQuote === 'AWS' ? cvText : '',
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
