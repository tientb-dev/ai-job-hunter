import { reviewedAsIs } from '../support/reviewed-cv.stub.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import 'reflect-metadata';
import { describe, expect, jest, test } from '@jest/globals';
import type { Repository } from 'typeorm';
import { memoryMatchRows } from '../support/memory-match-rows.js';
import { AiService } from '../../src/ai/ai.service.js';
import type { AiConfig } from '../../src/ai/ai.config.js';
import type { AiProvider } from '../../src/ai/ai-provider.js';
import type { ExtractionService } from '../../src/extraction/extraction.service.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import { canonicalRequirements } from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import { quoteRejectionCategory } from '../../src/matching/cv-match.diagnostics.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic fixtures only; no real person.
const pair = 'Experience with Docker and Kubernetes';
const docker = '• Deployed services with Docker – on AWS.';
const kube = '- Deployed workloads to a Kubernetes cluster.';
const cvText = ['EXPERIENCE', docker, kube].join('\n');
const job = {
  id: 'synthetic-gemini',
  title: 'Backend Engineer',
  skills: pair,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: '',
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const canonical = canonicalRequirements(job);
type Quotes = { Docker?: string; Kubernetes?: string };
const response = (quotes: Quotes) =>
  canonical.map((row) => ({
    ...row,
    cvQuote: '',
    components: requirementGroup(row.requirement, row.category).components.map(
      (c) => ({
        componentId: c.id,
        jdQuote: c.jdQuote,
        cvQuote: quotes[c.label as keyof Quotes] ?? '',
      }),
    ),
  }));
const good: Quotes = { Docker: docker, Kubernetes: kube };
const invented: Quotes = {
  Docker: 'Ran PRIVATE_FAKE Docker clusters at scale',
};

function setup(replies: Quotes[], provider: AiConfig['provider'] = 'gemini') {
  const cv = {
    id: 'cv-1',
    text: cvText,
    fileName: 'synthetic.docx',
    updatedAt: job.updatedAt,
  };
  const cvs = {
    findOne: jest.fn(async () => cv),
    findOneBy: jest.fn(async () => cv),
  };
  const generate = jest.fn<AiProvider['generate']>(async () =>
    JSON.stringify({ requirements: response(replies.shift()!) }),
  );
  const rows = memoryMatchRows();
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService({ generate }),
    new MatchingService(),
    { get: jest.fn(async () => job) } as unknown as OpportunitiesService,
    rows,
    reviewedAsIs(),
    { provider } as AiConfig,
  );
  const saved = () => (rows as unknown as { rows: CvMatchRecord[] }).rows;
  return { service, saved };
}

describe('Gemini: an invented component quote', () => {
  test('earns zero credit and marks the result unverified, not Low Fit', async () => {
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { service } = setup([invented]);
    const result = await service.analyze(LOCAL_OWNER_ID, job.id);
    jest.restoreAllMocks();
    const row = result.requirements[0]!;
    expect(row.credit).toBe(0);
    expect(row.coverage.components.every((c) => c.cvQuote === '')).toBe(true);
    expect(row.evidence.review).toBe(true);
    expect(result).toMatchObject({
      score: 0,
      evidenceUncertain: true,
      recommendation: 'Review requirements',
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FAKE');
  });

  test('never overwrites a reliable saved result', async () => {
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { service, saved } = setup([good, invented]);
    const first = await service.analyze(LOCAL_OWNER_ID, job.id);
    const second = await service.analyze(LOCAL_OWNER_ID, job.id);
    jest.restoreAllMocks();
    expect(first).toMatchObject({ score: 100, evidenceUncertain: false });
    expect(second).toMatchObject({
      keptPrevious: true,
      matchId: first.matchId,
      score: 100,
    });
    expect(saved()).toHaveLength(1);
    expect(saved()[0]!.matchId).toBe(first.matchId);
  });
});

describe('rejected-quote categories (diagnostics only)', () => {
  test.each([
    ['- Deployed services with Docker - on AWS.', 'PUNCTUATION_OR_CASE_DRIFT'],
    ['deployed services with docker – on aws.', 'PUNCTUATION_OR_CASE_DRIFT'],
    ['- Deployed workloads to a Kubernetes cluster’s', 'ABSENT'],
    ['Ran Docker clusters at scale', 'ABSENT'],
    ['Deployed', 'AMBIGUOUS'],
    [`${docker}\n${kube}\nEXTRA`, 'ABSENT'],
  ])('%j → %s', (quote, category) => {
    expect(quoteRejectionCategory(cvText, quote)).toBe(category);
  });

  test('the event holds counts only, never quote or CV text', async () => {
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    await setup([
      { Docker: '- Deployed services with Docker - on AWS.' },
    ]).service.analyze(LOCAL_OWNER_ID, job.id);
    const lines = write.mock.calls.map(([line]) => String(line));
    jest.restoreAllMocks();
    expect(lines.join('')).not.toMatch(/Docker|Kubernetes|Deployed|AWS/u);
    expect(lines.map((l) => JSON.parse(l) as object)).toContainEqual(
      expect.objectContaining({
        event: 'CV_MATCH_QUOTES_REJECTED',
        counts: { PUNCTUATION_OR_CASE_DRIFT: 1 },
      }),
    );
  });
});

describe('Ollama (non-Gemini): an invented component quote', () => {
  test('still fails the analysis and keeps the saved result', async () => {
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { service, saved } = setup([good, invented], 'ollama');
    const first = await service.analyze(LOCAL_OWNER_ID, job.id);
    // The Ollama schema restricts quotes to allowed passages: the reply is
    // rejected as invalid output, never scored.
    await expect(service.analyze(LOCAL_OWNER_ID, job.id)).rejects.toMatchObject(
      { errorCode: 'CV_MATCH_INVALID_OUTPUT' },
    );
    const lines = write.mock.calls.map(([line]) => String(line));
    jest.restoreAllMocks();
    expect(lines.join('')).not.toMatch(
      /PRIVATE_FAKE|CV_MATCH_QUOTES_REJECTED/u,
    );
    expect(saved()).toHaveLength(1);
    expect(saved()[0]!.matchId).toBe(first.matchId);
  });
});
