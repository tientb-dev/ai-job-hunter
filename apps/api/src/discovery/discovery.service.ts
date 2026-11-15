import {
  activeGreenhouseSources,
  GREENHOUSE_SCOPE,
} from './greenhouse-registry.js';
import { ConflictException, Injectable } from '@nestjs/common';
import { OpportunitiesService } from '../opportunities/opportunities.service.js';
import { rankJob, validateFilters, type DiscoveredJob } from './discovery.js';
import {
  GreenhouseSource,
  normalizeGreenhouse,
  type SourceReadMetadata,
} from './greenhouse.source.js';
export interface DiscoverySourceOutcome extends SourceReadMetadata {
  sourceKey: string;
  sourceName: string;
  status: 'success' | 'failed';
  fetched: number | null;
  normalized: number | null;
  invalid: number | null;
  failure: {
    code: 'SOURCE_UNAVAILABLE' | 'INVALID_FEED';
    message: string;
  } | null;
}
@Injectable()
export class DiscoveryService {
  private active = false;
  constructor(
    private readonly source: GreenhouseSource,
    private readonly jobs: OpportunitiesService,
  ) {}
  async discover(ownerId: string, input: unknown) {
    validateFilters(input);
    if (this.active)
      throw new ConflictException(
        'Discovery is already running. Wait for it to finish.',
      );
    this.active = true;
    try {
      const { jobs, errors, scannedAt } = await this.scan(input);
      const saved = await this.jobs.importDiscovered(ownerId, jobs);
      return {
        found: jobs.length,
        ...saved,
        errors,
        discoveredAt: scannedAt,
        scope: `${GREENHOUSE_SCOPE} Filters rank locally; unknown metadata stays eligible. Up to 50 new jobs per run.`,
      };
    } finally {
      this.active = false;
    }
  }
  // Shared fetch/normalize/rank pipeline; no database writes or AI.
  async scan(input: unknown) {
    const filters = validateFilters(input);
    const errors: string[] = [];
    const candidates: DiscoveredJob[] = [];
    const outcomes: DiscoverySourceOutcome[] = [];
    const warnings: string[] = [];
    const scannedAt = new Date().toISOString();
    const sources = activeGreenhouseSources();
    // Batches of two bound network work. Promise.all preserves registry order,
    // independent of completion order, including errors and equal-rank jobs.
    for (let offset = 0; offset < sources.length; offset += 2) {
      const results = await Promise.all(
        sources.slice(offset, offset + 2).map(async (source) => {
          const metadata: SourceReadMetadata = {
            cacheHit: false,
            fetchedAt: null,
          };
          let envelopeReceived = false;
          try {
            const payload = await this.source.read(source, metadata);
            envelopeReceived = true;
            const decoded = normalizeGreenhouse(payload, source, scannedAt);
            return {
              jobs: decoded.jobs,
              outcome: {
                sourceKey: source.key,
                sourceName: source.name,
                ...metadata,
                status: 'success',
                fetched: decoded.fetched,
                normalized: decoded.jobs.length,
                invalid: decoded.invalid,
                failure: null,
              } satisfies DiscoverySourceOutcome,
              errors: decoded.invalid
                ? [
                    `${source.name}: ${decoded.invalid} unsupported or oversized listings omitted.`,
                  ]
                : [],
            };
          } catch {
            return {
              jobs: [],
              outcome: {
                sourceKey: source.key,
                sourceName: source.name,
                ...metadata,
                status: 'failed',
                fetched: null,
                normalized: null,
                invalid: null,
                failure: {
                  code: envelopeReceived
                    ? 'INVALID_FEED'
                    : 'SOURCE_UNAVAILABLE',
                  message: envelopeReceived
                    ? 'Feed envelope is invalid.'
                    : 'Feed unavailable or rate limited. Retry later.',
                },
              } satisfies DiscoverySourceOutcome,
              errors: [
                `${source.name}: feed unavailable or rate limited. Retry later; no sample listings substituted.`,
              ],
            };
          }
        }),
      );
      for (const result of results) {
        outcomes.push(result.outcome);
        if (result.outcome.status === 'success')
          warnings.push(...result.errors);
        candidates.push(...result.jobs);
        errors.push(...result.errors);
      }
    }
    const ranked = candidates
      .map((job) => ({ job, rank: rankJob(job, filters) }))
      .filter(
        (row): row is { job: DiscoveredJob; rank: number } => row.rank !== null,
      )
      .sort(
        (a, b) => b.rank - a.rank || a.job.title.localeCompare(b.job.title),
      );
    // Keep the first ranked occurrence, preserving cap selection and stable feed order.
    const unique = new Map<string, DiscoveredJob>();
    for (const { job } of ranked) {
      const key = `${job.discovery.sourceUrl}:${job.discovery.sourceJobId}`;
      if (!unique.has(key)) unique.set(key, job);
    }
    return {
      jobs: [...unique.values()],
      errors,
      scannedAt,
      fetched: outcomes.reduce((sum, source) => sum + (source.fetched ?? 0), 0),
      normalized: outcomes.reduce(
        (sum, source) => sum + (source.normalized ?? 0),
        0,
      ),
      eligible: unique.size,
      sources: outcomes,
      sourceFailures: outcomes.filter((source) => source.status === 'failed')
        .length,
      warnings,
    };
  }
}
