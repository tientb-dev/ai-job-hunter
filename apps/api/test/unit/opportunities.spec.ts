import { transactionalRepository } from '../support/transactional-repository.mock.js';
import { expect, test } from '@jest/globals';
import { validateOpportunity } from '../../src/opportunities/opportunity.validation.js';
const input = {
  title: 'Synthetic engineer',
  company: 'Example Company',
  source: 'Email',
  status: 'SAVED',
  originalLink: 'https://example.com/job',
  contactNotes: 'Synthetic recruiter',
  description: 'Synthetic JD',
  notes: '',
  contactDates: ['2026-10-30'],
  followUpDate: '2026-11-02',
};
test('accepts all practical statuses without a transition restriction', () => {
  for (const status of [
    'SAVED',
    'CONTACTED',
    'JD_RECEIVED',
    'APPLIED',
    'INTERVIEW',
    'OFFER',
    'REJECTED',
    'CLOSED',
  ])
    expect(validateOpportunity({ ...input, status }).status).toBe(status);
});
test('rejects unsafe links, invalid dates, owner injection and oversized content', () => {
  for (const change of [
    { originalLink: 'javascript:alert(1)' },
    { originalLink: 'https://name:secret@example.com' },
    { followUpDate: '2026-02-30' },
    { contactDates: ['2026-01-01', '2026-01-01'] },
    { ownerId: 'someone' },
    { description: 'x'.repeat(26001) },
    { title: ' ' },
    { source: 'Crawler' },
    { status: 'UNKNOWN' },
    { followUpStatus: 'SNOOZED' },
  ])
    expect(() => validateOpportunity({ ...input, ...change })).toThrow();
});

test('follow-up status defaults to PENDING and accepts DONE and DISMISSED', () => {
  expect(validateOpportunity(input).followUpStatus).toBe('PENDING');
  for (const followUpStatus of ['DONE', 'DISMISSED'])
    expect(validateOpportunity({ ...input, followUpStatus })).toMatchObject({
      followUpStatus,
      status: 'SAVED',
    });
});

test('application details are optional, independent, nullable and bounded', () => {
  expect(validateOpportunity({ ...input, status: 'APPLIED' })).toMatchObject({
    appliedDate: null,
    applicationChannel: null,
  });
  expect(
    validateOpportunity({
      ...input,
      appliedDate: '2024-02-29',
      applicationChannel: ' Referral ',
    }),
  ).toMatchObject({
    appliedDate: '2024-02-29',
    applicationChannel: 'Referral',
    source: 'Email',
    status: 'SAVED',
  });
  expect(
    validateOpportunity({
      ...input,
      appliedDate: null,
      applicationChannel: '   ',
    }).applicationChannel,
  ).toBeNull();
  expect(
    validateOpportunity({ ...input, applicationChannel: 'x'.repeat(200) })
      .applicationChannel,
  ).toHaveLength(200);
  for (const change of [
    { appliedDate: '2026-02-29' },
    { appliedDate: '2026-04-31' },
    { appliedDate: '2026-01-01T00:00:00Z' },
    { appliedDate: '' },
    { appliedDate: 123 },
    { applicationChannel: 123 },
    { applicationChannel: 'x'.repeat(201) },
  ])
    expect(() => validateOpportunity({ ...input, ...change })).toThrow();
});

test('service preserves omitted application details and accepts explicit edits and clears', async () => {
  const { OpportunitiesService } =
    await import('../../src/opportunities/opportunities.service.js');
  const row = {
    ...validateOpportunity(input),
    id: 'synthetic',
    jdText: '',
    appliedDate: '2024-02-29',
    applicationChannel: 'Referral',
  };
  const rows = {
    findOneBy: async () => row,
    save: async (value: unknown) => value,
  };
  const service = new OpportunitiesService(
    transactionalRepository(rows) as unknown as ConstructorParameters<
      typeof OpportunitiesService
    >[0],
    {} as ConstructorParameters<typeof OpportunitiesService>[1],
  );
  expect(await service.update('synthetic', input)).toMatchObject({
    appliedDate: '2024-02-29',
    applicationChannel: 'Referral',
  });
  expect(
    await service.update('synthetic', {
      ...input,
      appliedDate: '2026-10-30',
      applicationChannel: 'TopCV',
    }),
  ).toMatchObject({ appliedDate: '2026-10-30', applicationChannel: 'TopCV' });
  expect(
    await service.update('synthetic', {
      ...input,
      appliedDate: null,
      applicationChannel: null,
    }),
  ).toMatchObject({ appliedDate: null, applicationChannel: null });
});
