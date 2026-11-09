import 'reflect-metadata';
import { CvMatchRecord } from '../../src/matching/cv-match.entity.js';
import { afterEach, expect, jest, test } from '@jest/globals';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { DiscoveryCandidate } from '../../src/discovery/discovery-candidate.entity.js';
import { AppModule } from '../../src/app.module.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import { AI_CONFIG, aiConfig } from '../../src/ai/ai.config.js';
import { ExtractionService } from '../../src/extraction/extraction.service.js';
import { MatchingModule } from '../../src/matching/matching.module.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { matchExtractions } from '../../src/matching/matching.js';
import { MatchingInputError } from '../../src/matching/matching.validation.js';
import type { MatchingInput } from '../../src/matching/matching.types.js';
import {
  freezeMatchingFixture,
  matchingPair,
} from '../support/matching-fixtures.js';

@Global()
@Module({
  providers: [
    {
      provide: getDataSourceToken(),
      useValue: { options: { type: 'postgres' } },
    },
  ],
  exports: [getDataSourceToken()],
})
class OfflineDatabaseModule {}

afterEach(() => {
  jest.restoreAllMocks();
});

test('MatchingModule exports a synchronous standalone service without AI or extraction dependencies', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network call'));
  const app = await Test.createTestingModule({
    imports: [MatchingModule],
  }).compile();
  try {
    await app.init();
    const service = app.get(MatchingService);
    expect(service).toBeInstanceOf(MatchingService);
    expect(Reflect.getMetadata('exports', MatchingModule)).toEqual([
      MatchingService,
    ]);
    expect(() => app.get(AI_PROVIDER)).toThrow();
    expect(() => app.get(ExtractionService)).toThrow();
    const input = matchingPair();
    freezeMatchingFixture(input);
    const before = JSON.stringify(input);
    const result = service.match(input);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual(matchExtractions(input));
    expect(service.match(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.overallScore).toBe(100);
    expect(result.coverage).toMatchObject({
      inputRequirementCount: 3,
      canonicalRequirementCount: 2,
      evaluableRequirementCount: 1,
      excludedRequirementCount: 1,
      activeCategoryWeight: 35,
      jdEvaluabilityRatio: 0.5,
    });
    expect(result.categories[0]!.denominatorWeight).toBe(2);
    expect(result.scoreExplanation).toContain('1/2');
    expect(result.scoreExplanation).toContain('35/100');
    for (const item of result.requirements) {
      for (const link of item.evidence) {
        expect(
          input[link.document].source.text.slice(
            link.reference.start,
            link.reference.end,
          ),
        ).toBe(link.reference.quote);
      }
    }
    expect(
      result.requirements[0]!.evidence.find((link) => link.document === 'cv')!
        .reference.start,
    ).toBe('😀 Synthetic CV\n'.length);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

test('MatchingService preserves synchronous sanitized input failures', async () => {
  const app = await Test.createTestingModule({
    imports: [MatchingModule],
  }).compile();
  try {
    const service = app.get(MatchingService);
    const valid = matchingPair();
    const invalid = {
      ...valid,
      cv: { ...valid.cv, schemaVersion: 'sensitive synthetic sentinel' },
    } as unknown as MatchingInput;
    expect(() => service.match(invalid)).toThrow(new MatchingInputError());
    try {
      service.match(invalid);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'INVALID_MATCHING_INPUT',
        message: 'Invalid matching input.',
      });
      expect((error as Error).cause).toBeUndefined();
      expect(String(error)).not.toContain('sentinel');
    }
  } finally {
    await app.close();
  }
});

test('AppModule compiles with matching registered and no AI or extraction invocation', async () => {
  const coordinateShutdown = jest.fn<(_barrier: () => Promise<void>) => void>();
  const generate = jest
    .fn<() => Promise<never>>()
    .mockRejectedValue(new Error('Unexpected AI call'));
  const extractCv = jest
    .fn<() => Promise<never>>()
    .mockRejectedValue(new Error('Unexpected extraction call'));
  const extractJd = jest
    .fn<() => Promise<never>>()
    .mockRejectedValue(new Error('Unexpected extraction call'));
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network call'));
  expect(Reflect.getMetadata('imports', AppModule)).toContain(MatchingModule);
  const app = await Test.createTestingModule({ imports: [AppModule] })
    .overrideModule(DatabaseModule)
    .useModule(OfflineDatabaseModule)
    // Repository construction belongs to database integration tests. Keep this
    // module-wiring test offline; any accidental repository query still fails.
    .overrideProvider(getRepositoryToken(Opportunity))
    .useValue(Object.freeze({}))
    .overrideProvider(getRepositoryToken(SavedCv))
    .useValue(Object.freeze({}))
    .overrideProvider(getRepositoryToken(DiscoveryCandidate))
    .useValue(Object.freeze({}))
    .overrideProvider(getRepositoryToken(CvMatchRecord))
    .useValue(Object.freeze({}))
    .overrideProvider(AI_CONFIG)
    .useValue(aiConfig({}))
    .overrideProvider(AI_PROVIDER)
    .useValue({ generate })
    .overrideProvider(ExtractionService)
    .useValue({ extractCv, extractJd, coordinateShutdown })
    .compile();
  try {
    await app.init();
    const input = matchingPair();
    expect(app.get(MatchingService).match(input)).toEqual(
      matchExtractions(input),
    );
    expect(generate).not.toHaveBeenCalled();
    expect(coordinateShutdown).toHaveBeenCalledTimes(1);
    expect(extractCv).not.toHaveBeenCalled();
    expect(extractJd).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
