import { expect, test } from 'vitest';
import {
  nextJobAction,
  type NextActionInput,
} from '../src/features/inbox/next-action';

const base: NextActionInput = {
  followUp: null,
  status: 'SAVED',
  cvSaved: true,
  sourceReason: 'CV_DRAFT_MATCH_REQUIRED',
  matchStatus: 'VALID',
  draft: null,
};
const pick = (input: Partial<NextActionInput>) =>
  nextJobAction({ ...base, ...input });

test.each<[string, Partial<NextActionInput>, string | null, string | null]>([
  [
    'follow-up due wins',
    {
      followUp: 'Overdue',
      draft: { pending: 3, approved: false, outdated: false },
    },
    'Open Application',
    'application',
  ],
  ['no saved CV', { cvSaved: false }, 'Open My CV', '/cv'],
  [
    'source review missing',
    { sourceReason: 'CV_DRAFT_PROFILE_NOT_FOUND' },
    'Review in My CV',
    '/cv',
  ],
  [
    'source review incomplete',
    { sourceReason: 'CV_DRAFT_PROFILE_INCOMPLETE' },
    'Review in My CV',
    '/cv',
  ],
  ['match missing', { matchStatus: 'MISSING' }, 'Go to Match', 'match'],
  ['match stale', { matchStatus: 'STALE_CV' }, 'Go to Match', 'match'],
  ['no draft yet', {}, 'Start tailored CV', 'tailored-cv'],
  [
    'suggestions pending (stale match ignored)',
    {
      matchStatus: 'EXPIRED',
      draft: { pending: 2, approved: false, outdated: false },
    },
    'Continue tailoring',
    'tailored-cv',
  ],
  [
    'ready for approval',
    { draft: { pending: 0, approved: false, outdated: false } },
    'Review and approve',
    'tailored-cv',
  ],
  [
    'approved, not applied',
    { draft: { pending: 0, approved: true, outdated: false } },
    'Open Approve & Export',
    'tailored-cv',
  ],
  [
    'approved and applied',
    {
      status: 'APPLIED',
      draft: { pending: 0, approved: true, outdated: false },
    },
    null,
    null,
  ],
  ['still loading draft state', { draft: undefined }, null, null],
  ['still loading source state', { sourceReason: undefined }, null, null],
  ['match still checking', { matchStatus: 'CHECKING' }, null, null],
])('%s', (_, input, label, to) => {
  const action = pick(input);
  expect(action?.label ?? null).toBe(label);
  expect(action?.to ?? null).toBe(to);
});

test('pending count and outdated approval are explained in plain words', () => {
  expect(
    pick({ draft: { pending: 1, approved: false, outdated: false } })?.text,
  ).toBe('Decide 1 remaining suggestion in your tailored CV.');
  expect(
    pick({ draft: { pending: 0, approved: true, outdated: true } })?.text,
  ).toMatch(/earlier version of this job/);
});
