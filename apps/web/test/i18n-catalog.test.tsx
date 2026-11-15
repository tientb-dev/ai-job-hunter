import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { VI_TEXT } from '../src/app/i18n-vi';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.tsx?$/.test(name)
        ? [path]
        : [];
  });
}

// Every literal tr('…') key in the app must have a Vietnamese entry.
test('every tr() text has a Vietnamese translation with the same placeholders', () => {
  const keys = new Set<string>();
  for (const file of sourceFiles(join(__dirname, '../src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /\btr\(\s*'((?:[^'\\]|\\.)*)'/g,
    ))
      keys.add(match[1]!.replace(/\\(.)/g, '$1'));
  }
  expect(keys.size).toBeGreaterThan(1000);
  const missing = [...keys].filter((key) => !(key in VI_TEXT));
  expect(missing).toEqual([]);
  // A translation may drop an English plural placeholder, but never add one.
  const invented = Object.entries(VI_TEXT).filter(([key, value]) =>
    (value.match(/\{\w+\}/g) ?? []).some((name) => !key.includes(name)),
  );
  expect(invented).toEqual([]);
});

test('tr translates in Vietnamese only and passes unknown text through', async () => {
  const { setLocale, tr } = await import('../src/app/i18n');
  setLocale('vi-VN');
  expect(tr('Save draft')).toBe('Lưu nháp');
  expect(tr('{n} of {total} prepared', { n: 2, total: 5 })).toBe(
    'Đã chuẩn bị 2/5',
  );
  expect(tr('s')).toBe(''); // English plural suffix
  expect(tr('Senior Java Developer')).toBe('Senior Java Developer'); // user data
  setLocale('en-US');
  expect(tr('Save draft')).toBe('Save draft');
});
