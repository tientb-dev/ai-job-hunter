import type { ProfileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
export const syntheticCv =
  'Synthetic Person\nBuilt Java APIs at Example Ltd.\n2020–2024';
export function syntheticProfile(sourceRevisionId: string): ProfileDocument {
  return {
    contractVersion: '1',
    sections: [
      {
        id: 'experience',
        kind: 'experience',
        review: 'pending',
        entries: [
          {
            id: 'role-1',
            facts: [
              {
                id: 'fact-1',
                field: 'description',
                value: syntheticCv,
                origin: 'source',
                review: 'pending',
                evidence: [
                  {
                    sourceRevisionId,
                    start: 0,
                    end: syntheticCv.length,
                    quote: syntheticCv,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    coverage: [
      {
        start: 0,
        end: syntheticCv.length,
        disposition: 'mapped',
        factIds: ['fact-1'],
        reason: null,
      },
    ],
  };
}
