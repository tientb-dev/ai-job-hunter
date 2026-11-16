import 'reflect-metadata';
import { expect, jest, test } from '@jest/globals';
import type { IncomingMessage } from 'node:http';
import { importTopcvPage } from '../../src/opportunities/topcv-page-import.js';
import { OpportunitiesController } from '../../src/opportunities/opportunities.controller.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import type { JobImportService } from '../../src/opportunities/job-import.service.js';
import type { JobMatchService } from '../../src/matching/job-match.service.js';
import {
  liveJobSources,
  permittedLiveJobUrl,
} from '../../src/opportunities/job-url.transport.js';
const job = {
  '@type': 'JobPosting',
  title: 'Synthetic Java Engineer',
  hiringOrganization: { name: 'Synthetic Employer' },
  jobLocation: [
    {
      address: {
        streetAddress: '93 Synthetic Street',
        addressLocality: 'Hà Nội',
        addressCountry: 'VN',
      },
    },
  ],
  description:
    '<h3>Must have</h3><p>Java, Spring Boot, SQL</p><h3>Nice to have</h3><p>TDD</p>',
  baseSalary: {
    currency: 'VND',
    value: { minValue: 18000000, maxValue: 24000000, unitText: 'MONTH' },
  },
  experienceRequirements: { monthsOfExperience: 36 },
  industry: 'Information Technology',
  validThrough: '2020-01-01T23:59:59+07:00',
};
const payload = () => ({
  version: 1,
  sourceUrl: 'https://www.topcv.vn/viec-lam/synthetic-java/123.html',
  jobPosting: structuredClone(job),
  visibleText: '',
  salaryText: '',
});
test('normalizes browser JSON-LD through existing parser without fetching or writing', () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('must not fetch'));
  const result = importTopcvPage(payload());
  expect(result).toMatchObject({
    platform: 'TopCV',
    originalLink: payload().sourceUrl,
    title: job.title,
    company: 'Synthetic Employer',
    location: '93 Synthetic Street, Hà Nội, VN',
    salary: '18000000-24000000 VND per MONTH',
    experience: '36 months',
    expired: true,
  });
  expect(result.sourceText).toContain('Experience: 36 months');
  expect(result.sourceText).toContain('"monthsOfExperience":36');
  expect(result.sourceText).toContain(
    'Source industry:\nInformation Technology',
  );
  expect(result.salaryDetails).toMatchObject({
    currency: 'VND',
    minimum: 18000000,
    maximum: 24000000,
    payPeriod: 'MONTH',
    basis: null,
  });
  expect(fetch).not.toHaveBeenCalled();
});
test('visible JD fallback preserves line boundaries and requires actual content', () => {
  const result = importTopcvPage({
    ...payload(),
    jobPosting: null,
    visibleText: 'Synthetic JD\nMust have\nJava and SQL',
    salaryText: 'Up to 1700 USD net',
  });
  expect(result.description).toBe('Synthetic JD\nMust have\nJava and SQL');
  expect(result.salary).toBe('Up to 1700 USD net');
  expect(() => importTopcvPage({ ...payload(), jobPosting: null })).toThrow(
    'No JD content',
  );
});
test.each([
  { version: 2 },
  { sourceUrl: 'https://topcv.vn.evil.example/viec-lam/a/123.html' },
  { sourceUrl: 'http://www.topcv.vn/viec-lam/a/123.html' },
  { sourceUrl: 'https://user:pass@topcv.vn/viec-lam/a/123.html' },
  { sourceUrl: 'https://topcv.vn:3000/viec-lam/a/123.html' },
  { sourceUrl: 'https://topcv.vn/private/cv' },
  { sourceUrl: 'https://topcv.vn/viec-lam/a/123.html?token=secret' },
  { cookies: 'not accepted' },
  { visibleText: 'x'.repeat(12001) },
  { salaryText: 'x'.repeat(301) },
  { jobPosting: { ...job, cookies: 'not accepted' } },
  { jobPosting: { ...job, title: ['malformed'] } },
  { jobPosting: { ...job, description: 'x'.repeat(65536) } },
  {
    jobPosting: { ...job, experienceRequirements: { monthsOfExperience: -1 } },
  },
  {
    jobPosting: {
      ...job,
      baseSalary: { currency: 'VND', value: { maxValue: 'invalid' } },
    },
  },
])('rejects malformed/oversized/untrusted payload %j', (patch) => {
  expect(() => importTopcvPage({ ...payload(), ...patch })).toThrow();
});
test('script-shaped JD text never escapes the JSON-LD boundary or executes', () => {
  const result = importTopcvPage({
    ...payload(),
    jobPosting: {
      ...job,
      description:
        '<p>Java</p></script><script>alert("synthetic")</script><p>SQL</p>',
    },
  });
  expect(result.description).toContain('Java');
  expect(result.description).toContain('SQL');
  expect(result.description).not.toContain('alert');
});
test('import-page route accepts local app only, never TopCV-origin direct requests', () => {
  const controller = new OpportunitiesController(
    {} as OpportunitiesService,
    {} as JobImportService,
    {} as JobMatchService,
  );
  const request = (origin: string) =>
    ({
      headers: { host: '127.0.0.1:5173', origin },
      rawHeaders: ['Host', '127.0.0.1:5173', 'Origin', origin],
    }) as IncomingMessage;
  expect(() =>
    controller.importPage(request('https://www.topcv.vn'), payload()),
  ).toThrow('Local browser requests only');
  expect(
    controller.importPage(request('http://127.0.0.1:5173'), payload()).title,
  ).toBe(job.title);
  expect(() =>
    permittedLiveJobUrl(payload().sourceUrl, liveJobSources({})),
  ).toThrow('TopCV link import is turned off');
  expect(
    permittedLiveJobUrl(
      payload().sourceUrl,
      liveJobSources({ JOB_URL_FETCH_TOPCV: '1' }),
    ),
  ).toBe(payload().sourceUrl);
});
