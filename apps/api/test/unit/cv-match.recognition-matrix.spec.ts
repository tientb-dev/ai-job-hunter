import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures only: structure modelled on real CV layouts, no real data.
const CV = {
  A: [
    'Synthetic Engineer',
    'TECHNICAL SKILLS',
    'Backend: Java, Spring Boot, Hibernate, Node.js, NestJS',
    'Frontend: React, Next.js, Vue.js, Nuxt.js, TypeScript, JavaScript',
    'Architecture: Microservices, REST APIs, RabbitMQ',
    'Databases: PostgreSQL, MySQL, SQL Server, Oracle',
    'Cloud & DevOps: AWS, Docker, GitLab CI/CD, GitHub Actions',
    'AI-assisted Development: Claude, ChatGPT, GitHub Copilot',
    'WORK EXPERIENCE',
    'Backend Developer, Example Co (2021 - 2024)',
    '- Built order management REST APIs with Java and Spring Boot.',
    '- Developed admin screens in Vue.js backed by PostgreSQL.',
  ].join('\n'),
  B: [
    'Synthetic Engineer',
    'What I did',
    'Example Co, Software Engineer, 2020 - 2024',
    'Built payment services in Java and Spring Boot exposing REST APIs.',
    'Developed customer dashboards with Vue.js and Nuxt.js.',
    'Used Claude and GitHub Copilot to generate unit tests and refactor legacy code.',
    'Maintained PostgreSQL schemas and Oracle stored procedures.',
  ].join('\n'),
  C: [
    'Synthetic Engineer',
    'Software Engineer at Example Co, 2019 - 2024',
    '• Implemented inventory REST APIs using Java and Spring Boot',
    '• Created booking pages in Vue.js',
    '• Used GitHub Copilot and Claude for code review and debugging',
    '• Designed SQL Server reporting tables',
  ].join('\n'),
  D: [
    'Synthetic Engineer',
    'Skills',
    'Languages: Java, JavaScript, TypeScript',
    'Frameworks: Spring Boot, Vue.js, Nuxt.js',
    'APIs: REST APIs',
    'Databases: PostgreSQL, Oracle, SQL Server',
    'AI tools: Claude, GitHub Copilot',
  ].join('\n'),
} as const;

const JD = {
  VI: [
    'Có kinh nghiệm sử dụng các công cụ AI như GitHub Copilot, Codex, Claude, Cursor hoặc các AI coding assistant khác trong quá trình phát triển phần mềm',
    'Có kinh nghiệm với Spring, Spring Boot hoặc các framework Java tương đương',
    'Có kinh nghiệm VueJS/NuxtJS hoặc các công nghệ frontend liên quan',
    'Có kinh nghiệm làm việc với cơ sở dữ liệu như PostgreSQL, Oracle, SQL Server',
  ],
  EN: [
    'Experience with AI coding assistants such as GitHub Copilot, Codex, Claude, Cursor, or equivalent tools',
    'Strong experience with Java, Spring, and Spring Boot',
    'Hands-on experience with RESTful APIs',
    'Experience with Vue.js',
  ],
} as const;

const job = (lines: readonly string[]) =>
  ({
    id: 'synthetic-matrix',
    title: 'Synthetic role',
    skills: lines.join('\n'),
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-18T00:00:00.000Z'),
  }) as Opportunity;

// Empty model quotes: recognition must come from deterministic CV evidence.
function assess(cv: string, lines: readonly string[]) {
  const opportunity = job(lines);
  const canonical = canonicalRequirements(opportunity);
  const jd = matchJobText(opportunity);
  const proposals = canonical.map((row) => ({ ...row, cvQuote: '' }));
  return scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
}
const row = (result: ReturnType<typeof assess>, start: string) => {
  const found = result.requirements.find((r) =>
    r.requirement.startsWith(start),
  );
  if (!found) throw new Error(`missing row ${start}`);
  return found;
};
const credited = (result: ReturnType<typeof assess>, start: string) => {
  const r = row(result, start);
  return r.status === 'EVIDENCED' || r.status === 'PARTIAL';
};

describe.each(['A', 'B', 'C', 'D'] as const)('CV %s', (name) => {
  const cv = CV[name];
  test('× Vietnamese JD: every requirement recognised with exact quotes', () => {
    const result = assess(cv, JD.VI);
    for (const start of [
      'Có kinh nghiệm sử dụng các công cụ AI',
      'Có kinh nghiệm với Spring',
      'Có kinh nghiệm VueJS',
      'Có kinh nghiệm làm việc với cơ sở dữ liệu',
    ])
      expect([start, credited(result, start)]).toEqual([start, true]);
    for (const r of result.requirements)
      for (const c of r.coverage?.components ?? [])
        if (c.cvQuote) expect(cv.includes(c.cvQuote)).toBe(true);
  });
  test('× English JD: every requirement recognised with exact quotes', () => {
    const result = assess(cv, JD.EN);
    for (const start of [
      'Experience with AI coding assistants',
      'Strong experience with Java',
      'Hands-on experience with RESTful APIs',
      'Experience with Vue.js',
    ])
      expect([start, credited(result, start)]).toEqual([start, true]);
    for (const r of result.requirements)
      for (const c of r.coverage?.components ?? [])
        if (c.cvQuote) expect(cv.includes(c.cvQuote)).toBe(true);
  });
});

describe('OR alternatives', () => {
  test('Vietnamese lead-in is stripped and the "khác" tail is not a required component', () => {
    const r = row(assess(CV.A, JD.VI), 'Có kinh nghiệm sử dụng các công cụ AI');
    const labels = r.coverage!.components.map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining(['GitHub Copilot', 'Codex', 'Claude', 'Cursor']),
    );
    expect(labels.some((l) => /như|khác/u.test(l))).toBe(false);
  });
  test('English "such as … or equivalent tools" yields the named tools only', () => {
    const r = row(assess(CV.A, JD.EN), 'Experience with AI coding assistants');
    expect(r.coverage!.components.map((c) => c.label)).toEqual([
      'GitHub Copilot',
      'Codex',
      'Claude',
      'Cursor',
    ]);
  });
});

describe('false positives stay conservative', () => {
  test('Java is not recognised from JavaScript only', () => {
    const cv =
      'Skills: JavaScript, TypeScript\nBuilt dashboards in JavaScript.';
    expect(
      credited(
        assess(cv, ['Experience with Java or Kotlin']),
        'Experience with Java',
      ),
    ).toBe(false);
  });
  test('JavaScript is not recognised from Java only', () => {
    const cv = 'Skills: Java, Kotlin\nBuilt services in Java.';
    expect(
      credited(
        assess(cv, ['Experience with JavaScript or TypeScript']),
        'Experience with JavaScript',
      ),
    ).toBe(false);
  });
  test('Spring alone does not imply Spring Boot', () => {
    const cv = 'Skills: Spring\nBuilt services with Spring MVC.';
    expect(
      credited(
        assess(cv, ['Experience with Spring Boot or Quarkus']),
        'Experience with Spring Boot',
      ),
    ).toBe(false);
  });
  test.each([
    ['English negation', 'Skills: Java\nNever used Claude or GitHub Copilot.'],
    [
      'Vietnamese negation',
      'Kỹ năng: Java\nChưa từng sử dụng Claude hoặc GitHub Copilot.',
    ],
  ])('%s is not evidence of AI tools', (_name, cv) => {
    const r = row(assess(cv, JD.VI), 'Có kinh nghiệm sử dụng các công cụ AI');
    expect(r.status === 'EVIDENCED' || r.status === 'PARTIAL').toBe(false);
  });
  test('an unrelated mention of a tool name is not evidence', () => {
    const cv =
      'Skills: Java\nReferences: Claude Monet Gallery volunteer guide.';
    const r = row(assess(cv, JD.EN), 'Experience with AI coding assistants');
    expect(r.status === 'EVIDENCED' || r.status === 'PARTIAL').toBe(false);
  });
});

test('Vietnamese work description in the CV is recognised', () => {
  const cv =
    'Kinh nghiệm làm việc\nLập trình viên, Công ty Ví Dụ (2021 - 2024)\n- Xây dựng các REST API bằng Java và Spring Boot.';
  expect(credited(assess(cv, JD.VI), 'Có kinh nghiệm với Spring')).toBe(true);
});

describe('Cursor: AI coding assistant, not a database cursor', () => {
  const jds = [
    'Experience with AI coding assistants such as GitHub Copilot, Cursor, or similar tools',
    'Có kinh nghiệm sử dụng các công cụ AI như Cursor, Claude hoặc công cụ AI tương đương',
  ];
  const credited = (cv: string, jd: string) => {
    const r = assess(cv, [jd]).requirements[0]!;
    return r.coverage!.components.find((c) => c.label === 'Cursor')!.status;
  };
  test.each([
    'Implemented server-side database cursors for paging large Oracle result sets.',
    'Built PL/SQL procedures using a cursor to batch-update orders.',
    'Skills: SQL, cursor management, indexing',
  ])('database cursor is not the Cursor tool: %s', (cv) => {
    for (const jd of jds) expect(credited(cv, jd)).toBe('NOT_EVIDENCED');
  });
  test.each([
    'Used Cursor to refactor services and generate unit tests.',
    'AI tools: Cursor, Claude',
  ])('Cursor the AI assistant is recognised: %s', (cv) => {
    for (const jd of jds) expect(credited(cv, jd)).not.toBe('NOT_EVIDENCED');
  });
  test('Claude and GitHub Copilot alternatives are unaffected', () => {
    const cv = 'Used Claude and GitHub Copilot to generate unit tests.';
    const r = assess(cv, [jds[0]!]).requirements[0]!;
    expect(r.status).toBe('EVIDENCED');
  });
});

describe('open alternatives are kept as meaning, never scored', () => {
  test.each([
    [
      'Có kinh nghiệm với Claude, Copilot hoặc công cụ AI tương đương',
      ['Claude', 'Copilot'],
      'công cụ AI tương đương',
    ],
    [
      'Có kinh nghiệm với Spring Boot hoặc framework tương đương',
      ['Spring Boot'],
      'framework tương đương',
    ],
    [
      'Experience with Cursor or similar AI coding assistants',
      ['Cursor'],
      'similar AI coding assistants',
    ],
  ])('%s', (text, labels, open) => {
    const group = requirementGroup(text, 'skill');
    expect(group.mode).toBe('OR');
    expect(group.components.map((c) => c.label)).toEqual(labels);
    expect(group.openAlternative).toBe(open);
    expect(text.includes(group.openAlternative!)).toBe(true);
  });
});
