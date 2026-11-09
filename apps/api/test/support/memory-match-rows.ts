import type { Repository } from 'typeorm';
import type { CvMatchRecord } from '../../src/matching/cv-match.entity.js';

// Minimal in-memory stand-in for the cv_matches repository in unit tests.
export function memoryMatchRows(): Repository<CvMatchRecord> {
  const rows: CvMatchRecord[] = [];
  const matches = (row: CvMatchRecord, where: Partial<CvMatchRecord>) =>
    Object.entries(where).every(
      ([key, value]) => row[key as keyof CvMatchRecord] === value,
    );
  const repo = {
    rows,
    findOneBy: async (where: Partial<CvMatchRecord>) =>
      rows.find((row) => matches(row, where)) ?? null,
    update: async (
      where: Partial<CvMatchRecord>,
      patch: Partial<CvMatchRecord>,
    ) => {
      for (const row of rows)
        if (matches(row, where)) Object.assign(row, patch);
    },
    delete: async (where: Partial<CvMatchRecord>) => {
      for (let i = rows.length - 1; i >= 0; i--)
        if (matches(rows[i]!, where)) rows.splice(i, 1);
    },
    insert: async (row: CvMatchRecord) => {
      rows.push(structuredClone(row));
    },
    manager: {
      transaction: async <T>(
        work: (m: { getRepository: () => unknown }) => Promise<T>,
      ) => work({ getRepository: () => repo }),
    },
  };
  return repo as unknown as Repository<CvMatchRecord>;
}
