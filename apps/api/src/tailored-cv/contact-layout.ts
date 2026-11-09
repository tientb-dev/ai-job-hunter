import { validatePdfLayout, type PdfLayout } from '../extraction/pdf-layout.js';
import type { Passage } from './source-profile-structure.js';

export const profileReferenceIssue =
  'Possible LinkedIn profile reference beside a contact icon. Confirm the platform before creating a URL; this fragment contains no full URL.';
const iconOnly = /^[\uFFFD\u25A1\u25AF\u25A0\uE000-\uF8FF\u2709]\uFE0F?$/u;

// Icon proximity establishes contact context, not the platform or a verified URL.
export function contactLayoutPassages(
  source: string,
  passages: Passage[],
  input?: PdfLayout,
): Passage[] {
  if (!input) return passages;
  let layout: PdfLayout;
  try {
    layout = validatePdfLayout(input, source);
  } catch {
    return passages;
  }
  if (!layout.complete) return passages;
  const associatedIcons = new Set<number>();
  const result = passages.map((p) => {
    const value = p.text.trim();
    if (
      !p.issue?.startsWith('Unrecognized contact fragment') ||
      !/^[a-z0-9]+(?:-[a-z0-9]+){1,8}$/u.test(value) ||
      value.length > 100 ||
      (p.kind && !['contact', 'links'].includes(p.kind))
    )
      return p;
    const item = layout.items.find(
      (i) =>
        source.slice(i.start, i.end).trim() === value &&
        i.start >= p.start &&
        i.end <= p.end,
    );
    if (!item?.horizontal) return p;
    const before = layout.items
      .filter((i) => i.page === item.page && i.end <= item.start)
      .at(-1);
    if (
      !before?.horizontal ||
      !iconOnly.test(source.slice(before.start, before.end).trim()) ||
      source.slice(before.end, item.start).trim() ||
      Math.abs(before.y - item.y) > item.height * 0.4 ||
      item.x - before.x - before.width < 0 ||
      item.x - before.x - before.width > item.height * 2
    )
      return p;
    const contact = layout.items.some(
      (i) =>
        i.page === item.page &&
        Math.abs(i.y - item.y) <= item.height * 0.4 &&
        passages.some(
          (part) =>
            ['email', 'phone'].includes(part.hint ?? '') &&
            i.start >= part.start &&
            i.end <= part.end,
        ),
    );
    if (contact) associatedIcons.add(before.start);
    return contact ? { ...p, issue: profileReferenceIssue } : p;
  });
  return result.map((p) =>
    associatedIcons.has(p.evidence?.start ?? p.start)
      ? {
          ...p,
          issue:
            'PDF icon or separator artifact. Beside a possible LinkedIn profile reference; keep or classify that reference separately.',
        }
      : p,
  );
}
