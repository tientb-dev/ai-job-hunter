import { expect, test } from '@jest/globals';
import { assessConditions } from '../../src/matching/cv-match.conditions.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

const technical = 'Java\nDocker\nKotlin';
const skills = 'Skills: Java, Docker, Kotlin';
function assess(requirement: string, cv: string) {
  const job = {
    title: 'Synthetic Engineer',
    skills: requirement,
    preferredSkills: '',
    experience: '',
    domain: '',
    description: '',
    postText: '',
    jdText: '',
  } as Opportunity;
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  return new MatchingService().matchSavedCv([], cv, jd, canonical);
}

test.each([
  ['English B2', 'Languages: English C1', 'MET'],
  ['English B2', 'English: A2', 'NOT_MET'],
  ['English B2', 'English: conversational', 'UNKNOWN'],
  ['English B2', 'English: B2\nEnglish: A2', 'UNKNOWN'],
  ['English B2', 'IELTS 8', 'UNKNOWN'],
  ['Fluent in French', 'French: fluent', 'MET'],
  ['IELTS 7.0', 'IELTS 7.5', 'MET'],
  ['IELTS 7.0', 'IELTS 6.5', 'NOT_MET'],
  ['IELTS 7.0', 'IELTS 8 practice test', 'UNKNOWN'],
  ['IELTS 7.0', 'English C2', 'UNKNOWN'],
  ['JLPT N2', 'JLPT N1', 'MET'],
  ['Minimum 4 years', '5 years of professional experience', 'MET'],
  ['Minimum 4 years', '2 years of professional experience', 'NOT_MET'],
  ['Minimum 4 years', '2+ years of professional experience', 'UNKNOWN'],
  ['Minimum 4 years', '5 years of experience with Kotlin', 'UNKNOWN'],
  ['3+ years working with Kotlin', '4 years of experience with Kotlin', 'MET'],
  ['Kotlin (3 years)', '2 years of Kotlin experience', 'NOT_MET'],
  [
    'Kotlin (3 years)',
    '7 years of experience with Java\nSkills: Kotlin',
    'UNKNOWN',
  ],
  [
    'Kotlin (3 years)',
    'Project A (2020–2022): Kotlin\nProject B (2021–2023): Kotlin',
    'UNKNOWN',
  ],
  [
    "Bachelor's degree in Computer Science",
    "Education: Bachelor's degree in Computer Science",
    'MET',
  ],
  [
    "Bachelor's degree in Computer Science",
    'Highest completed degree: Associate degree in Computer Science',
    'NOT_MET',
  ],
  [
    "Bachelor's degree in Computer Science",
    "Bachelor's degree in Physics",
    'UNKNOWN',
  ],
  [
    "Bachelor's degree in Computer Science",
    "Bachelor's degree in Computer Science\nStatus: pending",
    'UNKNOWN',
  ],
  ['PMP certification', 'Certifications: PMP', 'MET'],
  ['PMP certification', 'PMP course in progress', 'UNKNOWN'],
  ['PMP certification', skills, 'UNKNOWN'],
])('%s with %j yields %s', (requirement, cv, status) => {
  const { conditions } = assess(requirement, cv);
  expect(conditions).toHaveLength(1);
  expect(conditions[0]).toMatchObject({ jdQuote: requirement, status });
  if (status !== 'UNKNOWN')
    expect(conditions[0]?.evidence.length).toBeGreaterThan(0);
  for (const { cvQuote, start, end } of conditions[0]?.evidence ?? []) {
    expect(cv.slice(start, end)).toBe(cvQuote);
  }
});

test('conditions preserve Coverage score and confidence across all outcomes', () => {
  const base = assess(technical, skills);
  for (const level of ['B2', 'A1', 'conversational']) {
    const result = assess(
      `${technical}\nEnglish B2`,
      `${skills}\nEnglish: ${level}`,
    );
    expect(result).toMatchObject({
      score: base.score,
      coverageHidden: base.coverageHidden,
    });
  }
  expect(base).toMatchObject({ score: 40, coverageHidden: null });
  expect(assess('Java\nDocker\nEnglish B2', skills)).toMatchObject({
    score: null,
    coverageHidden: 'TOO_FEW_ASSESSABLE_SKILLS',
  });
});

test('mixed parent preserves Kotlin Coverage and the original language component', () => {
  const result = assess(
    'Java\nDocker\nExperience with Kotlin and French',
    skills,
  );
  expect(result).toMatchObject({
    score: 40,
    coverageHidden: null,
    conditions: [
      {
        kind: 'LANGUAGE',
        mode: 'AND',
        jdQuote: 'French',
        status: 'UNKNOWN',
        evidence: [],
      },
    ],
  });
});

test('the saved-match contract adds conditions to the existing scorer output', () => {
  const cv = `${skills}\nFrench: fluent`;
  const canonical = [
    {
      requirement: 'Fluent in French',
      jdQuote: 'Fluent in French',
      priority: 'required' as const,
      category: 'skill' as const,
      cvQuote: '',
    },
  ];
  const jd = 'Fluent in French';
  expect(new MatchingService().matchSavedCv([], cv, jd, canonical)).toEqual({
    ...scoreCvMatch([], cv, jd, canonical),
    conditions: [expect.objectContaining({ status: 'MET', kind: 'LANGUAGE' })],
  });
});

test.each([
  ['5+ years of Java', '3 years of Java', 'NOT_MET'],
  ['5+ years of Java', 'Java, Spring Boot', 'UNKNOWN'],
  ['English fluent', 'IELTS 8.0', 'UNKNOWN'],
  ['5+ years of Java', '3+ years of Java', 'UNKNOWN'],
  ['5+ years of Java', '3 years of Kotlin', 'UNKNOWN'],
])(
  'CP5 acceptance: %s with %s yields %s and preserves Coverage',
  (jd, evidence, status) => {
    const cv = `${skills}\n\n${evidence}`;
    const baseline = assess(technical, cv);
    const result = assess(`${technical}\n${jd}`, cv);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0]).toMatchObject({ jdQuote: jd, status });
    if (status === 'NOT_MET')
      expect(result.conditions[0]?.evidence).toEqual([
        { cvQuote: evidence, start: skills.length + 2, end: cv.length },
      ]);
    expect(baseline).toMatchObject({ score: 40, coverageHidden: null });
    expect(result).toMatchObject({
      score: baseline.score,
      coverageHidden: baseline.coverageHidden,
    });
  },
);

test.each(['Completed', 'Pending'])(
  'reviewed qualification retains the source span (%s)',
  (status) => {
    const quote = `Qualification: Bachelor's degree in Computer Science`;
    const cv = `Education\n${quote}\nStatus: ${status}`;
    const result = assess("Bachelor's degree in Computer Science", cv);
    const pending = status === 'Pending';
    expect(result.conditions[0]).toMatchObject({
      status: pending ? 'UNKNOWN' : 'MET',
      evidence: [
        {
          cvQuote: pending ? cv.slice(cv.indexOf(quote)) : quote,
          start: cv.indexOf(quote),
          end: pending ? cv.length : cv.indexOf(quote) + quote.length,
        },
      ],
    });
  },
);

test('uses reviewed education and the union of explicitly dated development roles', async () => {
  const { reviewedCvText } =
    await import('../../src/reviewed-cv/reviewed-cv.text.js');
  const { assessConditions } =
    await import('../../src/matching/cv-match.conditions.js');
  const education =
    'Học vấn: Tốt nghiệp Đại học chuyên ngành Công nghệ thông tin';
  const years = (n: number) =>
    `Có trên ${n} năm kinh nghiệm thực tế trong lĩnh vực lập trình và phát triển phần mềm`;
  const labels = [
    education,
    years(1),
    years(8),
    '3 years of experience with Kotlin',
  ];
  const jd = labels.join('\n');
  const review = reviewedCvText(
    [
      [
        'education',
        'qualification',
        'Bachelor’s degree in Information Technology',
        'school',
      ],
      ['experience', 'role', 'Software developer', 'first'],
      ['experience', 'dates', 'Jan 2014 – Jun 2020', 'first'],
      ['experience', 'role', 'Web developer', 'second'],
      ['experience', 'dates', 'Jan 2016 – Jun 2020', 'second'],
    ].map(([kind, field, value, id], i) => ({
      sectionKind: kind as 'experience' | 'education',
      field: field as 'role' | 'dates' | 'qualification',
      value: value!,
      entryId: id!,
      sectionId: kind!,
      id: String(i),
      confirmation: 'field',
      origin: 'source',
      evidence: [],
    })),
  );
  const canonical = canonicalRequirements({
    skills: jd,
    preferredSkills: '',
    experience: '',
    domain: '',
    description: '',
    jdText: '',
    postText: '',
  } as Opportunity);
  const result = assessConditions(canonical, jd, review.text, review);
  expect(result.map((c) => [c.kind, c.status])).toEqual([
    ['EDUCATION', 'MET'],
    ['EXPERIENCE', 'MET'],
    ['EXPERIENCE', 'UNKNOWN'],
    ['EXPERIENCE', 'UNKNOWN'],
  ]);
  expect(result[2]?.reason).toBe('DATED_PROGRAMMING');
});

test.each(['NONE', 'UNDATED', 'DATED'] as const)(
  'explains scoped UNKNOWN with %s reviewed evidence',
  (evidence) => {
    const requirement = '5 years of experience in Java Full Stack development';
    const cv =
      'Dates: Jan 2024 – Jan 2025\nBuilt full-stack applications with Java.';
    const start = cv.indexOf('\n') + 1;
    const work = {
      sectionKind: 'experience' as const,
      entryId: 'synthetic',
      origin: 'user_entered' as const,
    };
    const conditions = assessConditions(
      [
        {
          requirement,
          jdQuote: requirement,
          cvQuote: '',
          priority: 'required',
          category: 'experience',
        },
      ],
      requirement,
      cv,
      {
        text: cv,
        lines: [
          ...(evidence === 'NONE'
            ? []
            : [{ ...work, factId: 'work', start, end: cv.length }]),
          ...(evidence === 'DATED'
            ? [
                {
                  ...work,
                  factId: 'dates',
                  field: 'dates' as const,
                  start: 0,
                  end: start - 1,
                },
              ]
            : []),
        ],
      },
    );
    expect(conditions).toEqual([
      expect.objectContaining({
        status: 'UNKNOWN',
        unknownExperience: { evidence, years: 5, javaFullStack: true },
      }),
    ]);
  },
);
