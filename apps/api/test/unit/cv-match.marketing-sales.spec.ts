import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import {
  requirementHeading,
  sectionCandidates,
} from '../../src/opportunities/job-import.sections.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures modeled on real Marketing/Sales failures: English or
// Vietnamese JDs, Vietnamese CVs with PDF bullet glyphs ("").
const job = (skills: string, preferredSkills = ''): Opportunity =>
  ({
    title: 'Role',
    skills,
    preferredSkills,
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
  }) as unknown as Opportunity;

// Model output shaped like Gemini's: parent quote plus every server component.
function assess(
  saved: Opportunity,
  cv: string,
  quotes: Record<string, string>,
) {
  const canonical = canonicalRequirements(saved);
  const jd = matchJobText(saved);
  const proposals: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: quotes[row.requirement] ?? '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quotes[c.label] ?? '',
      }),
    ),
  }));
  const result = scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  );
  return Object.fromEntries(
    result.requirements.map((r) => [r.requirement, r.status]),
  );
}

describe('section headings in saved requirements', () => {
  test.each([
    'EDUCATION & KNOWLEDGE',
    '2. EXPERIENCE & SKILLS',
    'PERSONAL ATTRIBUTES / BEHAVIOR / ATTITUDES',
    'YÊU CẦU KỸ NĂNG:',
  ])('"%s" is a heading', (line) =>
    expect(requirementHeading(line)).toBe(true),
  );
  test.each(['AWS, SQL', 'CI/CD', 'SEO', 'Good English communication'])(
    '"%s" is not a heading',
    (line) => expect(requirementHeading(line)).toBe(false),
  );

  const skills = [
    'EDUCATION & KNOWLEDGE',
    "- Bachelor's degree in Marketing, Business or a related field",
    'EXPERIENCE & SKILLS',
    '- Strong network with Marketing Managers at FMCG, Beauty or Fashion',
    'brands',
    'including past clients who could re-sign',
    '- Good English communication',
  ].join('\n');

  test('headings are dropped and a PDF line wrap is one verbatim requirement', () => {
    const saved = job(skills);
    const rows = canonicalRequirements(saved);
    expect(rows.map((r) => r.requirement)).toEqual([
      "Bachelor's degree in Marketing, Business or a related field",
      'Strong network with Marketing Managers at FMCG, Beauty or Fashion brands including past clients who could re-sign',
      'Good English communication',
    ]);
    const jd = matchJobText(saved);
    for (const row of rows) expect(jd).toContain(row.jdQuote);
  });

  test('the importer does not turn sub-headings into requirements', () => {
    const values = sectionCandidates(
      `Requirements\n1. EDUCATION & KNOWLEDGE\n- Bachelor's degree in Business\n2. EXPERIENCE & SKILLS\n- Experience using HubSpot CRM`,
      'jd',
    ).map((c) => c.value);
    expect(values.some((v) => requirementHeading(v))).toBe(false);
    expect(values.join('\n')).toContain('HubSpot');
  });
});

describe('Vietnamese CV evidence for English/Vietnamese requirements', () => {
  const marketingCv = [
    'TÓM TẮT',
    '3 năm kinh nghiệm triển khai digital marketing cho thương mại điện tử.',
    'KINH NGHIỆM LÀM VIỆC',
    ' Lập kế hoạch và triển khai 12 chiến dịch quảng cáo Meta Ads và Google Ads.',
    'HỌC VẤN',
    'Cử nhân Quản trị Kinh doanh | Đại học Ví Dụ | 2017 – 2021',
  ].join('\n');
  const summary = marketingCv.split('\n')[1]!;
  const ads = marketingCv.split('\n')[3]!;
  const experience =
    'Có từ 1-2 năm kinh nghiệm ở vị trí Performance Marketing OR Digital Marketing';
  const adsRequirement = 'Kinh nghiệm triển khai Meta Ads OR Google Ads';
  const degree = "Bachelor's degree in Marketing, Business or a related field";

  test('explicit Vietnamese experience, ad tools and a business degree are credited', () => {
    expect(
      assess(
        job([experience, adsRequirement, degree].join('\n')),
        marketingCv,
        {
          [experience]: summary,
          'Digital Marketing': summary,
          'Google Ads': ads,
          [degree]: marketingCv.split('\n')[5]!,
        },
      ),
    ).toEqual({
      [experience]: 'EVIDENCED',
      [adsRequirement]: 'EVIDENCED',
      [degree]: 'EVIDENCED',
    });
  });

  test('a duration below the stated minimum is not credited', () => {
    const longer = experience.replace('1-2', '5-6');
    expect(
      assess(job(longer), marketingCv, {
        [longer]: summary,
        'Digital Marketing': summary,
      }),
    ).toEqual({ [longer]: 'NOT_EVIDENCED' });
  });

  test('negated Vietnamese evidence is not credited', () => {
    const cv = 'KỸ NĂNG\n Chưa từng triển khai Google Ads.';
    expect(
      assess(job(adsRequirement), cv, { 'Google Ads': cv.split('\n')[1]! }),
    ).toEqual({ [adsRequirement]: 'NOT_EVIDENCED' });
  });

  test('an unrelated degree is still not credited', () => {
    const cv = 'HỌC VẤN\nCử nhân Ngôn ngữ Anh | Đại học Ví Dụ | 2017 – 2021';
    expect(assess(job(degree), cv, { [degree]: cv.split('\n')[1]! })).toEqual({
      [degree]: 'NOT_EVIDENCED',
    });
  });
});

describe('threshold wording is not an alternative', () => {
  test('"or more" keeps one requirement', () => {
    expect(
      requirementGroup(
        'Track record of closing contracts worth VND 1 billion or more',
        'skill',
      ).mode,
    ).toBe('SINGLE');
  });
});

describe('per-contract deal size is not aggregate revenue', () => {
  const deal = 'Track record of closing contracts worth VND 1 billion or more';
  const target =
    'Proven record of achieving monthly revenue target of 1,500,000,000 VND';
  const check = (requirement: string, line: string) =>
    assess(job(requirement), `KINH NGHIỆM\n${line}`, { [requirement]: line })[
      requirement
    ];

  test.each([
    // Markus case: annual revenue across 24 contracts says nothing per contract.
    '\uf0b7 Đạt doanh thu 2.400.000.000 VND trong năm 2025, tương đương 109% chỉ tiêu cá nhân; ký mới 24 hợp đồng B2B.',
    '- Generated VND 3 billion in annual revenue from 30 new contracts.',
    '- Closed a contract worth VND 500 million with a retail chain.',
    '- Never closed a contract worth VND 2 billion.',
  ])('not credited: %s', (line) =>
    expect(check(deal, line)).toBe('NOT_EVIDENCED'),
  );

  test.each([
    '- Closed a contract worth VND 1.5 billion with an FMCG brand.',
    '\uf0b7 Ký hợp đồng trị giá 1,2 tỷ VND với khách hàng FMCG.',
    '- Signed 3 contracts, the largest contract valued at VND 2,000,000,000.',
  ])('credited: %s', (line) => expect(check(deal, line)).toBe('EVIDENCED'));

  // An annual figure is not a monthly target; an active verb alone no longer
  // credits whole-sentence prose, so the row needs review instead.
  test('an annual revenue figure does not prove a monthly target', () => {
    expect(
      check(
        target,
        '\uf0b7 Đạt doanh thu 2.400.000.000 VND trong năm 2025, tương đương 109% chỉ tiêu cá nhân.',
      ),
    ).toBe('UNDECOMPOSED');
  });
});

// Synthetic Vietnamese Marketing CV against an English JD (browser QA, PR #104).
describe('Vietnamese CV skills list and years against an English JD', () => {
  const cv = [
    'Tóm tắt',
    '',
    'Chuyên viên Marketing với 5 năm kinh nghiệm.',
    '',
    'Kỹ năng',
    '',
    'SEO, Google Ads, Facebook Ads, Content Marketing, Google Analytics',
  ].join('\n');
  const list =
    'SEO, Google Ads, Facebook Ads, Content Marketing, Google Analytics';

  test('an unlabelled skills list supports "Proficient in X"', () => {
    expect(
      assess(job('- Proficient in Google Analytics'), cv, {
        'Proficient in Google Analytics': list,
      })['Proficient in Google Analytics'],
    ).toBe('EVIDENCED');
  });
  test('an omitted quote is recovered from the same skills list', () => {
    expect(
      assess(job('- Proficient in Google Analytics'), cv, {})[
        'Proficient in Google Analytics'
      ],
    ).toBe('EVIDENCED');
  });
  test('a skills list is recognised for an experience row, use not shown', () => {
    expect(
      assess(job('- Experience with Google Analytics'), cv, {
        'Experience with Google Analytics': list,
      })['Experience with Google Analytics'],
    ).toBe('PARTIAL');
  });
  test('"N năm" satisfies a minimum-years row, and fewer years do not', () => {
    const years = (quote: string, text = cv) =>
      Object.values(
        assess(
          { ...job(''), experience: 'Minimum 3 years' } as Opportunity,
          text,
          { 'Minimum 3 years': quote },
        ),
      )[0];
    expect(years('Chuyên viên Marketing với 5 năm kinh nghiệm.')).toBe(
      'EVIDENCED',
    );
    expect(
      years(
        'Chuyên viên Marketing với 2 năm kinh nghiệm.',
        'Chuyên viên Marketing với 2 năm kinh nghiệm.',
      ),
    ).toBe('NOT_EVIDENCED');
  });
});

describe('Vietnamese result verbs', () => {
  test('"Tăng … qua email marketing" evidences the email-marketing component only', () => {
    const cv =
      'Kinh nghiệm\n\n• Tăng tỷ lệ chuyển đổi 12% qua email marketing.';
    const quote = '• Tăng tỷ lệ chuyển đổi 12% qua email marketing.';
    const status = assess(
      job('- Email marketing and conversion rate optimization experience'),
      cv,
      {
        'Email marketing and conversion rate optimization experience': quote,
        'Email marketing': quote,
        'conversion rate optimization experience': quote,
      },
    )['Email marketing and conversion rate optimization experience'];
    // The English CRO phrase has no literal match; never a full match by translation.
    expect(status).toBe('PARTIAL');
  });
});
