import {
  reviewedCvText,
  type CvEvidenceOrigin,
} from '../reviewed-cv/reviewed-cv.text.js';
import type { EvidenceLevel } from '../matching/cv-match.evidence-strength.js';
import type { DraftInput } from './tailored-draft.contract.js';

type PassageReference = {
  requirementId: string;
  componentId?: string;
} & (
  | { kind: 'selected' | 'condition_context' }
  | { kind: 'strength'; level: EvidenceLevel }
  | { kind: 'related_context'; observation: 'mention' | 'experience' }
);

export function savedPassageReferences({ plan, match }: DraftInput) {
  const { text, lines } = reviewedCvText(plan.facts);
  const byEntry = new Map<
    string,
    (PassageReference & { factIds: string[]; origin: CvEvidenceOrigin })[]
  >();
  const attach = (
    reference: PassageReference,
    passage: {
      quote: string;
      start?: number;
      end?: number;
      cvOrigin?: unknown;
    },
  ) => {
    const { quote } = passage;
    if (!quote.trim()) return;
    let { start, end } = passage;
    if (start === undefined && end === undefined) {
      start = text.indexOf(quote);
      if (start < 0 || text.indexOf(quote, start + 1) !== -1) return;
      end = start + quote.length;
    }
    if (
      start === undefined ||
      end === undefined ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > text.length ||
      end - start !== quote.length ||
      text.slice(start, end) !== quote
    )
      return;
    const touched = lines.filter(
      (line) => line.start < end && line.end > start,
    );
    const first = touched[0];
    if (
      !first ||
      start < first.start ||
      end > touched.at(-1)!.end ||
      touched.some((line) => line.entryId !== first.entryId)
    )
      return;
    const origin: CvEvidenceOrigin = touched.some(
      (line) => line.origin === 'user_entered',
    )
      ? 'user_entered'
      : 'source';
    if (passage.cvOrigin && passage.cvOrigin !== origin) return;
    const resolved = {
      ...reference,
      factIds: [...new Set(touched.map((line) => line.factId))],
      origin,
    };
    const refs = byEntry.get(first.entryId) ?? [];
    if (!refs.some((ref) => JSON.stringify(ref) === JSON.stringify(resolved)))
      refs.push(resolved);
    byEntry.set(first.entryId, refs);
  };

  for (const row of match.assessment.requirements) {
    const requirementId = row.parentId;
    if (!requirementId) continue;
    for (const component of row.coverage.components) {
      const anchor = { requirementId, componentId: component.id };
      attach(
        { ...anchor, kind: 'selected' },
        {
          quote: component.cvQuote,
          cvOrigin: 'cvOrigin' in component ? component.cvOrigin : undefined,
        },
      );
      for (const observation of ('observations' in component
        ? component.observations
        : []) ?? [])
        attach(
          { ...anchor, kind: 'related_context', observation: observation.kind },
          { quote: observation.cvQuote },
        );
      for (const passage of ('strength' in component
        ? component.strength?.quotes
        : undefined) ?? [])
        attach({ ...anchor, kind: 'strength', level: passage.level }, passage);
    }
    // The parent usually repeats its first selected component passage.
    if (
      !row.coverage.components.some(
        (component) => component.cvQuote === row.cvQuote,
      )
    )
      attach(
        { requirementId, kind: 'selected' },
        {
          quote: row.cvQuote,
          cvOrigin: 'cvOrigin' in row ? row.cvOrigin : undefined,
        },
      );
  }
  for (const condition of match.assessment.conditions ?? []) {
    if (!condition.parentId) continue;
    for (const passage of condition.evidence)
      attach(
        {
          requirementId: condition.parentId,
          componentId: condition.componentId,
          kind: 'condition_context',
        },
        { ...passage, quote: passage.cvQuote },
      );
  }
  return byEntry;
}
