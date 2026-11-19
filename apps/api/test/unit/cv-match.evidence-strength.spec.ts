import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import {
  EVIDENCE_STRENGTH,
  evidenceStrength,
  strengthLabel,
} from '../../src/matching/cv-match.evidence-strength.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures only.
const s = (label: string, cv: string) => evidenceStrength(label, cv);
const level = (label: string, cv: string) => s(label, cv)?.level ?? null;
const value = (label: string, cv: string) => s(label, cv)?.strength ?? 0;
const job = (title: string, company: string, ...bullets: string[]) =>
  [`${title}, ${company} (2020 - 2022)`, ...bullets.map((b) => `- ${b}`)].join(
    '\n',
  );

test('provisional strength constants (deliberate snapshot)', () => {
  expect(EVIDENCE_STRENGTH).toMatchInlineSnapshot(`
{
  "ALSO_LISTED": 5,
  "APPLIED": 75,
  "APPLIED_PLUS": 85,
  "EXTRA_UNIT": 5,
  "EXTRA_UNIT_MAX": 10,
  "LISTED": 40,
  "MAX": 100,
  "MENTIONED": 55,
}
`);
});

describe('levels', () => {
  const listed = 'SKILLS\nBackend: Java, Spring Boot';
  const mentioned = 'Worked with Java on the billing team.';
  const applied = 'Built payment REST APIs using Java.';
  const plus =
    'Led migration of the billing service to Java and released it to production.';
  test('LISTED < MENTIONED < APPLIED < APPLIED_PLUS', () => {
    expect(
      [listed, mentioned, applied, plus].map((cv) => level('Java', cv)),
    ).toEqual(['LISTED', 'MENTIONED', 'APPLIED', 'APPLIED_PLUS']);
    const values = [listed, mentioned, applied, plus].map((cv) =>
      value('Java', cv),
    );
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(values).size).toBe(4);
  });
  test.each([
    ['Đã sử dụng Java trong nhóm.', 'MENTIONED'],
    ['Xây dựng các REST API bằng Java cho hệ thống thanh toán.', 'APPLIED'],
    ['Phụ trách và bàn giao module thanh toán viết bằng Java.', 'APPLIED_PLUS'],
  ])('Vietnamese: %s → %s', (cv, expected) => {
    expect(level('Java', cv)).toBe(expected);
  });
  test('ownership needs no numbers', () => {
    expect(
      level(
        'Spring Boot',
        'Owned the Spring Boot order service end to end and delivered it.',
      ),
    ).toBe('APPLIED_PLUS');
  });
  test('used X to do Y is concrete; bare use is a mention', () => {
    expect(level('Claude', 'Used Claude to generate unit tests.')).toBe(
      'APPLIED',
    );
    expect(level('Claude', 'Used Claude.')).toBe('MENTIONED');
  });
});

describe('independent units', () => {
  const a = job('Developer', 'Alpha Co', 'Built order APIs in Java.');
  const b = job(
    'Developer',
    'Beta Co',
    'Implemented a Java batch importer for invoices.',
  );
  const c = job(
    'Engineer',
    'Gamma Co',
    'Developed Java services for shipment tracking.',
  );
  test('1, 2, 3 projects: more independent work, diminishing returns', () => {
    const [one, two, three] = [a, [a, b].join('\n'), [a, b, c].join('\n')].map(
      (cv) => s('Java', cv)!,
    ) as [
      NonNullable<ReturnType<typeof s>>,
      NonNullable<ReturnType<typeof s>>,
      NonNullable<ReturnType<typeof s>>,
    ];
    expect([
      one.independentUnits,
      two.independentUnits,
      three.independentUnits,
    ]).toEqual([1, 2, 3]);
    expect(one.strength).toBeLessThan(two.strength);
    expect(two.strength).toBeLessThan(three.strength);
    expect(three.strength - two.strength).toBeLessThanOrEqual(
      two.strength - one.strength,
    );
    const four = [
      a,
      b,
      c,
      job('Dev', 'Delta Co', 'Wrote Java ETL jobs for reports.'),
    ].join('\n');
    expect(value('Java', four)).toBe(three.strength); // capped
  });
  test('the same project pasted twice is one unit', () => {
    expect(s('Java', [a, a].join('\n'))!.independentUnits).toBe(1);
    expect(value('Java', [a, a].join('\n'))).toBe(value('Java', a));
  });
  test('a near-duplicate description of the same project is one unit', () => {
    const again = job('Developer', 'Alpha Co', 'Built the order APIs in Java.');
    expect(s('Java', [a, again].join('\n'))!.independentUnits).toBe(1);
  });
  test('repeated keywords in one project earn nothing extra', () => {
    const noisy = job(
      'Developer',
      'Alpha Co',
      'Built order APIs in Java, Java, Java, Java, Java.',
      'Developed Java tests for the Java order APIs in Java.',
    );
    expect(s('Java', noisy)!.independentUnits).toBe(1);
    expect(value('Java', noisy)).toBe(value('Java', a));
  });
  test('skills plus work is stronger than work alone, and work beats skills', () => {
    const skills = 'SKILLS\nBackend: Java, Spring Boot\n\n';
    expect(value('Java', skills + a)).toBeGreaterThan(value('Java', a));
    expect(value('Java', a)).toBeGreaterThan(value('Java', skills));
    expect(s('Java', skills + a)!.listed).toBe(true);
  });
  test('no headings and no skills section: one conservative unit, still APPLIED', () => {
    const prose =
      'Built order APIs in Java. Later implemented Java batch importers for invoices.';
    expect(s('Java', prose)).toMatchObject({
      level: 'APPLIED',
      independentUnits: 1,
    });
  });
});

describe('false positives stay out', () => {
  test.each([
    ['Java', 'Built dashboards in JavaScript.'],
    ['JavaScript', 'Built services in Java.'],
    ['Cursor', 'Implemented server-side database cursors for Oracle paging.'],
    ['Kafka', 'Never used Kafka in production.'],
    ['Kafka', 'Chưa từng sử dụng Kafka.'],
    ['Kafka', 'Interested in learning Kafka.'],
    ['Docker', 'Claude Monet Gallery volunteer guide.'],
  ])('%s ← %s → absent', (label, cv) => expect(s(label, cv)).toBeNull());
  test.each([
    ['Kafka', 'Completed a Kafka tutorial course.'],
    ['Kafka', 'I want to build Kafka pipelines next year.'],
  ])('completed courses and aspirations are never work: %s', (label, cv) => {
    expect(level(label, cv) === null || level(label, cv) === 'LISTED').toBe(
      true,
    );
  });
  test('quotes are exact CV substrings at their offsets', () => {
    const cv =
      'SKILLS\nBackend: Java\n\n' +
      job('Dev', 'Alpha Co', 'Built order APIs in Java.');
    for (const q of s('Java', cv)!.quotes)
      expect(cv.slice(q.start, q.end)).toBe(q.quote);
  });
});

describe('JD wording never changes the strength', () => {
  test.each([
    'Java',
    'Experience with Java',
    'Có kinh nghiệm sử dụng Java',
    'Proficiency in Java',
  ])('label: %s', (text) => expect(strengthLabel(text)).toBe('Java'));

  const cvs = {
    skillsOnly:
      'TECHNICAL SKILLS\nBackend: Java, Spring Boot\nFrontend: Vue.js',
    work: job('Developer', 'Alpha Co', 'Built order APIs in Java.'),
  };
  const jds = [
    ['Java'],
    ['Experience with Java'],
    ['Có kinh nghiệm sử dụng Java'],
    ['Experience with Java or Kotlin'],
    ['Experience with Java and Kotlin'],
    ['Experience with JVM languages such as Java, Scala, or similar tools'],
  ];
  const strengthIn = (cv: string, lines: string[]) => {
    const opportunity = {
      id: 'synthetic-cp3',
      title: 'x',
      skills: lines.join('\n'),
      preferredSkills: '',
      experience: '',
      domain: '',
      seniority: '',
      description: '',
      postText: '',
      jdText: '',
      updatedAt: new Date('2026-11-18T00:00:00.000Z'),
    } as Opportunity;
    const canonical = canonicalRequirements(opportunity);
    const jd = matchJobText(opportunity);
    // Empty model quotes: an empty quote never vetoes deterministic evidence.
    const result = scoreCvMatch(
      validateMatchAssessment(
        canonical.map((r) => ({ ...r, cvQuote: '' })),
        cv,
        jd,
        canonical,
      ),
      cv,
      jd,
      canonical,
    );
    const component = result.requirements[0]!.coverage.components.find(
      (c) => strengthLabel(c.label) === 'Java',
    ) as { strength?: { level: string; strength: number } } | undefined;
    return component?.strength;
  };
  test.each(Object.entries(cvs))(
    '%s: same level and strength for every JD form',
    (_name, cv) => {
      const results = jds.map((lines) => strengthIn(cv, lines));
      for (const r of results) expect(r).toEqual(results[0]);
      expect(results[0]).toEqual({
        ...s('Java', cv),
      });
    },
  );
  test('skills-only is LISTED for every JD form (never missing)', () => {
    for (const lines of jds)
      expect(strengthIn(cvs.skillsOnly, lines)?.level).toBe('LISTED');
  });
});

describe('hands-on work in any project type (CP3 verification)', () => {
  test.each([
    ['Java', 'Completed a Java course.', 'LISTED'],
    ['Java', 'Built a REST API using Java in a course project.', 'APPLIED'],
    [
      'Spring Boot',
      'Developed and deployed a Spring Boot application as a capstone project.',
      'APPLIED',
    ],
    [
      'Java',
      'Built an inventory management application using Java and PostgreSQL.',
      'APPLIED',
    ],
    [
      'Spring Boot',
      'Led development and deployed a personal Spring Boot project to production.',
      'APPLIED_PLUS',
    ],
  ])('%s ← %s → %s', (label, cv, expected) =>
    expect(level(label, cv)).toBe(expected),
  );

  const project = [
    'Project: E-commerce Platform',
    '- Built backend services using Java and Spring Boot.',
    '- Developed REST APIs in Java.',
    '- Optimized Java services for performance.',
  ].join('\n');
  test('several bullets in one project: practical, one unit, no penalty', () => {
    expect(s('Java', project)).toMatchObject({
      level: 'APPLIED',
      independentUnits: 1,
    });
    const single =
      'Project: E-commerce Platform\n- Built backend services using Java.';
    expect(value('Java', project)).toBe(value('Java', single));
  });
  test('an identical duplicated bullet adds nothing', () => {
    const bullet = '- Built backend services using Java and Spring Boot.';
    expect(value('Java', `Project: Shop\n${bullet}\n${bullet}`)).toBe(
      value('Java', `Project: Shop\n${bullet}`),
    );
  });
  test('a blank line alone does not prove a second project', () => {
    const cv =
      'Project: Shop\n- Built order APIs in Java.\n\n- Developed Java payment services.';
    expect(s('Java', cv)!.independentUnits).toBe(1);
  });
  test('two clearly named projects with similar stacks stay separate', () => {
    const cv = [
      'Project: Order Service (2021)',
      '- Built order APIs in Java and Spring Boot.',
      'Project: Billing Service (2022)',
      '- Built billing APIs in Java and Spring Boot.',
    ].join('\n');
    expect(s('Java', cv)!.independentUnits).toBe(2);
  });
});

describe('the action must apply to the assessed skill', () => {
  test.each([
    [
      'Java',
      'Completed a course on Java and built a demo in Python.',
      'LISTED',
    ],
    [
      'Python',
      'Completed a course on Java and built a demo in Python.',
      'APPLIED',
    ],
    ['Java', 'Learned Java and developed REST APIs using Node.js.', 'LISTED'],
    [
      'Node.js',
      'Learned Java and developed REST APIs using Node.js.',
      'APPLIED',
    ],
    ['Java', 'Built REST APIs using Java in a course project.', 'APPLIED'],
    ['Java', 'Built services using Java and Spring Boot.', 'APPLIED'],
    ['Spring Boot', 'Built services using Java and Spring Boot.', 'APPLIED'],
    [
      'Java',
      'Hoàn thành khóa học Java và xây dựng ứng dụng demo bằng Python.',
      'LISTED',
    ],
    [
      'Python',
      'Hoàn thành khóa học Java và xây dựng ứng dụng demo bằng Python.',
      'APPLIED',
    ],
    [
      'Spring Boot',
      'Xây dựng các dịch vụ bằng Java và Spring Boot.',
      'APPLIED',
    ],
  ])('%s ← %s → %s', (label, cv, expected) =>
    expect(level(label, cv)).toBe(expected),
  );
});
