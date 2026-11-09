import { expect, test } from '@jest/globals';
import {
  boundedPdfLayout,
  type PdfTextItem,
} from '../../src/extraction/pdf-layout.js';
import {
  sourcePassages,
  assembleProposal,
} from '../../src/tailored-cv/source-profile-proposal.js';
import { profileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
const id = '00000000-0000-4000-8000-000000000082';
function fixture(gap = 6, vertical = 0) {
  const values = [
    '✉',
    'person@example.invalid',
    '\uf05a',
    'synthetic-person-123',
  ];
  const text = values.join(' ') + '\n';
  let start = 0;
  const boxes = [
    [30, 79.4, 10.5],
    [46.5, 78.7, 105.5],
    [157, 79.4, 10.5],
    [167.5 + gap, 78.7 + vertical, 71.4],
  ];
  const items: PdfTextItem[] = values.map((v, index) => {
    const i = {
      start,
      end: start + v.length,
      page: 1,
      x: boxes[index]![0]!,
      y: boxes[index]![1]!,
      width: boxes[index]![2]!,
      height: 9.742,
      horizontal: true,
    };
    start += v.length + 1;
    return i;
  });
  return { text, layout: boundedPdfLayout(text, items, true) };
}
test('envelope icons remain independently excludable while exact email and profile references are retained', () => {
  const { text, layout } = fixture();
  const before = JSON.stringify(layout);
  const passages = sourcePassages(text, layout);
  expect(passages.find((p) => p.text.trim() === '✉')!.issue).toMatch(
    /^PDF icon or separator artifact/u,
  );
  expect(passages.find((p) => p.hint === 'email')!.text).toBe(
    'person@example.invalid',
  );
  expect(
    passages.find((p) => p.text.trim() === 'synthetic-person-123')!.issue,
  ).toMatch(/^Possible LinkedIn profile reference/u);
  expect(passages.find((p) => p.text.trim() === '\uf05a')!.issue).toContain(
    'Beside a possible LinkedIn',
  );
  const doc = assembleProposal(id, text, { fields: [] }, layout);
  expect(profileDocument(doc, id, text)).toEqual(doc);
  expect(doc.coverage.map((c) => text.slice(c.start, c.end)).join('')).toBe(
    text,
  );
  expect(JSON.stringify(doc)).not.toContain('https://www.linkedin.com');
  expect(
    doc.coverage.find((c) =>
      text.slice(c.start, c.end).includes('synthetic-person-123'),
    )!.disposition,
  ).toBe('unresolved');
  expect(JSON.stringify(layout)).toBe(before);
});
test.each([
  [80, 0],
  [6, 30],
])(
  'distant icons cannot establish profile-reference context (%s,%s)',
  (gap, vertical) => {
    const { text, layout } = fixture(gap, vertical);
    expect(
      sourcePassages(text, layout).find(
        (p) => p.text.trim() === 'synthetic-person-123',
      )!.issue,
    ).toMatch(/^Unrecognized contact fragment/u);
  },
);
test('unreadable characters inside a contact value are not treated as removable icons', () => {
  const text = 'person\uFFFDname@example.invalid\n';
  const passages = sourcePassages(text);
  expect(
    passages.some((p) =>
      p.issue?.startsWith('Contact text contains an unreadable character'),
    ),
  ).toBe(true);
  expect(passages.some((p) => p.hint === 'email')).toBe(false);
});

test('a full visible LinkedIn URL remains exact source evidence rather than a constructed link', () => {
  const text = '\uf05a https://www.linkedin.com/in/synthetic-person-123\n';
  const doc = assembleProposal(id, text, { fields: [] });
  const link = doc.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.field === 'link')!;
  expect(link.value).toBe('https://www.linkedin.com/in/synthetic-person-123');
  expect(link.origin).toBe('source');
  const ref = link.evidence[0]!;
  expect(ref.quote).toBe(text.slice(ref.start, ref.end));
  expect(ref.quote).toContain(link.value);
  expect(
    doc.coverage.some((c) => c.reason?.startsWith('Possible LinkedIn')),
  ).toBe(false);
});
