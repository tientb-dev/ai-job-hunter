import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import {
  applicationGuidance,
  type GuidanceRow,
} from '../../src/matching/cv-match.guidance.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// The three Vietnamese JD rows that were UNDECOMPOSED in the reported match.
const FULLSTACK = 'Từ 3 năm kinh nghiệm trở lên vị trí fullstack';
const LANGUAGES =
  'Sử dụng tối thiểu 01 loại ngôn ngữ lập trình Golang/Python/Java';
const DATABASES =
  'Sử dụng ít nhất 01 hệ quản trị CSDL (My SQL, SQL Server, Oracle, Mongo, Maria)';
const UNREADABLE =
  'Experience with multiple languages such as Kotlin, Scala and Rust';

const DATED_ROLE = 'Full-stack Developer | Synthetic Co | 01/2019 - 12/2024';
const JAVA_WORK = 'Developed REST services in Java with Spring Boot.';
const DB_WORK = 'Designed MySQL schemas and migrated data to MongoDB.';
const SKILLS = 'Skills: Python, Oracle';
const CV = [DATED_ROLE, JAVA_WORK, DB_WORK, SKILLS].join('\n');

function assess(rows: string[], quotes: Record<string, string>, cv = CV) {
  const job = {
    title: 'Synthetic',
    skills: rows.join('\n'),
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: rows.join('\n'),
    postText: '',
    jdText: '',
  } as Opportunity;
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  return scoreCvMatch(
    validateMatchAssessment(
      canonical.map((r) => ({ ...r, cvQuote: quotes[r.requirement] ?? '' })),
      cv,
      jd,
      canonical,
    ),
    cv,
    jd,
    canonical,
  );
}
const row = (result: ReturnType<typeof assess>, text: string) =>
  result.requirements.find((item) => item.requirement === text)!;

describe('Vietnamese JD requirement parsing', () => {
  test('one-of language and database lists are OR groups with CV names', () => {
    const languages = requirementGroup(LANGUAGES, 'skill');
    expect(languages).toMatchObject({ mode: 'OR', demonstratedUse: true });
    expect(languages.components.map((c) => c.label)).toEqual([
      'Golang',
      'Python',
      'Java',
    ]);
    const databases = requirementGroup(DATABASES, 'experience');
    expect(databases.mode).toBe('OR');
    expect(databases.components.map((c) => [c.label, c.jdQuote])).toEqual([
      ['MySQL', 'My SQL'],
      ['SQL Server', 'SQL Server'],
      ['Oracle', 'Oracle'],
      ['MongoDB', 'Mongo'],
      ['MariaDB', 'Maria'],
    ]);
  });
  test('an unknown name in a one-of list stays unevaluated, never split', () => {
    expect(
      requirementGroup(
        'Sử dụng ít nhất 01 hệ quản trị CSDL (MySQL, FooBase)',
        'skill',
      ).mode,
    ).toBe('UNKNOWN');
  });
});

describe('Vietnamese requirements against CV evidence', () => {
  test('dated fullstack role, Java work and database work are supported', () => {
    const result = assess([FULLSTACK, LANGUAGES, DATABASES], {
      [FULLSTACK]: DATED_ROLE,
      [LANGUAGES]: JAVA_WORK,
      [DATABASES]: DB_WORK,
    });
    for (const text of [FULLSTACK, LANGUAGES, DATABASES])
      expect(row(result, text)).toMatchObject({
        status: 'EVIDENCED',
        credit: 1,
      });
    expect(result.coverageHidden).toBe('TOO_FEW_ASSESSABLE_SKILLS');
  });
  test('fullstack role without a confirmable duration is PARTIAL', () => {
    const undated = 'Full-stack Developer at Synthetic Co';
    const result = assess([FULLSTACK], { [FULLSTACK]: undated }, undated);
    expect(row(result, FULLSTACK)).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
    });
  });
  test('a fullstack role shorter than the minimum is PARTIAL, not met', () => {
    const short = 'Full-stack Developer | Synthetic Co | 01/2023 - 12/2023';
    const result = assess([FULLSTACK], { [FULLSTACK]: short }, short);
    expect(row(result, FULLSTACK).status).toBe('PARTIAL');
  });
  test('skills-list-only database names are PARTIAL, not met or zero', () => {
    const cv = [DATED_ROLE, JAVA_WORK, SKILLS].join('\n');
    const result = assess([DATABASES], { [DATABASES]: SKILLS }, cv);
    expect(row(result, DATABASES)).toMatchObject({
      status: 'PARTIAL',
      credit: 0.5,
    });
  });
});

describe('fullstack duration across several roles', () => {
  const run = (cv: string) =>
    row(assess([FULLSTACK], { [FULLSTACK]: cv.split('\n')[0]! }, cv), FULLSTACK)
      .status;
  test('separate dated fullstack roles add up', () => {
    expect(
      run(
        'Fullstack Engineer | A Co | 01/2018 - 12/2019\nFull Stack Developer | B Co | 01/2021 - 12/2021',
      ),
    ).toBe('EVIDENCED');
  });
  test('overlapping periods are counted once', () => {
    // 24 + 12 months summed would reach 36; the union is only 24.
    expect(
      run(
        'Fullstack Engineer | A Co | 01/2021 - 12/2022\nFullstack Contractor | B Co | 01/2022 - 12/2022',
      ),
    ).toBe('PARTIAL');
  });
  test('undated or unrelated records add nothing', () => {
    expect(
      run(
        'Fullstack Engineer | A Co | 01/2022 - 12/2023\nFullstack Developer at B Co\nBackend Developer | C Co | 01/2016 - 12/2021',
      ),
    ).toBe('PARTIAL');
  });
});

describe('Go and Golang are one language', () => {
  const run = (line: string) =>
    row(assess([LANGUAGES], { [LANGUAGES]: line }, line), LANGUAGES).status;
  test.each(['Developed payment services in Go.', 'Built APIs in Golang.'])(
    'work in Go satisfies Golang: %s',
    (line) => expect(run(line)).toBe('EVIDENCED'),
  );
  test.each([
    'Developed a Go-to-market dashboard for sales.',
    'Developed Google Ads integrations.',
    'Developed tools we go back to daily.',
    'Developed MongoDB pipelines.',
  ])('no false positive: %s', (line) =>
    expect(run(line)).not.toBe('EVIDENCED'),
  );
});

describe('Vietnamese CV work evidence', () => {
  const run = (line: string, cv = line) =>
    row(assess([LANGUAGES], { [LANGUAGES]: line }, cv), LANGUAGES).status;
  test.each([
    'Sử dụng Java trong dự án quản lý kho cho khách hàng bán lẻ.',
    'Phát triển API bằng Python cho hệ thống thanh toán.',
    'Xây dựng dịch vụ Golang tại công ty Synthetic.',
  ])('explicit professional use is evidence: %s', (line) =>
    expect(run(line)).toBe('EVIDENCED'),
  );
  test.each([
    'Kỹ năng: Java, Python, Golang',
    'Ngôn ngữ: Java',
    'Java, Python',
    'Chưa sử dụng Java trong dự án thực tế.',
    'Đang học Java để sử dụng trong dự án sau này.',
    'Sử dụng Java thành thạo.',
  ])('no professional use: %s', (line) =>
    expect(run(line)).not.toBe('EVIDENCED'),
  );
});

describe('scoring excludes rows the system could not evaluate', () => {
  test('UNDECOMPOSED is listed but not in earned or possible weight', () => {
    const result = assess(
      [LANGUAGES, DATABASES, FULLSTACK, UNREADABLE, 'Docker'],
      {
        [LANGUAGES]: JAVA_WORK,
        [DATABASES]: DB_WORK,
        [FULLSTACK]: DATED_ROLE,
      },
    );
    expect(row(result, UNREADABLE).status).toBe('UNDECOMPOSED');
    expect(row(result, 'Docker')).toMatchObject({ status: 'NOT_EVIDENCED' });
    // Java applied, MongoDB migration applied plus, and no Docker.
    expect(result.score).toBe(Math.round((75 + 85) / 3));
    expect(result.coverageHidden).toBeNull();
    expect(result.evaluability).toMatchObject({ total: 5, evaluated: 4 });
    expect(result.guidance?.confidence).toBe('NORMAL');
  });
  test('only unreadable rows: no score, LOW guidance kept', () => {
    const result = assess([UNREADABLE], {});
    expect(result.score).toBeNull();
    expect(result.evaluability).toMatchObject({ evaluated: 0, low: true });
    expect(result.guidance?.confidence).toBe('LOW');
    expect(result.guidance?.actions[0]?.code).toBe('REVIEW_REQUIREMENT');
  });
});

describe('confidence follows required-item evaluability', () => {
  const rows = (unread: number, total = 7): GuidanceRow[] =>
    Array.from({ length: total }, (_, i) => ({
      requirement: `Requirement ${i}`,
      priority: 'required',
      status: i < unread ? 'UNDECOMPOSED' : 'EVIDENCED',
      credit: i < unread ? 0 : 1,
      cvQuote: i < unread ? '' : 'Developed services.',
      group: {
        mode: 'SINGLE',
        context: 'skill',
        components: [{ id: 'c1', label: `R${i}`, jdQuote: `R${i}` }],
      },
      components: [],
    }));
  test('one unread required row among seven stays NORMAL', () => {
    expect(applicationGuidance(rows(1)).confidence).toBe('NORMAL');
  });
  test('two of seven required rows unread is LOW', () => {
    expect(applicationGuidance(rows(2)).confidence).toBe('LOW');
  });
  test('no evaluable rows is LOW with low evaluability', () => {
    const guidance = applicationGuidance(rows(7));
    expect(guidance.confidence).toBe('LOW');
    expect(guidance.evaluability.low).toBe(true);
  });
});
