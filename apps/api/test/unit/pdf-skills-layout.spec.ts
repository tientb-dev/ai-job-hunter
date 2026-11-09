import { draftInput } from '../support/tailored-draft-fixtures.js';
import {
  assembleDraft,
  reviewedPlan,
} from '../../src/tailored-cv/tailored-draft.policy.js';
import {
  initialReview,
  applyReview,
  approveReview,
} from '../../src/tailored-cv/tailored-draft-review.policy.js';
import { canonicalExport } from '../../src/tailored-cv/tailored-cv-export.js';
import { expect, test } from '@jest/globals';
import { parsePdf } from '../../src/extraction/pdf.parser.js';
import { DocumentParser } from '../../src/extraction/document-parser.js';
import { validateParseResponse } from '../../src/extraction/parser.protocol.js';
import {
  boundedPdfLayout,
  validatePdfLayout,
} from '../../src/extraction/pdf-layout.js';
import {
  skillsPdf,
  categoryWordValuePdf,
  type SkillsPdfOrder,
} from '../support/pdf-skills-fixture.js';
import { pdfInput } from '../support/pdf-fixtures.js';
import {
  assembleProposal,
  sourcePassages,
} from '../../src/tailored-cv/source-profile-proposal.js';
import {
  assertSkillSourceCoverage,
  segmentSource,
} from '../../src/tailored-cv/source-profile-structure.js';
import { profileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
const sourceId = '00000000-0000-4000-8000-000000000082';
const expected = [
  ['Backend', 'Java, Spring Boot, C++, C#', '.NET, Node.js, CI/CD'],
  ['Frontend', 'React, TypeScript', 'Accessibility testing'],
  ['Leadership', 'Mentoring, Code Review'],
];

test.each<SkillsPdfOrder>(['row', 'column', 'interleaved'])(
  'geometry groups %s-order wrapped Skills without changing source/evidence',
  async (order) => {
    const parsed = await parsePdf(skillsPdf(order));
    const { text } = parsed.source;
    const originalOrder = {
      row: [
        'Skills',
        'Backend Java, Spring Boot, C++, C#',
        '.NET, Node.js, CI/CD',
        'Frontend React, TypeScript',
        'Accessibility testing',
        'Leadership Mentoring, Code Review',
      ],
      column: [
        'Skills',
        'Backend',
        'Frontend',
        'Leadership',
        'Java, Spring Boot, C++, C#',
        '.NET, Node.js, CI/CD',
        'React, TypeScript',
        'Accessibility testing',
        'Mentoring, Code Review',
      ],
      interleaved: [
        'Skills',
        'Backend',
        'Frontend',
        'Leadership',
        'Java, Spring Boot, C++, C#',
        'React, TypeScript',
        'Mentoring, Code Review',
        '.NET, Node.js, CI/CD',
        'Accessibility testing',
      ],
    };
    expect(text).toBe(originalOrder[order].join('\n'));
    const before = JSON.stringify(parsed);
    expect(parsed.pdfLayout?.complete).toBe(true);
    const doc = assembleProposal(
      sourceId,
      text,
      { fields: [] },
      parsed.pdfLayout,
    );
    expect(profileDocument(doc, sourceId, text)).toEqual(doc);
    expect(doc.coverage.map((c) => text.slice(c.start, c.end)).join('')).toBe(
      text,
    );
    const entries = doc.sections
      .filter((s) => s.kind === 'skills')
      .flatMap((s) => s.entries)
      .filter((e) => e.facts.some((f) => f.field === 'skill_category'));
    expect(entries).toHaveLength(3);
    for (const [index, entry] of entries.entries()) {
      const facts = entry.facts.filter((f) => f.field !== 'heading');
      expect(facts[0]!.field).toBe('skill_category');
      expect(facts[0]!.value.trim()).toBe(expected[index]![0]);
      expect(
        facts
          .slice(1)
          .map((f) => f.value.trim())
          .join('\n'),
      ).toBe(expected[index]!.slice(1).join('\n'));
      expect(facts.every((f) => f.review === 'pending')).toBe(true);
      for (const fact of facts)
        for (const ref of fact.evidence) {
          expect(ref.quote).toBe(text.slice(ref.start, ref.end));
          expect(ref.quote).toContain(fact.value);
        }
    }
    expect(JSON.stringify(parsed)).toBe(before);
    // Keep the unhinted text-only association check strict.
    if (order !== 'row')
      expect(() =>
        assertSkillSourceCoverage(doc, segmentSource(text)),
      ).toThrow();
    const passages = sourcePassages(text, parsed.pdfLayout);
    const wrong = structuredClone(doc);
    const records = wrong.sections
      .flatMap((s) => s.entries)
      .filter((e) => e.facts.some((f) => f.field === 'skill_category'));
    const value = records[0]!.facts.find((f) => f.field === 'skill')!;
    records[0]!.facts = records[0]!.facts.filter((f) => f !== value);
    records[1]!.facts.push(value);
    expect(() => assertSkillSourceCoverage(wrong, passages)).toThrow(
      /layout association/u,
    );
  },
);

test.each(['ambiguous', 'rotated', 'unknown', 'overlap'] as const)(
  'abstains for %s layout and retains reviewable source text',
  async (variant) => {
    const parsed = await parsePdf(skillsPdf('column', variant));
    const passages = sourcePassages(parsed.source.text, parsed.pdfLayout);
    expect(passages.some((p) => p.skillRow)).toBe(false);
    expect(
      passages
        .filter((p) => !p.heading && p.kind === 'skills')
        .every((p) => p.uncertain),
    ).toBe(true);
    expect(passages.map((p) => p.text).join('')).toBe(parsed.source.text);
    const fields = passages
      .filter((p) => !p.heading)
      .map((p) => ({ id: p.id, kind: 'skills', field: p.hint ?? 'skill' }));
    const doc = assembleProposal(
      sourceId,
      parsed.source.text,
      { fields },
      parsed.pdfLayout,
    );
    expect(
      doc.sections
        .flatMap((s) => s.entries.flatMap((e) => e.facts))
        .filter((f) => f.field !== 'heading')
        .every((f) => f.review === 'needs_clarification'),
    ).toBe(true);
  },
);

test('worker validates bounded geometry, source hash and page/offset ownership', async () => {
  const parser = new DocumentParser();
  try {
    const parsed = await parser.parse(pdfInput(skillsPdf('column')));
    expect(parsed.pdfLayout?.complete).toBe(true);
    for (const tamper of [
      (p: typeof parsed) => {
        Object.assign(p.pdfLayout!.items[0]!, { start: -1 });
      },
      (p: typeof parsed) => {
        Object.assign(p.pdfLayout!, { textHash: '0'.repeat(64) });
      },
      (p: typeof parsed) => {
        Object.assign(p.pdfLayout!.items[0]!, { page: 2 });
      },
      (p: typeof parsed) => {
        Object.assign(p.pdfLayout!.items[0]!, { x: Infinity });
      },
    ]) {
      const bad = structuredClone(parsed);
      tamper(bad);
      expect(() =>
        validateParseResponse({ version: 1, ok: true, result: bad }),
      ).toThrow();
    }
    const legacy = {
      source: parsed.source,
      pageCount: parsed.pageCount,
      warnings: parsed.warnings,
    };
    expect(
      validateParseResponse({ version: 1, ok: true, result: legacy }).ok,
    ).toBe(true);
  } finally {
    await parser.close();
  }
});

test('layout budgets abstain without truncating text, and stale hints cannot split facts', async () => {
  const parsed = await parsePdf(skillsPdf());
  const layout = boundedPdfLayout(
    parsed.source.text,
    [...parsed.pdfLayout!.items],
    false,
  );
  expect(layout).toMatchObject({ complete: false, items: [] });
  expect(() =>
    validatePdfLayout(
      { ...layout, textHash: '0'.repeat(64) },
      parsed.source.text,
    ),
  ).toThrow();
  expect(
    sourcePassages(parsed.source.text, layout).some((p) => p.skillRow),
  ).toBe(false);
  const absent = sourcePassages(parsed.source.text);
  expect(absent).toEqual(segmentSource(parsed.source.text));
});

test('geometry budgets and stale hashes fail closed without losing source text', async () => {
  const text = 'x '.repeat(769);
  const items = Array.from({ length: 769 }, (_, i) => ({
    start: i * 2,
    end: i * 2 + 1,
    page: 1,
    x: 50,
    y: i + 1,
    width: 5,
    height: 11,
    horizontal: true,
  }));
  expect(boundedPdfLayout(text, items, true)).toMatchObject({
    complete: false,
    items: [],
  });
  const longItems = items.slice(0, 500).map((i) => ({
    ...i,
    width: 5.123456789012345,
    x: 50.12345678901234,
    y: i.y + 0.123456789012345,
  }));
  expect(boundedPdfLayout(text.slice(0, 1000), longItems, true)).toMatchObject({
    complete: false,
    items: [],
  });
  const parsed = await parsePdf(skillsPdf('column'));
  const stale = { ...parsed.pdfLayout!, textHash: '0'.repeat(64) };
  const passages = sourcePassages(parsed.source.text, stale);
  expect(passages.some((p) => p.skillRow)).toBe(false);
  expect(passages.filter((p) => !p.heading).every((p) => p.uncertain)).toBe(
    true,
  );
  expect(passages.map((p) => p.text).join('')).toBe(parsed.source.text);
});

test('layout-owned facts export in category/value order with original technology wording', async () => {
  const parsed = await parsePdf(skillsPdf('interleaved'));
  const profile = assembleProposal(
    sourceId,
    parsed.source.text,
    { fields: [] },
    parsed.pdfLayout,
  );
  for (const section of profile.sections) section.review = 'confirmed';
  const input = draftInput();
  input.plan = reviewedPlan(profile);
  const doc = assembleDraft(input, []);
  doc.review = initialReview(doc);
  const originals = new Map(input.plan.facts.map((f) => [f.id, f.value]));
  const reviewed = applyReview(
    doc,
    doc.reviewIssues.map((_, issueIndex) => ({
      action: 'acknowledge' as const,
      issueIndex,
    })),
    originals,
  );
  const approved = approveReview(reviewed, [], 2, '2026-11-08');
  expect(
    canonicalExport(approved, 2)
      .blocks.filter((b) => b.section === 'skills')
      .map((b) => [b.label, b.text]),
  ).toEqual([
    ['Backend', 'Java, Spring Boot, C++, C#\n.NET, Node.js, CI/CD'],
    ['Frontend', 'React, TypeScript\nAccessibility testing'],
    ['Leadership', 'Mentoring, Code Review'],
  ]);
});

test.each<SkillsPdfOrder>(['row', 'column', 'interleaved'])(
  'category-like wrapped values stay in the value column (%s order)',
  async (order) => {
    const parsed = await parsePdf(categoryWordValuePdf(order));
    const before = JSON.stringify(parsed);
    const doc = assembleProposal(
      sourceId,
      parsed.source.text,
      { fields: [] },
      parsed.pdfLayout,
    );
    const rows = doc.sections
      .flatMap((s) => s.entries)
      .filter((e) => e.facts.some((f) => f.field === 'skill_category'));
    expect(rows.map((e) => e.facts[0]!.value.trim())).toEqual([
      'Leadership',
      'Backend',
      'Frontend',
    ]);
    expect(
      rows[0]!.facts
        .slice(1)
        .map((f) => f.value.trim())
        .join('\n'),
    ).toBe('Mentoring, Stakeholder\nCommunication');
    expect(
      rows[1]!.facts
        .slice(1)
        .map((f) => f.value.trim())
        .join('\n'),
    ).toBe('Java, C++, C#, .NET, Node.js, CI/CD');
    expect(
      rows[2]!.facts
        .slice(1)
        .map((f) => f.value.trim())
        .join('\n'),
    ).toBe('React, TypeScript');
    expect(
      doc.coverage
        .map((c) => parsed.source.text.slice(c.start, c.end))
        .join(''),
    ).toBe(parsed.source.text);
    expect(profileDocument(doc, sourceId, parsed.source.text)).toEqual(doc);
    expect(
      rows
        .flatMap((e) => e.facts)
        .every(
          (f) =>
            f.review === 'pending' &&
            f.evidence.every(
              (ref) =>
                ref.quote === parsed.source.text.slice(ref.start, ref.end) &&
                ref.quote.includes(f.value),
            ),
        ),
    ).toBe(true);
    expect(JSON.stringify(parsed)).toBe(before);
  },
);
