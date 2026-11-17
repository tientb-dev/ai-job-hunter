import 'reflect-metadata';
import { expect, jest, test } from '@jest/globals';
import type { AiService } from '../../src/ai/ai.service.js';
import { JobImportService } from '../../src/opportunities/job-import.service.js';
import {
  mergeCandidates,
  validateImportReview,
} from '../../src/opportunities/job-import.contract.js';
import { alternativeRequirement } from '../../src/extraction/jd-requirements.js';

// Synthetic regression reproducing the supplied complete qualification structure.
const jd = `Job title: Senior Fullstack Java Developer
Responsibilities
- Design and develop Digital Distribution Channels for insurance services
Requirements
- 5 years of experience in Java Full Stack development
- Experience in financial services (insurance or banking) digital channel development
- Strong experience with Java, Spring, and Spring Boot for back-end development
- Experience with front-end technologies such as JavaScript, HTML5, CSS, and at least one modern framework (React, Vue, or Angular)
- Hands-on experience in RESTful API design and integration
- Experience in RDBMS-based system design and development
- Business-level English communication skills (mandatory)
- Proficiency in English (Toeic 700+, business communication), sufficient for business discussions, technical meetings, and documentation
- Experience working in global or multicultural collaboration environments.
- Domain knowledge of insurance digital channels, such as online policy enrollment, application, and customer portals
- Experience handling high-traffic systems or global service platforms
- Experience with Microservices Architecture and cloud platforms (AWS, Azure, or GCP)
- Understanding of CI/CD pipelines and DevOps environments
Supplemental skill tags (not requirements): Java Swing`;

test('full JD reaches provider unchanged and sparse model output is recovered into validated review fields', async () => {
  const ai = {
    generateStructured: jest.fn<(request: unknown) => Promise<unknown>>(
      async () => ({
        candidates: [
          {
            field: 'skills',
            value: 'Java',
            source: 'post',
            quote:
              'Strong experience with Java, Spring, and Spring Boot for back-end development',
          },
          {
            field: 'skills',
            value: 'Java Swing',
            source: 'post',
            quote: 'Supplemental skill tags (not requirements): Java Swing',
          },
        ],
      }),
    ),
  };
  const result = await new JobImportService(ai as unknown as AiService).extract(
    { record: { postText: jd } },
  );
  expect(JSON.stringify(ai.generateStructured.mock.calls[0])).toContain(
    'Toeic 700+',
  );
  expect(result.error).toBeNull();
  const skills = result.fields.find((field) => field.field === 'skills')!;
  for (const term of [
    'Java',
    'Spring',
    'Spring Boot',
    'JavaScript',
    'HTML5',
    'CSS',
    'React, Vue, or Angular',
    'RESTful API',
    'RDBMS',
    'Microservices',
    'AWS, Azure, or GCP',
    'CI/CD',
    'DevOps',
    'English',
    'Toeic 700+',
    'financial services',
    'high-traffic',
    'global or multicultural',
  ])
    expect(skills.value).toContain(term);
  const requirementClauses = jd
    .split('Requirements\n')[1]!
    .split('\nSupplemental skill tags')[0]!
    .split('\n');
  expect(skills.value.split('\n')).toHaveLength(requirementClauses.length);
  for (const clause of requirementClauses) {
    expect(
      skills.candidates.some((candidate) => candidate.quote === clause),
    ).toBe(true);
    // Values drop the list bullet; the quote stays the literal line.
    expect(skills.value).toContain(
      clause.replace(/^[-•*–+]\s*/u, '').replace(/\.$/u, ''),
    );
  }
  expect(skills.value.split('\n')).not.toContain('Java');
  expect(skills.value).not.toContain('Java Swing');
  expect(skills.value.split('\n')).not.toContain('React');
  expect(skills.value.split('\n')).not.toContain('AWS');
  for (const item of skills.candidates) expect(jd).toContain(item.quote);
  expect(validateImportReview(result.fields, jd, '')).toEqual(result.fields);
});

test('Java is not replaced by an alternative clause containing JavaScript', () => {
  const result = mergeCandidates(
    {
      candidates: [
        {
          field: 'skills',
          value: 'Java',
          source: 'post',
          quote:
            'Strong experience with Java, Spring, and Spring Boot for back-end development',
        },
      ],
    },
    jd,
    '',
  );
  const skills = result.fields.find((field) => field.field === 'skills')!;
  expect(skills.candidates).toHaveLength(1);
  const qualification = skills.candidates[0]!;
  expect(qualification.value).toMatch(/\bJava\b/u);
  expect(qualification.value).toContain(
    '5 years of experience in Java Full Stack development',
  );
  expect(qualification.value).not.toContain('JavaScript');
  expect(qualification.value).not.toMatch(/React|Vue|Angular/u);
  expect(jd).toContain(qualification.quote);
  expect(qualification.quote).toContain(qualification.value);
  expect(validateImportReview(result.fields, jd, '')).toEqual(result.fields);
});

test('parenthetical cloud alternatives remain one downstream requirement', () => {
  expect(alternativeRequirement('cloud platforms (AWS, Azure, or GCP)')).toBe(
    true,
  );
  expect(
    alternativeRequirement(
      'at least one modern framework (React, Vue, or Angular)',
    ),
  ).toBe(true);
});
