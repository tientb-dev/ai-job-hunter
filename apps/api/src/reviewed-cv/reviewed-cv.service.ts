import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  CvProfileRevision,
  CvSourceRevision,
} from '../tailored-cv/tailored-cv.entity.js';
import { profileDocument } from '../tailored-cv/tailored-cv.contract.js';
import {
  draftHash,
  reviewedPlan,
} from '../tailored-cv/tailored-draft.policy.js';
import type { DraftPlan } from '../tailored-cv/tailored-draft.contract.js';
import { reviewedCvText, type ReviewedCvText } from './reviewed-cv.text.js';

export interface SavedCvIdentity {
  readonly updatedAt: Date;
  readonly text: string;
  readonly fileName: string;
}
export type ReviewedCv =
  | { readonly status: 'NOT_STARTED' }
  | { readonly status: 'PENDING'; readonly profileRevisionId: string }
  | {
      readonly status: 'COMPLETE';
      readonly profileRevisionId: string;
      readonly sourceRevisionId: string;
      readonly plan: DraftPlan;
      readonly reviewed: ReviewedCvText;
    };

/**
 * Read-only view of a saved CV's Source CV Review. Shared by Matching and
 * Tailored CV; it never creates sources, profiles or drafts.
 */
@Injectable()
export class ReviewedCvService {
  constructor(private readonly db: DataSource) {}

  /** The CV's captured source and its latest review revision, complete or not. */
  async latest(manager: EntityManager, ownerId: string, cv: SavedCvIdentity) {
    const source = await manager.getRepository(CvSourceRevision).findOne({
      where: {
        ownerId,
        savedCvUpdatedAt: cv.updatedAt,
        textHash: draftHash(cv.text),
        fileName: cv.fileName,
      },
    });
    if (!source) return null;
    const profile = await manager.getRepository(CvProfileRevision).findOne({
      where: { ownerId, sourceRevisionId: source.id },
      order: { createdAt: 'DESC', revision: 'DESC', id: 'DESC' },
      select: { id: true, revision: true },
    });
    return profile ? { source, profile } : null;
  }

  async forCv(
    ownerId: string,
    cv: SavedCvIdentity,
    manager: EntityManager = this.db.manager,
  ): Promise<ReviewedCv> {
    if (!cv.text.trim()) return { status: 'NOT_STARTED' };
    const found = await this.latest(manager, ownerId, cv);
    if (!found) return { status: 'NOT_STARTED' };
    const full = await manager.getRepository(CvProfileRevision).findOne({
      where: { ownerId, id: found.profile.id },
      select: { document: true },
    });
    let plan: DraftPlan;
    try {
      plan = reviewedPlan(
        profileDocument(full?.document, found.source.id, cv.text),
      );
    } catch {
      // Incomplete or unresolved review: never match on a guess.
      return { status: 'PENDING', profileRevisionId: found.profile.id };
    }
    return {
      status: 'COMPLETE',
      profileRevisionId: found.profile.id,
      sourceRevisionId: found.source.id,
      plan,
      reviewed: reviewedCvText(plan.facts),
    };
  }
}
