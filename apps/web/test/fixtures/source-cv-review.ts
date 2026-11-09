import type {
  CvProfile,
  CvProfileDocument,
  CvSource,
} from '../../src/features/inbox/source-cv-review.contract';
export const sourceCvFixture: CvSource = {
  contractVersion: '1',
  id: '00000000-0000-4000-8000-000000000082',
  fileName: 'synthetic-source-cv.pdf',
  savedCvUpdatedAt: '2026-01-01T00:00:00.000Z',
  text: 'Name: Synthetic Person\nRole: Developer at Example\nUnclassified award.',
};
const text = sourceCvFixture.text;
const roleStart = text.indexOf('Role:');
const unresolvedStart = text.indexOf('Unclassified');
const fact = (
  id: string,
  field: string,
  start: number,
  end: number,
  ambiguous = false,
) => ({
  id,
  field,
  value: text.slice(start, end),
  origin: 'source' as const,
  review: ambiguous ? ('needs_clarification' as const) : ('pending' as const),
  evidence: [
    {
      sourceRevisionId: sourceCvFixture.id,
      start,
      end,
      quote: text.slice(start, end),
    },
  ],
});
export function structuredCvFixture(): CvProfileDocument {
  return {
    contractVersion: '1',
    reconstruction: { version: '3', previousRevisionId: null },
    sections: [
      {
        id: 'contact',
        kind: 'contact',
        review: 'pending',
        entries: [
          { id: 'contact-entry', facts: [fact('name', 'name', 0, roleStart)] },
        ],
      },
      {
        id: 'experience',
        kind: 'experience',
        review: 'pending',
        entries: [
          {
            id: 'role-entry',
            facts: [fact('role', 'role', roleStart, unresolvedStart, true)],
          },
        ],
      },
    ],
    coverage: [
      {
        start: 0,
        end: roleStart,
        disposition: 'mapped',
        factIds: ['name'],
        reason: null,
      },
      {
        start: roleStart,
        end: unresolvedStart,
        disposition: 'mapped',
        factIds: ['role'],
        reason: null,
      },
      {
        start: unresolvedStart,
        end: text.length,
        disposition: 'unresolved',
        factIds: [],
        reason: null,
      },
    ],
  };
}
export function cvProfileFixture(empty = false): CvProfile {
  return {
    contractVersion: '1',
    id: '00000000-0000-4000-8000-000000000083',
    profileId: '00000000-0000-4000-8000-000000000084',
    revision: 1,
    sourceRevisionId: sourceCvFixture.id,
    document: empty
      ? {
          contractVersion: '1',
          sections: [],
          coverage: [
            {
              start: 0,
              end: text.length,
              disposition: 'unresolved',
              factIds: [],
              reason: null,
            },
          ],
        }
      : structuredCvFixture(),
  };
}
