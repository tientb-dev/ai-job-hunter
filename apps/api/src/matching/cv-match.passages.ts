import { createHash } from 'node:crypto';
import type { ReviewedCvText } from '../reviewed-cv/reviewed-cv.text.js';

export function matchPassages(
  reviewed: ReviewedCvText,
  revisionId: string,
  eligible: ReadonlySet<string>,
) {
  const quotes = new Map<string, string>();
  const passages: [id: string, firstLine: number, lastLine: number][] = [];
  const { lines, text } = reviewed;
  for (const [first, line] of lines.entries()) {
    for (let last = first; last < Math.min(first + 3, lines.length); last++) {
      const end = lines[last]!;
      if (end.entryId !== line.entryId) break;
      const quote = text.slice(line.start, end.end);
      if (!eligible.has(quote)) continue;
      // Saved assessments identify passages by text. Only issue references
      // whose resolved quote will still identify the same source on read.
      if (
        text.indexOf(quote) !== line.start ||
        text.indexOf(quote, line.start + 1) >= 0
      )
        continue;
      const id = createHash('sha256')
        .update(JSON.stringify([revisionId, line.start, end.end, quote]))
        .digest('hex')
        .slice(0, 24);
      quotes.set(id, quote);
      passages.push([id, first + 1, last + 1]);
    }
  }
  return {
    quotes,
    input: {
      evidenceLines: lines.map((line) => text.slice(line.start, line.end)),
      passages,
    },
  };
}

export type MatchPassages = ReturnType<typeof matchPassages>;
