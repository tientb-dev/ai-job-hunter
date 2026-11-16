import { expect, test } from '@jest/globals';
import { parseJobPosting } from '../../src/opportunities/job-url-import.js';
import { vietnamworksJsonLd } from '../../src/opportunities/vietnamworks-page.js';

const link = 'https://www.vietnamworks.com/synthetic-marketing-lead-1-42-jv';
const description = '<p>Lên kế hoạch chiến dịch — synthetic</p>';
const requirement = '<ul><li>3 năm kinh nghiệm Marketing</li></ul>';
const textRow = (id: string, value: string) =>
  `${id}:T${Buffer.byteLength(value).toString(16)},${value}`;
function page(job: Record<string, unknown>, extra = ''): string {
  // Text rows run straight into the next row with no newline, as observed.
  const stream =
    '1:HL["/font.woff2","font"]\n' +
    textRow('2a', description) +
    textRow('2b', requirement) +
    '2d:{"skillName":"SEO"}\n2c:["$2d"]\n' +
    `28:${JSON.stringify(job)}\n` +
    extra;
  const half = Math.floor(stream.length / 2);
  return [stream.slice(0, half), stream.slice(half)]
    .map(
      (part) =>
        `<script>self.__next_f.push([1,${JSON.stringify(part)}])</script>`,
    )
    .join('');
}
const job = {
  jobId: 42,
  jobTitle: 'Synthetic Marketing Lead',
  companyName: 'Synthetic Co',
  jobDescription: '$2a',
  jobRequirement: '$2b',
  skills: '$2c',
  address: 'Hà Nội',
  expiredOn: '2099-01-01T23:59:59+07:00',
  isSalaryVisible: true,
  salaryMin: 8000000,
  salaryMax: 12000000,
  salaryCurrency: 'VND',
  prettySalaryEN: '8m-12m ₫/month',
};

test('rebuilds title, company, description and requirements from the flight stream', () => {
  const preview = parseJobPosting(vietnamworksJsonLd(page(job)), link);
  expect(preview).toMatchObject({
    platform: 'VietnamWorks',
    title: 'Synthetic Marketing Lead',
    company: 'Synthetic Co',
    location: 'Hà Nội',
    expired: false,
  });
  expect(preview.description).toContain('Lên kế hoạch chiến dịch — synthetic');
  expect(preview.description).toContain(
    'Requirements:\n3 năm kinh nghiệm Marketing',
  );
  expect(preview.description).toContain(
    'Supplemental skill tags (not requirements): SEO',
  );
  expect(preview.salaryDetails).toMatchObject({
    minimum: 8000000,
    maximum: 12000000,
    currency: 'VND',
  });
});

test('hidden salary is not imported', () => {
  const preview = parseJobPosting(
    vietnamworksJsonLd(page({ ...job, isSalaryVisible: false })),
    link,
  );
  expect(preview.salary).toBe('');
});

test.each([
  ['no flight data', '<html></html>'],
  ['missing description', page({ ...job, jobDescription: '' })],
  [
    'two different jobs',
    page(job, `29:${JSON.stringify({ ...job, jobId: 43 })}\n`),
  ],
])('fails closed with paste guidance: %s', (_name, html) => {
  expect(() => vietnamworksJsonLd(html)).toThrow('paste the JD');
});
