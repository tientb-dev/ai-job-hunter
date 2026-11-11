import { parseDocx } from '../../src/extraction/docx.parser.js';
import { readFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  canonicalExport,
  stackedLabel,
  cvRows,
  reflow,
  titles,
  renderDocx,
  renderPdf,
} from '../../src/tailored-cv/tailored-cv-export.js';
import { exportFixtures } from '../support/cv-export-fixtures.js';
import { professionalProfileHref } from '../../src/tailored-cv/profile-links.js';
const compact = (text: string) => text.normalize('NFC').replace(/\s/gu, '');
for (const fixture of exportFixtures())
  test(`DOCX/PDF factual parity, Unicode and page geometry: ${fixture.id}`, async () => {
    const canonical = canonicalExport(fixture.document, 3);
    const docx = await renderDocx(canonical),
      pdf = await renderPdf(canonical);
    const wordText = (await mammoth.extractRawText({ buffer: docx })).value;
    const expected = canonical.blocks
      .map((b) => [b.label, b.text, b.aside].filter(Boolean).join('\n'))
      .join('\n');
    expect(compact(wordText)).toBe(compact(expected));
    if (wordText.length <= 12000)
      expect(compact((await parseDocx(new Uint8Array(docx))).source.text)).toBe(
        compact(expected),
      );
    else
      await expect(parseDocx(new Uint8Array(docx))).rejects.toMatchObject({
        code: 'DOCUMENT_TOO_LARGE',
      });
    const loading = getDocument({
      data: new Uint8Array(pdf),
      useSystemFonts: false,
      verbosity: 0,
    });
    const loaded = await loading.promise;
    let pdfText = '';
    try {
      for (let n = 1; n <= loaded.numPages; n++) {
        const page = await loaded.getPage(n),
          content = await page.getTextContent();
        const items = content.items.filter(
          (
            item,
          ): item is import('pdfjs-dist/types/src/display/api.js').TextItem =>
            'str' in item,
        );
        expect(items.some((item) => item.str.trim())).toBe(true);
        for (const item of items) {
          expect(item.transform[4]).toBeGreaterThanOrEqual(49);
          expect(item.transform[4] + item.width).toBeLessThanOrEqual(
            page.view[2]! - 49 + 1,
          );
          expect(item.transform[5]).toBeGreaterThan(40);
          expect(item.transform[5]).toBeLessThan(page.view[3]! - 40);
        }
        pdfText += items.map((item) => item.str).join('\n');
        expect(page.view[2]).toBeCloseTo(595.28, 0);
        expect(page.view[3]).toBeCloseTo(841.89, 0);
      }
      expect(compact(pdfText)).toBe(compact(expected));
      if (fixture.id !== 'multi-page')
        expect(loaded.numPages).toBe(fixture.id === 'long-urls' ? 2 : 1);
      if (fixture.id === 'multi-page')
        expect(loaded.numPages).toBeGreaterThan(1);
    } finally {
      await loading.destroy();
    }
  }, 15000);
test('requires exact approval and excludes only explicitly excluded facts, never pending metadata', () => {
  const doc = exportFixtures()[0]!.document;
  const fact = doc.sections[0]!.entries[0]!.facts[0]!;
  fact.proposedWording = {
    text: 'DO NOT EXPORT THIS PROPOSAL',
    status: 'pending',
    requirementIds: [],
  };
  doc.review!.factReviews[fact.id]!.proposal = 'rejected';
  expect(JSON.stringify(canonicalExport(doc, 3))).not.toContain(
    'DO NOT EXPORT',
  );
  doc.review!.factReviews[fact.id]!.exportIncluded = false;
  expect(JSON.stringify(canonicalExport(doc, 3))).not.toContain(
    fact.acceptedText,
  );
  expect(() => canonicalExport(doc, 2)).toThrow();
  doc.review!.approval = null;
  expect(() => canonicalExport(doc, 3)).toThrow();
});
test('unsupported glyphs and excessive paragraphs fail explicitly rather than silently dropping content', async () => {
  const content = {
    templateVersion: '1' as const,
    blocks: [
      { text: 'Unsupported 🦄', style: 'body' as const, entryStart: true },
    ],
  };
  await expect(renderPdf(content)).rejects.toMatchObject({
    errorCode: 'CV_EXPORT_UNSUPPORTED_TEXT',
  });
  await expect(renderDocx(content)).rejects.toMatchObject({
    errorCode: 'CV_EXPORT_UNSUPPORTED_TEXT',
  });
});

test('excessive explicit lines and empty export selections fail without silently truncating', () => {
  const doc = exportFixtures()[0]!.document;
  doc.sections[0]!.entries[0]!.facts[0]!.acceptedText = 'Line\n'.repeat(1201);
  expect(() => canonicalExport(doc, 3)).toThrow('budget');
  for (const state of Object.values(doc.review!.factReviews))
    state.exportIncluded = false;
  expect(() => canonicalExport(doc, 3)).toThrow('Include at least one');
});

test('outer source delimiters do not create blank export pages or mutate accepted facts', async () => {
  const doc = exportFixtures()[0]!.document;
  const fact = doc.sections[0]!.entries[0]!.facts[0]!;
  fact.acceptedText = '  Nguyễn Minh Anh  ' + '\n'.repeat(1000);
  const original = fact.acceptedText;
  const content = canonicalExport(doc, 3);
  const pdf = await renderPdf(content),
    task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    expect((await task.promise).numPages).toBe(1);
  } finally {
    await task.destroy();
  }
  expect(fact.acceptedText).toBe(original);
  expect(content.blocks[0]!.text).toBe('Nguyễn Minh Anh');
});

test('multi-role hierarchy, skill categories and nonbreaking communication phrase match in DOCX/PDF', async () => {
  const { cvPolishFixture } = await import('../support/cv-polish-fixture.js');
  const { inspectDocxZip } = await import('../../src/extraction/docx-zip.js');
  const { DOMParser } = await import('@xmldom/xmldom');
  const document = cvPolishFixture();
  const before = structuredClone(document);
  const canonical = canonicalExport(document, 3);
  const roles = [
    'Junior Developer',
    'Software Engineer — Kỹ sư phần mềm',
    'Senior Engineer',
  ];
  const categories = [
    'Programming, databases and development tools',
    'Collaboration, documentation and communication practices',
  ];
  // Roles are bold title rows; categories label their skills row (as in preview).
  for (const text of roles)
    expect(canonical.blocks.find((b) => b.text === text)?.style).toBe('anchor');
  for (const text of categories)
    expect(canonical.blocks.find((b) => b.label === text)?.style).toBe('body');
  const [docx, pdf] = await Promise.all([
    renderDocx(canonical),
    renderPdf(canonical),
  ]);
  expect(document).toEqual(before);
  const xml = (await inspectDocxZip(docx)).xml
    .get('word/document.xml')!
    .toString();
  const word = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = Array.from(word.getElementsByTagName('w:p'));
  const firstRun = (p: (typeof paragraphs)[number]) =>
    p.getElementsByTagName('w:t')[0]?.textContent;
  for (const text of roles) {
    const paragraph = paragraphs.find((p) => firstRun(p) === text)!;
    expect(paragraph).toBeDefined();
    expect(paragraph.getElementsByTagName('w:b').length).toBeGreaterThan(0);
    expect(paragraph.getElementsByTagName('w:keepNext').length).toBe(1);
    expect(paragraph.getElementsByTagName('w:keepLines').length).toBe(1);
  }
  for (const text of categories) {
    const paragraph = paragraphs.find((p) => firstRun(p) === text)!;
    expect(paragraph).toBeDefined();
    expect(paragraph.getElementsByTagName('w:b').length).toBeGreaterThan(0);
    // These long categories stack above their values instead of a column.
    expect(paragraph.getElementsByTagName('w:tab').length).toBe(0);
    expect(paragraph.getElementsByTagName('w:br').length).toBeGreaterThan(0);
  }
  expect(xml).toContain('Stakeholder\u00a0Communication');
  const wordText = (await mammoth.extractRawText({ buffer: docx })).value;
  const expected = canonical.blocks
    .map((b) => [b.label, b.text, b.aside].filter(Boolean).join('\n'))
    .join('\n');
  expect(compact(wordText)).toBe(compact(expected));
  const task = getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
    fontExtraProperties: true,
    verbosity: 0,
  });
  try {
    const loaded = await task.promise;
    let pdfText = '',
      phraseTogether = false;
    const boldRoles = new Set<string>();
    for (let n = 1; n <= loaded.numPages; n++) {
      const page = await loaded.getPage(n);
      await page.getOperatorList();
      const text = await page.getTextContent();
      const items = text.items.filter(
        (
          item,
        ): item is import('pdfjs-dist/types/src/display/api.js').TextItem =>
          'str' in item,
      );
      for (const item of items) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(49);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(
          page.view[2]! - 49 + 1,
        );
        expect(item.transform[5]).toBeGreaterThan(40);
        if (roles.includes(item.str)) {
          const font = page.commonObjs.get(item.fontName) as { name: string };
          expect(font.name).toMatch(/Bold/u);
          boldRoles.add(item.str);
        }
      }
      const lines = new Map<number, string>();
      for (const item of items)
        lines.set(
          item.transform[5]!,
          (lines.get(item.transform[5]!) ?? '') + item.str,
        );
      phraseTogether ||= [...lines.values()].some((line) =>
        /Stakeholder\s+Communication/u.test(line),
      );
      pdfText += items.map((item) => item.str).join('\n');
    }
    expect(boldRoles.size).toBe(roles.length);
    expect(phraseTogether).toBe(true);
    expect(compact(pdfText)).toBe(compact(expected));
  } finally {
    await task.destroy();
  }
}, 15000);
test('verified profile links move once to the contact header; other links stay in Links', async () => {
  const doc = exportFixtures()[0]!.document;
  const links = doc.sections.find((s) => s.kind === 'links')!;
  const url = 'https://www.linkedin.com/in/minh-anh-example';
  links.entries[0]!.facts.push({
    ...structuredClone(links.entries[0]!.facts[0]!),
    id: 'linkedin',
    acceptedText: url,
  });
  doc.review!.factReviews.linkedin = structuredClone(
    doc.review!.factReviews[links.entries[0]!.facts[0]!.id]!,
  );
  const before = JSON.stringify(doc);
  const { blocks } = canonicalExport(doc, 3);
  expect(JSON.stringify(doc)).toBe(before);
  const texts = blocks.map((b) => b.text);
  expect(texts.filter((t) => t === url)).toHaveLength(1);
  const profile = blocks.find((b) => b.text === url)!;
  expect(profile).toMatchObject({ section: 'contact', href: url });
  expect(texts.indexOf(url)).toBeLessThan(texts.indexOf('Summary'));
  const other = texts.indexOf('https://example.invalid/minh-anh');
  expect(other).toBeGreaterThan(texts.indexOf('Links'));
  expect(blocks[other]!.href).toBeUndefined();
  const html = (
    await mammoth.convertToHtml({
      buffer: await renderDocx({ templateVersion: '1', blocks }),
    })
  ).value;
  expect(html).toContain(`<a href="${url}">${url}</a>`);
  expect(html.split(url).length - 1).toBe(2);
  const pdf = (await renderPdf({ templateVersion: '1', blocks })).toString(
    'latin1',
  );
  expect(pdf).toContain(`/URI (${url})`);

  links.entries[0]!.facts = links.entries[0]!.facts.filter(
    (f) => f.id === 'linkedin',
  );
  const onlyProfile = canonicalExport(doc, 3).blocks.map((b) => b.text);
  expect(onlyProfile).not.toContain('Links');
  expect(onlyProfile.filter((t) => t === url)).toHaveLength(1);
});
test('only full LinkedIn/GitHub profile URLs are promoted', () => {
  for (const [text, href] of [
    [
      'https://www.linkedin.com/in/jane-doe',
      'https://www.linkedin.com/in/jane-doe',
    ],
    ['linkedin.com/in/jane-doe/', 'https://linkedin.com/in/jane-doe/'],
    ['https://github.com/janedoe', 'https://github.com/janedoe'],
    ['https://www.linkedin.com/company/acme', null],
    ['https://github.com/janedoe/repo', null],
    ['https://github.com/orgs', null],
    ['https://janedoe.dev', null],
    ['LinkedIn: https://www.linkedin.com/in/jane-doe', null],
    ['https://linkedin.com.evil.example/in/jane-doe', null],
  ] as const)
    expect(professionalProfileHref(text)).toBe(href);
});
test('shared CV rows: reflow joins PDF wraps only; titles carry their dates', () => {
  // Same cases as the web preview test (shared file prevents drift).
  const cases = JSON.parse(
    readFileSync('test/support/cv-layout-cases.json', 'utf8'),
  ) as {
    titles: Record<string, string>;
    reflow: [string, string][];
    rows: {
      kind: string;
      facts: [string, string][];
      rows: [string, string, string | null][];
    }[];
  };
  for (const [input, output] of cases.reflow)
    expect(reflow(input)).toBe(output);
  expect(titles).toEqual(cases.titles);
  for (const row of cases.rows)
    expect(
      cvRows(
        row.kind as Parameters<typeof cvRows>[0],
        row.facts.map(
          ([field, acceptedText], i) =>
            ({ id: `f${i}`, field, acceptedText }) as Parameters<
              typeof cvRows
            >[1][number],
        ),
      ).map((r) => [r.text, r.style, r.aside ?? null]),
    ).toEqual(row.rows);
  const fact = (field: string, acceptedText: string) =>
    ({ id: field, field, acceptedText }) as Parameters<
      typeof cvRows
    >[1][number];
  expect(
    cvRows('experience', [
      fact('employer', 'Example Studio'),
      fact('dates', '2020 – 2026'),
      fact('role', 'Team Lead'),
      fact('project', 'ERP platform'),
    ]).map(({ text, style, aside }) => [text, style, aside]),
  ).toEqual([
    ['Example Studio', 'anchor', '2020 – 2026'],
    ['Team Lead', 'anchor', undefined],
    ['ERP platform', 'detail', undefined],
  ]);
  expect(
    cvRows('skills', [
      fact('skill_category', 'Backend:'),
      fact('skill', 'Java, Spring Boot'),
    ]).map(({ label, text }) => [label, text]),
  ).toEqual([['Backend', 'Java, Spring Boot']]);
});

async function polishExport(copies: number, shortLabel = false) {
  const { cvPolishFixture } = await import('../support/cv-polish-fixture.js');
  const { initialReview } =
    await import('../../src/tailored-cv/tailored-draft-review.policy.js');
  const document = cvPolishFixture();
  const experience = document.sections.find((s) => s.kind === 'experience')!;
  experience.entries = Array.from({ length: copies }, (_, copy) =>
    experience.entries.map((entry) => ({
      ...entry,
      id: `${entry.id}-${copy}`,
      facts: entry.facts.map((fact) => ({ ...fact, id: `${fact.id}-${copy}` })),
    })),
  ).flat();
  if (shortLabel)
    document.sections
      .find((s) => s.kind === 'skills')!
      .entries[0]!.facts.find(
        (f) => f.field === 'skill_category',
      )!.acceptedText = 'Languages';
  document.review = initialReview(document);
  document.review.approval = {
    revision: 3,
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
  return canonicalExport(document, 3);
}

test('skill labels stack only when long and project names are titles', async () => {
  expect(stackedLabel('Languages')).toBe(false);
  expect(
    stackedLabel('Collaboration, documentation and communication practices'),
  ).toBe(true);
  const canonical = await polishExport(1, true);
  const project = canonical.blocks.find(
    (b) => b.section === 'projects' && b.text === 'University database project',
  );
  expect(project?.style).toBe('anchor');
  const { inspectDocxZip } = await import('../../src/extraction/docx-zip.js');
  const xml = (await inspectDocxZip(await renderDocx(canonical))).xml
    .get('word/document.xml')!
    .toString();
  // The short skills row (not the "Languages" section heading) keeps its column.
  expect(xml).toMatch(
    /<w:tab w:val="left" w:pos="2560"\/>(?:(?!<\/w:p>).)*?>Languages<\/w:t>/u,
  );
});

// Before PR12, one copy left "Senior Engineer" alone at the foot of page 1.
test.each([1, 2, 3])(
  'PDF never ends a page on a heading and breaks pages without large gaps (%i role copies)',
  async (copies) => {
    const canonical = await polishExport(copies);
    const headings = new Set(
      canonical.blocks
        .filter((b) => b.style === 'heading' || b.style === 'anchor')
        .map((b) => b.text),
    );
    const task = getDocument({
      data: new Uint8Array(await renderPdf(canonical)),
      useSystemFonts: false,
      verbosity: 0,
    });
    try {
      const loaded = await task.promise;
      expect(loaded.numPages).toBeGreaterThan(1);
      for (let n = 1; n <= loaded.numPages; n++) {
        const page = await loaded.getPage(n);
        const items = (await page.getTextContent()).items.filter(
          (
            item,
          ): item is import('pdfjs-dist/types/src/display/api.js').TextItem =>
            'str' in item && item.str.trim() !== '',
        );
        // Lowest line on the page (PDF y grows upwards); dates sit beside titles.
        const bottom = Math.min(...items.map((item) => item.transform[5]!));
        const lastLine = items
          .filter((item) => item.transform[5] === bottom)
          .map((item) => item.str)
          .find((text) => !/^\d{4}/u.test(text))!;
        expect([n, lastLine, headings.has(lastLine)]).toEqual([
          n,
          lastLine,
          false,
        ]);
        // No early breaks: every page but the last is filled near the margin.
        if (n < loaded.numPages)
          expect([n, bottom < 45 + 90]).toEqual([n, true]);
      }
    } finally {
      await task.destroy();
    }
  },
  15000,
);
