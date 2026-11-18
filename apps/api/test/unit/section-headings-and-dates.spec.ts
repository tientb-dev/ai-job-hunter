import { describe, expect, test } from '@jest/globals';
import { requirementLines } from '../../src/opportunities/job-import.sections.js';
import { recordMonths } from '../../src/matching/cv-match.coverage.js';

const scored = (text: string) =>
  requirementLines(text)
    .filter((row) => !row.excluded && row.kind)
    .map((row) => [row.line.replace(/^[-*•]\s*/u, ''), row.kind]);

describe('JD section headings are structure, not requirements', () => {
  test.each([
    'Yêu cầu bắt buộc',
    'Yêu cầu ứng viên',
    'Yêu cầu công việc:',
    'Must have',
    'Must-have:',
  ])('"%s" opens the required section', (heading) => {
    const jd = `Mô tả công việc\n* Phát triển API\n${heading}\n* 3+ năm kinh nghiệm Java\n* Hiểu Docker\nĐiểm cộng\n* Kafka`;
    expect(scored(jd)).toEqual([
      ['3+ năm kinh nghiệm Java', 'skills'],
      ['Hiểu Docker', 'skills'],
      ['Kafka', 'preferredSkills'],
    ]);
  });
  test('the heading after "Requirements:" is not scored and bullets stay required', () => {
    const jd =
      'Requirements:\nYêu cầu bắt buộc\n* Thành thạo Java 11+.\n* Tiếng Anh giao tiếp tốt.\nĐiểm cộng\n* Đã làm Team Lead';
    expect(scored(jd)).toEqual([
      ['Thành thạo Java 11+.', 'skills'],
      ['Tiếng Anh giao tiếp tốt.', 'skills'],
      ['Đã làm Team Lead', 'preferredSkills'],
    ]);
  });
  test('genuine requirements containing "bắt buộc" or "must have" are kept', () => {
    const jd =
      'Yêu cầu bắt buộc\n* Bắt buộc có chứng chỉ kế toán trưởng\n* Must have a valid driving licence\n* Yêu cầu bắt buộc: tiếng Nhật N2';
    expect(scored(jd)).toEqual([
      ['Bắt buộc có chứng chỉ kế toán trưởng', 'skills'],
      ['Must have a valid driving licence', 'skills'],
      ['Yêu cầu bắt buộc: tiếng Nhật N2', 'skills'],
    ]);
  });
});

describe('work-record date ranges (general, any profession)', () => {
  const today = new Date(2026, 7, 15); // Aug 2026
  const months = (header: string) =>
    recordMonths(
      '- Managed accounts payable.',
      `${header}\n- Managed accounts payable.`,
      today,
    );
  test.each([
    ['numeric', 'Accountant | Example Co | 03/2020 - 08/2026', 78],
    [
      'abbreviated English',
      'Accountant | Example Co | Mar 2020 – Aug 2026',
      78,
    ],
    ['abbreviated with dot', 'Accountant | Sept. 2021 - Jan. 2022', 5],
    ['full English', 'Nurse | January 2021 to December 2022', 24],
    ['Vietnamese tháng N/YYYY', 'Kế toán | tháng 3/2020 - tháng 8/2026', 78],
    [
      'Vietnamese tháng N năm YYYY',
      'Kế toán | Tháng 3 năm 2020 đến tháng 2 năm 2021',
      12,
    ],
    ['ongoing English', 'Teacher | Feb 2025 - Present', 19],
    ['ongoing Vietnamese', 'Giáo viên | tháng 2/2025 - hiện tại', 19],
    ['mixed month name and year-only end', 'Sales | May 2020 - 2021', 9],
    ['year-only stays shortest span', 'Sales | 2021 - 2023', 14],
  ])('%s', (_, header, expected) => {
    expect(months(header)).toBe(expected);
  });
  test.each([
    ['invalid numeric month', 'Accountant | 13/2020 - 08/2026'],
    ['invalid Vietnamese month', 'Kế toán | tháng 13/2020 - tháng 8/2026'],
    ['end before start', 'Accountant | Aug 2026 - Mar 2020'],
    ['missing dates', 'Accountant | Example Co'],
    ['unknown month word', 'Accountant | Spring 2020 - Fall 2021'],
  ])('%s gives no duration', (_, header) => {
    expect(months(header)).toBeNull();
  });
  test('an undated project never borrows the enclosing role dates', () => {
    const cv =
      'Developer | Example Co | Jan 2019 - Dec 2023\nProject: Billing\n- Built billing jobs.';
    expect(recordMonths('- Built billing jobs.', cv, today)).toBeNull();
  });
  test('each record keeps its own dates; overlapping records are not summed', () => {
    const cv = [
      'Project: A | Mar 2020 - Aug 2020',
      '- Built reports.',
      '',
      '',
      'Project: B | Jun 2020 - Dec 2020',
      '- Built dashboards.',
    ].join('\n');
    expect(recordMonths('- Built reports.', cv, today)).toBe(6);
    expect(recordMonths('- Built dashboards.', cv, today)).toBe(7);
  });
});
