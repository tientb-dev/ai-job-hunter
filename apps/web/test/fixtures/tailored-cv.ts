import type { SavedDraft } from '../../src/features/inbox/tailored-cv.contract';
export const draftJobId = '00000000-0000-4000-8000-123456789012';
export function tailoredDraftFixture(): SavedDraft {
  return {
    contractVersion: '1',
    id: '00000000-0000-4000-8000-000000000084',
    jobId: draftJobId,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    document: {
      contractVersion: '1',
      kind: 'tailored_cv',
      pins: {
        sourceRevisionId: '00000000-0000-4000-8000-000000000082',
        profileRevisionId: '00000000-0000-4000-8000-000000000083',
        profileRevision: 2,
        jobId: draftJobId,
        jobUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
      sections: [
        'contact',
        'summary',
        'skills',
        'experience',
        'projects',
        'education',
        'certifications',
        'languages',
        'links',
        'additional',
      ].map((kind) => ({
        id: kind,
        kind,
        entries:
          kind === 'experience'
            ? [
                {
                  id: 'role',
                  facts: [
                    {
                      id: 'description',
                      field: 'description',
                      acceptedText: 'Assisted a team prototype only.',
                      selected: true,
                      provenance: {
                        profileFactId: 'description',
                        origin: 'source',
                        evidence: [
                          {
                            sourceRevisionId:
                              '00000000-0000-4000-8000-000000000082',
                            start: 0,
                            end: 31,
                            quote: 'Assisted a team prototype only.',
                          },
                        ],
                      },
                      proposedWording: {
                        text: 'Assisted a team with a prototype only.',
                        status: 'pending',
                        requirementIds: [],
                      },
                    },
                  ],
                },
              ]
            : [],
      })),
      reviewIssues: [
        {
          code: 'SEMANTIC_REVIEW_REQUIRED',
          factId: 'description',
          reason: 'Review this wording for unchanged meaning.',
        },
        {
          code: 'REQUIREMENT_PARTIAL',
          requirementId: 'p1',
          reason: 'Academic SQL use does not establish production proficiency.',
        },
      ],
      recoverable: {
        unselectedFactIds: [],
        structuralFactIds: [],
        supersededFactIds: [],
        sourceCoverage: [],
      },
      review: {
        contractVersion: '1',
        factReviews: {
          description: {
            reviewedText: 'Assisted a team prototype only.',
            wording: 'reviewed_profile',
            proposal: 'pending',
          },
        },
        acknowledgedIssues: [],
        approval: null,
      },
    },
  };
}
