import { createHash } from 'node:crypto';
import { ExtractionError } from './extraction.errors.js';

export interface PdfTextItem {
  readonly start: number;
  readonly end: number;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly horizontal: boolean;
}
export interface PdfLayout {
  readonly version: '1';
  readonly textHash: string;
  readonly complete: boolean;
  readonly items: readonly PdfTextItem[];
}
export const PDF_LAYOUT_ITEMS = 768;
export const PDF_LAYOUT_BYTES = 48 * 1024;
export const pdfTextHash = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

export function validatePdfLayout(input: unknown, text: string): PdfLayout {
  const invalid = (): never => {
    throw new ExtractionError('INVALID_SOURCE');
  };
  if (!input || typeof input !== 'object') return invalid();
  const layout = input as PdfLayout;
  if (
    Object.keys(input).sort().join(',') !== 'complete,items,textHash,version' ||
    layout.version !== '1' ||
    layout.textHash !== pdfTextHash(text) ||
    typeof layout.complete !== 'boolean' ||
    !Array.isArray(layout.items) ||
    layout.items.length > PDF_LAYOUT_ITEMS ||
    Buffer.byteLength(JSON.stringify(input)) > PDF_LAYOUT_BYTES ||
    (!layout.complete && layout.items.length)
  )
    return invalid();
  let end = 0;
  for (const item of layout.items) {
    if (
      !item ||
      Object.keys(item).sort().join(',') !==
        'end,height,horizontal,page,start,width,x,y' ||
      !Number.isInteger(item.start) ||
      !Number.isInteger(item.end) ||
      item.start < end ||
      item.end <= item.start ||
      item.end > text.length ||
      !Number.isInteger(item.page) ||
      item.page < 1 ||
      item.page > 20 ||
      ![item.x, item.y, item.width, item.height].every(Number.isFinite) ||
      Math.abs(item.x) > 100000 ||
      Math.abs(item.y) > 100000 ||
      item.width < 0 ||
      item.width > 100000 ||
      item.height <= 0 ||
      item.height > 100000 ||
      typeof item.horizontal !== 'boolean' ||
      !text.slice(item.start, item.end).trim() ||
      (/[\uD800-\uDBFF]/u.test(text.charAt(item.start - 1)) &&
        /[\uDC00-\uDFFF]/u.test(text.charAt(item.start))) ||
      (/[\uD800-\uDBFF]/u.test(text.charAt(item.end - 1)) &&
        /[\uDC00-\uDFFF]/u.test(text.charAt(item.end))) ||
      text.slice(end, item.start).trim()
    )
      return invalid();
    end = item.end;
  }
  if (layout.complete && text.slice(end).trim()) return invalid();
  return structuredClone(layout);
}

export function boundedPdfLayout(
  text: string,
  items: PdfTextItem[],
  complete: boolean,
): PdfLayout {
  const layout = {
    version: '1' as const,
    textHash: pdfTextHash(text),
    complete,
    items,
  };
  if (!complete || Buffer.byteLength(JSON.stringify(layout)) > PDF_LAYOUT_BYTES)
    return { ...layout, complete: false, items: [] };
  try {
    return validatePdfLayout(layout, text);
  } catch {
    return { ...layout, complete: false, items: [] };
  }
}
