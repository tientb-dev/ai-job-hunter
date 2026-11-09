import {
  validatePdfLayout,
  type PdfLayout,
  type PdfTextItem,
} from '../extraction/pdf-layout.js';
import {
  knownSkillCategory,
  type Passage,
} from './source-profile-structure.js';

type OwnedItem = {
  item: PdfTextItem;
  row: string;
  order: number;
  field: 'skill' | 'skill_category';
};
// Only a single horizontal category/value table inside an explicit Skills region.
// Geometry supplies ownership; vocabulary alone never splits a passage.
function recognize(
  source: string,
  region: Passage[],
  layout: PdfLayout,
): OwnedItem[] | null {
  if (!layout.complete || region.some((p) => p.issue)) return null;
  const body = region.filter((p) => !p.heading);
  if (!body.length) return null;
  const start = body[0]!.start,
    end = body.at(-1)!.end;
  const items = layout.items.filter((i) => i.start < end && i.end > start);
  if (
    !items.length ||
    items.some(
      (i) =>
        i.start < start ||
        i.end > end ||
        !i.horizontal ||
        i.page !== items[0]!.page,
    )
  )
    return null;
  if (
    items.some((i) => !body.some((p) => i.start >= p.start && i.end <= p.end))
  )
    return null;
  const left = Math.min(...items.map((i) => i.x));
  const categories = items
    .filter(
      (i) =>
        // A category-like word can also be a wrapped value (Communication).
        // Only the independently positioned left column supplies row anchors.
        Math.abs(i.x - left) <= i.height * 0.4 &&
        knownSkillCategory.test(
          source.slice(i.start, i.end).trim().replace(/:$/u, ''),
        ),
    )
    .sort((a, b) => a.y - b.y);
  if (
    categories.length < 2 ||
    categories.length > 16 ||
    new Set(
      categories.map((i) => source.slice(i.start, i.end).trim().toLowerCase()),
    ).size !== categories.length
  )
    return null;
  const h = categories[0]!.height,
    tolerance = Math.max(1.5, h * 0.3);
  if (
    categories.some(
      (c, index) =>
        Math.abs(c.x - categories[0]!.x) > h * 0.4 ||
        Math.abs(c.height - h) > h * 0.3 ||
        (index > 0 && c.y - categories[index - 1]!.y < h * 2.5),
    )
  )
    return null;
  const values = items
    .filter((i) => !categories.includes(i))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rightEdge = Math.max(...categories.map((c) => c.x + c.width));
  if (
    !values.length ||
    values.some((i) => i.x - rightEdge < h || Math.abs(i.height - h) > h * 0.3)
  )
    return null;
  const lines: PdfTextItem[][] = [];
  for (const item of values) {
    let line = lines.at(-1);
    if (!line || Math.abs(item.y - line[0]!.y) > tolerance) {
      line = [];
      lines.push(line);
    }
    line.push(item);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  const x = lines[0]![0]!.x;
  if (
    lines.some(
      (line) =>
        Math.abs(line[0]!.x - x) > h * 0.5 ||
        line.some(
          (item, index) =>
            index > 0 &&
            (item.x < line[index - 1]!.x + line[index - 1]!.width - 1 ||
              item.x - (line[index - 1]!.x + line[index - 1]!.width) > h * 3),
        ),
    )
  )
    return null;
  const owned: OwnedItem[] = [];
  for (const [index, category] of categories.entries()) {
    const row = `pdf-skills-${category.page}-${category.start}`;
    const next = categories[index + 1];
    const rowLines = lines.filter(
      (line) =>
        line[0]!.y >= category.y - tolerance &&
        (!next || line[0]!.y < next.y - tolerance),
    );
    if (
      !rowLines.length ||
      Math.abs(rowLines[0]![0]!.y - category.y) > tolerance
    )
      return null;
    let previous = category.y;
    owned.push({
      item: category,
      row,
      order: index * 1000,
      field: 'skill_category',
    });
    for (const [lineIndex, line] of rowLines.entries()) {
      const y = line[0]!.y;
      if (
        lineIndex > 0 &&
        (y - previous < h * 0.7 ||
          y - previous > h * 1.9 ||
          (next && next.y - y < h * 0.7))
      )
        return null;
      previous = y;
      for (const [fragment, item] of line.entries())
        owned.push({
          item,
          row,
          order: index * 1000 + 1 + lineIndex * 100 + fragment,
          field: 'skill',
        });
    }
  }
  return owned.length === items.length ? owned : null;
}

export function skillsLayoutPassages(
  source: string,
  passages: Passage[],
  input?: PdfLayout,
): Passage[] {
  if (!input) return passages;
  let layout: PdfLayout | undefined;
  try {
    layout = validatePdfLayout(input, source);
  } catch {
    /* Untrusted/stale hints cannot authorize associations. */
  }
  const result: Passage[] = [];
  for (let index = 0; index < passages.length;) {
    const first = passages[index]!;
    if (first.kind !== 'skills') {
      result.push(first);
      index++;
      continue;
    }
    const region: Passage[] = [];
    do {
      region.push(passages[index++]!);
    } while (
      index < passages.length &&
      passages[index]!.kind === 'skills' &&
      !passages[index]!.heading
    );
    const owned = layout ? recognize(source, region, layout) : null;
    if (!owned) {
      result.push(
        ...region.map((p) => {
          if (p.heading) return p;
          const ambiguous = { ...p, uncertain: true };
          // Preserve text but remove last-category hints that could mispair it.
          if (['skill', 'skill_category'].includes(ambiguous.hint ?? ''))
            delete ambiguous.hint;
          return ambiguous;
        }),
      );
      continue;
    }
    for (const p of region) {
      if (p.heading) {
        result.push(p);
        continue;
      }
      const fragments = owned
        .filter((o) => o.item.start >= p.start && o.item.end <= p.end)
        .sort((a, b) => a.item.start - b.item.start);
      if (!fragments.length) {
        result.push({ ...p, uncertain: true });
        continue;
      }
      for (const [i, o] of fragments.entries()) {
        const start = i === 0 ? p.start : o.item.start;
        const end = fragments[i + 1]?.item.start ?? p.end;
        const piece: Passage = {
          ...p,
          start,
          end,
          text: source.slice(start, end),
          hint: o.field,
          uncertain: false,
          skillRow: o.row,
          skillOrder: o.order,
        };
        delete piece.evidence;
        const last = result.at(-1);
        if (
          last &&
          last.skillRow === piece.skillRow &&
          last.hint === 'skill' &&
          piece.hint === 'skill' &&
          last.end === piece.start &&
          last.skillOrder! < piece.skillOrder!
        ) {
          last.end = piece.end;
          last.text = source.slice(last.start, last.end);
        } else result.push(piece);
      }
    }
  }
  return result.map((p, index) => ({ ...p, id: `p${index + 1}` }));
}
