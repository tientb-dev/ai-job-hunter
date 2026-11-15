import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { afterEach, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import {
  JobsService,
  decodeJobs,
  JOBS_SOURCE,
} from '../../src/jobs/jobs.service.js';
const row = (title = 'Synthetic TypeScript role') => ({
  slug: 'synthetic-job',
  title,
  company_name: 'Synthetic company',
  location: 'Synthetic location',
  remote: true,
  url: 'https://www.arbeitnow.com/jobs/companies/synthetic/role',
  description: '<p>TypeScript and SQL</p><script>private()</script>',
  tags: ['TypeScript'],
  created_at: 1700000000,
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('official feed is projected to original safe links without rendering upstream HTML', () => {
  const data = decodeJobs(
    {
      data: [
        row(),
        { ...row(), slug: 'bad', url: 'javascript:alert(1)' },
        row(),
      ],
    },
    '2026-10-30T00:00:00Z',
  );
  expect(data.jobs).toHaveLength(1);
  expect(data.omittedCount).toBe(2);
  expect(data.jobs[0]).toMatchObject({
    title: 'Synthetic TypeScript role',
    source: 'Arbeitnow',
    description: 'TypeScript and SQL',
    url: row().url,
    remote: true,
  });
  expect(data.jobs[0]!.publishedAt).toBe('2023-11-14T22:13:20.000Z');
});
test('empty source is honest; malformed nonempty source fails instead of fabricating jobs', () => {
  expect(decodeJobs({ data: [] }, '2026-10-30T00:00:00Z').jobs).toEqual([]);
  expect(() =>
    decodeJobs({ data: [{ title: 'invalid' }] }, '2026-10-30T00:00:00Z'),
  ).toThrow();
  expect(() =>
    decodeJobs({ unexpected: [] }, '2026-10-30T00:00:00Z'),
  ).toThrow();
});
test('fixed public endpoint, bounded request, coalesced requests and five-minute cache', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ data: [row()] }));
  const service = new JobsService();
  const [a, b] = await Promise.all([service.list(), service.list()]);
  expect(a).toEqual(b);
  await service.list();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toEqual([
    JOBS_SOURCE,
    expect.objectContaining({
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    }),
  ]);
});
test('source failure is sanitized and cannot return a sample success', async () => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response('private upstream failure', { status: 503 }),
    );
  await expect(new JobsService().list()).rejects.toMatchObject({ status: 503 });
});
test('timeout aborts the source request', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  jest.spyOn(globalThis, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init!.signal!;
        signal.addEventListener('abort', () => reject(Error('cancelled')));
      }),
  );
  const assertion = expect(new JobsService().list()).rejects.toMatchObject({
    status: 503,
  });
  await jest.advanceTimersByTimeAsync(10000);
  await assertion;
  expect(signal!.aborted).toBe(true);
});
test('production jobs controller serves real-source projection, without an AI provider', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ data: [row()] }));
  const module = await Test.createTestingModule({
    imports: [JobsModule],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
  try {
    const response = await request(app.getHttpServer()).get('/api/v1/jobs');
    expect(response.status).toBe(200);
    expect(response.body.jobs[0].url).toBe(row().url);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

test.each([
  'www.arbeitnow.com',
  'www.arbeitnow.co.uk',
  'www.arbeitnow.fr',
  'www.arbeitnow.ch',
  'www.arbeitnow.nl',
])('retains original regional posting URL on %s', (host) => {
  const url = `https://${host}/jobs/companies/synthetic/role`;
  expect(
    decodeJobs({ data: [{ ...row(), url }] }, '2026-10-30T00:00:00Z').jobs[0]!
      .url,
  ).toBe(url);
});
