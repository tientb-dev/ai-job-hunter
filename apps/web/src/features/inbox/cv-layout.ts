import type { SavedDraft } from './tailored-cv.contract';

export type Document = SavedDraft['document'];
export type Section = Document['sections'][number];

const SECTION_ORDER = [
  'contact',
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
  'links',
  'additional',
];

// Same titles as the PDF/DOCX export (tailored-cv-export.ts).
const TITLES: Record<string, string> = {
  contact: 'Contact',
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
  links: 'Links',
  additional: 'Additional information',
};
export const sectionTitle = (kind: string) =>
  TITLES[kind] ??
  kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll('_', ' ');

/**
 * Layout-only reflow, identical to the export renderer: a line break inside a
 * sentence becomes a space; breaks before bullets/new items or after
 * sentence-ending punctuation stay. Saved wording is never changed.
 */
export function reflow(text: string): string {
  return (
    text
      .replace(/\r\n?/gu, '\n')
      .trim()
      // Join only clear PDF wraps: after a comma, or lowercase word to lowercase
      // word. Lists like "City\nVietnam" or bullets keep their line breaks.
      .replace(/,[ \t]*\n[ \t]*(?![•\-–*·]|\d+[.)]\s)(?=\S)/gu, ', ')
      .replace(/(\p{Ll})[ \t]*\n[ \t]*(?=[\p{Ll}(])/gu, '$1 ')
      // A wrapped item inside a comma list: "Mentoring, Stakeholder\nCommunication".
      .replace(/(,[^\n]*\p{L})[ \t]*\n[ \t]*(?=\p{L})/gu, '$1 ')
  );
}

export function sortSections<T extends { kind: string }>(sections: T[]) {
  return [...sections].sort(
    (a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind),
  );
}

/** Facts that would appear in the download, grouped by entry. */
export function includedEntries(document: Document, section: Section) {
  return section.entries
    .map((entry) => ({
      ...entry,
      facts: entry.facts.filter(
        (fact) =>
          document.review.factReviews[fact.id]?.exportIncluded !== false,
      ),
    }))
    .filter((entry) => entry.facts.length);
}

// Mirrors the API rule (profile-links.ts): only a whole-text LinkedIn /in/ or
// GitHub user URL is a verified professional profile. Presentation only.
const PROFILE_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[A-Za-z0-9\-_%]{3,100}|github\.com\/(?!(?:orgs|topics|features|about|marketplace|explore|settings|pricing|login|sponsors)(?:\/|$))[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/?$/u;
export function professionalProfileHref(text: string): string | null {
  const value = text.trim();
  if (!PROFILE_URL.test(value)) return null;
  return /^https?:\/\//u.test(value) ? value : `https://${value}`;
}

/** Included Links facts shown once in the contact header instead of Links. */
export function promotedLinks(document: Document) {
  return document.sections
    .filter((s) => s.kind === 'links')
    .flatMap((s) => includedEntries(document, s).flatMap((e) => e.facts))
    .filter(
      (f) => f.field === 'link' && professionalProfileHref(f.acceptedText),
    );
}

/** Entries as displayed: profile links move from Links to the contact header. */
export function displayEntries(document: Document, section: Section) {
  const promoted = promotedLinks(document);
  const ids = new Set(promoted.map((f) => f.id));
  const entries = includedEntries(document, section)
    .map((e) => ({ ...e, facts: e.facts.filter((f) => !ids.has(f.id)) }))
    .filter((e) => e.facts.length);
  return section.kind === 'contact' && promoted.length
    ? [...entries, { id: 'promoted-profile-links', facts: promoted }]
    : entries;
}

// Mirrors cvRows in the API export (tailored-cv-export.ts); both are checked
// against apps/api/test/support/cv-layout-cases.json.
const TITLE_FIELDS = new Set(['employer', 'institution', 'role', 'title']);
const DETAIL_FIELDS = new Set(['project', 'skill', 'dates']);
const DATE_RANGE =
  /\d{4}\s*[-–—]\s*(?:\p{L}+\.?\s+)?(?:\d{4}|present|now|current)/iu;
export interface CvRow {
  id: string;
  field: string;
  text: string;
  style: 'anchor' | 'body' | 'detail';
  aside?: string;
}
/** Experience / projects / education entry as display rows. */
export function structuredRows(
  kind: string,
  facts: { id: string; field: string; acceptedText: string }[],
): CvRow[] {
  const rows: CvRow[] = [];
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i]!;
    const next = facts[i + 1];
    if (
      TITLE_FIELDS.has(fact.field) ||
      // A project's name heads its entry like a role title.
      (kind === 'projects' && fact.field === 'project')
    ) {
      const dates =
        next?.field === 'dates' && DATE_RANGE.test(next.acceptedText)
          ? next
          : undefined;
      if (dates) i++;
      rows.push({
        id: fact.id,
        field: fact.field,
        text: reflow(fact.acceptedText),
        style: 'anchor',
        ...(dates ? { aside: reflow(dates.acceptedText) } : {}),
      });
    } else
      rows.push({
        id: fact.id,
        field: fact.field,
        text: reflow(fact.acceptedText),
        style: DETAIL_FIELDS.has(fact.field) ? 'detail' : 'body',
      });
  }
  // Education: a date range stored apart from the institution belongs beside it.
  const title = rows.find((row) => row.style === 'anchor');
  const range = rows.findIndex(
    (row) => row.field === 'dates' && DATE_RANGE.test(row.text),
  );
  if (kind === 'education' && title && !title.aside && range >= 0) {
    title.aside = rows[range]!.text;
    rows.splice(range, 1);
  }
  return rows;
}
