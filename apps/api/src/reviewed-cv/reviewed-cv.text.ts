import type { EligibleFact } from '../tailored-cv/tailored-draft.contract.js';
import { resolveCvQuote } from '../matching/cv-match.evidence.js';

/** One rendered line of a confirmed fact, with offsets into the reviewed text. */
export interface ReviewedLine {
  readonly factId: string;
  readonly sectionKind: EligibleFact['sectionKind'];
  readonly entryId: string;
  readonly origin: EligibleFact['origin'];
  readonly start: number;
  readonly end: number;
}
export interface ReviewedCvText {
  readonly text: string;
  readonly lines: readonly ReviewedLine[];
}
export type CvEvidenceOrigin = 'source' | 'user_entered';

// Headings use the shapes the existing matching heuristics already recognize
// (an all-caps heading, `SKILLS`, `WORK EXPERIENCE`); no parallel rules.
const HEADINGS: Partial<Record<EligibleFact['sectionKind'], string>> = {
  summary: 'SUMMARY',
  skills: 'SKILLS',
  experience: 'WORK EXPERIENCE',
  projects: 'PROJECTS',
  education: 'EDUCATION',
  certifications: 'CERTIFICATIONS',
  languages: 'LANGUAGES',
  additional: 'ADDITIONAL INFORMATION',
};
// Record markers the existing guards use so a quote never merges records.
const LABELS: Record<string, string> = {
  employer: 'Employer',
  role: 'Role',
  dates: 'Dates',
  institution: 'Institution',
  qualification: 'Qualification',
  project: 'Project',
  certification: 'Certification',
  skill: 'Skills',
  skill_category: 'Skills',
};
const labelled = /^\s*[\p{L}][\p{L} &/+-]{0,30}:\s+/u;

/**
 * Deterministic matching text from a completed review: confirmed facts only,
 * in profile order, contact and links excluded. Two blank lines separate every
 * record (entry) and no blank line occurs inside one, so quote windows (which
 * stop at two blank lines) stay inside one record.
 */
export function reviewedCvText(facts: readonly EligibleFact[]): ReviewedCvText {
  let text = '';
  const lines: ReviewedLine[] = [];
  let section = '';
  let entry = '';
  for (const fact of facts) {
    if (fact.sectionKind === 'contact' || fact.sectionKind === 'links')
      continue;
    const values = fact.value
      .split(/\r\n|[\r\n\u2028\u2029]/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!values.length) continue;
    if (fact.sectionId !== section) {
      if (text) text += '\n\n\n';
      text += `${HEADINGS[fact.sectionKind] ?? 'ADDITIONAL INFORMATION'}\n`;
      section = fact.sectionId;
      entry = fact.entryId;
    } else if (fact.entryId !== entry) {
      text += '\n\n\n';
      entry = fact.entryId;
    } else text += '\n';
    const label = LABELS[fact.field];
    values.forEach((value, index) => {
      if (index) text += '\n';
      const line =
        index === 0 && label && !labelled.test(value)
          ? `${label}: ${value}`
          : value;
      lines.push({
        factId: fact.id,
        sectionKind: fact.sectionKind,
        entryId: fact.entryId,
        origin: fact.origin,
        start: text.length,
        end: text.length + line.length,
      });
      text += line;
    });
  }
  return { text, lines };
}

/**
 * Provenance of a verified quote. Any user-entered line makes the whole quote
 * user-entered: it is never presented as independently verified source text.
 */
export function quoteOrigin(
  reviewed: ReviewedCvText,
  quote: string,
): CvEvidenceOrigin | null {
  const exact = resolveCvQuote(reviewed.text, quote);
  if (exact === null) return null;
  const start = reviewed.text.indexOf(exact);
  const end = start + exact.length;
  const touched = reviewed.lines.filter(
    (line) => line.start < end && line.end > start,
  );
  if (!touched.length) return null;
  return touched.some((line) => line.origin === 'user_entered')
    ? 'user_entered'
    : 'source';
}
