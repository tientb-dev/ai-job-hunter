import { createHash } from 'node:crypto';
import type { ProfileDocument } from './tailored-cv.contract.js';
import { record } from './tailored-cv.contract.js';
import { CONFLICTING_SOURCE_REASON } from './tailored-draft.contract.js';
import { knownSkillCategory } from './source-profile-structure.js';
import {
  TailoredDraftError,
  type BatchOutput,
  type DraftInput,
  type DraftPlan,
  type EligibleFact,
  type TailoredDraftDocument,
  type CvSectionKind,
  type DraftFact,
} from './tailored-draft.contract.js';
export const draftHash = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
export const DRAFT_BYTES = 96 * 1024;
export const MAX_BATCHES = 32;
export const BATCH_FACTS = 6;
export const sectionKinds: CvSectionKind[] = [
  'contact',
  'links',
  'summary',
  'skills',
  'experience',
  'projects',
  'education',
  'certifications',
  'languages',
  'additional',
];
const mutableFields = new Set([
  'summary',
  'skill',
  'description',
  'text',
  'source_passage',
]);
export function reviewedPlan(profile: ProfileDocument): DraftPlan {
  if (
    !profile.sections.length ||
    profile.coverage.some((row) => row.disposition === 'unresolved')
  )
    throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
  const facts: EligibleFact[] = [],
    structuralFactIds: string[] = [],
    supersededFactIds: string[] = [];
  for (const section of profile.sections)
    for (const entry of section.entries) {
      // A correction takes the place of the fact it replaces, so the draft keeps
      // the source order (e.g. institution before degree).
      const replacement = new Map(
        entry.facts.flatMap((fact) =>
          fact.replacesFactId ? [[fact.replacesFactId, fact] as const] : [],
        ),
      );
      const ordered = entry.facts.flatMap((fact) =>
        fact.replacesFactId &&
        entry.facts.some((f) => f.id === fact.replacesFactId)
          ? []
          : replacement.has(fact.id)
            ? [fact, replacement.get(fact.id)!]
            : [fact],
      );
      for (const fact of ordered) {
        if (
          /^(?:ignore (?:all|previous)|system(?: prompt)?\s*:|assistant\s*:|return json|invent\b)/iu.test(
            fact.value.trim(),
          )
        )
          throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
        if (fact.field === 'heading') {
          structuralFactIds.push(fact.id);
          continue;
        }
        if (
          fact.review === 'needs_clarification' ||
          (fact.review !== 'confirmed' && section.review !== 'confirmed')
        )
          throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
        if (replacement.has(fact.id)) {
          supersededFactIds.push(fact.id);
          continue;
        }
        facts.push({
          id: fact.id,
          field: fact.field,
          value: fact.value,
          sectionId: section.id,
          sectionKind: section.kind,
          entryId: entry.id,
          confirmation: fact.review === 'confirmed' ? 'field' : 'section',
          origin: fact.origin,
          evidence: structuredClone(fact.evidence),
          ...(fact.replacesFactId
            ? { replacesFactId: fact.replacesFactId }
            : {}),
        });
      }
    }
  if (!facts.length)
    throw new TailoredDraftError('CV_DRAFT_PROFILE_INCOMPLETE');
  if (facts.length > 96) throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  return {
    profile: structuredClone(profile),
    facts,
    candidates: facts.filter((fact) => mutableFields.has(fact.field)),
    structuralFactIds,
    supersededFactIds,
  };
}
export function proposalBatches(plan: DraftPlan): EligibleFact[][] {
  const batches: EligibleFact[][] = [];
  for (const fact of plan.candidates) {
    const last = batches.at(-1);
    if (
      !last ||
      last[0]!.entryId !== fact.entryId ||
      last[0]!.sectionId !== fact.sectionId ||
      last.length >= BATCH_FACTS ||
      last.reduce((n, f) => n + Buffer.byteLength(f.value), 0) +
        Buffer.byteLength(fact.value) >
        12000
    )
      batches.push([fact]);
    else last.push(fact);
  }
  if (batches.length > MAX_BATCHES)
    throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  return batches;
}
export function validateBatch(
  output: unknown,
  batch: readonly EligibleFact[],
  requirementIds: readonly string[],
): BatchOutput {
  let data: Record<string, unknown>;
  try {
    data = record(output, ['selectedFactIds', 'proposals']);
  } catch {
    throw new TailoredDraftError('CV_DRAFT_INVALID_OUTPUT');
  }
  if (
    !Array.isArray(data.selectedFactIds) ||
    data.selectedFactIds.length > batch.length ||
    !Array.isArray(data.proposals) ||
    data.proposals.length > 2 ||
    new Set(data.selectedFactIds).size !== data.selectedFactIds.length
  )
    throw new TailoredDraftError('CV_DRAFT_INVALID_OUTPUT');
  const allowed = new Set(batch.map((fact) => fact.id));
  if (
    data.selectedFactIds.some(
      (id) => typeof id !== 'string' || !allowed.has(id),
    )
  )
    throw new TailoredDraftError('CV_DRAFT_UNSUPPORTED_REFERENCE');
  const seen = new Set<string>();
  for (const item of data.proposals) {
    let proposal: Record<string, unknown>;
    try {
      proposal = record(item, [
        'factId',
        'text',
        'requirementIds',
        ...(item && typeof item === 'object' && Object.hasOwn(item, 'verify')
          ? ['verify']
          : []),
      ]);
    } catch {
      throw new TailoredDraftError('CV_DRAFT_INVALID_OUTPUT');
    }
    if (
      typeof proposal.factId !== 'string' ||
      !allowed.has(proposal.factId) ||
      !data.selectedFactIds.includes(proposal.factId)
    )
      throw new TailoredDraftError('CV_DRAFT_UNSUPPORTED_REFERENCE');
    if (
      seen.has(proposal.factId) ||
      typeof proposal.text !== 'string' ||
      !proposal.text.trim() ||
      proposal.text.length > 600 ||
      !Array.isArray(proposal.requirementIds) ||
      proposal.requirementIds.length > 5 ||
      new Set(proposal.requirementIds).size !==
        proposal.requirementIds.length ||
      (proposal.verify !== undefined &&
        (typeof proposal.verify !== 'string' || proposal.verify.length > 600))
    )
      throw new TailoredDraftError('CV_DRAFT_INVALID_OUTPUT');
    if (
      proposal.requirementIds.some(
        (id) => typeof id !== 'string' || !requirementIds.includes(id),
      )
    )
      throw new TailoredDraftError('CV_DRAFT_UNSUPPORTED_REFERENCE');
    seen.add(proposal.factId);
  }
  return structuredClone(output) as BatchOutput;
}
// Deliberately narrower than semantic equivalence: preserve ordered wording and
// significant punctuation. Unrecognized transformations fail closed.
const normalizedSpacing = (text: string): string =>
  text.trim().replace(/\s+/gu, ' ');
const withoutFinalStop = (text: string): string =>
  text.replace(/(?<=[\p{L}\p{M}])\.$/u, '');
type ProposalContext = Pick<EligibleFact, 'sectionKind' | 'field'>;
function noValueChange(
  source: string,
  proposed: string,
  context?: ProposalContext,
): boolean {
  const original = normalizedSpacing(source);
  const suggestion = normalizedSpacing(proposed);
  if (withoutFinalStop(original) === withoutFinalStop(suggestion)) return true;
  // Only explicit, known category prefixes in Skills; never infer a boundary
  // inside a claim or discard punctuation from technology names.
  return (
    context?.sectionKind === 'skills' &&
    context.field === 'skill' &&
    /^(?:Backend|Leadership) /u.test(original) &&
    suggestion === original.replace(/^(Backend|Leadership) /u, '$1: ')
  );
}
// A pure skills list: optional category prefix, then distinct short items with
// one consistent separator and no qualifiers. Qualified or prose lists abstain.
interface SkillList {
  prefix: string;
  items: string[];
  separator: string;
  trailing: string;
}
const listQualifier =
  /\b(?:not|no|only|academic|coursework|prototype|learning|learned|basic|familiar|familiarity|beginner|exposure|some|except|without|planned|studying|progress|personal|hobby|and|or)\b/iu;
const listItem = /^[\p{L}\p{N}][\p{L}\p{N} .#+/&-]{0,39}$/u;
export function skillList(text: string): SkillList | undefined {
  const trailing = /\s*$/u.exec(text)![0];
  const body = text.slice(0, text.length - trailing.length);
  if (body !== body.trimStart() || listQualifier.test(body)) return undefined;
  let prefix = '';
  const colon = /^([^:,·]{1,40}:\s*)/u.exec(body);
  if (colon) prefix = colon[1]!;
  else {
    const words = body.split(' ');
    for (let k = Math.min(4, words.length - 1); k >= 1; k--) {
      const head = words.slice(0, k).join(' ');
      if (knownSkillCategory.test(head)) {
        prefix = `${head} `;
        break;
      }
    }
  }
  const rest = body.slice(prefix.length);
  if (/[;:()[\]"']/u.test(rest)) return undefined;
  const separator = rest.includes(' · ') ? ' · ' : ', ';
  if (separator === ' · ' ? rest.includes(',') : rest.includes('·'))
    return undefined;
  const items = rest.split(separator);
  if (
    items.length < 2 ||
    new Set(items).size !== items.length ||
    !items.every((item) => listItem.test(item) && item.split(' ').length <= 4)
  )
    return undefined;
  return { prefix, items, separator, trailing };
}
// Same prefix, separator and items; only the order differs.
function listReorder(source: string, proposed: string): boolean {
  const a = skillList(source),
    b = skillList(proposed.trimEnd() + (skillList(source)?.trailing ?? ''));
  return Boolean(
    a &&
    b &&
    a.prefix === b.prefix &&
    a.separator === b.separator &&
    a.items.length === b.items.length &&
    a.items.join('\u0000') !== b.items.join('\u0000') &&
    [...a.items].sort().join('\u0000') === [...b.items].sort().join('\u0000'),
  );
}
// Whole-term mention of a CV list item in job requirement text. Short terms
// (Go, C#, AWS) match case-sensitively so ordinary words never count.
export function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{N}+#.])${escaped}(?![\\p{L}\\p{N}+#]|\\.[\\p{L}])`,
    term.length <= 3 ? 'u' : 'iu',
  ).test(haystack);
}
type MatchRows = DraftInput['match']['assessment']['requirements'];
// Deterministic, source-grounded emphasis: lead a pure skills list with the
// items the job names. Abstains when no reorder results.
export function jdLedSkillOrder(
  fact: Pick<EligibleFact, 'field' | 'value'>,
  requirements: MatchRows,
): { text: string; requirementIds: string[]; explanation: string } | undefined {
  if (fact.field !== 'skill') return undefined;
  const list = skillList(fact.value);
  if (!list) return undefined;
  const rows = requirements.filter((row) => row.status !== 'CONFLICT');
  const named = new Map<string, string[]>();
  for (const item of list.items) {
    const ids = rows
      .filter((row) =>
        [row.requirement, ...row.coverage.components.map((c) => c.label)].some(
          (text) => mentions(text, item),
        ),
      )
      .map((row) => row.parentId!);
    if (ids.length) named.set(item, ids);
  }
  const order = [
    ...list.items.filter((i) => named.has(i)),
    ...list.items.filter((i) => !named.has(i)),
  ];
  if (order.join('\u0000') === list.items.join('\u0000')) return undefined;
  const requirementIds = [...new Set([...named.values()].flat())].slice(0, 5);
  const lead = [...named.keys()];
  return {
    text: list.prefix + order.join(list.separator) + list.trailing,
    requirementIds,
    explanation: `Leads with ${lead.join(', ')}, which the job names (${requirementIds.join(', ')}). Same items; only the order changes.`,
  };
}
// ---- D2.3 Experience rewrite claim check ---------------------------------
// Lexical proxies for claim-level meaning. A rewrite may restructure freely but
// must keep every number, technology/entity, negation (with its object),
// agency ("by X"), and scope/hedge qualifier, and add no responsibility
// escalation. Additions of metrics/technologies are never accepted as facts;
// they become user-verification suggestions instead.
const lower = (t: string) => t.toLowerCase();
const words = (text: string) =>
  [
    ...text.matchAll(/\.?[\p{L}\p{N}](?:[\p{L}\p{N}+#./'-]*[\p{L}\p{N}+#])?/gu),
  ].map((m) => m[0]);
const numbers = (text: string) =>
  [...text.matchAll(/[-+−]?\d[\d.,]*(?:\s?%|\+|[kKmMxX]\b)?/gu)].map((m) =>
    m[0].replace(/\s/gu, ''),
  );
const entities = (text: string) => {
  const list = words(text.replace(/^\s*[•●▪◦*-]\s*/u, ''));
  return list.filter(
    (w, i) =>
      !/^[-+−]?\d[\d.,]*$/u.test(w) &&
      (/[+#./\d]/u.test(w.slice(1)) ||
        /^\./u.test(w) ||
        /\p{Lu}/u.test(w.slice(1)) ||
        (i > 0 && /^\p{Lu}/u.test(w))),
  );
};
const has = (text: string, term: string) => mentions(text, term);
const hasWord = (text: string, word: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}-])${word}(?![\\p{L}\\p{N}-])`, 'iu').test(text);
const negation = /\b(?:not|no|never|without|none|nor|non)\b/giu;
const qualifiers = [
  'only',
  'prototype',
  'prototypes',
  'academic',
  'coursework',
  'internal',
  'junior',
  'intern',
  'partial',
  'partially',
  'assisted',
  'helped',
  'supported',
  'contributed',
  'participated',
  'collaborated',
  'team',
  'pilot',
  'personal',
  'learning',
  'basic',
  'familiar',
  'exposure',
  'some',
  'approximately',
  'about',
  'around',
  'may',
  'might',
  'could',
  'planned',
  'expected',
  'aimed',
  'locally',
  'test',
  'testing',
  'staging',
  'demo',
  'proposed',
  'co-led',
  'jointly',
];
const escalations = [
  'led',
  'lead',
  'leading',
  'owned',
  'own',
  'owning',
  'ownership',
  'managed',
  'manage',
  'managing',
  'headed',
  'directed',
  'spearheaded',
  'architected',
  'drove',
  'championed',
  'oversaw',
  'supervised',
  'mentored',
  'sole',
  'solely',
  'single-handedly',
  'independently',
  'expert',
  'senior',
  'principal',
  'all',
  'every',
  'entire',
  'production',
  'company-wide',
  'enterprise-wide',
  'global',
  'millions',
  'significantly',
  'dramatically',
  'drastically',
  'major',
];
const stopWords = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'for',
  'in',
  'on',
  'at',
  'with',
  'by',
  'as',
  'from',
  'into',
  'its',
  'their',
  'this',
  'that',
]);
const contentSequence = (text: string) =>
  words(text)
    .map(lower)
    .filter((w) => !stopWords.has(w))
    .join(' ');
export type ClaimCheck =
  | { verdict: 'cosmetic' }
  | { verdict: 'safe' }
  | { verdict: 'verify'; details: string[] }
  | { verdict: 'blocked'; reason: string };
export function claimCheck(
  source: string,
  proposed: string,
  jdTerms: readonly string[] = [],
): ClaimCheck {
  if (/[\p{Cc}\p{Cf}]/u.test(proposed.replace(/[\n\t\r]/gu, '')))
    return { verdict: 'blocked', reason: 'Invalid control characters.' };
  if (
    /\b(?:p\d{1,3}|requirements?\s+p?\d|JD)\b/u.test(proposed) &&
    !/\b(?:p\d{1,3}|JD)\b/u.test(source)
  )
    return {
      verdict: 'blocked',
      reason: 'Mentions job requirement references in CV wording.',
    };
  if (proposed.length > source.length * 1.6 + 60)
    return {
      verdict: 'blocked',
      reason: 'Rewrite is much longer than the original fact.',
    };
  const missing = (list: string[], where: string) =>
    list.filter((t) => !has(where, t));
  const lostNumbers = numbers(source).filter(
    (n) => !numbers(proposed).includes(n),
  );
  if (lostNumbers.length)
    return {
      verdict: 'blocked',
      reason: `Changes or drops source number(s): ${lostNumbers.join(', ')}.`,
    };
  const lostEntities = missing(entities(source), proposed);
  if (lostEntities.length)
    return {
      verdict: 'blocked',
      reason: `Drops source technology or name(s): ${lostEntities.join(', ')}.`,
    };
  const objects = (text: string, cue: RegExp) =>
    [...text.matchAll(cue)].map((m) => lower(m[0]).replace(/\s+/gu, ' '));
  const negationObjects = (t: string) =>
    objects(
      t,
      /\b(?:not|no|never|without|none|nor|non)\s+[\p{L}\p{N}.+#-]+/giu,
    );
  const sourceNeg = negationObjects(source),
    proposedNeg = negationObjects(proposed);
  if (
    (source.match(negation)?.length ?? 0) !==
      (proposed.match(negation)?.length ?? 0) ||
    sourceNeg.some((n) => !proposedNeg.includes(n))
  )
    return {
      verdict: 'blocked',
      reason: 'Changes a negation or what it applies to.',
    };
  const agency = objects(source, /\bby\s+(?!\d)[\p{L}.+#-]+/giu);
  if (agency.some((a) => !lower(proposed).replace(/\s+/gu, ' ').includes(a)))
    return {
      verdict: 'blocked',
      reason: 'Changes who performed the work (agency).',
    };
  const lostQualifiers = qualifiers.filter(
    (q) => hasWord(source, q) && !hasWord(proposed, q),
  );
  if (lostQualifiers.length)
    return {
      verdict: 'blocked',
      reason: `Drops scope or responsibility qualifier(s): ${lostQualifiers.join(', ')}.`,
    };
  // The source's actions (lead verb and "to <verb>" purposes) must survive,
  // in any inflection. Restructuring may move them; it may not replace them.
  const lostActions = actions(source).filter(
    (a) => !words(proposed).some((w) => stem(w) === a),
  );
  if (lostActions.length)
    return {
      verdict: 'blocked',
      reason: `Changes the original action: ${lostActions.join(', ')} no longer appears.`,
    };
  const raised = escalations.filter(
    (e) => hasWord(proposed, e) && !hasWord(source, e),
  );
  const lowered = escalations.filter(
    (e) => hasWord(source, e) && !hasWord(proposed, e),
  );
  if (lowered.length)
    return {
      verdict: 'blocked',
      reason: `Changes stated responsibility or scope: drops ${lowered.join(', ')}.`,
    };
  if (raised.length)
    return {
      verdict: 'blocked',
      reason: `Adds responsibility or scope not in the source: ${raised.join(', ')}.`,
    };
  // Only after every safety check: identical content words = cosmetic.
  if (contentSequence(source) === contentSequence(proposed))
    return { verdict: 'cosmetic' };
  const placeholders = [...proposed.matchAll(/\[[^\]\n]{1,40}\]/gu)].map(
    (m) => m[0],
  );
  const bare = proposed.replace(/\[[^\]\n]{1,40}\]/gu, ' ');
  // Technologies and names are claims, never questions: block, don't ask.
  const addedTerms = [
    ...missing(entities(bare), source),
    ...jdTerms.filter((t) => has(bare, t) && !has(source, t)),
  ];
  if (addedTerms.length)
    return {
      verdict: 'blocked',
      reason: `Adds technology or name(s) not in the source: ${[...new Set(addedTerms)].join(', ')}.`,
    };
  const details = [
    ...numbers(bare).filter((n) => !numbers(source).includes(n)),
    ...placeholders,
  ];
  return details.length
    ? { verdict: 'verify', details: [...new Set(details)] }
    : { verdict: 'safe' };
}
// Keep the source's bullet marker and line ending so accepted text stays aligned.
const irregular: Record<string, string> = {
  led: 'lead',
  built: 'build',
  wrote: 'write',
  ran: 'run',
  drove: 'drive',
  made: 'make',
  took: 'take',
  began: 'begin',
  brought: 'bring',
  kept: 'keep',
  held: 'hold',
  taught: 'teach',
  sold: 'sell',
  won: 'win',
  spoke: 'speak',
};
// Crude, deliberately conservative stemmer: inflections of one verb collide;
// different verbs do not.
export function stem(word: string): string {
  const w = lower(word);
  if (irregular[w]) return irregular[w]!;
  const base = w.replace(/ies$|ied$/u, 'y').replace(/(?:ing|ed|es|s|e)$/u, '');
  return /([^aeiou])\1$/u.test(base) && base.length > 3
    ? base.slice(0, -1)
    : base;
}
function actions(text: string): string[] {
  const body = text.replace(/^\s*[•●▪◦*-]\s*/u, '');
  const lead = words(body)[0];
  const purposes = [...body.matchAll(/\bto\s+(?:\p{L}+ly\s+)?(\p{Ll}+)/gu)].map(
    (m) => m[1]!,
  );
  return [...new Set([lead, ...purposes].filter(Boolean).map((w) => stem(w!)))];
}
export function framed(source: string, proposed: string): string {
  const marker = /^\s*[•●▪◦*-]\s+/u.exec(source)?.[0] ?? '';
  const ending = /\s*$/u.exec(source)![0];
  const body = proposed.trim().replace(/^[•●▪◦*-]\s+/u, '');
  return marker + body + ending;
}
// A model-cited requirement is kept only when it is demonstrably about this
// fact: matcher evidence quotes the fact, or the fact names one of the
// requirement's short component terms. Everything else is dropped.
export function relevantRequirementIds(
  fact: Pick<EligibleFact, 'value' | 'evidence'>,
  ids: readonly string[],
  requirements: MatchRows,
): string[] {
  return ids.filter((id) => {
    const row = requirements.find((r) => r.parentId === id);
    if (!row || row.status === 'CONFLICT') return false;
    return row.coverage.components.some(
      (c) =>
        (c.status === 'EVIDENCED' &&
          c.cvQuote &&
          fact.evidence.some((ref) => ref.quote.includes(c.cvQuote))) ||
        (c.label.split(/\s+/u).length <= 4 && mentions(fact.value, c.label)),
    );
  });
}
const relatesTo = (ids: readonly string[], requirements: MatchRows) =>
  ids.length
    ? `Relates to ${ids
        .map((id) => {
          const text = requirements.find((r) => r.parentId === id)!.requirement;
          return `${id} (${text.length > 40 ? `${text.slice(0, 40)}…` : text})`;
        })
        .join(', ')}.`
    : 'No specific job requirement could be linked.';
// Cosmetic: the single permitted article insertion. Safe, but never useful
// enough to present as a tailoring proposal.
function cosmetic(source: string, proposed: string): boolean {
  const original = normalizedSpacing(source),
    suggestion = normalizedSpacing(proposed);
  for (const site of original.matchAll(
    /(?:^| )(?:for|in|on|at) (?=[\p{L}\p{M}])/gu,
  )) {
    const at = site.index + site[0].length;
    if (suggestion === `${original.slice(0, at)}the ${original.slice(at)}`)
      return true;
  }
  return false;
}
export function rewriteRisk(
  source: string,
  proposed: string,
  context?: ProposalContext,
): string | null {
  if (/[\p{Cc}\p{Cf}]/u.test(proposed.replace(/[\n\t\r]/gu, '')))
    return 'Invalid control characters.';
  if (noValueChange(source, proposed, context)) return null;
  if (context?.field === 'skill' && listReorder(source, proposed)) return null;
  const original = normalizedSpacing(source);
  const suggestion = normalizedSpacing(proposed);
  // One definite article may be inserted after these existing prepositions.
  // No deletion, replacement, reordering, or simultaneous punctuation edit is
  // allowed. In particular, never discard "by" (agency) or scope qualifiers.
  const sites = original.matchAll(/(?:^| )(?:for|in|on|at) (?=[\p{L}\p{M}])/gu);
  for (const site of sites) {
    const at = site.index + site[0].length;
    if (suggestion === `${original.slice(0, at)}the ${original.slice(at)}`)
      return null;
  }
  return 'Wording order, agency, entities, qualifiers or significant punctuation changed outside the permitted article insertion.';
}
export function assembleDraft(
  input: DraftInput,
  outputs: readonly BatchOutput[],
): TailoredDraftDocument {
  const { plan, match } = input;
  const selected = outputs.flatMap((output) => output.selectedFactIds);
  const selectedSet = new Set(selected);
  const proposals = new Map(
    outputs.flatMap((output) =>
      output.proposals.map((proposal) => [proposal.factId, proposal] as const),
    ),
  );
  const requirements = match.assessment.requirements;
  const document: TailoredDraftDocument = {
    contractVersion: '1',
    kind: 'tailored_cv',
    pins: structuredClone(input.pins),
    jobSnapshot: structuredClone(input.job),
    requirements: requirements.map((row) => ({
      id: row.parentId!,
      text: row.requirement,
      priority: row.priority,
      status: row.status,
      mode: row.coverage.mode,
      credit: row.coverage.credit,
      components: row.coverage.components.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
      })),
    })),
    sections: [],
    recoverable: {
      unselectedFactIds: plan.candidates
        .filter((fact) => !selectedSet.has(fact.id))
        .map((fact) => fact.id),
      structuralFactIds: [...plan.structuralFactIds],
      supersededFactIds: [...plan.supersededFactIds],
      sourceCoverage: structuredClone(plan.profile.coverage),
    },
    reviewIssues: [],
  };
  for (const row of requirements)
    if (row.status !== 'EVIDENCED')
      document.reviewIssues.push({
        code:
          row.status === 'PARTIAL'
            ? 'REQUIREMENT_PARTIAL'
            : row.status === 'CONFLICT'
              ? 'REQUIREMENT_CONFLICT'
              : 'REQUIREMENT_UNKNOWN',
        requirementId: row.parentId,
        reason: row.coverage.reason,
      });
  for (const section of plan.profile.sections) {
    const result: TailoredDraftDocument['sections'][number] = {
      id: section.id,
      kind: section.kind,
      entries: [],
    };
    for (const [originalOrder, entry] of section.entries.entries()) {
      const facts = plan.facts.filter(
        (fact) => fact.sectionId === section.id && fact.entryId === entry.id,
      );
      if (!facts.length) continue;
      result.entries.push({
        id: entry.id,
        originalOrder,
        priorityFactIds: selected.filter((id) =>
          facts.some((fact) => fact.id === id),
        ),
        facts: facts.map((fact) => {
          const relevance: TailoredDraftDocument['sections'][number]['entries'][number]['facts'][number]['relevance'] =
            [];
          if (fact.origin === 'source')
            for (const row of requirements) {
              if (row.status === 'CONFLICT' || row.coverage.mode === 'UNKNOWN')
                continue;
              const components = row.coverage.components.filter(
                (c) =>
                  c.status === 'EVIDENCED' &&
                  c.cvQuote &&
                  fact.evidence.some((ref) => ref.quote.includes(c.cvQuote)),
              );
              if (components.length)
                relevance.push({
                  requirementId: row.parentId!,
                  componentIds: components.map((c) => c.id),
                  kind: 'source_passage_support',
                });
            }
          const proposal = proposals.get(fact.id);
          let wording: DraftFact['proposedWording'] = null;
          const conflicted = requirements.some(
            (row) =>
              row.status === 'CONFLICT' &&
              row.coverage.components.some((c) =>
                [c.cvQuote, ...c.conflictingQuotes].some(
                  (quote) =>
                    quote &&
                    fact.evidence.some((ref) => ref.quote.includes(quote)),
                ),
              ),
          );
          let verification: DraftFact['verification'] = null;
          const rewritable =
            fact.field === 'description' &&
            ['experience', 'projects'].includes(fact.sectionKind);
          if (proposal && rewritable) {
            const terms = requirements.flatMap((row) =>
              row.coverage.components
                .map((c) => c.label)
                .filter((l) => l.split(/\s+/u).length <= 3),
            );
            const cited = relevantRequirementIds(
              fact,
              proposal.requirementIds,
              requirements,
            );
            for (const [text, path] of [
              [proposal.text, 'rewrite'],
              [proposal.verify ?? '', 'verify'],
            ] as const) {
              if (!text.trim()) continue;
              const check = claimCheck(fact.value, text, terms);
              if (check.verdict === 'cosmetic') continue;
              if (check.verdict === 'blocked' || conflicted) {
                document.reviewIssues.push({
                  code: 'CV_DRAFT_UNSAFE_REWRITE',
                  factId: fact.id,
                  reason: conflicted
                    ? CONFLICTING_SOURCE_REASON
                    : `Blocked ${path}: ${check.verdict === 'blocked' ? check.reason : ''}`,
                });
                continue;
              }
              if (check.verdict === 'safe' && !wording)
                wording = {
                  text: framed(fact.value, text),
                  status: 'pending',
                  requirementIds: [...cited],
                  explanation: `${relatesTo(cited, requirements)} Actions, numbers, technologies, negations, qualifiers and responsibility match the source; confirm the meaning is unchanged.`,
                };
              else if (check.verdict === 'verify' && !verification)
                verification = {
                  text: framed(fact.value, text),
                  details: check.details,
                  requirementIds: [...cited],
                  explanation: `Stronger framing. ${relatesTo(cited, requirements)} Not in your CV: ${check.details.join(', ')}. Use it only if you can confirm or supply these details.`,
                };
            }
            if (wording)
              document.reviewIssues.push({
                code: 'SEMANTIC_REVIEW_REQUIRED',
                factId: fact.id,
                reason:
                  'A claim check is not semantic verification. Review the rewrite against the original fact.',
              });
          } else if (proposal) {
            const conflict = conflicted;
            const noValue =
              noValueChange(fact.value, proposal.text, fact) ||
              cosmetic(fact.value, proposal.text);
            const risk =
              rewriteRisk(fact.value, proposal.text, fact) ??
              (conflict && !noValue ? CONFLICTING_SOURCE_REASON : null);
            if (risk)
              document.reviewIssues.push({
                code: 'CV_DRAFT_UNSAFE_REWRITE',
                factId: fact.id,
                reason: risk,
              });
            else if (!noValue) {
              wording = {
                text: proposal.text,
                status: 'pending' as const,
                requirementIds: relevantRequirementIds(
                  fact,
                  proposal.requirementIds,
                  requirements,
                ),
                explanation: `Model-suggested order. ${relatesTo(
                  relevantRequirementIds(
                    fact,
                    proposal.requirementIds,
                    requirements,
                  ),
                  requirements,
                )}`,
              };
              document.reviewIssues.push({
                code: 'SEMANTIC_REVIEW_REQUIRED',
                factId: fact.id,
                reason:
                  'A lexical safeguard is not semantic verification. Review wording against the original fact.',
              });
            }
            for (const requirementId of relevantRequirementIds(
              fact,
              proposal.requirementIds,
              requirements,
            ))
              if (
                proposal.text.trim() !== fact.value.trim() &&
                !relevance.some((link) => link.requirementId === requirementId)
              )
                relevance.push({
                  requirementId,
                  componentIds: [],
                  kind: 'ai_relevance_only',
                });
          }
          // Deterministic JD-led ordering is offered only when the model gave no
          // usable wording, and never for facts tied to conflicting evidence.
          const ordered =
            !wording && !conflicted
              ? jdLedSkillOrder(fact, requirements)
              : undefined;
          if (
            ordered &&
            rewriteRisk(fact.value, ordered.text, fact) === null &&
            !noValueChange(fact.value, ordered.text, fact)
          ) {
            wording = { status: 'pending', ...ordered };
            document.reviewIssues.push({
              code: 'SEMANTIC_REVIEW_REQUIRED',
              factId: fact.id,
              reason:
                'Order-only change to an existing skills list. Confirm it still reads correctly.',
            });
          }
          return {
            id: fact.id,
            field: fact.field,
            acceptedText: fact.value,
            selected:
              !mutableFields.has(fact.field) || selectedSet.has(fact.id),
            provenance: {
              profileFactId: fact.id,
              origin: fact.origin,
              confirmation: fact.confirmation,
              evidence: structuredClone(fact.evidence),
              ...(fact.replacesFactId
                ? { replacesFactId: fact.replacesFactId }
                : {}),
            },
            relevance,
            proposedWording: wording,
            ...(verification ? { verification } : {}),
          };
        }),
      });
    }
    document.sections.push(result);
  }
  for (const kind of sectionKinds)
    if (!document.sections.some((section) => section.kind === kind)) {
      document.sections.push({ id: `absent-${kind}`, kind, entries: [] });
      document.reviewIssues.push({
        code: 'SECTION_NOT_IN_PROFILE',
        sectionKind: kind,
        reason:
          'No reviewed source content exists for this section; nothing was invented.',
      });
    }
  if (Buffer.byteLength(JSON.stringify(document)) > DRAFT_BYTES)
    throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  return document;
}
