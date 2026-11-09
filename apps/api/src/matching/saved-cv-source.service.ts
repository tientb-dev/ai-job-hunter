import { ConflictException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { SavedCv } from './saved-cv.entity.js';

// Matching owns the current CV. P8 may capture a locked snapshot, never write it.
@Injectable()
export class SavedCvSourceService {
  async forCapture(
    manager: EntityManager,
    ownerId: string,
    expectedUpdatedAt: string,
  ) {
    const cv = await manager.getRepository(SavedCv).findOne({
      where: { ownerId },
      select: {
        ownerId: true,
        text: true,
        fileName: true,
        updatedAt: true,
        sourceMetadata: true,
      },
      lock: { mode: 'pessimistic_write' },
    });
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
