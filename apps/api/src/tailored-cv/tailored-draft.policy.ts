import { createHash } from 'node:crypto';
import { proposeEntryOrder } from './experience-order.js';
import type { ProfileDocument } from './tailored-cv.contract.js';
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
type MatchRows = DraftInput['match']['assessment']['requirements'];
export function savedSourceSupport(
  fact: EligibleFact,
  requirements: MatchRows,
): DraftFact['relevance'] {
  if (fact.origin !== 'source') return [];
  return requirements.flatMap((row) => {
    if (row.status === 'CONFLICT' || row.coverage.mode === 'UNKNOWN') return [];
    const componentIds = row.coverage.components
      .filter(
        (component) =>
          component.status === 'EVIDENCED' &&
          component.cvQuote &&
          fact.evidence.some((ref) => ref.quote.includes(component.cvQuote!)),
      )
      .map((component) => component.id);
    return componentIds.length
      ? [
          {
            requirementId: row.parentId!,
            componentIds,
            kind: 'source_passage_support' as const,
          },
        ]
      : [];
  });
}

export function framed(source: string, proposed: string): string {
  const marker = /^\s*[•●▪◦*-]\s+/u.exec(source)?.[0] ?? '';
  const ending = /\s*$/u.exec(source)![0];
  const body = marker
    ? proposed.trim().replace(/^[•●▪◦*-]\s+/u, '')
    : proposed.trim();
  return marker + body + ending;
}
const compactWhitespace = (value: string) => value.trim().replace(/\s+/gu, ' ');
/**
 * Numbers in a suggestion that the source fact does not contain. Separators
 * and units are ignored ("1,000" = "1000", "50" = "50%"), so reformatting a
 * documented number is not flagged; a new figure always is.
 */
const terms = (text: string, min: number) =>
  new Set(
    (text.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu) ?? [])
      .map((t) => t.replace(/\.+$/u, ''))
      .filter((t) => t.length >= min),
  );
/**
 * Words a rewrite carries over from other facts of the same entry (bullets are
 * rewritten in isolation, so these are claims the fact itself does not make),
 * or, for a skills list, any word that was not in the list.
 */
export function importedTerms(
  field: string,
  source: string,
  proposed: string,
  siblings: readonly string[],
): string[] {
  const own = terms(source, 2);
  const added = [...terms(proposed, field === 'skill' ? 2 : 4)].filter(
    (t) => !own.has(t),
  );
  if (field === 'skill') return added;
  if (field === 'summary') return [];
  const elsewhere = terms(siblings.join(' '), 4);
  return added.filter((t) => elsewhere.has(t));
}
const YEARS = /(\d+(?:[.,]\d+)?)\s*\+?\s*(?:years?|yrs?|năm)(?![\p{L}])/giu;
const FILLER = new Set(
  'of in with and or the a an as on for at to experience experiences professional total over more than including kinh nghiệm trong về với và các của làm hơn'.split(
    ' ',
  ),
);
const content = (text: string) =>
  (text.toLocaleLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []).filter(
    (w) => !FILLER.has(w),
  );
/**
 * "N years" phrases. A claim is qualified by the words after it ("6 years of
 * Java"); CV evidence by its whole clause ("Java ... for 3 years").
 * shortcut: words before a claimed figure are not checked (subjects are
 * rephrased freely); add them if summaries start prefixing scope to years.
 */
function yearPhrases(text: string) {
  return [...text.matchAll(YEARS)].map((m) => {
    const before = text
      .slice(0, m.index)
      .split(/[.;:()\n]/u)
      .at(-1)!;
    const rest = text.slice(m.index + m[0].length).split(/[.;,:()\n]/u)[0]!;
    return {
      years: m[1]!.replace(',', '.'),
      phrase: `${m[0]}${rest.split(/\s+/u).slice(0, 9).join(' ')}`.trim(),
      qualifiers: new Set(content(rest).slice(0, 6)),
      clause: new Set(content(`${before} ${rest}`)),
    };
  });
}
// Claim families: a word counts as supported when the same stem is used
// anywhere in the CV (titles, bullets, skills), not only in the old summary.
const CLAIMS: { kind: string; en: string; vi: string; pattern: RegExp }[] = [
  {
    kind: 'seniority',
    en: 'title or seniority',
    vi: 'chức danh/cấp bậc',
    pattern:
      /\b(senior|sr|principal|staff|head|chief|architect|manager|director|tech(?:nical)? lead|team lead)\b|trưởng nhóm|trưởng phòng|cấp cao/giu,
  },
  {
    kind: 'leadership',
    en: 'leadership',
    vi: 'vai trò lãnh đạo',
    pattern:
      /\b(led|leading|leads|lead(?=\s+(?:a|the|teams?|engineers|developers|projects?))|manag(?:ed|es|ing)|mentor(?:ed|ing|s)?|supervis(?:ed|ing|es)|head(?:ed|ing))\b|dẫn dắt|lãnh đạo|quản lý nhóm|hướng dẫn/giu,
  },
  {
    kind: 'expertise',
    en: 'expertise',
    vi: 'mức độ chuyên môn',
    pattern:
      /\b(expert|expertise|specialist|speciali[sz]ed|guru|mastery|extensive|deep (?:knowledge|expertise)|highly skilled|proficient)\b|chuyên gia|chuyên sâu|thành thạo/giu,
  },
  {
    kind: 'achievement',
    en: 'result',
    vi: 'kết quả',
    pattern:
      /\b(increas(?:ed|ing)|reduc(?:ed|ing)|improv(?:ed|ing)|boost(?:ed|ing)|sav(?:ed|ing)|grew|accelerat(?:ed|ing)|optimi[sz](?:ed|ing)|doubl(?:ed|ing)|tripl(?:ed|ing))\b|cải thiện|tối ưu|giảm|tăng/giu,
  },
];
const stem = (word: string) =>
  word
    .toLocaleLowerCase()
    .replace(/^(?:led|leads|leading)$/u, 'lead')
    .replace(/(?:ed|es|ing|s|e)$/u, '');
/**
 * Claims a summary rewrite adds that the CV does not support: years tied to
 * a different scope (total years are not technology years), and seniority,
 * leadership, expertise or result wording absent from the whole CV. Numbers
 * stated anywhere in the CV are supported.
 */
export function summaryClaims(
  original: string,
  proposed: string,
  cv: readonly string[],
  en: boolean,
): string[] {
  const evidence = [original, ...cv];
  const claims: string[] = [];
  // "5 years of experience, 4 of them with Java" states 4 years of Java.
  const known = evidence
    .map((t) => t.replace(/(\d+)\s+of\s+(?:them|those|which)\b/giu, '$1 years'))
    .flatMap(yearPhrases);
  for (const claim of yearPhrases(proposed)) {
    const supported = known.some(
      (k) =>
        k.years === claim.years &&
        [...claim.qualifiers].every((q) => k.clause.has(q)),
    );
    if (!supported) claims.push(`"${claim.phrase}"`);
  }
  // The opening headline ("Senior Java Developer and ...") is a title claim:
  // its words must come from the old headline or a title held in the CV.
  const headline = (text: string) => {
    const words: string[] = [];
    for (const word of text
      .split(/[,.;:]|\s(?:with|and|who|từ|với|có)\s/iu)[0]!
      .trim()
      .split(/\s+/u)) {
      // The title ends where the description starts ("... building APIs").
      if (words.length === 6 || /\p{L}{3,}(?:ing|ed)$/iu.test(word)) break;
      words.push(word);
    }
    return words.join(' ');
  };
  const titles = cv.filter((line) => line.trim().split(/\s+/u).length <= 6);
  const held = new Set(content([headline(original), ...titles].join(' ')));
  const unheld = content(headline(proposed)).filter((w) => !held.has(w));
  if (unheld.length)
    claims.push(
      `${en ? 'headline title' : 'chức danh mở đầu'}: "${headline(proposed)}"`,
    );
  const corpus = evidence.join('\n');
  for (const family of CLAIMS) {
    const found = new Set<string>();
    for (const m of proposed.matchAll(family.pattern)) {
      const word = m[0].toLocaleLowerCase();
      const has = (text: string) =>
        [...text.matchAll(family.pattern)].some(
          (x) => stem(x[0]) === stem(word),
        );
      if (!has(corpus)) found.add(m[0]);
    }
    if (found.size)
      claims.push(`${en ? family.en : family.vi}: ${[...found].join(', ')}`);
  }
  // Year figures are judged with their scope above; other numbers by the CV.
  const withoutYears = proposed.replace(YEARS, '');
  const numbers = newNumbers(corpus, withoutYears);
  if (numbers.length)
    claims.push(`${en ? 'numbers' : 'số liệu'}: ${numbers.join(', ')}`);
  return claims;
}
// Strong, documented positioning a rewrite must not drop. A family is kept
// when the rewrite still uses any of its words (e.g. "led" -> "managed").
const STRONG: { family: string; pattern: RegExp }[] = [
  {
    family: 'leadership',
    pattern:
      /\b(led|leads?|leading|leadership|manag(?:ed|es|ing)|headed|heads?|mentor(?:ed|ing|s)?|spearhead(?:ed|ing)|direct(?:ed|ing)|drove|driving|supervis(?:ed|ing))\b|dẫn dắt|lãnh đạo|quản lý|hướng dẫn|trưởng nhóm/iu,
  },
  {
    family: 'ownership',
    pattern:
      /\b(own(?:ed|s|ing|er|ership)?|architect(?:ed|ing|ure)?|design(?:ed|ing|s)?|founded|launched|initiated|introduced)\b|thiết kế|chịu trách nhiệm|phụ trách|làm chủ/iu,
  },
  {
    family: 'title',
    pattern:
      /\b(senior|principal|staff|chief|head|tech(?:nical)? lead|team lead|lead engineer|manager|director)\b|cấp cao|trưởng nhóm|trưởng phòng/iu,
  },
];
/**
 * What a rewrite drops from the original: a leadership, ownership or title
 * claim, or a documented figure. Such a rewrite weakens a verified
 * qualification and is not shown; the original stays.
 */
export function weakened(
  original: string,
  proposed: string,
  field = 'description',
): string[] {
  const lost = STRONG.filter(
    ({ pattern }) => pattern.test(original) && !pattern.test(proposed),
  ).map(({ family }) => family);
  // A summary may leave a figure to the bullet that documents it.
  const figures = field === 'summary' ? [] : newNumbers(proposed, original);
  return figures.length ? [...lost, `figures: ${figures.join(', ')}`] : lost;
}
const skillItems = (text: string) =>
  text
    .split(/[,;\n•|]+/u)
    .map((s) => s.trim().replace(/^[-*]\s*/u, ''))
    .filter(Boolean);
const mentions = (jd: string, item: string) =>
  item
    .toLocaleLowerCase()
    .split(/\s*\/\s*/u)
    .some((part) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}])`,
        'u',
      ).test(jd),
    );
/**
 * A rewrite that changes nothing a recruiter for this job would notice:
 * a skills reorder that does not move job-relevant items ahead of others (or
 * drops items), or a small word swap (at most two words in and two out) that
 * brings in no job-relevant word or figure, or only rearranges existing words
 * without moving job-relevant ones forward.
 */
export function lowValue(
  field: string,
  original: string,
  proposed: string,
  jd: string,
  required = '',
): boolean {
  const job = jd.toLocaleLowerCase();
  if (field === 'skill') {
    // "Databases: PostgreSQL, MySQL" — the group label is not an item.
    const label = /^[^:,\n]{1,40}:\s*/u;
    const before = skillItems(original.replace(label, ''));
    const after = skillItems(proposed.replace(label, ''));
    const key = (items: string[]) =>
      items
        .map((i) => i.toLocaleLowerCase())
        .sort()
        .join('\n');
    // A changed list is judged by the added-claim checks; a shorter list loses skills.
    if (key(before) !== key(after)) return after.length < before.length;
    // Same order, new layout (e.g. a bulleted list) is a formatting choice.
    if (before.join('\n') === after.join('\n')) return false;
    // Pairs where a job-relevant item comes after one the job does not mention.
    const misplaced = (items: string[]) => {
      let seen = 0;
      let count = 0;
      for (const item of items)
        if (mentions(job, item)) count += seen;
        else seen++;
      return count;
    };
    // Worth showing only when it fixes at least two misplaced pairs, or brings
    // a required job skill into the first three items.
    const need = required.toLocaleLowerCase();
    const top = (items: string[]) =>
      items.slice(0, 3).filter((item) => need && mentions(need, item));
    const promoted = top(after).some((item) => !top(before).includes(item));
    return !promoted && misplaced(before) - misplaced(after) < 2;
  }
  const words = (text: string) => content(text);
  // Leading with the job-relevant words is a relevance gain, even unchanged.
  const firstRelevant = (list: string[]) => {
    const index = list.findIndex((w) => w.length > 2 && job.includes(w));
    return index < 0 ? Infinity : index;
  };
  // Judge order on the words both versions share, so deleting a word in front
  // does not count as moving a relevant one forward.
  const shared = (list: string[], other: string[]) =>
    list.filter((w) => other.includes(w));
  const was = words(original);
  const now = words(proposed);
  if (firstRelevant(shared(now, was)) < firstRelevant(shared(was, now)))
    return false;
  const before = new Set(words(original));
  const after = new Set(words(proposed));
  const added = [...after].filter((w) => !before.has(w));
  const removed = [...before].filter((w) => !after.has(w));
  if (added.some((w) => w.length > 2 && job.includes(w))) return false;
  // A new figure is a claim for the user to confirm, not a cosmetic change.
  if (added.some((w) => /\d/u.test(w))) return false;
  return (
    added.length <= 2 &&
    removed.length <= 2 &&
    added.length + removed.length <= 3
  );
}
export function newNumbers(source: string, proposed: string): string[] {
  const digits = (text: string) =>
    (text.match(/\d+(?:[.,]\d+)*/gu) ?? []).map((n) => n.replace(/[.,]/gu, ''));
  const known = new Set(digits(source));
  return [
    ...new Set(
      (proposed.match(/\d+(?:[.,]\d+)*%?/gu) ?? []).filter(
        (n) => !known.has(n.replace(/[.,%]/gu, '')),
      ),
    ),
  ];
}

/** Shown suggestions per section; the rest of the five go to Experience. */
export const SECTION_LIMITS = { summary: 1, skill: 2 } as const;
/**
 * Text-free outcome counts per CV section, with stable reason codes for
 * hidden suggestions. Never holds CV text, generated text or prompts.
 */
export type DraftDiagnostics = Record<
  string,
  {
    candidates: number;
    shown: number;
    confirm: number;
    hidden: number;
    reasons: Record<string, number>;
    reasonWordsAvg: number;
  }
>;
export function assembleDraft(
  input: DraftInput,
  outputs: readonly BatchOutput[],
  diagnostics?: DraftDiagnostics,
): TailoredDraftDocument {
  const { plan, match } = input;
  const clarifications = new Map<
    string,
    NonNullable<DraftFact['clarification']>
  >();
  // Keep the first two distinct fact anchors in the model's priority order.
  for (const question of outputs.flatMap((output) => output.questions ?? [])) {
    if (clarifications.size === 2) break;
    if (!clarifications.has(question.factId))
      clarifications.set(question.factId, {
        kind: 'impact',
        status: 'open',
        requirementIds: question.requirementIds,
        question: question.question,
        explanation: question.explanation,
      });
  }
  const selected = outputs.flatMap((output) => output.selectedFactIds);
  const selectedSet = new Set(selected);
  const proposals = new Map(
    outputs.flatMap((output) =>
      output.proposals.map((proposal) => [proposal.factId, proposal] as const),
    ),
  );
  const requirements = match.assessment.requirements;
  const jobText = [
    input.job.title,
    input.job.skills,
    input.job.preferredSkills,
    input.job.experience,
    input.job.domain,
    input.job.jdText || input.job.description || input.job.postText,
  ].join('\n');
  // A verdict per proposal, in the model's priority order: hidden with a
  // stable reason code, or shown within the per-section budget.
  const verdicts = new Map<string, string | null>();
  const used = { summary: 0, skill: 0 };
  for (const [factId, proposal] of proposals) {
    const fact = plan.facts.find((f) => f.id === factId);
    if (!fact) continue;
    const text = framed(fact.value, proposal.text);
    const lost = weakened(fact.value, text, fact.field);
    let reason: string | null =
      compactWhitespace(text) === compactWhitespace(fact.value)
        ? 'identical'
        : lost.length
          ? `weakened_${lost[0]!.split(':')[0]}`
          : lowValue(fact.field, fact.value, text, jobText, input.job.skills)
            ? 'low_value'
            : null;
    const bucket =
      fact.field === 'summary' || fact.field === 'skill' ? fact.field : null;
    if (!reason && bucket) {
      if (used[bucket] >= SECTION_LIMITS[bucket]) reason = 'section_cap';
      else used[bucket]++;
    }
    verdicts.set(factId, reason);
  }
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
          const relevance = savedSourceSupport(fact, requirements);
          const proposal = proposals.get(fact.id);
          const text = proposal ? framed(fact.value, proposal.text) : null;
          const en = input.locale === 'en';
          const summary = fact.field === 'summary';
          // A new figure the model did not flag still needs the user's confirmation.
          const added = text && !summary ? newNumbers(fact.value, text) : [];
          const claims =
            text && summary
              ? summaryClaims(
                  fact.value,
                  text,
                  plan.facts
                    .filter((f) => f.id !== fact.id)
                    .map((f) => f.value),
                  en,
                )
              : [];
          const imported = text
            ? importedTerms(
                fact.field,
                fact.value,
                text,
                plan.facts
                  .filter((f) => f.entryId === fact.entryId && f.id !== fact.id)
                  .map((f) => f.value),
              )
            : [];
          // The model's own note and every deterministic finding are kept: the
          // user confirms all of them at once.
          const assertion =
            [
              proposal?.confirmationAssertion,
              claims.length &&
                (en
                  ? `Check these claims against your experience: ${claims.join('; ')}`
                  : `Kiểm tra với kinh nghiệm thực tế: ${claims.join('; ')}`),
              added.length &&
                (en
                  ? `Numbers not in your CV: ${added.join(', ')}`
                  : `Số liệu chưa có trong CV: ${added.join(', ')}`),
              imported.length &&
                (fact.field === 'skill'
                  ? en
                    ? `Not in your skills list: ${imported.join(', ')}`
                    : `Chưa có trong danh sách kỹ năng: ${imported.join(', ')}`
                  : en
                    ? `Details taken from another line of this entry: ${imported.join(', ')}`
                    : `Chi tiết lấy từ dòng khác của mục này: ${imported.join(', ')}`),
            ]
              .filter((part): part is string => !!part)
              .map((part) => part.replace(/[.\s]+$/u, ''))
              .join('. ') || null;
          // Keep the original rather than show a rewrite that weakens a
          // verified claim, changes nothing that matters for this job, or
          // exceeds its section's budget.
          const worthShowing = text !== null && verdicts.get(fact.id) === null;
          const wording: DraftFact['proposedWording'] =
            proposal &&
            text !== null &&
            worthShowing &&
            compactWhitespace(text) !== compactWhitespace(fact.value)
              ? {
                  text,
                  status: 'pending',
                  requirementIds: proposal.requirementIds,
                  explanation: proposal.explanation,
                  ...(assertion
                    ? {
                        requiresConfirmation: true,
                        confirmationAssertion: assertion,
                      }
                    : {}),
                }
              : null;
          for (const requirementId of new Set([
            ...(wording?.requirementIds ?? []),
            ...(clarifications.get(fact.id)?.requirementIds ?? []),
          ])) {
            if (!relevance.some((link) => link.requirementId === requirementId))
              relevance.push({
                requirementId,
                componentIds: [],
                kind: 'ai_relevance_only',
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
            ...(clarifications.has(fact.id)
              ? { clarification: clarifications.get(fact.id)! }
              : {}),
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
  for (const section of document.sections)
    if (section.kind === 'experience' || section.kind === 'projects')
      for (const entry of section.entries) {
        const proposal = proposeEntryOrder(
          entry,
          document.requirements,
          document.jobSnapshot,
        );
        if (proposal) entry.orderProposal = proposal;
      }
  if (Buffer.byteLength(JSON.stringify(document)) > DRAFT_BYTES)
    throw new TailoredDraftError('CV_DRAFT_CONTEXT_LIMIT');
  if (diagnostics) {
    const drafted = new Map(
      document.sections.flatMap((s) =>
        s.entries.flatMap((e) => e.facts.map((f) => [f.id, f] as const)),
      ),
    );
    const words: Record<string, number[]> = {};
    for (const [factId, reason] of verdicts) {
      const fact = plan.facts.find((f) => f.id === factId)!;
      const row = (diagnostics[fact.sectionKind] ??= {
        candidates: 0,
        shown: 0,
        confirm: 0,
        hidden: 0,
        reasons: {},
        reasonWordsAvg: 0,
      });
      row.candidates++;
      const wording = drafted.get(factId)?.proposedWording;
      if (!wording) {
        row.hidden++;
        const code = reason ?? 'unchanged';
        row.reasons[code] = (row.reasons[code] ?? 0) + 1;
        continue;
      }
      if (wording.requiresConfirmation) row.confirm++;
      else row.shown++;
      (words[fact.sectionKind] ??= []).push(
        wording.explanation?.trim().split(/\s+/u).length ?? 0,
      );
    }
    for (const [section, list] of Object.entries(words))
      diagnostics[section]!.reasonWordsAvg = Math.round(
        list.reduce((a, b) => a + b, 0) / list.length,
      );
  }
  return document;
}
