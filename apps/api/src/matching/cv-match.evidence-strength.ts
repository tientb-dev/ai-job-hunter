import {
  andCiCdPractices,
  capabilityOf,
  ciCdPipelines,
  evidenceRules as rules,
  isDesignTarget,
  simpleLabel,
  singleManagedLanguage,
  supportsCiCdPipelineWork,
  wrappedBulletSpans,
  type RequirementGroup,
} from './cv-match.coverage.js';

/**
 * Evidence strength (CV Match CP3): how strongly the CV itself shows a skill,
 * independent of how the JD words the requirement. Not a proficiency rating
 * or a hiring probability; nothing here changes the overall score.
 */
export type EvidenceLevel = 'LISTED' | 'MENTIONED' | 'APPLIED' | 'APPLIED_PLUS';

/** Provisional calibration values; change deliberately (snapshot-tested). */
export const EVIDENCE_STRENGTH = {
  LISTED: 40,
  MENTIONED: 55,
  APPLIED: 75,
  APPLIED_PLUS: 85,
  /** Per additional independent APPLIED-or-better unit. */
  EXTRA_UNIT: 5,
  EXTRA_UNIT_MAX: 10,
  /** Work evidence also listed in a skills declaration. */
  ALSO_LISTED: 5,
  MAX: 100,
} as const;

export interface StrengthQuote {
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly level: EvidenceLevel;
}
export interface EvidenceStrength {
  readonly level: EvidenceLevel;
  readonly strength: number;
  /** Independent work/project units at APPLIED or better. */
  readonly independentUnits: number;
  readonly listed: boolean;
  /** Exact CV substrings: one per counted unit, plus the list line. */
  readonly quotes: readonly StrengthQuote[];
}

const rank: Record<EvidenceLevel, number> = {
  LISTED: 0,
  MENTIONED: 1,
  APPLIED: 2,
  APPLIED_PLUS: 3,
};
// Use without a stated implementation ("Worked with Java", "Đã sử dụng Java").
const genericUse =
  /\b(?:used|using|use|worked|working)\b|(?<!\p{L})(?:sử dụng|dùng|làm việc với|biết|có kinh nghiệm)(?!\p{L})/iu;
// Concrete implementation verbs (EN/VI); "used X to/for …" states a purpose.
const concreteWork =
  /\b(?:built|build|developed|implemented|designed|architected|created|wrote|written|integrated|deployed|migrated|automated|configured|containeri[sz]ed|optimi[sz]ed|refactored|maintained|delivered|consumed|published|administered|operated)\b|\b(?:used|using)\b[^.;]{0,60}\b(?:to|for)\s+\p{L}|(?<!\p{L})(?:xây dựng|phát triển|triển khai|thiết kế|lập trình|tích hợp|tối ưu|cấu hình|viết|bảo trì|vận hành|di chuyển)(?!\p{L})|(?<!\p{L})(?:sử dụng|dùng)(?!\p{L})[^.;]{0,60}(?<!\p{L})(?:để|nhằm)(?!\p{L})/iu;
// Ownership/delivery actions that are themselves concrete work.
const ownedWork =
  /\b(?:led|owned|delivered|released|launched|shipped|migrat\w+)\b|(?<!\p{L})(?:phụ trách|chịu trách nhiệm|dẫn dắt|chủ trì|bàn giao)(?!\p{L})/iu;
// Responsibility, ownership, delivery or outcome; numbers never required.
const ownership =
  /\b(?:led|lead|owned|owner|responsible for|in charge of|delivered|released|launched|shipped|migrated|rolled out|in production|to production|production[- ]ready|reduced|improved|increased|cut|mentored)\b|(?<!\p{L})(?:phụ trách|chịu trách nhiệm|dẫn dắt|chủ trì|bàn giao|đưa vào (?:vận hành|sử dụng)|lên production|giảm|tăng|cải thiện)(?!\p{L})/iu;
// Unit starts: a dated role/project line, a "Project:"/"Dự án" line, or a heading.
const unitStart = (text: string) =>
  /\b(?:19|20)\d{2}\b|^(?:project|dự án|công ty|company|employer|role)\b/iu.test(
    text,
  ) ||
  // Case-sensitive: an all-caps heading line ("WORK EXPERIENCE").
  /^[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u.test(text);

interface Line {
  text: string;
  start: number;
  unit: number;
}
function lines(cv: string): Line[] {
  const result: Line[] = [];
  let unit = 0;
  const wrapped = new Map(
    wrappedBulletSpans(cv).map(({ start, end }) => [start, end]),
  );
  let consumedEnd = 0;
  for (const raw of cv.matchAll(/[^\r\n\u2028\u2029]+/gu)) {
    const trimmed = raw[0].trim();
    if (!trimmed || raw.index < consumedEnd) continue;
    const start = raw.index + raw[0].indexOf(trimmed);
    const end = wrapped.get(start) ?? start + trimmed.length;
    const text = cv.slice(start, end);
    consumedEnd = end;
    if (result.length && !wrapped.has(start) && unitStart(text)) unit++;
    result.push({ text, start, unit });
  }
  return result;
}
// The action must apply to this skill: "Completed a course on Java and built
// a demo in Python" does not make Java APPLIED. Segments split at and/và/,/;
// a segment without its own verb ("… and Spring Boot") shares the previous
// segment's action.
function clauseLevel(label: string, text: string): EvidenceLevel | null {
  const parts = text
    .split(/,|;|\band\b|(?<!\p{L})và(?!\p{L})/iu)
    .map((part) => part.trim())
    .filter(Boolean);
  const own = (part: string) =>
    rules.aspiration(part) ||
    rules.passingMention(part) ||
    segmentLevel(part) !== null;
  let found: EvidenceLevel | null | undefined;
  parts.forEach((part, index) => {
    if (!rules.mentions(label, part)) return;
    let source = index;
    while (source > 0 && !own(parts[source]!)) source--;
    // The shared action plus this skill's own words ("… in production").
    const level = segmentLevel(parts.slice(source, index + 1).join(', '));
    if (found === undefined || (level && (!found || rank[level] > rank[found])))
      found = level;
  });
  return found === undefined ? segmentLevel(text) : found;
}
function segmentLevel(text: string): EvidenceLevel | null {
  if (rules.aspiration(text)) return 'LISTED';
  // A course/tutorial/training context is judged by what was actually done:
  // "Completed a Java course" stays LISTED; "Built a REST API using Java in a
  // course project" is hands-on work. No project-type penalty either way.
  const concrete = concreteWork.test(text) || ownedWork.test(text);
  if (rules.passingMention(text) && !concrete) return 'LISTED';
  if (concrete) return ownership.test(text) ? 'APPLIED_PLUS' : 'APPLIED';
  return genericUse.test(text) || rules.workVerb(text) ? 'MENTIONED' : null;
}
const words = (text: string) =>
  new Set(
    text
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}+#.]+/u)
      .filter((word) => word.length > 2),
  );
// Near-duplicate units: same first line, or ≥80% shared words (Jaccard).
function duplicate(a: string[], b: string[]): boolean {
  if (a[0]!.toLocaleLowerCase() === b[0]!.toLocaleLowerCase()) return true;
  const x = words(a.join(' ')),
    y = words(b.join(' '));
  const shared = [...x].filter((word) => y.has(word)).length;
  return shared / (x.size + y.size - shared || 1) >= 0.8;
}

/** Strength of the CV's own evidence for one named skill; null when absent. */
export function evidenceStrength(
  label: string,
  cv: string,
  group?: RequirementGroup,
): EvidenceStrength | null {
  const all = lines(cv);
  const pipeline =
    ciCdPipelines.test(label) || !!(group && andCiCdPractices(label, group));
  const sql = capabilityOf(label)?.id === 'sql-writing';
  const hits = all.filter(
    (line) =>
      (rules.mentions(label, line.text.replace(/\s+/gu, ' ')) ||
        (pipeline && supportsCiCdPipelineWork(line.text))) &&
      !rules.aiExcluded(label, line.text) &&
      !rules.negative(line.text) &&
      !rules.uncertain(line.text),
  );
  if (!hits.length) return null;
  let listQuote: StrengthQuote | undefined;
  const best = new Map<number, StrengthQuote>();
  for (const line of hits) {
    const listed = rules.listed(label, line.text, cv);
    const text = line.text.replace(/\s+/gu, ' ');
    const activity = sql || pipeline;
    if (
      activity &&
      (sql || !listed) &&
      (listed ||
        rules.passingMention(text) ||
        rules.aspiration(text) ||
        (pipeline && !supportsCiCdPipelineWork(text)))
    )
      continue;
    const level = listed
      ? 'LISTED'
      : activity
        ? ownership.test(text)
          ? 'APPLIED_PLUS'
          : 'APPLIED'
        : clauseLevel(label, text);
    const quote = {
      quote: line.text,
      start: line.start,
      end: line.start + line.text.length,
    };
    if (listed) listQuote ??= { ...quote, level: 'LISTED' };
    else {
      // A named skill without any use statement still counts as a mention-level
      // declaration (e.g. a summary "Java developer"): conservative LISTED.
      const found = level ?? 'LISTED';
      const current = best.get(line.unit);
      if (!current || rank[found] > rank[current.level])
        best.set(line.unit, { ...quote, level: found });
    }
  }
  if (!best.size && !listQuote) return null;
  const units = [...best.entries()];
  const applied: { unit: number; quote: StrengthQuote }[] = [];
  for (const [unit, quote] of units) {
    if (rank[quote.level] < rank.APPLIED) continue;
    const text = (id: number) =>
      all.filter((line) => line.unit === id).map((line) => line.text);
    if (applied.some((seen) => duplicate(text(seen.unit), text(unit))))
      continue;
    applied.push({ unit, quote });
  }
  const top = units
    .map(([, quote]) => quote)
    .sort((a, b) => rank[b.level] - rank[a.level])[0];
  const level: EvidenceLevel = top
    ? rank[top.level] > rank.LISTED || !listQuote
      ? top.level
      : 'LISTED'
    : 'LISTED';
  const S = EVIDENCE_STRENGTH;
  const extra = Math.min(
    S.EXTRA_UNIT_MAX,
    S.EXTRA_UNIT * Math.max(0, applied.length - 1),
  );
  const strength = Math.min(
    S.MAX,
    S[level] +
      (rank[level] >= rank.APPLIED ? extra : 0) +
      (listQuote && rank[level] > rank.LISTED ? S.ALSO_LISTED : 0),
  );
  const quotes = [
    ...(applied.length ? applied.map((item) => item.quote) : top ? [top] : []),
    ...(listQuote ? [listQuote] : []),
  ];
  return {
    level,
    strength,
    independentUnits: applied.length,
    listed: !!listQuote,
    quotes,
  };
}

// The named skill behind a JD label, whatever the wording ("Java",
// "Experience with Java", "Có kinh nghiệm sử dụng Java"); null for prose.
const lead =
  /^(?:(?:strong|solid|proven|hands-on|good|excellent|deep)\s+)?(?:(?:professional\s+)?experience (?:with|in|using)|familiar(?:ity)? with|working knowledge of|knowledge of|understanding of|proficiency (?:with|in)|proficient (?:with|in))\s+|^(?:có\s+)?(?:kinh nghiệm(?:\s+(?:làm việc\s+)?(?:với|về|trong|sử dụng|lập trình))?|kiến thức(?:\s+về)?|hiểu biết(?:\s+về)?)\s+|^(?:sử dụng\s+)?thành thạo\s+|^(?:biết\s+)?sử dụng\s+/iu;
const duration =
  /^(?:(?:minimum|at least|min\.?|từ|ít nhất|tối thiểu)\s+)?\d+\+?\s*(?:years?|yrs?|năm)\s+(?:of\s+)?(?:working with\s+)?/iu;
const durationSuffix = /\s*\(\d+\+?\s*(?:years?|yrs?|năm)\)$/iu;
const experienceSuffix =
  /\s+(?:(?:back[- ]?end|front[- ]?end|full[- ]?stack|database)\s+)?experience$/iu;
export function strengthLabel(label: string): string | null {
  const managed = singleManagedLanguage.exec(
    label.trim().replace(/[.;:]+$/u, ''),
  );
  if (managed) return managed[1]!;
  const term = simpleLabel(
    label
      .trim()
      .replace(/[.;:]+$/u, '')
      .replace(duration, '')
      .replace(durationSuffix, '')
      .replace(lead, '')
      .replace(experienceSuffix, '')
      .trim(),
  );
  return /^[\p{L}\d][\w+#./-]*(?: [\w+#./-]+){0,2}$/u.test(term) &&
    !/\b(?:and|or|và|hoặc|years?|năm)\b/iu.test(term)
    ? term
    : null;
}

// Resolve coverage targets from canonical JD components, before looking at CV evidence.
export function technicalStrengthTarget(
  label: string,
  group: RequirementGroup,
): string | null {
  const simple = simpleLabel(label);
  if (capabilityOf(simple)) return simple;
  if (isDesignTarget(label, group)) return label;
  if (group.mode !== 'SINGLE' && /^[\w-]+ experience in [\w-]+$/iu.test(label))
    return label;
  const term = strengthLabel(label);
  // A short action clause is still prose. Keep noun phrases intact so
  // modifiers remain part of the evidence predicate.
  return term &&
    !/^(?:automate|build|configure|create|debug|design|develop|deliver|deploy|implement|improve|integrate|maintain|manage|migrate|monitor|operate|optimi[sz]e|support|write|writing|work)\s+/iu.test(
      term,
    ) &&
    !/\b(?:across|an?|for|from|multiple|of|the|through|to|using|with)\b/iu.test(
      term,
    )
    ? term
    : null;
}
