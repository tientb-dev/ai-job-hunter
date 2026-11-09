import { randomUUID } from 'node:crypto';
import type { scoreCvMatch } from './cv-match.js';

export type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;
export type SavedCvAssessment = Immutable<ReturnType<typeof scoreCvMatch>>;
export interface SourceRevisions {
  readonly cvUpdatedAt: string;
  readonly jobUpdatedAt: string;
}
export interface MatchSnapshot extends SourceRevisions {
  readonly matchId: string;
  readonly ownerId: string;
  readonly jobId: string;
  readonly assessment: SavedCvAssessment;
}
export function immutableValue<T>(value: T): Immutable<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutableValue(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
export class MatchContextError extends Error {
  constructor() {
    super('Match context is unavailable or stale. Reanalyze CV Match.');
  }
}

// Bump whenever deterministic evidence semantics change. Internal cache only.
export const MATCHING_POLICY_VERSION = 'qualification-d1/v1';

// Only assessment excerpts are retained, never a second complete source document.
export class MatchContexts {
  private readonly entries = new Map<
    string,
    {
      snapshot: MatchSnapshot;
      expiresAt: number;
      analyzedAt: string;
      policyVersion: string;
    }
  >();
  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly policyVersion: () => string = () =>
      MATCHING_POLICY_VERSION,
  ) {}

  private prune(): void {
    for (const [id, entry] of this.entries)
      if (entry.expiresAt <= this.now()) this.entries.delete(id);
  }
  create(
    ownerId: string,
    jobId: string,
    revisions: SourceRevisions,
    assessment: SavedCvAssessment,
  ): MatchSnapshot {
    this.prune();
    for (const [id, { snapshot }] of this.entries)
      if (snapshot.ownerId === ownerId && snapshot.jobId === jobId)
        this.entries.delete(id);
    while (this.entries.size >= 20)
      this.entries.delete(this.entries.keys().next().value!);
    const snapshot = immutableValue({
      matchId: randomUUID(),
      ownerId,
      jobId,
      ...revisions,
      assessment: structuredClone(assessment),
    });
    this.entries.set(snapshot.matchId, {
      snapshot,
      analyzedAt: new Date().toISOString(),
      policyVersion: this.policyVersion(),
      expiresAt: this.now() + 15 * 60 * 1000,
    });
    return snapshot;
  }
  current(ownerId: string, jobId: string, revisions: SourceRevisions) {
    const entry = [...this.entries.values()].find(
      ({ snapshot }) =>
        snapshot.ownerId === ownerId && snapshot.jobId === jobId,
    );
    if (!entry) return { status: 'MISSING' as const };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(entry.snapshot.matchId);
      return { status: 'EXPIRED' as const };
    }
    if (entry.snapshot.cvUpdatedAt !== revisions.cvUpdatedAt)
      return { status: 'STALE_CV' as const };
    if (entry.snapshot.jobUpdatedAt !== revisions.jobUpdatedAt)
      return { status: 'STALE_JOB' as const };
    // Reuse the same identity/ownership/revision validator as suggestions and P8.
    try {
      const snapshot = this.require(
        entry.snapshot.matchId,
        ownerId,
        jobId,
        revisions,
      );
      const matchValidForMs = this.remainingMs(snapshot.matchId);
      if (!matchValidForMs) return { status: 'EXPIRED' as const };
      return {
        status: 'VALID' as const,
        snapshot,
        analyzedAt: entry.analyzedAt,
        matchValidForMs,
      };
    } catch (error) {
      if (error instanceof MatchContextError)
        return { status: 'EXPIRED' as const };
      throw error;
    }
  }

  remainingMs(matchId: string): number {
    this.prune();
    return Math.max(
      0,
      (this.entries.get(matchId)?.expiresAt ?? this.now()) - this.now(),
    );
  }
  require(
    matchId: string,
    ownerId: string,
    jobId: string,
    revisions: SourceRevisions,
  ): MatchSnapshot {
    this.prune();
    const entry = this.entries.get(matchId);
    const snapshot = entry?.snapshot;
    if (
      !snapshot ||
      entry?.policyVersion !== this.policyVersion() ||
      snapshot.ownerId !== ownerId ||
      snapshot.jobId !== jobId ||
      snapshot.cvUpdatedAt !== revisions.cvUpdatedAt ||
      snapshot.jobUpdatedAt !== revisions.jobUpdatedAt
    )
      throw new MatchContextError();
    return snapshot;
  }
}
