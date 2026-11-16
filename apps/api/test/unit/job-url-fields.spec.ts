import { expect, test } from '@jest/globals';
import { withSourceFields } from '../../src/opportunities/job-url-import.js';

const value = (fields: { field: string; value: string }[], name: string) =>
  fields.find((row) => row.field === name)?.value ?? '';

test('fetched JD gets source-quoted field suggestions without AI; list numbers are not skills', () => {
  const sourceText = [
    'Job title: Synthetic Sales Executive',
    'Company: Synthetic Co',
    'Mô tả công việc',
    'Tìm kiếm khách hàng mới.',
    'Yêu cầu ứng viên',
    '1. Tối thiểu 2 năm kinh nghiệm bán hàng B2B.',
    '8. Am hiểu thị trường ô tô.',
    'Ưu tiên',
    'Biết tiếng Anh giao tiếp.',
    'Quyền lợi được hưởng',
    'Lương cơ bản 10 - 15M.',
  ].join('\n');
  const { fields, sourceText: kept } = withSourceFields({ sourceText });
  expect(kept).toBe(sourceText);
  const skills = value(fields, 'skills').split('\n');
  expect(skills).toEqual(
    expect.arrayContaining([
      expect.stringContaining('Am hiểu thị trường ô tô'),
    ]),
  );
  expect(skills.some((line) => /^\d+[.)]?$/u.test(line))).toBe(false);
  expect(value(fields, 'skills')).not.toContain('Lương');
  expect(value(fields, 'preferredSkills')).toContain('tiếng Anh');
  // Every suggestion is quoted from the source text.
  for (const row of fields)
    for (const candidate of row.candidates)
      expect(sourceText).toContain(candidate.quote);
});
