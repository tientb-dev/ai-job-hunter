import { normalize } from './matching.policy.js';
import type { MatchRequirement } from './cv-match.js';

// Narrow recovery for explicit evidence, not fuzzy matching of arbitrary skills.
export function recoveredCvQuote(item: MatchRequirement, cv: string): string {
  const requirement = normalize(item.requirement);
  const javaBackend =
    requirement === 'java' ||
    (/\bmanaged languages?\b/u.test(requirement) &&
      /\b(?:at least one|one of|either)\b/u.test(requirement) &&
      !/\b(?:not|except|excluding|without)\b/u.test(requirement) &&
      /\bjava\b/u.test(requirement)) ||
    /^(?:backend[\s—–-]+java|java[\s—–-]+backend|java spring boot)$/u.test(
      requirement,
    );
  const minimum =
    item.category === 'experience'
      ? /^(?:(?:minimum|at least|min\.?)\s+)?(\d+)\+?\s+(?:years?|yrs?)(?:\s+(?:of\s+)?(?:(?:professional|overall|software development|software|development|working)\s+)?experience)?$/u.exec(
          requirement,
        )
      : null;
  if (!javaBackend && !minimum) return '';
  for (const line of cv.split(/[\r\n\u2028\u2029]+/u)) {
    if (!line.trim() || line.length > 2000) continue;
    const text = normalize(line);
    // Do not turn negation, aspirations or AI-tool usage into qualifications.
    if (
      /\b(?:no|not|without|never|seeking|aspiring|interested|aspiration|copilot|chatgpt)\b|ai[- ]assisted|\b(?:không|chưa)\b/u.test(
        text,
      )
    )
      continue;
    if (
      javaBackend &&
      /\bjava\b/u.test(text) &&
      (/^\s*(?:(?:technical )?skills\s*[:—–-]|(?:technical skills[:\s]*)?backend\s*[:—–-])/u.test(
        text,
      ) ||
        (/\bjava\s+spring\s+boot\b/u.test(text) &&
          /\b(?:led|built|developed|development|implemented|using)\b/u.test(
            text,
          )))
    )
      return line;
    if (minimum) {
      const years =
        /\b(\d+)\+?\s+(?:years?|yrs?)\s+(?:of\s+)?(?:(?:professional|industry|working|hands-on|commercial|software|development)\s+)?experience\b/u.exec(
          text,
        );
      if (years && Number(years[1]) >= Number(minimum[1])) return line;
      // Use an explicit stated role duration, never sum potentially overlapping roles.
      const span =
        /\b(\d+)\s+(?:yrs?|years?)(?:\s+(\d+)\s+(?:mos?|months?))?\b/u.exec(
          text,
        );
      const datedRole =
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\s*[–—-]\s*(?:[a-z]+\s+\d{4}|present)\b/u.test(
          text,
        );
      if (
        span &&
        datedRole &&
        Number(span[1]) * 12 + Number(span[2] ?? 0) >= Number(minimum[1]) * 12
      )
        return line;
    }
  }
  return '';
}

// Resolve only whitespace differences, preserving an exact original source span.
// No case folding, Unicode normalization, punctuation repair or semantic search.
export function resolveCvQuote(source: string, quote: string): string | null {
  if (!quote.trim()) return null;
  if (source.includes(quote)) return quote;
  const target = quote.replace(/\s+/gu, ' ').trim();
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < source.length;) {
    const start = i;
    if (/\s/u.test(source[i]!)) {
      while (i < source.length && /\s/u.test(source[i]!)) i++;
      text += ' ';
    } else {
      text += source[i]!;
      i++;
    }
    starts.push(start);
    ends.push(i);
  }
  const index = text.indexOf(target);
  if (index < 0 || text.indexOf(target, index + 1) >= 0) return null;
  const original = source.slice(starts[index], ends[index + target.length - 1]);
  return original.replace(/\s+/gu, ' ').trim() === target ? original : null;
}

// Constrain model quote selection to original passages, never generated prose.
export function cvQuoteChoices(source: string): string[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of source.matchAll(/[^\r\n\u2028\u2029]+/gu)) {
    const line = match[0];
    let start = match.index;
    const end = start + line.length;
    while (start < end) {
      let next = Math.min(start + 1000, end);
      if (next < end) {
        const boundary = source.lastIndexOf(' ', next);
        if (boundary > start) next = boundary;
      }
      const text = source.slice(start, next).trim();
      if (text) {
        const offset = source.indexOf(text, start);
        spans.push({ start: offset, end: offset + text.length });
      }
      start = next;
    }
  }
  const choices = new Set<string>(['']);
  for (let i = 0; i < spans.length; i++) {
    for (let j = i; j < Math.min(i + 3, spans.length); j++) {
      const quote = source.slice(spans[i]!.start, spans[j]!.end);
      if (quote.length > 2000) break;
      choices.add(quote);
      const compact = quote.replace(/\s+/gu, ' ').trim();
      if (compact !== quote && resolveCvQuote(source, compact) !== null)
        choices.add(compact);
    }
  }
  return [...choices];
}

// Database-only continuation: a preposition/database tail may wrap, but a new
// bullet, sentence, heading or blank line is not a continuation of the action.
function databaseContinuation(before: string, after: string): boolean {
  return (
    !!before.trim() &&
    !!after.trim() &&
    !/[.!?;:]\s*$/u.test(before) &&
    !/^\s*(?:[-*•‣▪–—]|\d+[.)]|#)/u.test(after) &&
    !/:\s*$/u.test(after) &&
    (/^\s*(?:using|with|on)\s+/iu.test(after) ||
      (/\b(?:using|with|on)(?:\s+(?:Microsoft\s+)?SQL)?\s*$/iu.test(before) &&
        /^\s*(?:SQL\s+Server|Server|MySQL|Oracle|PostgreSQL|MariaDB)\b/iu.test(
          after,
        )))
  );
}

// Semantic views only. Callers always return the unchanged original source span.
export function databaseSemanticClauses(quote: string): string[] {
  const lines = quote.split(/\r\n|[\r\n\u2028\u2029]/u);
  return lines.flatMap((line, index) => [
    line,
    ...(index + 1 < lines.length &&
    databaseContinuation(line, lines[index + 1]!)
      ? [`${line} ${lines[index + 1]!}`.replace(/\s+/gu, ' ').trim()]
      : []),
  ]);
}

// Add at most 20 exact database-work spans: up to three adjacent attribution
// headers and one work line plus its optional soft continuation. The generic
// three-span quote window and attribution validation remain unchanged.
export function databaseAttributedQuoteChoices(source: string): string[] {
  const lines = [...source.matchAll(/[^\r\n\u2028\u2029]+/gu)].map((match) => {
    const text = match[0].trim();
    const start = match.index + match[0].indexOf(text);
    return { text, start, end: start + text.length };
  });
  const adjacent = (left: number, right: number) =>
    /^[ \t]*(?:\r\n|[\r\n\u2028\u2029])[ \t]*$/u.test(
      source.slice(lines[left]!.end, lines[right]!.start),
    );
  const header = /^(employer|company|role|project)\s*:/iu;
  const choices = new Set<string>();
  for (let index = 0; index < lines.length && choices.size < 20; index++) {
    if (
      !/^(?:[-*•]\s*)?(?:(?:(?:I|Personally|Independently)\s+)?(?:developed|built|implemented|delivered|designed|tuned|optimized|administered|troubleshot)\b|(?:development|implementation)\s+of\b|responsible\s+for\s+(?:developing|implementing)\b)/iu.test(
        lines[index]!.text,
      )
    )
      continue;
    let start = index;
    const seen = new Set<string>();
    while (start > 0 && index - start < 3 && adjacent(start - 1, start)) {
      const kind = header
        .exec(lines[start - 1]!.text)?.[1]
        ?.toLowerCase()
        .replace('company', 'employer');
      if (!kind || seen.has(kind)) break;
      seen.add(kind);
      start--;
    }
    let end = index;
    const namedDatabase =
      /\b(?:SQL\s+Server|MySQL|Oracle|PostgreSQL|MariaDB)\b/iu;
    if (
      !namedDatabase.test(lines[index]!.text) &&
      index + 1 < lines.length &&
      adjacent(index, index + 1) &&
      databaseContinuation(lines[index]!.text, lines[index + 1]!.text)
    )
      end++;
    if (end - start < 3) continue; // Already covered by the existing window.
    const quote = source.slice(lines[start]!.start, lines[end]!.end);
    if (quote.length <= 2000 && namedDatabase.test(quote)) choices.add(quote);
  }
  return [...choices];
}

// Whitespace-normalized occurrences of a quote in the CV (0, 1 or 2 = "2 or more").
export function cvQuoteOccurrences(source: string, quote: string): 0 | 1 | 2 {
  const text = source.replace(/\s+/gu, ' ');
  const target = quote.replace(/\s+/gu, ' ').trim();
  if (!target) return 0;
  const first = text.indexOf(target);
  if (first < 0) return 0;
  return text.indexOf(target, first + 1) >= 0 ? 2 : 1;
}

// A quote that is an exact, unique fragment of the CV is widened to the whole
// line(s) containing it, and accepted only if that is an allowed passage. The
// result is the full passage, so evidence is judged with every qualifier and
// negation on those lines; a fragment alone is never accepted.
export function alignToPassage(
  source: string,
  quote: string,
  allowed: ReadonlySet<string>,
): string | null {
  if (cvQuoteOccurrences(source, quote) !== 1) return null;
  const exact = resolveCvQuote(source, quote);
  if (!exact) return null;
  const at = source.indexOf(exact);
  if (at < 0 || source.indexOf(exact, at + 1) >= 0) return null;
  const lineBreak = /[\r\n\u2028\u2029]/u;
  let start = at;
  while (start > 0 && !lineBreak.test(source[start - 1]!)) start--;
  let end = at + exact.length;
  while (end < source.length && !lineBreak.test(source[end]!)) end++;
  const passage = source.slice(start, end).trim();
  return allowed.has(passage) ? passage : null;
}
