// Run from apps/api after test compilation: node ../../docs/audits/p8-export-acceptance.probe.mjs
// Synthetic only; writes new acceptance artifacts, never reads CV/database data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const api = new URL('../../apps/api/', import.meta.url);
const require = createRequire(new URL('package.json', api));
const { extractRawText } = require('mammoth');
const pdfModule = import.meta.resolve
  ? require.resolve('pdfjs-dist/package.json')
  : null;
const canvasRequire = createRequire(pdfModule);
const { createCanvas } = canvasRequire('@napi-rs/canvas');
const { getDocument } = await import(
  new URL('legacy/build/pdf.mjs', new URL('./', `file://${pdfModule}`))
);
const { exportFixtures } = await import(
  new URL('.test-dist/test/support/cv-export-fixtures.js', api)
);
const { canonicalExport, renderDocx, renderPdf } = await import(
  new URL('dist/tailored-cv/tailored-cv-export.js', api)
);
const output = new URL('../../artifacts/p8-acceptance/', import.meta.url);
await mkdir(output, { recursive: true });
const compact = (text) => text.normalize('NFC').replace(/\s/gu, '');
const results = [];
for (const fixture of exportFixtures()) {
  const canonical = canonicalExport(fixture.document, 3),
    expected = canonical.blocks.map((b) => b.text).join('\n');
  const docx = await renderDocx(canonical),
    pdf = await renderPdf(canonical);
  const docxText = (await extractRawText({ buffer: docx })).value;
  assert.equal(compact(docxText), compact(expected));
  const loading = getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
    verbosity: 0,
  });
  const loaded = await loading.promise;
  let text = '';
  const pages = [];
  try {
    for (let i = 1; i <= loaded.numPages; i++) {
      const page = await loaded.getPage(i),
        content = await page.getTextContent(),
        items = content.items.filter((item) => 'str' in item);
      assert.ok(items.some((item) => item.str.trim()));
      for (const item of items) {
        assert.ok(item.transform[4] >= 49);
        assert.ok(item.transform[4] + item.width <= page.view[2] - 48);
        assert.ok(
          item.transform[5] > 40 && item.transform[5] < page.view[3] - 40,
        );
      }
      text += items.map((item) => item.str).join('\n');
      const viewport = page.getViewport({ scale: 1.25 }),
        canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        canvas,
      }).promise;
      const filename = `${fixture.id}-page-${i}.png`;
      await writeFile(new URL(filename, output), canvas.toBuffer('image/png'));
      pages.push(filename);
    }
    assert.equal(compact(text), compact(expected));
    results.push({
      fixture: fixture.id,
      pages: loaded.numPages,
      docxTextParity: true,
      pdfTextParity: true,
      withinPageBounds: true,
      noBlankPages: true,
      renderedPages: pages,
      docxViewer: 'UNVERIFIED: Word/LibreOffice unavailable',
    });
  } finally {
    await loading.destroy();
  }
  await Promise.all([
    writeFile(new URL(`${fixture.id}.docx`, output), docx),
    writeFile(new URL(`${fixture.id}.pdf`, output), pdf),
    writeFile(
      new URL(`${fixture.id}.canonical.json`, output),
      JSON.stringify(canonical, null, 2) + '\n',
    ),
  ]);
}
await writeFile(
  new URL('export-results.json', output),
  JSON.stringify(results, null, 2) + '\n',
);
console.log(JSON.stringify(results, null, 2));
