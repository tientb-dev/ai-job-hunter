import { BadRequestException } from '@nestjs/common';
import type { SavedCvProvenance } from '../extraction/extraction.types.js';
export type ParserProvenance = SavedCvProvenance;
export interface Evidence {
  sourceRevisionId: string;
  start: number;
  end: number;
  quote: string;
}
export interface ProfileFact {
  id: string;
  field: string;
  value: string;
  origin: 'source' | 'user_entered';
  review: 'pending' | 'confirmed' | 'needs_clarification';
  evidence: Evidence[];
  replacesFactId?: string;
}
export interface ProfileDocument {
  contractVersion: '1';
  reconstruction?: { version: '2' | '3'; previousRevisionId: string | null };
  sections: {
    id: string;
    kind:
      | 'contact'
      | 'links'
      | 'summary'
      | 'skills'
      | 'experience'
      | 'education'
      | 'projects'
      | 'certifications'
      | 'languages'
      | 'additional';
    review: 'pending' | 'confirmed' | 'needs_clarification';
    entries: {
      id: string;
      facts: ProfileFact[];
      /** Experience only: the shared source employer fact of this position's group. */
      employerFactId?: string;
    }[];
  }[];
  coverage: {
    start: number;
    end: number;
    disposition: 'mapped' | 'unresolved' | 'excluded';
    factIds: string[];
    reason: string | null;
  }[];
}
export const DOCUMENT_BYTES = 96 * 1024;
export function invalid(): never {
  throw new BadRequestException(
    'Invalid P8 request. Check contract version, limits and evidence.',
  );
}
export function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  )
    invalid();
  return result;
}
export function version(body: unknown, keys: readonly string[]) {
  const value = record(body, ['contractVersion', ...keys]);
  if (value.contractVersion !== '1') invalid();
  return value;
}
export function revision(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) >= 2147483647
  )
    invalid();
  return value as number;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    invalid();
  return value.toLowerCase();
}
export function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function text(value: unknown, max = 1000): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 && ![9, 10, 13].includes(code);
    })
  )
    invalid();
  return value;
}
function choice(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid();
}
function span(start: unknown, end: unknown, source: string) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (start as number) < 0 ||
    (end as number) <= (start as number) ||
    (end as number) > source.length
  )
    invalid();
}
export function emptyProfile(source: string): ProfileDocument {
  return {
    contractVersion: '1',
    sections: [],
    coverage: [
      {
        start: 0,
        end: source.length,
        disposition: 'unresolved',
        factIds: [],
        reason: null,
      },
    ],
  };
}
// These checks establish provenance and complete accounting, not semantic truth.
export function profileDocument(
  input: unknown,
  sourceId: string,
  source: string,
): ProfileDocument {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > DOCUMENT_BYTES)
    invalid();
  const hasReconstruction =
    !!input &&
    typeof input === 'object' &&
    Object.hasOwn(input, 'reconstruction');
  const doc = version(input, [
    'sections',
    'coverage',
    ...(hasReconstruction ? ['reconstruction'] : []),
  ]);
  if (hasReconstruction) {
    const metadata = record(doc.reconstruction, [
      'version',
      'previousRevisionId',
    ]);
    if (!['2', '3'].includes(metadata.version as string)) invalid();
    if (metadata.previousRevisionId !== null) uuid(metadata.previousRevisionId);
  }
  const ids = new Set<string>();
  const facts = new Map<string, ProfileFact>();
  const unique = (value: unknown) => {
    const id = text(value, 100);
    if (ids.has(id)) invalid();
    ids.add(id);
    return id;
  };
  for (const sectionInput of list(doc.sections, 20)) {
    const section = record(sectionInput, ['id', 'kind', 'review', 'entries']);
    unique(section.id);
    choice(section.kind, [
      'contact',
      'links',
      'summary',
      'skills',
      'experience',
      'education',
      'projects',
      'certifications',
      'languages',
      'additional',
    ]);
    choice(section.review, ['pending', 'confirmed', 'needs_clarification']);
    for (const entryInput of list(section.entries, 100)) {
      const entry = record(entryInput, [
        'id',
        'facts',
        ...(entryInput &&
        typeof entryInput === 'object' &&
        Object.hasOwn(entryInput, 'employerFactId')
          ? ['employerFactId']
          : []),
      ]);
      if (entry.employerFactId !== undefined) {
        text(entry.employerFactId, 100);
        if (section.kind !== 'experience') invalid();
      }
      unique(entry.id);
      for (const factInput of list(entry.facts, 50)) {
        const fact = record(factInput, [
          'id',
          'field',
          'value',
          'origin',
          'review',
          'evidence',
          ...(factInput &&
          typeof factInput === 'object' &&
          Object.hasOwn(factInput, 'replacesFactId')
            ? ['replacesFactId']
            : []),
        ]);
        const id = unique(fact.id);
        text(fact.field, 100);
        text(fact.value, 4000);
        choice(fact.origin, ['source', 'user_entered']);
        choice(fact.review, ['pending', 'confirmed', 'needs_clarification']);
        const evidence = list(fact.evidence, 10);
        if (
          (fact.origin === 'source' && !evidence.length) ||
          (fact.origin === 'user_entered' && evidence.length)
        )
          invalid();
        for (const item of evidence) {
          const ref = record(item, [
            'sourceRevisionId',
            'start',
            'end',
            'quote',
          ]);
          if (ref.sourceRevisionId !== sourceId) invalid();
          span(ref.start, ref.end, source);
          if (
            text(ref.quote, 4000) !==
            source.slice(ref.start as number, ref.end as number)
          )
            invalid();
        }
        if (
          section.review === 'confirmed' &&
          (fact.review === 'needs_clarification' ||
            (hasReconstruction &&
              fact.origin === 'user_entered' &&
              fact.review !== 'confirmed'))
        )
          invalid();
        if (
          fact.origin === 'source' &&
          !(evidence as Evidence[]).some((ref) =>
            ref.quote.includes(fact.value as string),
          )
        )
          invalid();
        facts.set(id, factInput as ProfileFact);
        if (facts.size > 300) invalid();
      }
    }
  }
  const replacements = new Set<string>();
  for (const section of (input as ProfileDocument).sections)
    for (const entry of section.entries) {
      // A shared employer link must reference a source employer fact held by a
      // different entry of the same section; linked entries hold no employer.
      if (entry.employerFactId !== undefined) {
        const owner = section.entries.find((e) =>
          e.facts.some((f) => f.id === entry.employerFactId),
        );
        const target = owner?.facts.find((f) => f.id === entry.employerFactId);
        if (
          !owner ||
          owner === entry ||
          owner.employerFactId !== undefined ||
          target!.field !== 'employer' ||
          target!.origin !== 'source' ||
          entry.facts.some((f) => f.field === 'employer')
        )
          invalid();
      }
      for (const fact of entry.facts) {
        if (fact.replacesFactId !== undefined) {
          const original = entry.facts.find(
            (candidate) => candidate.id === fact.replacesFactId,
          );
          if (
            fact.origin !== 'user_entered' ||
            !original ||
            original.origin !== 'source' ||
            original.field !== fact.field ||
            replacements.has(original.id)
          )
            invalid();
          replacements.add(original.id);
        }
      }
    }
  let cursor = 0;
  const mapped = new Set<string>();
  for (const item of list(doc.coverage, 1000)) {
    const row = record(item, [
      'start',
      'end',
      'disposition',
      'factIds',
      'reason',
    ]);
    span(row.start, row.end, source);
    if (row.start !== cursor) invalid();
    cursor = row.end as number;
    choice(row.disposition, ['mapped', 'unresolved', 'excluded']);
    const links = list(row.factIds, 300);
    if (new Set(links).size !== links.length) invalid();
    if (row.disposition === 'mapped') {
      if (!links.length || row.reason !== null) invalid();
      const supportingSpans: Evidence[] = [];
      for (const id of links) {
        const fact = facts.get(id as string);
        if (
          !fact ||
          fact.origin !== 'source' ||
          !fact.evidence.some(
            (ref) =>
              ref.start < (row.end as number) &&
              ref.end > (row.start as number),
          )
        )
          invalid();
        supportingSpans.push(...fact.evidence);
        mapped.add(id as string);
      }
      let covered = row.start as number;
      for (const ref of supportingSpans.sort((a, b) => a.start - b.start)) {
        if (ref.end <= covered) continue;
        if (ref.start > covered) break;
        covered = ref.end;
      }
      if (covered < (row.end as number)) invalid();
    } else if (links.length) invalid();
    if (row.disposition === 'excluded') text(row.reason, 1000);
    else if (row.reason !== null) text(row.reason, 1000);
  }
  if (
    cursor !== source.length ||
    [...facts.values()].some(
      (fact) => fact.origin === 'source' && !mapped.has(fact.id),
    )
  )
    invalid();
  return structuredClone(input) as ProfileDocument;
}
