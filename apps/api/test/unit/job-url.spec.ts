import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { transactionalRepository } from '../support/transactional-repository.mock.js';
import 'reflect-metadata';
import { expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { JobImportService } from '../../src/opportunities/job-import.service.js';
const fields = {
  title: 'Synthetic engineer',
  company: '',
  source: 'Website',
  status: 'SAVED',
  originalLink: 'https://www.itviec.com/jobs/synthetic?utm_source=manual',
  contactNotes: 'User contact',
  notes: 'User notes',
  description: 'Pasted synthetic JD',
  contactDates: ['2026-10-30'],
  followUpDate: '2026-11-01',
};
test('duplicate URL create preserves every existing field and never saves', async () => {
  const existing = {
    ...fields,
    originalLink: 'https://itviec.com/jobs/synthetic',
    status: 'INTERVIEW',
  };
  const before = structuredClone(existing);
  const save = jest.fn();
  const rows = { find: jest.fn(async () => [existing]), save };
  const service = new OpportunitiesService(
    transactionalRepository(rows) as unknown as Repository<Opportunity>,
    {} as JobImportService,
  );
  await expect(service.create(LOCAL_OWNER_ID, fields)).rejects.toThrow(
    'already saved',
  );
  expect(save).not.toHaveBeenCalled();
  expect(existing).toEqual(before);
});
test.each([
  'https://www.topcv.vn/viec-lam/synthetic',
  'https://www.vietnamworks.com/synthetic',
  '',
])('URL and source survive create/read and edit/read: %s', async (url) => {
  let stored: Record<string, unknown>;
  const rows = {
    find: jest.fn(async () => []),
    create: jest.fn((value: unknown) => value),
    save: jest.fn(async (value: object) => {
      stored = { ...value, id: 'synthetic' };
      return stored;
    }),
    findOneBy: jest.fn(async () => stored),
    findOneByOrFail: jest.fn(async () => stored),
  };
  const service = new OpportunitiesService(
    transactionalRepository(rows) as unknown as Repository<Opportunity>,
    {} as JobImportService,
  );
  const created = await service.create(LOCAL_OWNER_ID, {
    ...fields,
    originalLink: url,
  });
  expect(created).toMatchObject({
    originalLink: url,
    source: 'Website',
    contactNotes: fields.contactNotes,
  });
  const edited = await service.update(LOCAL_OWNER_ID, 'synthetic', {
    ...fields,
    originalLink: url,
    title: 'Edited role',
  });
  expect(edited).toMatchObject({
    originalLink: url,
    source: 'Website',
    title: 'Edited role',
    contactDates: fields.contactDates,
    followUpDate: fields.followUpDate,
  });
});
