import { afterEach, expect, jest, test } from '@jest/globals';
import {
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import { configureCvMatchDiagnostics } from '../../src/matching/cv-match.diagnostics.js';

afterEach(() => {
  configureCvMatchDiagnostics(false);
  jest.restoreAllMocks();
});
const cv = 'PRIVATE_CV_SENTINEL';
const label = 'PRIVATE_LABEL_SENTINEL';
const quote = 'PRIVATE_JD_SENTINEL';
const jd = `- ${quote}.\nOther PRIVATE_OTHER_SENTINEL`;
const seed = (parentId: string, text: string): MatchRequirement => ({
  parentId,
  requirement: text,
  priority: 'required',
  category: 'skill',
  jdQuote: text,
  cvQuote: '',
});
const canonical = [
  seed('p1', quote),
  seed('p2', 'Other PRIVATE_OTHER_SENTINEL'),
];
// p1: concise label, JD line copied with bullet and period; p2 omitted; a fake id.
const proposals: MatchRequirement[] = [
  { ...canonical[0]!, requirement: label, jdQuote: `- ${quote}.` },
  { ...canonical[0]!, parentId: 'PRIVATE_MODEL_ID', requirement: label },
];
const run = () => {
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(() => validateMatchAssessment(proposals, cv, jd, canonical)).toThrow(
    expect.objectContaining({ errorCode: 'CV_MATCH_INCOMPLETE' }),
  );
  return write.mock.calls.map(([line]) => String(line));
};

test('disabled by default: nothing is written', () => {
  expect(run()).toEqual([]);
});

test('enabled: one sanitized line with counts, server ids and booleans', () => {
  configureCvMatchDiagnostics(true);
  const lines = run();
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toMatch(/PRIVATE|SENTINEL/u);
  expect(JSON.parse(lines[0]!)).toEqual({
    event: 'CV_MATCH_INCOMPLETE',
    counts: { canonical: 2, returned: 2, unlinked: 2 },
    parentIds: { missing: 0, matching: 1, mismatched: 1 },
    returnedLinks: { none: 2, one: 0, multiple: 0 },
    unlinked: [
      {
        id: 'p1',
        parentIdReturned: true,
        labelLooseMatch: false,
        jdQuoteLooseMatch: true,
      },
      {
        id: 'p2',
        parentIdReturned: false,
        labelLooseMatch: false,
        jdQuoteLooseMatch: false,
      },
    ],
  });
});

test('non-server canonical ids are replaced by indices', () => {
  configureCvMatchDiagnostics(true);
  const write = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  expect(() =>
    validateMatchAssessment(
      [{ ...canonical[1]!, parentId: undefined }],
      cv,
      jd,
      [seed('PRIVATE_X', quote), canonical[1]!],
    ),
  ).toThrow();
  const line = String(write.mock.calls[0]![0]);
  expect(line).not.toMatch(/PRIVATE/u);
  expect(JSON.parse(line).unlinked[0].id).toBe('#0');
});
