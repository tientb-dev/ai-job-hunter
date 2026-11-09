import { expect, test } from '@jest/globals';
import { QueryFailedError } from 'typeorm';
import {
  DOCUMENT_BYTES,
  emptyProfile,
  profileDocument,
  timestamp,
  version,
} from '../../src/tailored-cv/tailored-cv.contract.js';
import { foundationError } from '../../src/tailored-cv/tailored-cv.http.js';
import {
  syntheticCv,
  syntheticProfile,
} from '../support/tailored-cv-fixtures.js';
const sourceId = 'aa000000-0000-4000-8000-000000000001';
test('empty capture accounts for the complete source as unresolved', () => {
  const document = emptyProfile(syntheticCv);
  expect(profileDocument(document, sourceId, syntheticCv)).toEqual(document);
  expect(document.coverage).toEqual([
    {
      start: 0,
      end: syntheticCv.length,
      disposition: 'unresolved',
      factIds: [],
      reason: null,
    },
  ]);
});
test('exact evidence is snapshotted without mutating input', () => {
  const input = syntheticProfile(sourceId);
  const result = profileDocument(input, sourceId, syntheticCv);
  expect(result).toEqual(input);
  result.sections[0]!.entries[0]!.facts[0]!.value = 'Changed';
  expect(input.sections[0]!.entries[0]!.facts[0]!.value).toBe(syntheticCv);
});
// Mutations deliberately build malformed external JSON.
type MutableInput = {
  [key: string]: unknown;
  sections: {
    id: string;
    review: string;
    entries: {
      id: string;
      facts: {
        value: string;
        origin: string;
        review: string;
        evidence: {
          sourceRevisionId: string;
          start: number;
          end: number;
          quote: string;
        }[];
      }[];
    }[];
  }[];
  coverage: {
    start: number;
    end: number;
    disposition: string;
    factIds: string[];
    reason: string | null;
  }[];
};
test.each([
  [
    'wrong version',
    (d: MutableInput) => {
      d.contractVersion = '2';
    },
  ],
  [
    'unknown keys',
    (d: MutableInput) => {
      d.ownerId = sourceId;
    },
  ],
  [
    'wrong source',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.evidence[0]!.sourceRevisionId =
        'other';
    },
  ],
  [
    'invented quote',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.evidence[0]!.quote = 'Invented';
    },
  ],
  [
    'invented source value',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.value = 'Managed Kubernetes';
    },
  ],
  [
    'invalid offset',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.evidence[0]!.start = -1;
    },
  ],
  [
    'fractional offset',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.evidence[0]!.end = 1.5;
    },
  ],
  [
    'omitted content',
    (d: MutableInput) => {
      d.coverage[0]!.end--;
    },
  ],
  [
    'empty coverage',
    (d: MutableInput) => {
      d.coverage = [];
    },
  ],
  [
    'coverage gap',
    (d: MutableInput) => {
      d.coverage[0]!.start = 1;
    },
  ],
  [
    'unknown mapped fact',
    (d: MutableInput) => {
      d.coverage[0]!.factIds = ['unknown'];
    },
  ],
  [
    'duplicate IDs',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.id = 'fact-1';
    },
  ],
  [
    'unsupported confirmation',
    (d: MutableInput) => {
      d.sections[0]!.review = 'confirmed';
      d.sections[0]!.entries[0]!.facts[0]!.review = 'needs_clarification';
    },
  ],
  [
    'unattributed source fact',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.evidence = [];
    },
  ],
  [
    'user fact masquerading as source',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.origin = 'user_entered';
    },
  ],
  [
    'missing exclusion reason',
    (d: MutableInput) => {
      d.coverage[0]! = {
        ...d.coverage[0]!,
        disposition: 'excluded',
        factIds: [],
        reason: null,
      };
    },
  ],
  [
    'too many sections',
    (d: MutableInput) => {
      d.sections = Array.from({ length: 21 }, () => d.sections[0]!);
    },
  ],
  [
    'oversized value',
    (d: MutableInput) => {
      d.sections[0]!.entries[0]!.facts[0]!.value = 'x'.repeat(4001);
    },
  ],
  [
    'oversized document',
    (d: MutableInput) => {
      d.extra = 'x'.repeat(DOCUMENT_BYTES);
    },
  ],
])('rejects %s', (_name, mutate) => {
  const document = syntheticProfile(sourceId);
  mutate(document as unknown as MutableInput);
  expect(() => profileDocument(document, sourceId, syntheticCv)).toThrow();
});
test('a short quote cannot mark the entire source mapped', () => {
  const document = syntheticProfile(sourceId);
  const fact = document.sections[0]!.entries[0]!.facts[0]!;
  fact.value = 'Synthetic';
  fact.evidence = [
    { sourceRevisionId: sourceId, start: 0, end: 9, quote: 'Synthetic' },
  ];
  expect(() => profileDocument(document, sourceId, syntheticCv)).toThrow();
});
test('section-level confirmation and explicit user facts remain distinct from source evidence', () => {
  const document = syntheticProfile(sourceId);
  const section = document.sections[0]!;
  section.review = 'confirmed';
  section.entries[0]!.facts.push({
    id: 'user-1',
    field: 'note',
    value: 'User-supplied clarification',
    origin: 'user_entered',
    review: 'confirmed',
    evidence: [],
  });
  expect(profileDocument(document, sourceId, syntheticCv)).toEqual(document);
});
test('source exclusions are explicit and retain a reason', () => {
  const document = emptyProfile(syntheticCv);
  document.coverage[0]!.disposition = 'excluded';
  document.coverage[0]!.reason = 'User excluded personal address';
  expect(profileDocument(document, sourceId, syntheticCv)).toEqual(document);
});
test('strict envelopes and calendar timestamps', () => {
  expect(() =>
    version({ contractVersion: '1', ownerId: sourceId }, []),
  ).toThrow();
  expect(() => timestamp('2026-02-30T00:00:00.000Z')).toThrow();
  expect(() => timestamp('2026-01-01')).toThrow();
  expect(timestamp('2026-01-01T00:00:00.000Z')).toBe(
    '2026-01-01T00:00:00.000Z',
  );
});
test('storage and parser errors never leak SQL, payloads or driver details', () => {
  const privateMessage = 'private CV and database details';
  for (const error of [
    new Error(privateMessage),
    Object.assign(new Error(privateMessage), {
      type: 'entity.parse.failed',
      body: privateMessage,
    }),
    new QueryFailedError(
      'sensitive query',
      ['private payload'],
      Object.assign(new Error(privateMessage), { code: '23503' }),
    ),
  ]) {
    expect(JSON.stringify(foundationError(error))).not.toMatch(
      /private|sensitive|query|payload/u,
    );
  }
});

test('aggregate byte bound rejects otherwise valid collections below individual limits', () => {
  const document = emptyProfile(syntheticCv);
  document.sections.push({
    id: 'notes',
    kind: 'additional',
    review: 'pending',
    entries: [
      {
        id: 'notes-entry',
        facts: Array.from({ length: 26 }, (_, index) => ({
          id: `user-${index}`,
          field: 'note',
          value: 'x'.repeat(4000),
          origin: 'user_entered' as const,
          review: 'pending' as const,
          evidence: [],
        })),
      },
    ],
  });
  expect(Buffer.byteLength(JSON.stringify(document))).toBeGreaterThan(
    DOCUMENT_BYTES,
  );
  expect(() => profileDocument(document, sourceId, syntheticCv)).toThrow();
  document.sections[0]!.entries[0]!.facts.splice(7);
  expect(profileDocument(document, sourceId, syntheticCv)).toEqual(document);
});

test('user replacements retain source facts and cannot borrow evidence or replace a fact in another entry', () => {
  const document = syntheticProfile(sourceId);
  const entry = document.sections[0]!.entries[0]!;
  entry.facts.push({
    id: 'replacement',
    field: 'description',
    value: 'User clarification',
    origin: 'user_entered',
    review: 'pending',
    evidence: [],
    replacesFactId: 'fact-1',
  });
  expect(profileDocument(document, sourceId, syntheticCv)).toEqual(document);
  entry.facts[1]!.replacesFactId = 'unknown';
  expect(() => profileDocument(document, sourceId, syntheticCv)).toThrow();
});
