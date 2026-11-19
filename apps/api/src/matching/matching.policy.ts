import type { Category, Predicate } from './matching.types.js';

export const CATEGORIES = [
  ['technicalSkills', 35],
  ['experience', 25],
  ['architecture', 20],
  ['engineeringPractices', 10],
  ['domainKnowledge', 10],
] as const;
export const TERMS: readonly [string, Category, readonly string[]][] = [
  ['typescript', 'technicalSkills', []],
  ['javascript', 'technicalSkills', []],
  ['node.js', 'technicalSkills', ['nodejs']],
  ['react', 'technicalSkills', []],
  ['java', 'technicalSkills', []],
  ['postgresql', 'technicalSkills', []],
  ['docker', 'technicalSkills', []],
  ['kubernetes', 'technicalSkills', []],
  ['c', 'technicalSkills', []],
  ['c++', 'technicalSkills', []],
  ['c#', 'technicalSkills', []],
  ['.net', 'technicalSkills', []],
  ['microservices', 'architecture', []],
  ['event-driven architecture', 'architecture', []],
  ['unit testing', 'engineeringPractices', []],
  ['code review', 'engineeringPractices', []],
  ['continuous integration', 'engineeringPractices', []],
  ['payments', 'domainKnowledge', []],
  ['healthcare', 'domainKnowledge', []],
];
export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
    .trim()
    .replace(/\s+/gu, ' ');
}
export interface Parsed {
  readonly term: string;
  readonly category: Category;
  readonly predicate: Exclude<Predicate, 'unsupported'>;
  readonly months: number | null;
  readonly lowerBound: boolean;
  readonly negative: boolean;
  readonly rules: readonly string[];
}
function term(text: string): Parsed | null {
  const found = TERMS.find(
    ([canonical, , aliases]) => canonical === text || aliases.includes(text),
  );
  if (!found) return null;
  return {
    term: found[0],
    category: found[1],
    predicate: 'termPresence',
    months: null,
    lowerBound: false,
    negative: false,
    rules: [
      `term.${found[0]}.v1`,
      ...(text !== found[0] ? ['alias.nodejs.v1'] : []),
    ],
  };
}
export function duration(
  text: string,
): { months: number; lowerBound: boolean } | null {
  const match = /^(\d+)(\+)? (months?|years?)$/u.exec(normalize(text));
  if (!match) return null;
  const months = Number(match[1]) * (match[3]!.startsWith('year') ? 12 : 1);
  return Number.isSafeInteger(months)
    ? { months, lowerBound: !!match[2] }
    : null;
}
export function parsePhrase(text: string, kind: 'cv' | 'jd'): Parsed | null {
  let value = normalize(text).replace(/\.$/u, '');
  if (kind === 'jd')
    value = value
      .replace(/^(required|preferred): /u, '')
      .replace(/ (required|preferred)$/u, '');
  const bare = term(value);
  if (bare) return { ...bare, rules: [...bare.rules, `${kind}.term.v1`] };
  const negative = kind === 'cv' && value.startsWith('no experience with ');
  const experience =
    /^(?:experience with |experience in |no experience with )(.+)$/u.exec(
      value,
    );
  if (experience && (kind === 'cv' || !value.startsWith('no '))) {
    const found = term(experience[1]!);
    if (found)
      return {
        ...found,
        predicate: 'experiencePresence',
        negative,
        rules: [
          ...found.rules,
          `${kind}.${negative ? 'negative' : 'experience'}.v1`,
        ],
      };
  }
  const timed =
    /^(at least )?(\d+\+? (?:months?|years?)) of experience with (.+)$/u.exec(
      value,
    );
  if (!timed || (kind === 'cv' && timed[1])) return null;
  const found = term(timed[3]!);
  const span = duration(timed[2]!);
  if (!found || !span || (kind === 'jd' && span.months === 0)) return null;
  return {
    ...found,
    predicate: 'minimumDuration',
    ...span,
    rules: [...found.rules, `${kind}.duration.v1`],
  };
}
export function parseCvLine(text: string): readonly Parsed[] | null {
  const normalized = normalize(text).replace(/\.$/u, '');
  if (normalized.startsWith('skills: ')) {
    const items = normalized.slice(8).split(/,\s*/u).map(term);
    return items.length && items.every((item) => item !== null)
      ? items.map((item) => ({
          ...item,
          rules: [...item.rules, 'cv.skill-list.v1'],
        }))
      : null;
  }
  const parsed = parsePhrase(text, 'cv');
  return parsed ? [parsed] : null;
}
