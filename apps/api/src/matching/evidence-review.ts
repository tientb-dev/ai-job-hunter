import type { Opportunity } from '../opportunities/opportunity.entity.js';
import { requirementLines } from '../opportunities/job-import.sections.js';
import type { ReviewedCvText } from '../reviewed-cv/reviewed-cv.text.js';
import { STACKS } from '../discovery/discovery.js';
import { evidenceRules } from './cv-match.coverage.js';
import { cvQuoteOccurrences, resolveCvQuote } from './cv-match.evidence.js';
import {
  strengthLabel,
  evidenceStrength,
} from './cv-match.evidence-strength.js';
import { normalize, parsePhrase } from './matching.policy.js';

const rawFields = ['jdText', 'description', 'postText'] as const;
const savedFields = [
  'skills',
  'preferredSkills',
  'experience',
  'domain',
] as const;
type Field = (typeof rawFields)[number] | (typeof savedFields)[number];
type Status =
  | 'VERIFIED_EVIDENCE'
  | 'PARTIAL_EVIDENCE'
  | 'NO_DOCUMENTED_EVIDENCE'
  | 'NEEDS_REVIEW';
type Reason =
  | 'DECLARED'
  | 'MISSING'
  | 'LIMITED'
  | 'SCOPE'
  | 'WORK_CONTEXT'
  | 'TEAM_DEPLOYMENT'
  | 'PRODUCTION_SCOPE'
  | 'PROFICIENCY'
  | 'SOURCE'
  | 'SAVED_FIELD'
  | 'VERIFY';

interface Row {
  field: Field;
  start: number;
  end: number;
  quote: string;
  status: Status;
  reason: Reason;
  missing: string[];
  evidence: {
    quote: string;
    start: number;
    end: number;
    entryId: string;
    origin: 'source' | 'user_entered';
    kind: 'declaration' | 'review' | 'context';
  }[];
}

const clean = (text: string) =>
  text.replace(/^\s*(?:[-*•–]|\d+[.)])\s+/u, '').trim();
const exact = (text: string) => normalize(clean(text));

// shortcut: explicit English activity frames only; leave paraphrases for manual review.
const workRequest =
  /^experience\s+\p{L}+ing\s+(.+?)\s+(?:with|using)\s+(.+)$/iu;
const deploymentRequest =
  /^(personally\s+)?deploy\s+(?:(?:a|an|the)\s+)?(.+?)\s+to production$/iu;

function workContext(label: string, cv: ReviewedCvText) {
  const request = label.replace(/[.;]$/u, '');
  const work = workRequest.exec(request);
  const deployment = deploymentRequest.exec(request);
  if (!work && !deployment) return null;
  const tools = work?.[2]?.split(/\s+(?:and|và)\s+/iu) ?? [];

  for (const line of cv.lines) {
    if (line.sectionKind !== 'experience' && line.sectionKind !== 'projects')
      continue;
    const quote = cv.text.slice(line.start, line.end);
    for (const part of quote.split(/[!?;]|\.(?=\s|$)/u)) {
      const clause = clean(part);
      if (
        evidenceRules.negative(clause) ||
        evidenceRules.uncertain(clause) ||
        evidenceRules.aspiration(clause)
      )
        continue;
      const activity =
        work && /^(.+?)\s+(?:using|with)\s+(.+)$/iu.exec(clause.trim());
      if (
        work &&
        activity &&
        evidenceRules.workVerb(activity[1]!) &&
        evidenceRules.mentions(work[1]!, activity[1]!) &&
        tools.every((tool) => evidenceRules.mentions(tool, activity[2]!))
      )
        return { ...line, quote, reason: 'WORK_CONTEXT' as const };
      if (!deployment) continue;
      const event =
        /^(?:(our team|the team|we|i)\s+)?deployed\s+(?:(?:a|an|the|our)\s+)?(.+?)\s+(?:to|in)\s+(?:a\s+|the\s+)?(production|sandbox|staging)$/iu.exec(
          clause.trim(),
        );
      if (!event) continue;
      const [, actor, object, environment] = event;
      const target = deployment[2]!;
      const singular = (value: string) => normalize(value).replace(/s$/u, '');
      const team = actor && normalize(actor) !== 'i';
      if (singular(object!) !== singular(target)) {
        // An explicit team event may be context for a qualified object class.
        // Its narrower type is still unverified.
        const generic = /^[A-Z]{2,}\s+(\p{L}+)$/u.exec(target)?.[1];
        if (
          !deployment[1] ||
          !team ||
          normalize(environment!) !== 'production' ||
          !generic ||
          !singular(object!).endsWith(` ${singular(generic)}`)
        )
          continue;
      }
      const reason =
        normalize(environment!) !== 'production'
          ? 'PRODUCTION_SCOPE'
          : deployment[1] && team
            ? 'TEAM_DEPLOYMENT'
            : 'WORK_CONTEXT';
      return { ...line, quote, reason } satisfies {
        reason: Reason;
        quote: string;
      };
    }
  }
  return null;
}

/** Read-time view over the same revision that owns the existing Match snapshot. */
export function buildEvidenceReview(
  job: Pick<Opportunity, Field | 'updatedAt'>,
  cv: ReviewedCvText,
  profileRevisionId: string,
  requirements: readonly { jdQuote: string; cvQuote: string }[],
) {
  const sources = rawFields.flatMap((field) => {
    const text = job[field];
    return text?.trim() ? [{ field, text }] : [];
  });
  const rows: Row[] = [];
  const seen = new Set<string>();

  const append = (
    field: Field,
    start: number,
    quote: string,
    reason: Reason,
  ) => {
    const row: Row = {
      field,
      start,
      end: start + quote.length,
      quote,
      status: 'NEEDS_REVIEW',
      reason,
      missing: [],
      evidence: [],
    };
    rows.push(row);
    return row;
  };

  const attach = (
    row: Row,
    quote: string,
    kind: Row['evidence'][number]['kind'] | null,
    start: number,
  ) => {
    const end = start + quote.length;
    const touched = cv.lines.filter(
      (line) => line.start < end && line.end > start,
    );
    const first = touched[0];
    if (
      !first ||
      first.start > start ||
      touched.at(-1)!.end < end ||
      touched.some(({ entryId }) => entryId !== first.entryId) ||
      cv.text.slice(start, end) !== quote
    )
      return false;
    if (
      kind &&
      !row.evidence.some((ref) => ref.start === start && ref.end === end)
    )
      row.evidence.push({
        quote,
        start,
        end,
        entryId: first.entryId,
        kind,
        origin: touched.some(({ origin }) => origin === 'user_entered')
          ? 'user_entered'
          : 'source',
      });
    return true;
  };

  const declarations = (term: string) =>
    cv.lines.filter(
      (line) =>
        line.sectionKind === 'skills' &&
        cv.text
          .slice(line.start, line.end)
          .replace(/^Skills:\s*/iu, '')
          .split(/[,;]\s*/u)
          .some((value) => normalize(value) === normalize(term)),
    );
  const conflict = (term: string) =>
    cv.lines.find(({ start, end }) => {
      const text = cv.text.slice(start, end);
      return (
        evidenceRules.mentions(term, text) &&
        (evidenceRules.negative(text) || evidenceRules.uncertain(text))
      );
    });

  for (const { field, text } of sources) {
    const candidates = new Set(
      requirementLines(text)
        .filter((item) => item.kind && !item.excluded)
        .map(({ line }) => exact(line)),
    );
    const located = new Set<string>();
    for (const match of text.matchAll(/[^\r\n]+/gu)) {
      const quote = match[0].trim();
      const key = exact(quote);
      const label = clean(quote);
      const request = label.replace(/[.;]$/u, '');
      const scoped =
        workRequest.test(request) || deploymentRequest.test(request);
      if (!key || (!candidates.has(key) && !(scoped && text.trim() === quote)))
        continue;
      located.add(key);
      if (seen.has(key)) continue;
      seen.add(key);
      const row = append(
        field,
        match.index + match[0].indexOf(quote),
        quote,
        'SCOPE',
      );
      // shortcut: only exact catalog names and bare conjunctions get automatic credit,
      // until a broader semantic policy can independently verify qualifiers and use.
      const names = label.split(/\s+(?:and|và)\s+/iu);
      const terms = names.map((name) =>
        STACKS.find((skill) => normalize(skill) === normalize(name)),
      );
      if (terms.every((term) => term !== undefined)) {
        let unresolved = false;
        let verified = 0;
        for (const term of terms) {
          const hits = cv.lines.filter((line) =>
            evidenceRules.mentions(term, cv.text.slice(line.start, line.end)),
          );
          const declared = declarations(term)[0];
          const disputed = conflict(term);
          if (
            declared &&
            attach(
              row,
              cv.text.slice(declared.start, declared.end),
              'declaration',
              declared.start,
            )
          )
            verified++;
          if (disputed) {
            unresolved = true;
            attach(
              row,
              cv.text.slice(disputed.start, disputed.end),
              'review',
              disputed.start,
            );
          } else if (declared) {
            if (!row.evidence.some(({ start }) => start === declared.start))
              unresolved = true;
          } else if (hits.length) {
            unresolved = true;
            const line = hits[0]!;
            attach(
              row,
              cv.text.slice(line.start, line.end),
              'review',
              line.start,
            );
          } else row.missing.push(term);
        }
        row.status = unresolved
          ? 'NEEDS_REVIEW'
          : verified === terms.length
            ? 'VERIFIED_EVIDENCE'
            : verified
              ? 'PARTIAL_EVIDENCE'
              : 'NO_DOCUMENTED_EVIDENCE';
        row.reason = unresolved
          ? 'SCOPE'
          : verified === terms.length
            ? 'DECLARED'
            : 'MISSING';
        continue;
      }

      for (const skill of STACKS) {
        if (!evidenceRules.mentions(skill, label)) continue;
        const declared = declarations(skill)[0];
        if (declared)
          attach(
            row,
            cv.text.slice(declared.start, declared.end),
            'declaration',
            declared.start,
          );
      }

      // Existing work-strength rules locate a passage. The UI only claims the
      // technology is named there, leaving work scope and proficiency to review.
      const term = strengthLabel(label);
      const related =
        term &&
        parsePhrase(term, 'jd')?.predicate === 'termPresence' &&
        normalize(term) !== normalize(label) &&
        !conflict(term)
          ? evidenceStrength(term, cv.text)?.quotes.find(
              ({ level }) => level === 'APPLIED' || level === 'APPLIED_PLUS',
            )
          : undefined;
      if (related && attach(row, related.quote, 'review', related.start)) {
        row.status = 'PARTIAL_EVIDENCE';
        row.reason = /^(?:proficiency|proficient|thành thạo)\b/iu.test(label)
          ? 'PROFICIENCY'
          : 'LIMITED';
      }
      const context = workContext(label, cv);
      if (context && attach(row, context.quote, 'context', context.start)) {
        row.reason = context.reason;
      }
      const legacy = requirements.find(
        (item) => exact(item.jdQuote) === key,
      )?.cvQuote;
      if (!legacy || related || context) continue;
      const literal = resolveCvQuote(cv.text, legacy);
      if (
        !literal ||
        cvQuoteOccurrences(cv.text, literal) !== 1 ||
        !attach(
          row,
          literal,
          scoped ? null : 'review',
          cv.text.indexOf(literal),
        )
      )
        row.reason = 'VERIFY';
    }
    if ([...candidates].some((candidate) => !located.has(candidate)))
      append(field, 0, text, 'SOURCE');
  }

  for (const field of savedFields) {
    for (const match of (job[field] ?? '').matchAll(/[^\r\n]+/gu)) {
      const quote = match[0].trim();
      if (quote && !seen.has(exact(quote)))
        append(
          field,
          match.index + match[0].indexOf(quote),
          quote,
          'SAVED_FIELD',
        );
    }
  }
  if (
    sources.length &&
    !rows.some(({ field }) => rawFields.some((raw) => raw === field))
  ) {
    const source = sources[0]!;
    append(source.field, 0, source.text, 'SOURCE');
  }

  return {
    version: 1 as const,
    jobRevision: job.updatedAt,
    profileRevisionId,
    sources,
    rows,
  };
}
