import { pdfObjects, stream } from './pdf-fixtures.js';
export type SkillsPdfOrder = 'row' | 'column' | 'interleaved';
export function skillsPdf(
  order: SkillsPdfOrder = 'row',
  variant: 'clear' | 'ambiguous' | 'rotated' | 'unknown' | 'overlap' = 'clear',
): Uint8Array {
  const cells: Record<string, [string, number, number]> = {
    b: ['Backend', 50, 100],
    f: ['Frontend', 50, 154],
    l: [variant === 'unknown' ? 'Uncertain craft' : 'Leadership', 50, 208],
    b1: [
      'Java, Spring Boot, C++, C#',
      180,
      variant === 'ambiguous' ? 127 : 100,
    ],
    b2: ['.NET, Node.js, CI/CD', 180, 116],
    f1: ['React, TypeScript', variant === 'overlap' ? 80 : 180, 154],
    f2: ['Accessibility testing', 180, 170],
    l1: ['Mentoring, Code Review', 180, 208],
  };
  const orders = {
    row: ['b', 'b1', 'b2', 'f', 'f1', 'f2', 'l', 'l1'],
    column: ['b', 'f', 'l', 'b1', 'b2', 'f1', 'f2', 'l1'],
    interleaved: ['b', 'f', 'l', 'b1', 'f1', 'l1', 'b2', 'f2'],
  };
  const draw = (text: string, x: number, y: number) =>
    `BT /F1 11 Tf ${variant === 'rotated' ? '0.98 0.2 -0.2 0.98' : '1 0 0 1'} ${x} ${792 - y} Tm (${text.replace(/[\\()]/gu, '\\$&')}) Tj ET`;
  const content = [
    draw('Skills', 50, 60),
    ...orders[order].map((key) => draw(...cells[key]!)),
  ].join('\n');
  return pdfObjects([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    stream(content),
  ]);
}

// Synthetic text with the measured column positions, font height and baseline
// spacing of the reported failure; no private CV content is retained.
export function categoryWordValuePdf(order: SkillsPdfOrder): Uint8Array {
  const cells: Record<string, [string, number, number]> = {
    l: ['Leadership', 17.985, 253.29],
    l1: ['Mentoring, Stakeholder', 159.183, 253.29],
    l2: ['Communication', 159.183, 268.277],
    b: ['Backend', 17.985, 293.756],
    b1: ['Java, C++, C#, .NET, Node.js, CI/CD', 159.183, 293.756],
    f: ['Frontend', 17.985, 319.984],
    f1: ['React, TypeScript', 159.183, 319.984],
  };
  const orders = {
    row: ['l', 'l1', 'l2', 'b', 'b1', 'f', 'f1'],
    column: ['l', 'b', 'f', 'l1', 'l2', 'b1', 'f1'],
    interleaved: ['l', 'b', 'f', 'l1', 'b1', 'f1', 'l2'],
  };
  const draw = (text: string, x: number, y: number) =>
    `BT /F1 9.742 Tf 1 0 0 1 ${x} ${792 - y} Tm (${text}) Tj ET`;
  const content = [
    draw('Skills', 17.985, 230),
    ...orders[order].map((key) => draw(...cells[key]!)),
  ].join('\n');
  return pdfObjects([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    stream(content),
  ]);
}
