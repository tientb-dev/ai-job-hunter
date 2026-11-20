import type {
  EvidenceReview,
  MatchCondition,
  MatchResult,
  SkillMatch,
} from './cv-match.types';

export type Finding = NonNullable<SkillMatch['findings']>[number];
export type JdSpan = Finding['sources'][number];
export interface Comparison {
  key: string;
  source?: JdSpan;
  title: string;
  findings: Finding[];
  conditions: MatchCondition[];
  status: string;
  supported: boolean;
  unmapped?: boolean;
}
function located(s: { quote: string } & Partial<JdSpan>): s is JdSpan {
  return (
    typeof s.field === 'string' &&
    Number.isSafeInteger(s.start) &&
    s.start! >= 0 &&
    s.end! - s.start! === s.quote.length
  );
}
export function containsSpan(parent: JdSpan, child: JdSpan) {
  return (
    parent.field === child.field &&
    child.start >= parent.start &&
    child.end <= parent.end &&
    parent.quote.slice(child.start - parent.start, child.end - parent.start) ===
      child.quote
  );
}
export function compareRequirements(
  findings: Finding[],
  conditions: MatchCondition[],
  scored: SkillMatch['rows'],
  review?: EvidenceReview,
  requirements: MatchResult['requirements'] = [],
) {
  const rows = new Map<string, Comparison>();
  const original = new Set(['jdText', 'description', 'postText']);
  const sourceTexts = new Map<string, string>(
    review?.sources.map((source) => [source.field, source.text]),
  );
  // Identical complete source documents preserve the same occurrence positions.
  function sourceField(span: JdSpan) {
    const content = sourceTexts.get(span.field);
    return content
      ? ([...sourceTexts].find(([, text]) => text === content)?.[0] ??
          span.field)
      : span.field;
  }
  function add(source: JdSpan, f: Finding, unmapped = false) {
    const key = JSON.stringify([
      sourceField(source),
      source.start,
      source.end,
      source.quote,
    ]);
    const row = rows.get(key) ?? {
      key,
      source,
      unmapped,
      title: source.quote,
      findings: [] as Finding[],
      conditions: [],
      status: '',
      supported: false,
    };
    if (!row.findings.includes(f)) row.findings.push(f);
    rows.set(key, row);
  }
  const clauses = findings
    .filter((f) => f.kind === 'clause' || f.kind === 'requirement')
    .flatMap((f) => f.sources);
  const assessed = scored.map((row) => row.source).filter(located);
  for (const f of findings)
    for (const span of f.sources) {
      if (f.kind === 'clause' || f.kind === 'requirement') {
        add(span, f);
        continue;
      }
      const enclosing = (sources: JdSpan[]) =>
        sources.filter(
          (s) => containsSpan(s, span) && s.quote.length > span.quote.length,
        );
      const explicit = enclosing(clauses);
      const reviewed = enclosing(review?.rows ?? []);
      const scoredParents = enclosing(assessed);
      const candidates = explicit.length
        ? explicit
        : reviewed.length
          ? reviewed
          : scoredParents;
      // A shorter scored token can describe the same occurrence inside a full clause.
      const parents = candidates.filter(
        (s) =>
          !candidates.some(
            (other) =>
              other.quote.length > s.quote.length && containsSpan(other, s),
          ),
      );
      if (parents.length) for (const parent of parents) add(parent, f);
      else {
        const grounded =
          clauses.some(
            (s) => containsSpan(s, span) && s.quote === span.quote,
          ) ||
          (['jdText', 'description', 'postText'].includes(span.field) &&
            [...(review?.rows ?? []), ...assessed].some(
              (s) => containsSpan(s, span) && s.quote === span.quote,
            ));
        add(span, f, !grounded);
      }
    }
  for (const row of rows.values()) {
    const direct = row.findings.filter((f) => f.kind === 'skill');
    row.supported = direct.length > 0;
    const exact =
      row.findings.every((f) => f.kind === 'skill') &&
      direct.some((f) => f.sources.some((s) => containsSpan(s, row.source!)));
    const verified = review?.rows.some(
      (r) =>
        r.status === 'VERIFIED_EVIDENCE' &&
        containsSpan(r, row.source!) &&
        containsSpan(row.source!, r),
    );
    row.status = row.supported
      ? verified && row.findings.every((f) => f.kind === 'skill')
        ? 'Requirement supported'
        : exact
          ? 'Your CV documents this skill'
          : 'Evidence supports part of this requirement'
      : row.findings.some((f) => f.kind === 'requirement')
        ? 'Evidence to clarify'
        : 'Needs clarification';
  }
  const result = [...rows.values()].filter(
    (row) =>
      !row.unmapped ||
      original.has(row.source!.field) ||
      row.findings.some(
        (f) =>
          ![...rows.values()].some(
            (parent) => !parent.unmapped && parent.findings.includes(f),
          ),
      ),
  );

  const wording = (quote: string) =>
    quote
      .normalize('NFC')
      .trim()
      .replace(/^[-•*]\s+/u, '')
      .replace(/\s+/gu, ' ')
      .replace(/[.;。；]$/u, '')
      .trim();
  const byQuote = (quote: string) =>
    result.filter((r) => !r.unmapped && wording(r.title) === wording(quote));
  const remaining = conditions.filter((c) => {
    let matches = byQuote(c.jdQuote);
    if (!matches.length && c.parentId) {
      const parents = requirements.filter((r) => r.parentId === c.parentId);
      if (parents.length === 1) {
        const parent = parents[0]!;
        const component = parent.coverage?.components.find(
          (part) => part.id === c.componentId,
        );
        if (component) matches = byQuote(component.jdQuote);
        if (!matches.length && (!c.componentId || component))
          matches = byQuote(parent.jdQuote);
      }
    }
    if (matches.length !== 1) return true;
    const row = matches[0]!;
    row.conditions.push(c);
    if (c.status !== 'MET') {
      row.supported = false;
      row.status = row.conditions.some((item) => item.status === 'NOT_MET')
        ? 'Evidence falls short of the condition'
        : 'More CV evidence is needed';
    }
    return false;
  });
  const durations = remaining.filter(
    (c) => c.kind === 'EXPERIENCE' && c.status === 'UNKNOWN',
  );
  for (const group of [
    ...remaining.filter((c) => !durations.includes(c)).map((c) => [c]),
    ...(durations.length ? [durations] : []),
  ]) {
    const c =
      group.find(
        (item) =>
          item.kind === 'EXPERIENCE' &&
          findings.some(
            (f) =>
              f.kind === 'skill' &&
              item.jdQuote
                .toLowerCase()
                .split(/[^\p{L}\p{N}.+#]+/u)
                .includes(f.label.toLowerCase()),
          ),
      ) ?? group[0]!;
    result.push({
      key: JSON.stringify(group),
      title: c.jdQuote,
      conditions: group,
      findings: [],
      supported: c.status === 'MET',
      status:
        c.status === 'MET'
          ? 'Evidence meets the condition'
          : c.status === 'UNKNOWN'
            ? 'More CV evidence is needed'
            : 'Evidence falls short of the condition',
    });
  }
  return result;
}
