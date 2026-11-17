import { expect, test } from '@jest/globals';
import { withSourceFields } from '../../src/opportunities/job-url-import.js';

// Synthetic JDs shaped like real TopCV / VietnamWorks / ITviec imports that the
// no-AI parser fragmented. No real postings or personal data.
const parse = (lines: string[]) => {
  const { fields } = withSourceFields({ sourceText: lines.join('\n') });
  const get = (name: string) =>
    (fields.find((row) => row.field === name)?.value ?? '')
      .split('\n')
      .filter(Boolean);
  return { skills: get('skills'), preferred: get('preferredSkills') };
};

test('Sales: wrapped bullet lines rejoin and sub-headings are dropped', () => {
  const { skills } = parse([
    'Job title: Synthetic Business Development Executive',
    'Yêu cầu ứng viên',
    '1. EDUCATION & KNOWLEDGE',
    "- Bachelor's degree in Marketing, Business or a related field",
    '2. EXPERIENCE & SKILLS',
    '- Strong network with Marketing Managers at FMCG, Beauty or Fashion',
    'brands, including past clients who could re-sign',
    '- Good English communication',
    'Requirements:',
    'REQUIREMENTS',
    '- Self-motivated, sales acumen, negotiating skills and can work independently.',
    'Quyền lợi được hưởng',
    '- Lương thưởng hấp dẫn',
  ]);
  expect(skills).toEqual([
    "Bachelor's degree in Marketing, Business or a related field",
    'Strong network with Marketing Managers at FMCG, Beauty or Fashion brands, including past clients who could re-sign',
    'Good English communication',
    'Self-motivated, sales acumen, negotiating skills and can work independently',
  ]);
});

test('Marketing: prose is not split at commas and "Ưu tiên …:" opens preferred', () => {
  const { skills, preferred } = parse([
    'Yêu cầu ứng viên',
    'Hiểu thuật toán phân phối nội dung Facebook, đặc biệt là Facebook Reels.',
    'Thành thạo Meta Business Suite và các công cụ quản lý Fanpage.',
    'Ưu tiên đặc biệt:',
    'Có kinh nghiệm xây dựng Fanpage hướng đến người dùng quốc tế.',
    'Quyền lợi được hưởng',
  ]);
  expect(skills).toEqual([
    'Hiểu thuật toán phân phối nội dung Facebook, đặc biệt là Facebook Reels',
    'Thành thạo Meta Business Suite và các công cụ quản lý Fanpage',
  ]);
  expect(preferred).toEqual([
    'Có kinh nghiệm xây dựng Fanpage hướng đến người dùng quốc tế',
  ]);
});

test('Marketing: TopCV label rows and title-case headings are not requirements', () => {
  const { skills } = parse([
    'Yêu cầu ứng viên',
    'Giới tính',
    'Độ tuổi',
    '22 - 35 tuổi',
    'Bằng cấp',
    'Cao đẳng/ Đại Học',
    'Kỹ năng',
    '- Sử dụng thành thạo CapCut',
    'Thái độ',
    '- Chuyên nghiệp, tự tin',
    'Yêu cầu khác',
    '- Có laptop',
  ]);
  expect(skills).toEqual([
    'Cao đẳng/ Đại Học',
    'Sử dụng thành thạo CapCut',
    'Chuyên nghiệp, tự tin',
    'Có laptop',
  ]);
});

test('IT: clear short technology lists still split', () => {
  const { skills } = parse([
    'Requirements',
    '- Java, Spring Boot, Kafka',
    '- Thành thạo Docker, Kubernetes',
  ]);
  expect(skills).toEqual([
    'Java',
    'Spring Boot',
    'Kafka',
    'Docker',
    'Kubernetes',
  ]);
});
