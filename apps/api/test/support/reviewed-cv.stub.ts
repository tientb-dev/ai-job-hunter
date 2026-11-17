import type { ReviewedCvService } from '../../src/reviewed-cv/reviewed-cv.service.js';

export const STUB_PROFILE_REVISION_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * Treats a fixture CV text as an already completed review of itself, so
 * scoring tests keep exercising the exact text they supply. Every line is
 * source provenance.
 */
export function reviewedAsIs(): ReviewedCvService {
  return {
    forCv: async (_owner: string, cv: { text: string }) => {
      const lines = [...cv.text.matchAll(/[^\r\n]+/gu)].map((m) => ({
        factId: `line-${m.index}`,
        sectionKind: 'additional' as const,
        entryId: 'entry',
        origin: 'source' as const,
        start: m.index,
        end: m.index + m[0].length,
      }));
      return {
        status: 'COMPLETE' as const,
        profileRevisionId: STUB_PROFILE_REVISION_ID,
        sourceRevisionId: STUB_PROFILE_REVISION_ID,
        plan: { facts: [] } as never,
        reviewed: { text: cv.text, lines },
      };
    },
  } as unknown as ReviewedCvService;
}
