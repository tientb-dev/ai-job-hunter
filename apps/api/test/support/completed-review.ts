import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { ReviewedCvService } from '../../src/reviewed-cv/reviewed-cv.service.js';
import type { ProfileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
import {
  CvProfileRevision,
  CvSourceRevision,
} from '../../src/tailored-cv/tailored-cv.entity.js';
import { draftHash } from '../../src/tailored-cv/tailored-draft.policy.js';

/**
 * Synthetic completed Source CV Review of a saved CV: one confirmed fact per
 * source line, every line mapped. Returns ids so the caller can clean up.
 */
export async function completeReview(
  db: DataSource,
  ownerId: string,
  cvId: string,
  entries = 1,
) {
  const cv = await db.getRepository(SavedCv).findOneOrFail({
    where: { ownerId, id: cvId },
    select: { text: true, fileName: true, updatedAt: true },
  });
  // Idempotent: an existing completed review of this CV version is reused.
  const existing = await new ReviewedCvService(db).forCv(ownerId, cv);
  if (existing.status === 'COMPLETE') {
    const { profileId } = await db
      .getRepository(CvProfileRevision)
      .findOneByOrFail({ ownerId, id: existing.profileRevisionId });
    return {
      sourceRevisionId: existing.sourceRevisionId,
      profileRevisionId: existing.profileRevisionId,
      profileId,
    };
  }
  const sourceRevisionId = randomUUID();
  const profileId = randomUUID();
  const lines = [...cv.text.matchAll(/[^\r\n]+/gu)].filter((m) => m[0].trim());
  const document: ProfileDocument = {
    contractVersion: '1',
    sections: [
      {
        id: 'section-experience',
        kind: 'experience',
        review: 'confirmed',
        entries: Array.from({ length: entries }, (_, entry) => ({
          id: `entry-${entry}`,
          facts: lines
            .filter((_, index) => index % entries === entry)
            .map((m) => ({
              id: `fact-${m.index}`,
              field: 'description',
              value: m[0],
              origin: 'source' as const,
              review: 'pending' as const,
              evidence: [
                {
                  sourceRevisionId,
                  start: m.index,
                  end: m.index + m[0].length,
                  quote: m[0],
                },
              ],
            })),
        })),
      },
    ],
    coverage: lines.map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
      disposition: 'mapped' as const,
      factIds: [`fact-${m.index}`],
      reason: null,
    })),
  };
  await db.getRepository(CvSourceRevision).insert({
    id: sourceRevisionId,
    ownerId,
    fileName: cv.fileName,
    text: cv.text,
    textHash: draftHash(cv.text),
    savedCvUpdatedAt: cv.updatedAt,
    provenance: {
      kind: 'saved-text-bootstrap',
      format: null,
      parser: null,
      segments: null,
      warnings: null,
      originalBytesRetained: false,
    },
  });
  const profileRevisionId = randomUUID();
  await db.getRepository(CvProfileRevision).insert({
    id: profileRevisionId,
    ownerId,
    profileId,
    revision: 1,
    sourceRevisionId,
    document,
  });
  const review = await new ReviewedCvService(db).forCv(ownerId, cv);
  if (review.status !== 'COMPLETE')
    throw new Error(`Synthetic review is ${review.status}`);
  return { sourceRevisionId, profileRevisionId, profileId };
}

export async function removeReviews(db: DataSource, ownerId: string) {
  await db.getRepository(CvProfileRevision).delete({ ownerId });
  await db.getRepository(CvSourceRevision).delete({ ownerId });
}

/** A newer completed revision of the same review (e.g. after an edit). */
export async function reviseReview(
  db: DataSource,
  ownerId: string,
  review: { profileRevisionId: string; profileId: string },
) {
  const repo = db.getRepository(CvProfileRevision);
  const previous = await repo.findOneOrFail({
    where: { ownerId, id: review.profileRevisionId },
    select: {
      id: true,
      revision: true,
      sourceRevisionId: true,
      document: true,
    },
  });
  const id = randomUUID();
  await repo.insert({
    id,
    ownerId,
    profileId: review.profileId,
    revision: previous.revision + 1,
    sourceRevisionId: previous.sourceRevisionId,
    document: previous.document,
  });
  return id;
}
