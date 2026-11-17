import { afterEach, expect, test } from 'vitest';
import { setLocale } from '../src/app/i18n';
import {
  categoryLabel,
  decodeJobQuestionSets,
  type JobFamily,
} from '../src/features/interview-prep/job-interview-api';

afterEach(() => setLocale('en-US'));

const SLOTS = [
  'skill',
  'architecture',
  'troubleshooting',
  'experience',
] as const;

test('each family labels the shared category IDs for its own field (en-US and vi-VN)', () => {
  setLocale('en-US');
  const en = (f: JobFamily) => SLOTS.map((c) => categoryLabel(f, c));
  expect(en('it')).toEqual([
    'Technical skill',
    'Architecture and design',
    'Troubleshooting',
    'Technical experience',
  ]);
  expect(en('marketing')).toEqual([
    'Marketing skill',
    'Strategy and planning',
    'Campaign problem-solving',
    'Marketing experience',
  ]);
  expect(en('sales')).toEqual([
    'Sales skill',
    'Sales strategy',
    'Handling objections',
    'Sales experience',
  ]);
  expect(en('other')).toEqual([
    'Role skill',
    'Approach and planning',
    'Problem-solving',
    'Relevant experience',
  ]);
  setLocale('vi-VN');
  expect(SLOTS.map((c) => categoryLabel('marketing', c))).toEqual([
    'Kỹ năng marketing',
    'Chiến lược và lập kế hoạch',
    'Xử lý vấn đề chiến dịch',
    'Kinh nghiệm marketing',
  ]);
  expect(SLOTS.map((c) => categoryLabel('sales', c))).toEqual([
    'Kỹ năng bán hàng',
    'Chiến lược bán hàng',
    'Xử lý phản đối của khách hàng',
    'Kinh nghiệm bán hàng',
  ]);
  expect(categoryLabel('other', 'troubleshooting')).toBe('Giải quyết vấn đề');
});

test('the decoder keeps valid families, treats a missing family as IT (older API) and unknown ones as other', () => {
  const set = (id: string, family?: unknown) => ({
    id,
    createdAt: '2026-11-10T09:00:00.000Z',
    active: true,
    partial: false,
    ...(family === undefined ? {} : { family }),
    questions: [],
  });
  const decoded = decodeJobQuestionSets({
    contractVersion: '1',
    job: { id: 'j', title: 'Synthetic', company: 'Example' },
    jdEmpty: false,
    jdChanged: false,
    sets: [
      set('a', 'marketing'),
      set('b', 'sales'),
      set('c'),
      set('d', 'finance'),
      set('e', 42),
    ],
  });
  expect(decoded.sets.map((s) => s.family)).toEqual([
    'marketing',
    'sales',
    'it',
    'other',
    'other',
  ]);
});
