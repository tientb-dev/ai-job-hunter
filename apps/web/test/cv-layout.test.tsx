import { expect, test } from 'vitest';
import {
  reflow,
  sectionTitle,
  structuredRows,
} from '../src/features/inbox/cv-layout';
// Shared with the API export test so preview and PDF/DOCX rules cannot drift.
import cases from '../../api/test/support/cv-layout-cases.json';

test('preview layout rules match the export rules', () => {
  expect(cases.reflow).toHaveLength(11);
  for (const [input, output] of cases.reflow as [string, string][])
    expect(reflow(input)).toBe(output);
  for (const [kind, title] of Object.entries(cases.titles))
    expect(sectionTitle(kind)).toBe(title);
  for (const row of cases.rows)
    expect(
      structuredRows(
        row.kind,
        row.facts.map(([field, acceptedText], i) => ({
          id: `f${i}`,
          field: field!,
          acceptedText: acceptedText!,
        })),
      ).map((r) => [r.text, r.style, r.aside ?? null]),
    ).toEqual(row.rows);
});
