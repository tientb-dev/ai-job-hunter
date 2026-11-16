import 'reflect-metadata';
import { expect, jest, test } from '@jest/globals';
import type { AiService } from '../../src/ai/ai.service.js';
import { importTopcvPage } from '../../src/opportunities/topcv-page-import.js';
import { JobImportService } from '../../src/opportunities/job-import.service.js';
import { validateImportReview } from '../../src/opportunities/job-import.contract.js';
import { validateOpportunity } from '../../src/opportunities/opportunity.validation.js';
import {
  liveJobSources,
  permittedLiveJobUrl,
} from '../../src/opportunities/job-url.transport.js';
const url =
  'https://www.vietnamworks.com/synthetic-fullstack-java-1793350235119486825-2126090-jv';
const alternative = 'At least one of Java, React, Node.js';
const job = {
  '@type': 'JobPosting',
  title: 'Synthetic Senior Fullstack Java Developer',
  hiringOrganization: { name: 'Synthetic VN Employer' },
  jobLocation: [
    {
      address: {
        streetAddress: '123 Synthetic Street',
        addressLocality: 'Ho Chi Minh City',
        addressCountry: 'VN',
      },
    },
  ],
  description: `<p>Projects in Healthcare</p><h3>Requirements</h3><p>Minimum 5 years experience using Java</p><p>${alternative}</p><h3>Nice to have</h3><p>K8S, Microservice</p>`,
  experienceRequirements: { monthsOfExperience: 60 },
  workMode: 'Hybrid',
  baseSalary: {
    currency: 'USD',
    value: { minValue: 1500, maxValue: 2500, unitText: 'MONTH' },
  },
  validThrough: '2020-01-01T23:59:59+07:00',
  industry: 'Information Technology',
};
const payload = () => ({
  version: 1,
  sourceUrl: url,
  jobPosting: structuredClone(job),
  visibleText: '',
  salaryText: '',
  workModeText: '',
});
test('VietnamWorks JSON-LD uses existing normalization, review validation and canonical save workflow', async () => {
  const network = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('No network permitted'));
  const imported = importTopcvPage(payload());
  expect(imported).toMatchObject({
    platform: 'VietnamWorks',
    originalLink: url,
    title: job.title,
    company: 'Synthetic VN Employer',
    location: '123 Synthetic Street, Ho Chi Minh City, VN',
    salary: '1500-2500 USD per MONTH',
    experience: '60 months',
    workMode: 'Hybrid',
    expired: true,
  });
  const ai = {
    generateStructured: jest.fn<(request: unknown) => Promise<unknown>>(
      async () => ({ candidates: [] }),
    ),
  };
  const result = await new JobImportService(ai as unknown as AiService).extract(
    { record: { postText: imported.sourceText } },
  );
  expect(result.error).toBeNull();
  const fields = Object.fromEntries(
    result.fields.map((field) => [field.field, field.value]),
  );
  expect(fields.skills!.split('\n')).toContain(alternative);
  expect(fields.preferredSkills).toContain('K8S');
  expect(fields.preferredSkills).toContain('Microservice');
  expect(fields.skills).not.toContain('K8S');
  expect(fields.domain).toBe('Healthcare');
  expect(fields.experience).toBe('Minimum 5 years');
  expect(validateImportReview(result.fields, imported.sourceText, '')).toEqual(
    result.fields,
  );
  const saved = validateOpportunity({
    ...fields,
    title: 'My edited title',
    originalLink: url,
    postText: imported.sourceText,
    importReview: result.fields,
    source: 'Website',
    status: 'INTERVIEW',
    description: imported.description,
    notes: 'User notes',
    contactNotes: 'User contact',
    contactDates: [],
    followUpDate: null,
  });
  expect(saved).toMatchObject({
    title: 'My edited title',
    originalLink: url,
    domain: 'Healthcare',
    salary: imported.salary,
    status: 'INTERVIEW',
    notes: 'User notes',
    contactNotes: 'User contact',
  });
  expect(network).not.toHaveBeenCalled();
});
test('missing optional metadata remains unknown and visible JD is a bounded fallback', () => {
  const result = importTopcvPage({
    ...payload(),
    jobPosting: null,
    visibleText: 'Synthetic VietnamWorks JD\nRequirements\nJava',
    salaryText: '',
  });
  expect(result).toMatchObject({
    platform: 'VietnamWorks',
    title: '',
    company: '',
    location: '',
    salary: '',
    experience: '',
    workMode: '',
    validThrough: null,
    expired: false,
  });
});
test.each([
  'https://vietnamworks.com.evil.example/job-123-jv',
  'http://www.vietnamworks.com/job-123-jv',
  'https://user:pass@vietnamworks.com/job-123-jv',
  'https://www.vietnamworks.com:8080/job-123-jv',
  'https://www.vietnamworks.com/private/cv',
  'https://www.vietnamworks.com/jobs',
  'https://www.vietnamworks.com/job-123-jv?token=secret',
  'https://www.topcv.vn/synthetic-job-123-jv',
  'https://www.vietnamworks.com/viec-lam/a/123.html',
])(
  'rejects untrusted origins, credentials and non-job paths: %s',
  (sourceUrl) => {
    expect(() => importTopcvPage({ ...payload(), sourceUrl })).toThrow();
  },
);
test('server-side VietnamWorks fetching is off unless its flag is set', () => {
  expect(() => permittedLiveJobUrl(url, liveJobSources({}))).toThrow(
    'VietnamWorks link import is turned off',
  );
  const on = liveJobSources({ JOB_URL_FETCH_VIETNAMWORKS: '1' });
  expect(permittedLiveJobUrl(url, on)).toBe(url);
  expect(() =>
    permittedLiveJobUrl('https://www.vietnamworks.com/viec-lam?q=x', on),
  ).toThrow('ending in -jv');
});

test('older bookmark payload with unknown structured experience imports JD without inventing months', () => {
  const input = payload();
  const result = importTopcvPage({
    ...input,
    jobPosting: { ...input.jobPosting, experienceRequirements: {} },
  });
  expect(result.experience).toBe('');
  expect(result.sourceText).not.toContain('undefined months');
  expect(result.title).toBe(job.title);
  expect(result.description).toContain('Minimum 5 years');
});
test('invalid nonempty experience is rejected with a safe field name rather than content', () => {
  const secret = 'SYNTHETIC_PRIVATE_MARKER';
  expect(() =>
    importTopcvPage({
      ...payload(),
      jobPosting: {
        ...job,
        experienceRequirements: { monthsOfExperience: secret },
      },
    }),
  ).toThrow('jobPosting.experienceRequirements.monthsOfExperience');
  try {
    importTopcvPage({
      ...payload(),
      jobPosting: {
        ...job,
        experienceRequirements: { monthsOfExperience: secret },
      },
    });
  } catch (error) {
    expect((error as Error).message).not.toContain(secret);
  }
});

test.each(['Negotiable', 'Thỏa thuận', ''])(
  'textual quantitative salary placeholder does not block JD import: %s',
  (value) => {
    const result = importTopcvPage({
      ...payload(),
      jobPosting: {
        ...job,
        baseSalary: { currency: 'USD', value: { value, unitText: 'MONTH' } },
      },
    });
    expect(result.title).toBe(job.title);
    expect(result.salary).toBe('');
    expect(result.sourceText).toContain(`"value":"${value}"`);
  },
);
test.each([
  ['1500-2500', '1500-2500 USD per MONTH'],
  ['Up to 2500 USD net', 'Up to 2500 USD net per MONTH'],
  ['1700', '1700 USD per MONTH'],
  [1700, '1700 USD per MONTH'],
])(
  'quantitative salary amount/range uses only explicit currency/unit metadata: %s',
  (value, expected) => {
    const result = importTopcvPage({
      ...payload(),
      jobPosting: {
        ...job,
        baseSalary: { currency: 'USD', value: { value, unitText: 'MONTH' } },
      },
    });
    expect(result.salary).toBe(expected);
    expect(result.sourceText).toContain('Salary metadata:');
  },
);
test('text salary without currency or period keeps both unknown', () => {
  const result = importTopcvPage({
    ...payload(),
    jobPosting: { ...job, baseSalary: { value: { value: 'Up to 1700 net' } } },
  });
  expect(result.salary).toBe('Up to 1700 net');
  expect(result.salaryDetails).toMatchObject({
    currency: null,
    minimum: null,
    maximum: 1700,
    basis: 'net',
    payPeriod: null,
  });
});
test.each([
  { value: ['array'] },
  { value: { nested: 'invalid' } },
  { value: 'x'.repeat(301) },
])('malformed/oversized quantitative values remain rejected', ({ value }) => {
  expect(() =>
    importTopcvPage({
      ...payload(),
      jobPosting: { ...job, baseSalary: { value: { value } } },
    }),
  ).toThrow('jobPosting.baseSalary.value.value');
});
