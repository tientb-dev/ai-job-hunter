import 'reflect-metadata';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { MatchContexts } from '../../src/matching/match-context.js';
import { suggestionCandidates } from '../../src/matching/suggestion-policy.js';
import { expect, jest, test } from '@jest/globals';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiProvider } from '../../src/ai/ai-provider.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import type { Repository } from 'typeorm';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import {
  cvQuoteChoices,
  resolveCvQuote,
} from '../../src/matching/cv-match.evidence.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';

// Entirely synthetic source; no personal/employer/project data was copied.
const requirement =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const skills = 'Databases: PostgreSQL, MySQL, SQL Server and Oracle';
const project = 'Developed enterprise features using SQL Server.';
const attributedProject = `Project: Synthetic inventory application\n${project}`;
const optimization = 'Optimized data-access logic and MyBatis queries.';
const cv = [
  skills,
  'Project: Synthetic inventory application',
  project,
  optimization,
].join('\n');
const job = {
  title: 'Synthetic developer',
  skills: requirement,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: requirement,
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-05T00:00:00.000Z'),
} as Opportunity;
const group = requirementGroup(requirement, 'skill');
const sql = (coverage: ReturnType<typeof evaluateCoverage>) =>
  coverage.components.find(({ label }) => label === 'SQL Server')!;

function trace(quote = project, text = cv) {
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  const proposals = canonical.map((row) => ({
    ...row,
    cvQuote: quote,
    components: group.components.map((component) => ({
      componentId: component.id,
      jdQuote: component.jdQuote,
      cvQuote: component.label === 'SQL Server' ? quote : '',
    })),
  }));
  const verified = validateMatchAssessment(proposals, text, jd, canonical);
  return { verified, result: scoreCvMatch(verified, text, jd, canonical) };
}

test('synthetic saved text → candidate enum → resolution → assignment succeeds before qualification', () => {
  expect(cv).toContain(project);
  expect(cv).toContain(optimization);
  expect(cvQuoteChoices(cv)).toContain(project);
  expect(cvQuoteChoices(cv)).toContain(`${project}\n${optimization}`);
  expect(resolveCvQuote(cv, project)).toBe(project);
  expect(resolveCvQuote(cv, `${project} ${optimization}`)).toBe(
    `${project}\n${optimization}`,
  );
  const { verified, result } = trace(`${project}\n${optimization}`);
  expect(verified[0]?.cvEvidenceUnverified).toBeUndefined();
  expect(
    verified[0]?.components?.find(({ componentId }) => componentId === 'c3')
      ?.cvQuote,
  ).toBe(`${project}\n${optimization}`);
  expect(result.requirements[0]).toMatchObject({
    status: 'PARTIAL',
    credit: 0.5,
    coverage: { mode: 'OR' },
  });
  const component = result.requirements[0]!.coverage.components[2]!;
  expect(component.cvQuote).toBe(attributedProject); // exact professional use, not full proficiency
  expect(component).toMatchObject({
    observations: expect.arrayContaining([
      { kind: 'experience', cvQuote: attributedProject },
    ]),
  });
  expect(result.requirements[0]!.coverage.reason).toContain(
    'SQL Server project experience',
  );
});

test('mocked real service reads the saved parsed text and returns original unqualified project evidence', async () => {
  const cvs = {
    findOne: jest.fn<
      (
        options: unknown,
      ) => Promise<{ text: string; fileName: string; updatedAt: Date }>
    >(async () => ({
      text: cv,
      fileName: 'synthetic.pdf',
      updatedAt: job.updatedAt,
    })),
    findOneBy: jest.fn(async () => ({
      fileName: 'synthetic.pdf',
      updatedAt: job.updatedAt,
    })),
  };
  const provider: AiProvider = {
    generate: jest.fn<AiProvider['generate']>(async (request) => {
      expect(request.prompt).toContain(project);
      const schema = request.schema as {
        properties: {
          requirements: {
            items: {
              properties: {
                components: {
                  items: { properties: { cvQuote: { enum: string[] } } };
                };
              };
            };
          };
        };
      };
      expect(
        schema.properties.requirements.items.properties.components.items
          .properties.cvQuote.enum,
      ).toContain(project);
      return JSON.stringify({
        requirements: canonicalRequirements(job).map((row) => ({
          ...row,
          cvQuote: project,
          components: group.components.map((component) => ({
            componentId: component.id,
            jdQuote: component.jdQuote,
            cvQuote: component.label === 'SQL Server' ? project : '',
          })),
        })),
      });
    }),
  };
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService(provider),
    new MatchingService(),
    { get: async () => job } as unknown as OpportunitiesService,
    memoryMatchRows(),
  );
  const result = await service.analyze('synthetic-job');
  expect(result.requirements[0]?.coverage.components[2]).toMatchObject({
    status: 'PARTIAL',
    observations: expect.arrayContaining([
      { kind: 'experience', cvQuote: attributedProject },
    ]),
  });
  expect(result.score).toBe(50);
  expect(cvs.findOne).toHaveBeenCalledWith(
    expect.objectContaining({
      select: expect.objectContaining({ text: true }),
    }),
  );
});

test.each(['', skills, project, `${project}\n${optimization}`])(
  'omitted, skills-only and project proposals retain work context without upgrading level: %s',
  (selection) => {
    const coverage = evaluateCoverage(
      group,
      selection ? [selection] : [],
      cv,
      true,
    );
    expect(sql(coverage)).toMatchObject({
      status: 'PARTIAL',
      observations: expect.arrayContaining([
        { kind: 'experience', cvQuote: attributedProject },
      ]),
    });
    expect(coverage.credit).toBe(0.5);
    expect(coverage.components[0]).toMatchObject({
      observations: [{ kind: 'mention', cvQuote: skills }],
    });
    expect(coverage.components[1]).toMatchObject({
      observations: [{ kind: 'mention', cvQuote: skills }],
    });
  },
);

test('skills names alone are mentions, never project work or proficiency', () => {
  const coverage = evaluateCoverage(group, [skills], skills, true);
  expect(coverage.status).toBe('NOT_EVIDENCED');
  for (const component of coverage.components)
    expect(component).toMatchObject({
      cvQuote: '',
      observations: [{ kind: 'mention', cvQuote: skills }],
    });
  expect(coverage.reason).toContain('mentions');
});

test.each([
  'I have never used SQL Server.',
  'I plan to develop enterprise features using SQL Server.',
  'Developed enterprise features using SQL Server in a tutorial only.',
])(
  'negative, aspiration and tutorial are not experience observations: %s',
  (text) => {
    const coverage = evaluateCoverage(group, [text], text, true);
    expect(coverage.status).toBe('NOT_EVIDENCED');
    expect(
      sql(coverage).observations?.some(({ kind }) => kind === 'experience'),
    ).not.toBe(true);
  },
);

test('unqualified work and an explicit use denial conflict; lack of proficiency alone does not contradict use', () => {
  const contradicted = `${project}\nI have never used SQL Server.`;
  const coverage = evaluateCoverage(group, [project], contradicted, true);
  expect(coverage).toMatchObject({ status: 'CONFLICT', credit: 0 });
  expect(sql(coverage).conflictingQuotes).toContain(
    'I have never used SQL Server.',
  );
  expect(
    evaluateCoverage(
      group,
      [project],
      `${project}\nI am not proficient in SQL Server.`,
      true,
    ).status,
  ).toBe('PARTIAL');
});

test('stronger existing proficiency evidence still satisfies one OR alternative and preserves source quotes', () => {
  const strong =
    'Administered production SQL Server databases with query tuning, indexing and replication.';
  const coverage = evaluateCoverage(group, [strong], `${cv}\n${strong}`, true);
  expect(coverage).toMatchObject({ status: 'EVIDENCED', credit: 1 });
  expect(sql(coverage).cvQuote).toBe(strong);
  expect(
    coverage.components.filter(({ status }) => status === 'EVIDENCED'),
  ).toHaveLength(1);
});

test('invalid source quotes are rejected and cannot be promoted by observational recovery', () => {
  expect(() => trace('Invented SQL Server proficiency.')).toThrow();
  expect(
    evaluateCoverage(group, [], cv, false).components[2]?.observations,
  ).toBeUndefined();
});

test('adjacent generic MyBatis optimization is context, not proof of SQL Server proficiency', () => {
  const { result } = trace(`${project}\n${optimization}`);
  const row = result.requirements[0]!;
  expect(row.status).toBe('PARTIAL');
  expect(row.coverage.components[2]).toMatchObject({
    observations: expect.arrayContaining([
      { kind: 'experience', cvQuote: attributedProject },
    ]),
  });
  expect(row.coverage.components[2]).not.toMatchObject({
    observations: expect.arrayContaining([
      { kind: 'experience', cvQuote: optimization },
    ]),
  });
  const snapshot = new MatchContexts().create(
    'synthetic-owner',
    'synthetic-job',
    {
      cvUpdatedAt: job.updatedAt.toISOString(),
      jobUpdatedAt: job.updatedAt.toISOString(),
    },
    result,
  );
  expect(suggestionCandidates(snapshot, cv)[0]).toMatchObject({
    kind: 'clarify',
    wording: null,
  });
});

test('separate projects are never combined to meet the proficiency task count', () => {
  const text = `${project}\nProject: Different synthetic PostgreSQL application\nAdministered production PostgreSQL databases with indexing and replication.`;
  const coverage = evaluateCoverage(group, [project], text, true);
  expect(sql(coverage).status).toBe('PARTIAL');
  expect(sql(coverage).observations).toEqual([
    { kind: 'experience', cvQuote: project },
  ]);
  expect(coverage.credit).toBe(0.5);
});

test('project observation keeps original nonbreaking whitespace after quote resolution', () => {
  const original = 'Developed enterprise features using SQL\u00a0Server.';
  const resolved = resolveCvQuote(original, project);
  expect(resolved).toBe(original);
  const coverage = evaluateCoverage(group, [resolved!], original, true);
  expect(sql(coverage)).toMatchObject({
    status: 'PARTIAL',
    observations: [{ kind: 'experience', cvQuote: original }],
  });
});
