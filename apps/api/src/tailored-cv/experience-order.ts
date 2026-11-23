import type {
  DraftFact,
  TailoredDraftDocument,
} from './tailored-draft.contract.js';
/** Bullet fields that may move; titles, employers and dates never do. */
const BODY = new Set(['description', 'text', 'source_passage']);
/** CV Match evidence outweighs a JD term match; each JD requirement counts once. */
const WEIGHT = {
  evidenceRequired: 3,
  evidencePreferred: 1,
  required: 2,
  preferred: 1,
};
/**
 * A reorder must fix misplaced pairs worth at least one required requirement
 * in total (sum of score gaps over every pair the new order puts right).
 */
const MIN_GAIN = WEIGHT.required;
/**
 * Only a confidently relevant bullet may move up: one with CV Match evidence,
 * or matching at least this many distinct JD requirements. One stray tool
 * mention is not enough to overrule the author's own order.
 */
const MIN_GROUPS = 2;
/** Reasons are labels, never long JD sentences. */
const MAX_REASON = 40;
const short = (text: string) => {
  const t = text.trim().replace(/\s+/gu, ' ');
  return t.length <= MAX_REASON
    ? t
    : `${t.slice(0, MAX_REASON - 1).trimEnd()}…`;
};

export interface OrderProposal {
  originalFactIds: string[];
  factIds: string[];
  /** Per moved-up fact: the job skills / requirements it matches. */
  reasons: Record<string, string[]>;
}

type Entry = TailoredDraftDocument['sections'][number]['entries'][number];
/** One JD requirement and the short terms that show a bullet addresses it. */
interface Group {
  required: boolean;
  terms: string[];
}

const words = (t: string) => t.split(/\s+/u).filter(Boolean);
/**
 * Short list items are terms as written ("Spring Boot", "CI/CD"). A longer
 * phrase is a sentence, so only its technical tokens count (capitalised or
 * with digits/symbols, e.g. "Microservices", "OAuth2"), never its first word.
 */
function terms(fragment: string): string[] {
  const parts = words(fragment);
  if (parts.length <= 3) return [parts.join(' ')];
  // Adjacent technical tokens form one term: "Clean Code", not "Clean" + "Code".
  const found: string[] = [];
  let phrase: string[] = [];
  const flush = () => {
    if (phrase.length) found.push(phrase.join(' '));
    phrase = [];
  };
  for (const raw of parts.slice(1)) {
    const w = raw.replace(/^[("'`]+|[)"'`.,:;!?]+$/gu, '');
    const technical =
      /^[A-Za-z0-9][A-Za-z0-9+#./-]*$/u.test(w) && /[A-Z0-9+#./]/u.test(w);
    if (technical) phrase.push(w);
    // Punctuation after a word ends the phrase ("Docker, Kubernetes").
    if (!technical || w !== raw) flush();
  }
  flush();
  return found;
}
const fragments = (line: string) =>
  line
    .split(/[,;•|]+|\s+(?:OR|or|hoặc)\s+/u)
    .map((s) => s.trim().replace(/^[-*]\s*/u, ''))
    .filter(Boolean);
/**
 * A pure list line ("Docker, Kubernetes, Terraform") is one requirement per
 * item; a sentence ("Experience with Docker, Kubernetes or Cloud") is a single
 * requirement satisfied by any of its alternatives.
 */
function groups(text: string, required: boolean): Group[] {
  return text.split(/\n+/u).flatMap((line) => {
    const parts = fragments(line);
    if (!parts.length) return [];
    if (parts.every((p) => words(p).length <= 3))
      return parts.map((p) => ({ required, terms: [p] }));
    const all = [...new Set(parts.flatMap(terms))];
    return all.length ? [{ required, terms: all }] : [];
  });
}
const matches = (text: string, term: string) =>
  term.length >= 2 &&
  new RegExp(
    `(?<![\\p{L}\\p{N}])${term.toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(text);

/**
 * Deterministic bullet order for one Experience/Projects entry. Only body
 * facts move, and only within a run not broken by a title or date fact, so
 * text, titles, dates and role order are untouched. Returns null when the
 * original order is already good or the evidence is not strong enough.
 */
export function proposeEntryOrder(
  entry: Pick<Entry, 'facts'>,
  requirements: TailoredDraftDocument['requirements'],
  job: Pick<TailoredDraftDocument['jobSnapshot'], 'skills' | 'preferredSkills'>,
): OrderProposal | null {
  // The same JD line can arrive as a requirement and as a skills line.
  const seen = new Set<string>();
  const jd = [
    ...requirements.map((r) => [r.text, r.priority === 'required'] as const),
    ...job.skills.split(/\n+/u).map((l) => [l, true] as const),
    ...job.preferredSkills.split(/\n+/u).map((l) => [l, false] as const),
  ]
    .filter(([line]) => {
      const key = line.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .flatMap(([line, required]) => groups(line, required));
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const score = (fact: DraftFact) => {
    const text = fact.acceptedText.toLocaleLowerCase();
    const reasons: string[] = [];
    const add = (label: string) => {
      if (
        !reasons.some(
          (r) => r.toLocaleLowerCase() === label.toLocaleLowerCase(),
        )
      )
        reasons.push(label);
    };
    let total = 0;
    let hits = 0;
    let evidence = 0;
    for (const group of jd) {
      const found = group.terms.filter((t) => matches(text, t));
      if (!found.length) continue;
      hits++;
      total += group.required ? WEIGHT.required : WEIGHT.preferred;
      found.map(short).forEach(add);
    }
    for (const link of fact.relevance) {
      // ai_relevance_only is the model's opinion, not CV Match evidence.
      if (link.kind !== 'source_passage_support') continue;
      const row = byId.get(link.requirementId);
      if (!row) continue;
      evidence++;
      total +=
        row.priority === 'required'
          ? WEIGHT.evidenceRequired
          : WEIGHT.evidencePreferred;
      // Prefer the matched component labels (e.g. "REST APIs") over the sentence.
      const labels = row.components
        .filter((c) => link.componentIds.includes(c.id))
        .map((c) => c.label);
      (labels.length ? labels : [row.text]).map(short).forEach(add);
    }
    // A weak signal ranks like no signal, so it never moves a bullet.
    const confident = evidence > 0 || hits >= MIN_GROUPS;
    return { total: confident ? total : 0, reasons };
  };

  const original = entry.facts.map((f) => f.id);
  const next = [...original];
  const reasons: Record<string, string[]> = {};
  let changed = false;
  for (let start = 0; start < entry.facts.length;) {
    if (!BODY.has(entry.facts[start]!.field)) {
      start++;
      continue;
    }
    let end = start;
    while (end < entry.facts.length && BODY.has(entry.facts[end]!.field)) end++;
    const run = entry.facts
      .slice(start, end)
      .map((fact, index) => ({ fact, index, ...score(fact) }));
    // Stable: ties keep their original relative order.
    const ranked = [...run].sort(
      (a, b) => b.total - a.total || a.index - b.index,
    );
    let gain = 0;
    for (let i = 0; i < run.length; i++)
      for (let j = i + 1; j < run.length; j++)
        gain += Math.max(0, run[j]!.total - run[i]!.total);
    if (gain >= MIN_GAIN) {
      ranked.forEach((r, i) => {
        next[start + i] = r.fact.id;
        if (i < r.index && r.reasons.length) reasons[r.fact.id] = r.reasons;
      });
      changed = true;
    }
    start = end;
  }
  return changed ? { originalFactIds: original, factIds: next, reasons } : null;
}

/**
 * True when `ids` reorders `facts` only inside body runs: same id set, and
 * every title/date/employer/role fact keeps its exact position.
 */
export function isSafeOrder(
  facts: readonly Pick<DraftFact, 'id' | 'field'>[],
  ids: readonly string[],
): boolean {
  if (ids.length !== facts.length || new Set(ids).size !== ids.length)
    return false;
  const byId = new Map(facts.map((f) => [f.id, f]));
  let run = new Set<string>();
  const flush = (end: number) => {
    // The ids placed in this run must be exactly the run's original facts.
    for (let i = end - run.size; i < end; i++)
      if (!run.has(ids[i]!)) return false;
    run = new Set();
    return true;
  };
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i]!;
    if (!byId.has(ids[i]!)) return false;
    if (BODY.has(fact.field)) run.add(fact.id);
    else if (!flush(i) || ids[i] !== fact.id) return false;
  }
  return flush(facts.length);
}
