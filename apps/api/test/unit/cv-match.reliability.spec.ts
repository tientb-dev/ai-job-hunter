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
import {
  CV_MATCH_SEED,
  JobMatchService,
} from '../../src/matching/job-match.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import type { SavedCv } from '../../src/matching/saved-cv.entity.js';
import type { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import type { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';

// Synthetic Marketing CV (Vietnamese) and English JD; no real person.
const cvText = [
  'Nguyễn Giả Lập',
  'Kỹ năng',
  'Google Analytics, Facebook Ads, Canva',
  'Kinh nghiệm',
  'Marketing Executive — Công ty Giả Lập C',
  '• Tăng 12% tỷ lệ mở qua chiến dịch email marketing',
].join('\n');
const job = {
  id: 'synthetic-mkt',
  title: 'Marketing Executive',
  skills: 'Proficient in Google Analytics\nKnowledge of SEO',
  preferredSkills: 'Canva',
  experience: '',
  domain: '',
  seniority: '',
  description: '',
  postText: '',
  jdText: '',
  updatedAt: new Date('2026-11-01T00:00:00Z'),
} as Opportunity;
const canonical = canonicalRequirements(job);
const jd = matchJobText(job);
const good: Record<string, string> = {
  'Proficient in Google Analytics': 'Google Analytics, Facebook Ads, Canva',
  Canva: 'Google Analytics, Facebook Ads, Canva',
};
// Replayed model responses: same CV/JD, one good, one with every quote empty.
const response = (quotes: Record<string, string>, requirements = canonical) =>
  requirements.map((row) => ({
    ...row,
    cvQuote: quotes[row.requirement] ?? '',
  }));
const score = (quotes: Record<string, string>) =>
  scoreCvMatch(
    validateMatchAssessment(response(quotes), cvText, jd, canonical),
    cvText,
    jd,
    canonical,
  );
const flags = (result: ReturnType<typeof score>) =>
  result.requirements.map((r) => [r.requirement, r.status, r.evidence]);
const listedCoverage = Math.round((3 * 40 + 40) / (3 + 3 + 1));

describe('replayed good vs mostly-empty model response', () => {
  test('good response: evidenced, no review flags', () => {
    const result = score(good);
    expect(flags(result)).toEqual([
      [
        'Proficient in Google Analytics',
        'EVIDENCED',
        { modelQuote: 'ACCEPTED', review: false },
      ],
      [
        'Knowledge of SEO',
        'NOT_EVIDENCED',
        { modelQuote: 'EMPTY', review: false },
      ],
      ['Canva', 'EVIDENCED', { modelQuote: 'ACCEPTED', review: false }],
    ]);
    expect(result.score).toBe(listedCoverage);
    expect(result.evidenceUncertain).toBe(false);
  });
  // Deterministic recovery: an empty model response reaches the same result.
  test('empty response: same evidence recovered from the CV, SEO still missing', () => {
    const result = score({});
    expect(
      result.requirements.map((r) => [r.requirement, r.status, r.cvQuote]),
    ).toEqual([
      [
        'Proficient in Google Analytics',
        'EVIDENCED',
        'Google Analytics, Facebook Ads, Canva',
      ],
      ['Knowledge of SEO', 'NOT_EVIDENCED', ''],
      ['Canva', 'EVIDENCED', 'Google Analytics, Facebook Ads, Canva'],
    ]);
    expect(result.score).toBe(listedCoverage);
    for (const r of result.requirements)
      if (r.cvQuote) expect(cvText).toContain(r.cvQuote);
    expect(result.evidenceUncertain).toBe(false);
  });
  test('genuinely missing evidence raises no warning', () => {
    const result = score({ ...good });
    expect(
      result.requirements.find((r) => r.requirement === 'Knowledge of SEO')
        ?.evidence.review,
    ).toBe(false);
    expect(result.evidenceUncertain).toBe(false);
  });
});

function setup(
  replies: Record<string, string>[],
  provider: AiConfig['provider'] = 'ollama',
  savedJob = job,
) {
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
  const requirements = canonicalRequirements(savedJob);
  const generate = jest.fn<AiProvider['generate']>(async ({ prompt }) =>
    prompt.startsWith('Split each job requirement')
      ? JSON.stringify({ items: [] })
      : JSON.stringify({
          requirements: response(replies.shift()!, requirements),
        }),
  );
  const rows = memoryMatchRows();
  const service = new JobMatchService(
    cvs as unknown as Repository<SavedCv>,
    {} as ExtractionService,
    new AiService({ generate }),
    new MatchingService(),
    { get: jest.fn(async () => savedJob) } as unknown as OpportunitiesService,
    rows,
    reviewedAsIs(),
    { provider } as AiConfig,
  );
  const saved = () => (rows as unknown as { rows: CvMatchRecord[] }).rows;
  return { service, generate, saved };
}

describe('saving a low-confidence re-analysis', () => {
  test('sends the fixed seed and keeps the reliable saved match', async () => {
    // A rejected (invented) quote blocks recovery, so the re-analysis is low-confidence.
    const invented = {
      ...good,
      'Proficient in Google Analytics': 'Ran PRIVATE_FAKE analytics audits',
    };
    const { service, generate, saved } = setup([good, invented], 'gemini', {
      ...job,
      preferredSkills: `${job.preferredSkills}\nExperience designing and developing queues as well as caches`,
    });
    const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const first = await service.analyze(LOCAL_OWNER_ID, job.id);
    expect(generate.mock.calls[1]![0]).toMatchObject({ seed: CV_MATCH_SEED });
    const second = await service.analyze(LOCAL_OWNER_ID, job.id);
    expect(second).toMatchObject({
      keptPrevious: true,
      matchId: first.matchId,
      score: listedCoverage,
    });
    expect(saved()).toHaveLength(1);
    expect(saved()[0]!.matchId).toBe(first.matchId);
    const outcomes = write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('"CV_MATCH_PERSISTENCE"'))
      .map((line) => JSON.parse(line) as { attempt: string; outcome: string });
    expect(outcomes).toEqual([
      {
        event: 'CV_MATCH_PERSISTENCE',
        attempt: expect.any(String),
        outcome: 'PERSISTED_FRESH',
      },
      {
        event: 'CV_MATCH_PERSISTENCE',
        attempt: expect.any(String),
        outcome: 'RETAINED_PREVIOUS',
      },
    ]);
    const attempts = write.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('"CV_MATCH_DECOMPOSITION"'))
      .map((line) => (JSON.parse(line) as { attempt: string }).attempt);
    expect(outcomes.map(({ attempt }) => attempt)).toEqual(attempts);
    expect(outcomes[0]?.attempt).not.toBe(outcomes[1]?.attempt);
  });
  test('replaces a saved match that was itself uncertain', async () => {
    const { service, saved } = setup([{}, good]);
    await service.analyze(LOCAL_OWNER_ID, job.id);
    const second = await service.analyze(LOCAL_OWNER_ID, job.id);
    expect(second).not.toHaveProperty('keptPrevious');
    expect(saved()[0]!.matchId).toBe(second.matchId);
  });
  test('an uncertain run replaces an older saved match without diagnostics', async () => {
    const { service, saved } = setup([good, {}]);
    await service.analyze(LOCAL_OWNER_ID, job.id);
    // Pre-PR assessment shape: no evidenceUncertain field. Still readable.
    delete (saved()[0]!.assessment as { evidenceUncertain?: boolean })
      .evidenceUncertain;
    expect((await service.currentMatch(LOCAL_OWNER_ID, job.id)).status).toBe(
      'VALID',
    );
    const second = await service.analyze(LOCAL_OWNER_ID, job.id);
    expect(second).not.toHaveProperty('keptPrevious');
    expect(saved()[0]!.matchId).toBe(second.matchId);
  });
});
