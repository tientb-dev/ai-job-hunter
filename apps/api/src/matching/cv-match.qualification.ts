import type {
  ComponentCoverage,
  RequirementGroup,
} from './cv-match.coverage.js';

export type QualificationPredicate =
  | { kind: 'degree'; level: 'bachelor'; acceptedFields: readonly string[] }
  | { kind: 'experience'; relevant: true; minimumMonths: number }
  | { kind: 'bootcamp'; completed: true };

const bachelor = String.raw`(?:bachelor(?:['’]s)?\s+(?:degree|of science|of engineering)|b\.?sc\.?|bs)`;
const field = String.raw`(?:computer science|computer engineering|software engineering|information technology|information systems|engineering)`;
// "A related technical discipline" is bounded to these fields, never any degree.
const technicalFields = [
  'computer science',
  'computer engineering',
  'software engineering',
  'information technology',
  'information systems',
];
const listedDegreePattern = new RegExp(
  String.raw`^${bachelor}\s+in\s+(${field}(?:\s*,\s*${field})+)\s*,?\s+or\s+(${field}|(?:an?\s+)?related\s+(?:technical\s+)?(?:discipline|field))$`,
  'iu',
);
const degreePattern = new RegExp(
  String.raw`^${bachelor}\s+in\s+(${field}(?:\s+or\s+${field})*)$`,
  'iu',
);
const experiencePattern =
  /^(?:(?:at least|minimum)\s+)?(\d+)\+?\s+(years?|months?)\s+of\s+relevant\s+(?:software development\s+)?experience$/iu;
const bootcampPattern = /^(?:coding|software development)\s+boot\s*camp$/iu;

// A bounded alternative family, not a general expression parser. null means the
// existing grammar owns the clause; UNKNOWN prevents unsafe generic fallback.
export function qualificationGroup(text: string): RequirementGroup | null {
  const mixed =
    /\bboot\s*camp\b/iu.test(text) ||
    (/\b(?:degree|bachelor)\b/iu.test(text) &&
      (!/equivalent practical experience/iu.test(text) ||
        /[()]|\band\b|\d+\+?\s+(?:years?|months?)/iu.test(text)) &&
      /\bor\b|\band\b/iu.test(text));
  if (!mixed) return null;
  // One bachelor's degree with a comma-listed field alternative family.
  const listed = listedDegreePattern.exec(text);
  if (listed) {
    const fields = listed[1]!
      .toLowerCase()
      .split(/\s*,\s*/u)
      .concat(
        /related/iu.test(listed[2]!)
          ? technicalFields
          : [listed[2]!.toLowerCase()],
      );
    return {
      mode: 'OR',
      context: 'skill',
      components: [
        {
          id: 'c1',
          label: text,
          jdQuote: text,
          qualification: {
            kind: 'degree',
            level: 'bachelor',
            acceptedFields: [...new Set(fields)],
          },
        },
      ],
    };
  }
  const unknown: RequirementGroup = {
    mode: 'UNKNOWN',
    context: 'skill',
    components: [{ id: 'c1', label: text, jdQuote: text }],
  };
  if (/[()]/u.test(text) || /\band\b/iu.test(text)) return unknown;
  const labels = text
    .split(
      /[,;]\s*or\s+|\s+or\s+(?=(?:bachelor|b\.?sc\.?|bs\b|\d|at least|minimum|coding|software development\s+boot))/iu,
    )
    .map((part) => part.trim());
  if (labels.length < 2 || labels.length > 3) return unknown;
  const predicates: QualificationPredicate[] = [];
  for (const label of labels) {
    const degree = degreePattern.exec(label);
    const experience = experiencePattern.exec(label);
    if (degree)
      predicates.push({
        kind: 'degree',
        level: 'bachelor',
        acceptedFields: degree[1]!.toLowerCase().split(/\s+or\s+/iu),
      });
    else if (experience && Number(experience[1]) > 0)
      predicates.push({
        kind: 'experience',
        relevant: true,
        minimumMonths:
          Number(experience[1]) * (/^year/iu.test(experience[2]!) ? 12 : 1),
      });
    else if (bootcampPattern.test(label))
      predicates.push({ kind: 'bootcamp', completed: true });
    else return unknown;
  }
  if (new Set(predicates.map((p) => p.kind)).size !== predicates.length)
    return unknown;
  return {
    mode: 'OR',
    context: 'skill',
    components: labels.map((label, index) => ({
      id: `c${index + 1}`,
      label,
      jdQuote: label,
      qualification: predicates[index]!,
    })),
  };
}

const denial =
  /\b(?:no|not|never|without|lack|lacking|cannot|unverified|unrelated)\b|\b\w+['’]t\b/iu;
const unfinished =
  /\b(?:incomplete|pending|pursuing|candidate|expected|in.progress|ongoing|enrolled|attending|attended|studying|awaiting|will|would|want|intend|if|wish|aim|planning|hoping|plans?|seeking|aspiring|interested|learning|claim(?:ed|s)?)\b/iu;
const degreeEvidence = new RegExp(
  String.raw`\b${bachelor}\s+(?:in\s+)?(${field})(?=\s*(?:[.!?,;\r\n]|$|from\b))`,
  'iu',
);
const bootEvidence = /\b(?:coding|software development)\s+boot\s*camp\b/iu;
const durationEvidence =
  /\b(\d+)\+?\s+(years?|months?)(?:\s+(\d+)\s+months?)?\s+(?:of\s+)?(?:relevant\s+)?(?:(?:professional\s+)?software development\s+experience|experience\s+(?:in\s+(?:professional\s+)?software development|(?:developing|building)\s+(?:software(?:\s+(?:systems|applications|services))?|enterprise\s+(?:applications|systems|services))))\b/iu;

// Keep entire source lines, including semicolon/sentence qualifiers. Only join
// an immediately adjacent field-only/status line; never combine separate roles.
function qualificationPassages(cv: string): string[] {
  const lines = [...cv.matchAll(/[^\r\n\u2028\u2029]+/gu)];
  return lines.flatMap((line, index) => {
    let first = index;
    let last = index;
    const adjacent = (left: number, right: number) =>
      !!lines[right] &&
      /^[ \t]*(?:\r\n|[\r\n\u2028\u2029])[ \t]*$/u.test(
        cv.slice(
          lines[left]!.index + lines[left]![0].length,
          lines[right]!.index,
        ),
      );
    const status =
      /^(?:status\s*:[^\r\n]*|(?:(?:I am|currently|still)\s+)?(?:not completed|incomplete|pending|pursuing|expected|in.progress|enrolled|studying|graduated|completed|awarded|earned|received)(?:\s*[:–-]\s*\d{4})?\.?|(?:I have not|I never|not) (?:completed|earned|received|graduated)(?: (?:this|the) (?:qualification|degree|boot camp))?\.?|(?:this|the) (?:qualification|degree|boot camp) (?:is|was|remains) [^\r\n]+)$/iu;
    const levelOnly = new RegExp(
      String.raw`\b${bachelor}\s*(?:in|:)?\s*$`,
      'iu',
    );
    const fieldOnly = new RegExp(
      String.raw`^\s*(?:(?:field|major)\s*:\s*|in\s+)?${field}\.?\s*$`,
      'iu',
    );
    if (
      levelOnly.test(line[0]) &&
      adjacent(index, index + 1) &&
      fieldOnly.test(lines[index + 1]![0])
    )
      last++;
    if (adjacent(last, last + 1) && status.test(lines[last + 1]![0].trim()))
      last++;
    if (
      index > 0 &&
      adjacent(index - 1, index) &&
      status.test(lines[index - 1]![0].trim())
    )
      first--;
    const quote = cv.slice(
      lines[first]!.index,
      lines[last]!.index + lines[last]![0].length,
    );
    return quote.length <= 2000 ? [quote] : [];
  });
}

function relevantDegree(p: QualificationPredicate, quote: string): boolean {
  if (p.kind !== 'degree') return false;
  const match = degreeEvidence.exec(
    quote.replace(/\s+(?:field|major)\s*:\s*/iu, ' in '),
  );
  return !!match && p.acceptedFields.includes(match[1]!.toLowerCase());
}
function supported(p: QualificationPredicate, quote: string): boolean {
  if (
    denial.test(quote) ||
    unfinished.test(quote) ||
    /\b(?:my|our) (?:colleague|friend|teammate|team)\b|\b(?:he|she|they) (?:completed|graduated|earned|has|have)\b/iu.test(
      quote,
    )
  )
    return false;
  if (p.kind === 'degree') return relevantDegree(p, quote);
  if (p.kind === 'bootcamp')
    return /\b(?:completed|graduated from|(?:awarded|earned|received) (?:a |the )?(?:certificate|diploma) (?:from|for))\s+(?:a\s+|the\s+)?(?:coding|software development)\s+boot\s*camp\b/iu.test(
      quote,
    );
  const duration = durationEvidence.exec(quote);
  // Multiple duration assertions cannot be safely linked or summed here.
  if (
    !duration ||
    [
      ...quote.matchAll(
        /\b\d+\+?\s+(?:years?|months?)(?:\s+\d+\s+months?)?\b/giu,
      ),
    ].length !== 1 ||
    /\b(?:personal|hobby|academic|tutorial|prototype|team claims)\b/iu.test(
      quote,
    )
  )
    return false;
  if (
    /\b\d+[.,]\d+\s+(?:years?|months?)\b|\b(?:under|less than|up to|about|approximately)\s+\d/iu.test(
      quote,
    )
  )
    return false;
  if (
    duration[3] &&
    (!/^year/iu.test(duration[2]!) || Number(duration[3]) >= 12)
  )
    return false;
  const months =
    Number(duration[1]) * (/^year/iu.test(duration[2]!) ? 12 : 1) +
    Number(duration[3] ?? 0);
  return months >= p.minimumMonths;
}
function contradicted(p: QualificationPredicate, quote: string): boolean {
  if (!denial.test(quote) && !unfinished.test(quote)) return false;
  if (p.kind === 'degree')
    return (
      relevantDegree(p, quote) ||
      (/\b(?:no|not|never)\b[^.!?;\r\n]{0,50}\bbachelor/iu.test(quote) &&
        !new RegExp(field, 'iu').test(quote))
    );
  if (p.kind === 'bootcamp') return bootEvidence.test(quote);
  return /\b(?:no|never|not)\b[^.!?;\r\n]{0,60}\b(?:software development|experience developing software)\b/iu.test(
    quote,
  );
}

export function evaluateQualifications(
  group: RequirementGroup,
  selected: string[],
  cv: string,
  allowRecovery: boolean,
) {
  const passages = qualificationPassages(cv);
  const components: ComponentCoverage[] = group.components.map((component) => {
    const { qualification, ...publicComponent } = component;
    const predicate = qualification!;
    const positives = passages.filter((quote) => supported(predicate, quote));
    const positive = positives.find(
      (quote) =>
        allowRecovery ||
        selected.some(
          (s) =>
            s.trim() &&
            cv.includes(s) &&
            (s.includes(quote) || quote.includes(s)),
        ),
    );
    const negatives = passages.filter((quote) =>
      contradicted(predicate, quote),
    );
    const conflict = positives.length > 0 && negatives.length > 0;
    return {
      ...publicComponent,
      status: conflict ? 'CONFLICT' : positive ? 'EVIDENCED' : 'NOT_EVIDENCED',
      cvQuote: positive ?? (conflict ? positives[0]! : ''),
      conflictingQuotes: conflict ? negatives : [],
    };
  });
  const conflict = components.some((c) => c.status === 'CONFLICT');
  const credit = conflict
    ? 0
    : Number(components.some((c) => c.status === 'EVIDENCED'));
  return {
    mode: group.mode,
    components,
    credit,
    status: conflict
      ? ('CONFLICT' as const)
      : credit
        ? ('EVIDENCED' as const)
        : ('NOT_EVIDENCED' as const),
    reason: conflict
      ? 'Contradictory CV statements need review.'
      : 'Review the source-backed qualification alternatives.',
  };
}
