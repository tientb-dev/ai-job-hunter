import { expect, test } from '@jest/globals';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  CV_TEMPLATES,
  canonicalExport,
  renderPdf,
} from '../../src/tailored-cv/tailored-cv-export.js';
import { exportFixtures } from '../support/cv-export-fixtures.js';

const squash = (t: string) =>
  t.normalize('NFC').toLocaleUpperCase('vi-VN').replace(/\s/gu, '');

for (const template of CV_TEMPLATES)
  for (const fixture of exportFixtures().filter((f) =>
    ['standard', 'multi-page', 'vietnamese'].includes(f.id),
  ))
    test(`${template} PDF keeps all text inside the page: ${fixture.id}`, async () => {
      const canonical = canonicalExport(fixture.document, 3);
      const pdf = await renderPdf(canonical, template);
      const loaded = await getDocument({
        data: new Uint8Array(pdf),
        useSystemFonts: false,
        verbosity: 0,
      }).promise;
      let text = '';
      for (let n = 1; n <= loaded.numPages; n++) {
        const page = await loaded.getPage(n);
        for (const item of (await page.getTextContent()).items) {
          if (!('str' in item)) continue;
          text += item.str;
          if (!item.str.trim()) continue;
          expect(item.transform[4]).toBeGreaterThanOrEqual(39);
          expect(item.transform[4] + item.width).toBeLessThanOrEqual(
            page.view[2]! - 39 + 1,
          );
          expect(item.transform[5]).toBeGreaterThan(30);
          expect(item.transform[5]).toBeLessThan(page.view[3]! - 30);
        }
      }
      const expected = canonical.blocks
        .map((b) => [b.label, b.text, b.aside].filter(Boolean).join(''))
        .join('');
      expect(squash(text)).toBe(squash(expected));
      if (fixture.id === 'multi-page')
        expect(loaded.numPages).toBeGreaterThan(1);
    });

test('templates render visibly different PDFs', async () => {
  const canonical = canonicalExport(exportFixtures()[0]!.document, 3);
  const sizes = new Set(
    await Promise.all(
      CV_TEMPLATES.map(async (t) =>
        (await renderPdf(canonical, t))
          .toString('latin1')
          .replace(/\/CreationDate[^\n]*/u, ''),
      ),
    ),
  );
  expect(sizes.size).toBe(3);
});
