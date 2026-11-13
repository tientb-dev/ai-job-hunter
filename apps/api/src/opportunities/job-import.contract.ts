import { workModeEvidence } from './job-import.work-mode.js';
import { supportedBusinessDomain } from './job-import.domain.js';
import {
  hasCompensationAmount,
  isNegotiableSalary,
} from './job-import.salary.js';
import {
  experienceQuote,
  experienceEvidence,
} from './job-import.experience.js';
import {
  normalizeRequirementCandidates,
  institutionalSkillOnly,
  excludedSkillEvidence,
  skillSourceKind,
  requiredAlternativeLine,
  alternativeClause,
  preferredSourceLine,
  requiredSourceLine,
} from './job-import.sections.js';
import {
  quotedText,
  isPreferred,
  mergedValues,
  canonicalValue,
} from './job-import.evidence.js';
import { BadRequestException } from '@nestjs/common';
import type { OutputSchema } from '../ai/ai-provider.js';
export const IMPORT_FIELDS = [
  'title',
  'company',
  'agency',
  'contactNotes',
  'location',
  'workMode',
  'employmentType',
  'seniority',
  'skills',
  'preferredSkills',
  'experience',
  'domain',
  'salary',
  'originalLink',
] as const;
export type ImportFieldName = (typeof IMPORT_FIELDS)[number];
export interface ImportCandidate {
  field: ImportFieldName;
  value: string;
  source: 'post' | 'jd';
  quote: string;
}
export interface ImportField {
  field: ImportFieldName;
  value: string;
  status: 'SUPPORTED' | 'MISSING' | 'CONFLICT';
  candidates: ImportCandidate[];
  reviewed: boolean;
}
export const IMPORT_SCHEMA: OutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'source', 'quote'],
        properties: {
          field: { type: 'string', enum: IMPORT_FIELDS },
          value: { type: 'string', minLength: 1, maxLength: 2000 },
          source: { type: 'string', enum: ['post', 'jd'] },
          quote: { type: 'string', minLength: 1, maxLength: 3000 },
        },
      },
    },
  },
};
export function safeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
const normalized = (value: string) =>
  value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
// Exact quotes establish textual support, not semantic correctness. Human review is mandatory.
export function mergeCandidates(
  input: unknown,
  post: string,
  jd: string,
  canonical = true,
  classifyDomains = canonical,
  reconcileRequirements = canonical,
): { fields: ImportField[]; rejected: number } {
  const raw =
    input && typeof input === 'object' && 'candidates' in input
      ? (input as { candidates: unknown }).candidates
      : null;
  if (!Array.isArray(raw) || raw.length > 120)
    throw new BadRequestException('Invalid extraction response');
  let accepted: ImportCandidate[] = [];
  let rejected = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      rejected++;
      continue;
    }
    const c = item as ImportCandidate;
    const source = c.source === 'post' ? post : c.source === 'jd' ? jd : '';
    if (
      !IMPORT_FIELDS.includes(c.field) ||
      typeof c.value !== 'string' ||
      !c.value.trim() ||
      c.value.length > 2000 ||
      typeof c.quote !== 'string' ||
      !c.quote.trim() ||
      c.quote.length > 3000 ||
      !quotedText(source, c.quote) ||
      !quotedText(c.quote, c.value) ||
      (['title', 'company'].includes(c.field) && c.value.trim().length > 300) ||
      (c.field === 'originalLink' && !safeLink(c.value)) ||
      (canonical &&
        ['skills', 'preferredSkills'].includes(c.field) &&
        (institutionalSkillOnly(source, c.value) ||
          excludedSkillEvidence(source, c.value, c.quote))) ||
      (canonical &&
        c.field === 'workMode' &&
        !workModeEvidence(c.quote).some(
          (item) => item.mode === canonicalValue('workMode', c.value),
        )) ||
      (c.field === 'salary' &&
        !hasCompensationAmount(c.value) &&
        !isNegotiableSalary(c.value)) ||
      (classifyDomains &&
        c.field === 'domain' &&
        !supportedBusinessDomain(source, c.value))
    ) {
      rejected++;
      continue;
    }
    if (
      canonical &&
      ['skills', 'preferredSkills', 'salary'].includes(c.field)
    ) {
      const contexts = source
        .split(/\r?\n/u)
        .filter((line) => quotedText(line, c.value));
      if (
        /^(?:Supplemental skill tags|Ignored salary placeholders|Company|Source industry)\s*(?:\([^)]*\))?\s*:/iu.test(
          c.quote.trim(),
        ) ||
        (contexts.length &&
          contexts.every((line) =>
            /^(?:Supplemental skill tags \(not requirements\)|Ignored salary placeholders \(not compensation\)):/iu.test(
              line.trim(),
            ),
          ))
      ) {
        rejected++;
        continue;
      }
    }
    if (
      canonical &&
      /^(?:unknown|not (?:provided|stated|specified)|n\/?a|chưa rõ|không rõ|tbd)$/iu.test(
        c.value.trim(),
      )
    ) {
      rejected++;
      continue;
    }
    if (
      canonical &&
      c.field === 'company' &&
      /^(?:công ty mình|công ty khách hàng|khách hàng|our company|the client|unnamed client|confidential)$/iu.test(
        c.value.trim(),
      )
    ) {
      rejected++;
      continue;
    }
    let quote = quotedText(source, c.quote)!;
    let value = quotedText(quote, c.value)!;
    if (canonical && c.field === 'experience')
      quote = experienceQuote(source, value, quote);
    if (canonical && c.field === 'skills') {
      const contexts = source
        .split(/\r?\n/u)
        .filter((line) => Boolean(quotedText(line, value)));
      if (contexts.length && contexts.every((line) => isPreferred(line, value)))
        quote = contexts[0]!;
    }
    let field =
      canonical && c.field === 'skills' && isPreferred(quote, value)
        ? 'preferredSkills'
        : c.field;
    if (canonical && (field === 'skills' || field === 'preferredSkills'))
      field = skillSourceKind(source, value) ?? field;
    if (canonical && field === 'preferredSkills')
      quote = preferredSourceLine(source, value) ?? quote;
    if (canonical && field === 'skills') {
      quote = requiredSourceLine(source, value) ?? quote;
      // A fragment of an inline "A, B, or C" sentence keeps the whole clause.
      const alternative =
        requiredAlternativeLine(source, value) ??
        alternativeClause(source, [value]);
      if (alternative && alternative.length <= 2000) {
        value = alternative;
        quote = alternative;
      }
    }
    if (
      canonical &&
      ['skills', 'preferredSkills', 'experience', 'workMode'].includes(field) &&
      /không (?:yêu cầu|bắt buộc|cần)|not required|no experience/iu.test(quote)
    ) {
      rejected++;
      continue;
    }
    const candidate = { field, value: value.trim(), source: c.source, quote };
    if (
      !accepted.some(
        (existing) => JSON.stringify(existing) === JSON.stringify(candidate),
      )
    )
      accepted.push(candidate);
  }
  if (reconcileRequirements)
    accepted = normalizeRequirementCandidates(accepted, post, jd);
  // Fallback only from validated title candidates, never experience/body text.
  // Keep an existing supported level and leave multi-level titles unresolved.
  if (
    canonical &&
    !accepted.some((candidate) => candidate.field === 'seniority')
  ) {
    const levels = accepted
      .filter((candidate) => candidate.field === 'title')
      .flatMap((title) =>
        [
          ...title.value.matchAll(
            /(?<![\p{L}\p{N}_])(?:Junior|Mid[- ]level|Senior|Lead|Principal)(?![\p{L}\p{N}_])/giu,
          ),
        ].map((match) => ({
          field: 'seniority' as const,
          value: match[0],
          source: title.source,
          quote: title.value,
        })),
      );
    if (
      new Set(
        levels.map((level) => normalized(level.value).replace(/[- ]/gu, '')),
      ).size === 1
    )
      accepted.push(...levels);
  }
  return {
    rejected,
    fields: IMPORT_FIELDS.map((field) => {
      const candidates = accepted.filter(
        (c) =>
          c.field === field &&
          !(
            canonical &&
            field === 'preferredSkills' &&
            accepted.some(
              (required) =>
                required.field === 'skills' &&
                normalized(canonicalValue('skills', required.value)) ===
                  normalized(canonicalValue('skills', c.value)),
            )
          ),
      );
      const unique = [
        ...new Map(
          candidates.map((c) => [normalized(c.value), c.value]),
        ).values(),
      ];
      const legacyConflict = field !== 'skills' && unique.length > 1;
      const merged = canonical
        ? mergedValues(field, candidates)
        : {
            value: legacyConflict
              ? ''
              : unique.join(field === 'skills' ? '\n' : ''),
            conflict: legacyConflict,
          };
      return {
        field,
        value: merged.value,
        status: merged.conflict
          ? 'CONFLICT'
          : candidates.length
            ? 'SUPPORTED'
            : 'MISSING',
        candidates,
        reviewed: false,
      };
    }),
  };
}
export function fullDescription(post: string, jd: string): string {
  return [
    post ? `Recruitment post\n${post}` : '',
    jd ? `Job description document\n${jd}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function validateImportReview(
  value: unknown,
  post: string,
  jd: string,
): ImportField[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    (value.length !== 0 &&
      value.length !== IMPORT_FIELDS.length &&
      value.length !== 11)
  )
    throw new BadRequestException('Invalid import review');
  if (!value.length) return [];
  const fields = value as ImportField[];
  const legacy = fields.length === 11;
  const expected = legacy
    ? IMPORT_FIELDS.filter(
        (field) => !['experience', 'preferredSkills', 'domain'].includes(field),
      )
    : IMPORT_FIELDS;
  if (
    new Set(fields.map((f) => f?.field)).size !== expected.length ||
    expected.some((field) => !fields.some((f) => f?.field === field)) ||
    fields.some(
      (f) =>
        !f ||
        !IMPORT_FIELDS.includes(f.field) ||
        typeof f.reviewed !== 'boolean' ||
        typeof f.value !== 'string' ||
        !Array.isArray(f.candidates) ||
        f.candidates.length > 120,
    )
  )
    throw new BadRequestException('Invalid import review');
  const result = mergeCandidates(
    { candidates: fields.flatMap((f) => f.candidates) },
    post,
    jd,
    !legacy,
    // Revalidate historical evidence without reclassifying saved/manual values.
    false,
  );
  if (
    result.rejected ||
    fields.some((f) => f.candidates.some((c) => c.field !== f.field))
  )
    throw new BadRequestException(
      'Import evidence no longer matches sources. Extract again or review manually.',
    );
  let historical: ReturnType<typeof mergeCandidates> | undefined;
  return result.fields
    .filter((f) => expected.includes(f.field))
    .map((computed) => {
      const saved = fields.find((f) => f.field === computed.field)!;
      if (
        computed.field === 'salary' &&
        saved.status === computed.status &&
        canonicalValue('salary', saved.value) === computed.value
      )
        computed = { ...computed, value: saved.value };
      if (
        ['skills', 'preferredSkills'].includes(computed.field) &&
        saved.status === computed.status &&
        saved.value.replace(/\bhoặc\b/giu, 'OR') === computed.value
      )
        computed = { ...computed, value: saved.value };
      if (
        ['skills', 'preferredSkills'].includes(computed.field) &&
        (saved.value !== computed.value || saved.status !== computed.status)
      ) {
        // Accept only the exact historical derivation from the same verified
        // candidates. Do not rewrite old evidence or accept arbitrary values.
        historical ??= mergeCandidates(
          { candidates: fields.flatMap((field) => field.candidates) },
          post,
          jd,
          !legacy,
          false,
          false,
        );
        const previous = historical.fields.find(
          (field) => field.field === computed.field,
        )!;
        if (
          !historical.rejected &&
          previous.value === saved.value &&
          previous.status === saved.status
        )
          computed = previous;
      }
      // Preserve old review metadata whose only display difference is the zl alias.
      const oldZlContact =
        computed.field === 'contactNotes' &&
        saved.status === 'SUPPORTED' &&
        computed.status === 'SUPPORTED' &&
        /(?<![\p{L}\p{N}])zl\s*[:：]?\s*(?=\+?\d)/iu.test(saved.value) &&
        canonicalValue('contactNotes', saved.value) ===
          canonicalValue('contactNotes', computed.value);
      const reviewedOldContactConflict =
        computed.field === 'contactNotes' &&
        saved.status === 'CONFLICT' &&
        saved.value === '' &&
        saved.reviewed &&
        computed.status === 'SUPPORTED';
      const previousExperience =
        computed.field === 'experience'
          ? experienceEvidence(saved.value)
          : null;
      const currentExperience =
        computed.field === 'experience'
          ? experienceEvidence(computed.value)
          : null;
      const equivalentOldExperience =
        saved.status === 'SUPPORTED' &&
        computed.status === 'SUPPORTED' &&
        previousExperience &&
        currentExperience &&
        previousExperience.months === currentExperience.months &&
        previousExperience.minimum === currentExperience.minimum &&
        previousExperience.qualifier === currentExperience.qualifier &&
        previousExperience.maximumMonths === currentExperience.maximumMonths;
      const compatibleOldLocationOrExperience =
        ['location', 'experience', 'salary'].includes(computed.field) &&
        saved.status === 'CONFLICT' &&
        saved.value === '' &&
        computed.status === 'SUPPORTED';
      if (
        !equivalentOldExperience &&
        !compatibleOldLocationOrExperience &&
        !oldZlContact &&
        !reviewedOldContactConflict &&
        (saved.status !== computed.status ||
          saved.value !== computed.value ||
          (computed.status === 'CONFLICT' && !saved.reviewed))
      )
        throw new BadRequestException(
          'Review every conflicting field before saving.',
        );
      return {
        ...computed,
        reviewed: compatibleOldLocationOrExperience ? false : saved.reviewed,
      };
    });
}
