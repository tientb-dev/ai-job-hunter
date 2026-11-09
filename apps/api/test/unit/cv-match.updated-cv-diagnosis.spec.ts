import 'reflect-metadata';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from '@jest/globals';
import { Repository } from 'typeorm';
import { AiService } from '../../src/ai/ai.service.js';
import { DocumentParser } from '../../src/extraction/document-parser.js';
import { ExtractionOwner } from '../../src/extraction/extraction.owner.js';
import { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { canonicalRequirements } from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import { pdfObjects, stream } from '../support/pdf-fixtures.js';

// Synthetic P6.5 lifecycle probes with approved P6.6 education expectations.
// No live model, private document or database.
const golden = JSON.parse(
  readFileSync(
    '../../docs/audits/fixtures/itviec-ai-solution-architect.golden.json',
    'utf8',
  ),
) as { mustHave: { quote: string }[] };
const live = JSON.parse(
  readFileSync(
    '../../docs/audits/fixtures/itviec-ai-solution-architect.live-p55d.json',
    'utf8',
  ),
) as { normalizedFields: { field: string; value: string }[] };
const degree = "Bachelor's Degree in Information Technology";
const education = [
  'EDUCATION',
  'Nong Lam University',
  degree,
  'Graduated: 2019',
];
const educationRequirement = golden.mustHave[0]!.quote;
const architectureRequirement = golden.mustHave[5]!.quote;
const shutdown: ExtractionService[] = [];
afterEach(async () => {
  for (const extraction of shutdown.splice(0))
    await extraction.onModuleDestroy();
});

function syntheticPdf(lines: string[], fileName = 'synthetic-updated.pdf') {
  const content = `BT /F1 12 Tf 72 720 Td 18 TL ${lines.map((line, index) => `${index ? 'T* ' : ''}(${line.replace(/[\\()]/gu, '\\$&')}) Tj`).join('\n')} ET`;
  const bytes = Buffer.from(
    pdfObjects([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      stream(content),
    ]),
  );
  return { bytes, fileName, mediaType: 'application/pdf' };
}
function setup(
  skills = educationRequirement,
  select: (cv: string) => string = () => '',
) {
  const job = {
    id: 'synthetic-p65',
    title: 'Synthetic AI Solution Architect',
    skills,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-05T00:00:00.000Z'),
  } as Opportunity;
  let saved = {
    ownerId: 'synthetic-owner',
    text: 'Old synthetic CV without education.',
    fileName: 'synthetic-old.pdf',
    updatedAt: new Date('2026-11-05T00:00:00.000Z'),
  };
  const prompts: string[] = [];
  const ai = new AiService({
    generate: async (request) => {
      const input = JSON.parse(request.prompt.split('\n').at(-1)!) as {
        cv: string;
      };
      prompts.push(input.cv);
      const requirements = canonicalRequirements(job).map(
        ({ requirement, priority, category, jdQuote, parentId }) => ({
          requirement,
          priority,
          category,
          jdQuote,
          parentId,
          cvQuote: select(input.cv),
        }),
      );
      return JSON.stringify({ requirements });
    },
  });
  const extraction = new ExtractionService(
    ai,
    new ExtractionOwner(new DocumentParser()),
  );
  shutdown.push(extraction);
  const cvs = {
    findOne: async () => ({ ...saved }),
    findOneBy: async () => ({ ...saved }),
    upsert: async (value: {
      ownerId: string;
      text: string;
      fileName: string;
    }) => {
      saved = {
        ...value,
        updatedAt: new Date(saved.updatedAt.getTime() + 1000),
      };
    },
  };
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    extraction,
    ai,
    new MatchingService(),
    { get: async () => job } as unknown as OpportunitiesService,
    memoryMatchRows(),
  );
  return { job, service, prompts, saved: () => ({ ...saved }) };
}

test('real synthetic PDF replacement stores new degree text and analysis uses it with its new revision', async () => {
  const run = setup(
    educationRequirement,
    (cv) => cv.split('\n').find((line) => /Bachelor/u.test(line)) ?? '',
  );
  expect((await run.service.analyze(run.job.id)).requirements[0]!.status).toBe(
    'NOT_EVIDENCED',
  );
  const oldRevision = run.saved().updatedAt;
  const metadata = await run.service.saveCv(syntheticPdf(education));
  expect(metadata).toMatchObject({ fileName: 'synthetic-updated.pdf' });
  expect(metadata).not.toHaveProperty('text');
  expect(run.saved().text).toMatch(
    /Bachelor['’]s Degree in Information Technology/u,
  );
  const parsedDegree = run.saved().text.split('\n')[2]!;
  expect(run.saved().updatedAt.getTime()).toBeGreaterThan(
    oldRevision.getTime(),
  );
  const result = await run.service.analyze(run.job.id);
  expect(run.prompts.at(-1)).toBe(run.saved().text);
  expect(run.prompts.at(-1)).not.toContain('Old synthetic CV');
  expect(result.cvUpdatedAt).toEqual(metadata!.updatedAt);
  expect(result.requirements[0]).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
    cvQuote: `${parsedDegree}\nGraduated: 2019`,
  });
  expect(requirementGroup(educationRequirement, 'skill')).toMatchObject({
    mode: 'OR',
    context: 'education',
    components: [
      { id: 'c1', label: expect.stringContaining('Information Technology') },
      { id: 'c2', label: 'equivalent practical experience' },
    ],
  });
});

test('the fresh parsed degree is recovered when the controlled model omits its selection', async () => {
  const run = setup();
  await run.service.saveCv(syntheticPdf(education));
  expect(run.saved().text).toMatch(
    /Bachelor['’]s Degree in Information Technology/u,
  );
  const result = await run.service.analyze(run.job.id);
  expect(run.prompts[0]).toBe(run.saved().text);
  expect(result.requirements[0]).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
    cvQuote: expect.stringContaining('Information Technology'),
  });
});

test('fresh full public JD with omitted selections recovers education: 17 / 2 Matched / 0 Partial / 13 Unknown', async () => {
  const run = setup();
  const fields = Object.fromEntries(
    live.normalizedFields.map((row) => [row.field, row.value]),
  );
  Object.assign(run.job, {
    skills: fields.skills,
    preferredSkills: fields.preferredSkills,
    experience: fields.experience,
    domain: fields.domain,
  });
  await run.service.saveCv(
    syntheticPdf([
      ...education,
      'Professional Summary: 6 years of experience building software systems.',
    ]),
  );
  const result = await run.service.analyze(run.job.id);
  expect(run.prompts[0]).toMatch(
    /Bachelor['’]s Degree in Information Technology/u,
  );
  expect(result.score).toBe(17);
  expect(
    result.requirements.filter((row) => row.status === 'EVIDENCED'),
  ).toHaveLength(2);
  expect(
    result.requirements.filter((row) => row.status === 'PARTIAL'),
  ).toHaveLength(0);
  expect(
    result.requirements.filter((row) => row.status === 'NOT_EVIDENCED'),
  ).toHaveLength(13);
  expect(
    result.requirements
      .filter((row) => row.status === 'EVIDENCED')
      .map((row) => row.requirement),
  ).toEqual([educationRequirement.replace(/\.$/u, ''), 'Minimum 6 years']);
});

test('degree and field separated by a PDF line break retain bounded original context', async () => {
  const quote = 'Bachelor’s Degree in\nInformation Technology';
  const run = setup(educationRequirement, () => quote);
  await run.service.saveCv(
    syntheticPdf([
      'EDUCATION',
      'Nong Lam University',
      "Bachelor's Degree in",
      'Information Technology',
      'Graduated: 2019',
    ]),
  );
  expect(run.saved().text).toContain(quote);
  const result = await run.service.analyze(run.job.id);
  expect(result.requirements[0]!).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: `${quote}\nGraduated: 2019`,
  });
});

test.each([
  [
    [
      'Designed REST APIs and microservices.',
      'Designed integrations using RabbitMQ.',
      'Designed GitLab CI/CD pipelines.',
    ],
    60,
    ['APIs', 'integrations', 'CI/CD practices'],
  ],
  [
    [
      'Designed REST APIs and microservices.',
      'Integrated services using RabbitMQ.',
      'Implemented GitLab CI/CD pipelines.',
    ],
    40,
    ['APIs', 'CI/CD practices'],
  ],
] as const)(
  'architecture source quotations grant only supported components: %j',
  async (lines, score, supported) => {
    const quote = lines.join('\n');
    const run = setup(architectureRequirement, () => quote);
    await run.service.saveCv(syntheticPdf([...lines]));
    const result = await run.service.analyze(run.job.id);
    const row = result.requirements[0]!;
    expect(result.score).toBe(score);
    expect(row.status).toBe('PARTIAL');
    expect(
      row.coverage.components
        .filter((component) => component.status === 'EVIDENCED')
        .map((component) => component.label),
    ).toEqual(supported);
    for (const component of row.coverage.components)
      if (component.cvQuote)
        expect(run.saved().text).toContain(component.cvQuote);
    for (const label of ['cloud-based architectures', 'data flows'])
      expect(
        row.coverage.components.find((component) => component.label === label)!
          .status,
      ).toBe('NOT_EVIDENCED');
  },
);

test('explicit architecture design evidence recovers only supported AND components when selections are omitted', async () => {
  const run = setup(architectureRequirement);
  await run.service.saveCv(
    syntheticPdf([
      'Designed REST APIs and microservices.',
      'Designed integrations using RabbitMQ.',
      'Designed GitLab CI/CD pipelines.',
    ]),
  );
  const result = await run.service.analyze(run.job.id);
  expect(result.requirements[0]).toMatchObject({
    status: 'PARTIAL',
    credit: 0.6,
  });
});

test('fabricated education quotation causes a typed failure rather than a successful Unknown assessment', async () => {
  const run = setup(
    educationRequirement,
    () => "Bachelor's Degree in Computer Science",
  );
  await run.service.saveCv(syntheticPdf(education));
  await expect(run.service.analyze(run.job.id)).rejects.toMatchObject({
    errorCode: 'CV_MATCH_INVALID_OUTPUT',
  });
});
