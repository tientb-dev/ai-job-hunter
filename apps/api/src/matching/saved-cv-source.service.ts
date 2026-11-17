import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { SavedCv } from './saved-cv.entity.js';

// Matching owns the saved CVs. P8 may capture a locked snapshot, never write it.
@Injectable()
export class SavedCvSourceService {
  /** Read-only: each saved CV's capture identity, for review summaries. */
  identities(manager: EntityManager, ownerId: string) {
    return manager.getRepository(SavedCv).find({
      where: { ownerId },
      select: { id: true, fileName: true, updatedAt: true, text: true },
    });
  }
  async forCapture(
    manager: EntityManager,
    ownerId: string,
    expectedUpdatedAt: string,
  ) {
    const repo = manager.getRepository(SavedCv);
    // A CV's upload timestamp is its version identity among the owner's CVs.
    const id = (
      await repo.find({
        where: { ownerId },
        select: { id: true, updatedAt: true },
      })
    ).find((row) => row.updatedAt.toISOString() === expectedUpdatedAt)?.id;
    const cv =
      id &&
      (await repo.findOne({
        where: { ownerId, id },
        select: {
          ownerId: true,
          text: true,
          fileName: true,
          updatedAt: true,
          sourceMetadata: true,
        },
        lock: { mode: 'pessimistic_write' },
      }));
    if (
      !cv ||
      cv.updatedAt.toISOString() !== expectedUpdatedAt ||
      !cv.text.trim()
    ) {
      throw new ConflictException(
        'Current CV is unavailable or changed. Reload before capture.',
      );
    }
    return {
      text: cv.text,
      fileName: cv.fileName,
      updatedAt: cv.updatedAt,
      provenance: cv.sourceMetadata ?? null,
    };
  }
}
