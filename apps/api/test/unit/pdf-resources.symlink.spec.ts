import { expect, jest, test } from '@jest/globals';

// A manifest file that is a symlink resolving outside the bundled directory is
// seen by fetch() only through realpath(). Simulate that resolution; node_modules
// is never modified.
const actual =
  await jest.requireActual<typeof import('node:fs/promises')>(
    'node:fs/promises',
  );
const escaped = 'LiberationSans-Regular.ttf';
jest.unstable_mockModule('node:fs/promises', () => ({
  ...actual,
  realpath: async (path: Parameters<typeof actual.realpath>[0]) =>
    String(path).endsWith(escaped)
      ? `/outside-bundle/${escaped}`
      : actual.realpath(path),
}));
const { BundledPdfResources } =
  await import('../../src/extraction/pdf.resources.js');

test('denies a manifest resource whose real path escapes the bundle', async () => {
  const resources = new BundledPdfResources();
  await expect(
    resources.fetch({ kind: 'standardFontDataUrl', filename: escaped }),
  ).rejects.toMatchObject({ code: 'RESOURCE_ACCESS_DENIED' });
  expect(resources.failed).toBe(true);
});

test('other bundled resources still resolve inside the bundle', async () => {
  const resources = new BundledPdfResources();
  const bytes = await resources.fetch({
    kind: 'cMapUrl',
    filename: 'Adobe-Japan1-UCS2.bcmap',
  });
  expect(bytes.byteLength).toBeGreaterThan(100);
  expect(resources.failed).toBe(false);
});
