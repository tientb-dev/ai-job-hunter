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
const response = (quotes: Record<string, string>) =>
  canonical.map((row) => ({ ...row, cvQuote: quotes[row.requirement] ?? '' }));
const score = (quotes: Record<string, string>) =>
  scoreCvMatch(
    validateMatchAssessment(response(quotes), cvText, jd, canonical),
    cvText,
    jd,
    canonical,
  );
const flags = (result: ReturnType<typeof score>) =>
  result.requirements.map((r) => [r.requirement, r.status, r.evidence]);

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
    expect(result.score).toBe(57);
    expect(result.evidenceUncertain).toBe(false);
  });
  test('empty response: same low score, missed evidence flagged, SEO not', () => {
    const result = score({});
    expect(flags(result)).toEqual([
      [
        'Proficient in Google Analytics',
        'NOT_EVIDENCED',
        { modelQuote: 'EMPTY', review: true },
      ],
      [
        'Knowledge of SEO',
        'NOT_EVIDENCED',
        { modelQuote: 'EMPTY', review: false },
      ],
      ['Canva', 'NOT_EVIDENCED', { modelQuote: 'EMPTY', review: true }],
    ]);
    // Flags never earn credit or produce a quote.
    expect(result.score).toBe(0);
    expect(result.requirements.every((r) => r.cvQuote === '')).toBe(true);
    expect(result.evidenceUncertain).toBe(true);
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

function setup(replies: Record<string, string>[]) {
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
    { provider: 'ollama' } as AiConfig,
  );
  const saved = () => (rows as unknown as { rows: CvMatchRecord[] }).rows;
  return { service, generate, saved };
}

describe('saving a low-confidence re-analysis', () => {
  test('sends the fixed seed and keeps the reliable saved match', async () => {
    const { service, generate, saved } = setup([good, {}]);
    const first = await service.analyze(LOCAL_OWNER_ID, job.id);
    expect(generate.mock.calls[0]![0]).toMatchObject({ seed: CV_MATCH_SEED });
    const second = await service.analyze(LOCAL_OWNER_ID, job.id);
    expect(second).toMatchObject({
      keptPrevious: true,
      matchId: first.matchId,
      score: 57,
    });
    expect(saved()).toHaveLength(1);
    expect(saved()[0]!.matchId).toBe(first.matchId);
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
