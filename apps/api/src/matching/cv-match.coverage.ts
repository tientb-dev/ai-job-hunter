import {
  qualificationGroup,
  evaluateQualifications,
  type QualificationPredicate,
} from './cv-match.qualification.js';
import {
  cvQuoteChoices,
  resolveCvQuote,
  databaseAttributedQuoteChoices,
  databaseSemanticClauses,
} from './cv-match.evidence.js';
import { normalize } from './matching.policy.js';

export type CoverageStatus =
  'EVIDENCED' | 'PARTIAL' | 'NOT_EVIDENCED' | 'CONFLICT';
export interface RequirementComponent {
  qualification?: QualificationPredicate;
  id: string;
  label: string;
  jdQuote: string;
}
export interface RequirementGroup {
  mode: 'SINGLE' | 'AND' | 'OR' | 'UNKNOWN';
  components: RequirementComponent[];
  context:
    | 'skill'
    | 'design'
    | 'knowledge'
    | 'experience'
    | 'education'
    | 'proficiency';
  personalDelivery?: true;
  managedLanguage?: true;
  aiFamiliarityOrInterest?: true;
  minimumYears?: number;
  // Named alternatives: one must be shown in work, never a bare skills list.
  demonstratedUse?: true;
  // "Strong proficiency in at least one programming language such as …":
  // professional use is PARTIAL; only a stated proficiency level is full credit.
  languageProficiency?: true;
}
export interface ComponentEvidence {
  componentId: string;
  jdQuote: string;
  cvQuote: string;
}
export interface ComponentCoverage extends RequirementComponent {
  status: CoverageStatus;
  cvQuote: string;
  conflictingQuotes: string[];
  // Original source observations; mentions alone never authorize credit or copying.
  observations?: { kind: 'mention' | 'experience'; cvQuote: string }[];
  qualificationReason?: string;
}

// Keep prose clauses whole; only bare comma/semicolon skill lists are independent
// parents. Unknown prose is deliberately not reduced to disconnected keywords.
export function simpleSkillList(line: string): boolean {
  return (
    !/\b(?:and|or|experience|knowledge|understanding|design\w*|ability|skills|degree|built|delivered|working|strong|proficien\w*|including|such as|at least)\b/iu.test(
      line,
    ) &&
    line.split(/[,;]+/u).every((part) => part.trim().split(/\s+/u).length <= 3)
  );
}

// A single named language is an atomic qualification, not an ambiguous list.
const singleManagedLanguage =
  /^Backend service experience in managed languages including ([\w+#.-]+)$/iu;

export function requirementGroup(
  requirement: string,
  category: string,
): RequirementGroup {
  const text = requirement.trim().replace(/\.$/u, '');
  const group = (
    mode: RequirementGroup['mode'],
    labels: string[],
    context: RequirementGroup['context'] = 'skill',
    personalDelivery?: true,
  ): RequirementGroup => ({
    mode,
    context,
    ...(personalDelivery ? { personalDelivery } : {}),
    components: labels.map((label, index) => ({
      id: `c${index + 1}`,
      label,
      jdQuote: label,
    })),
  });
  if (category === 'skill' || category === 'experience') {
    const qualification = qualificationGroup(text);
    if (qualification) return qualification;
  }
  if (category !== 'skill') return group('SINGLE', [text]);
  if (
    /^Familiarity with or interest in AI-assisted development tools, code generation, and automation workflows$/iu.test(
      text,
    )
  )
    return {
      ...group('OR', ['Familiarity', 'interest'], 'knowledge'),
      aiFamiliarityOrInterest: true,
    };
  const duration =
    /^(?:(?:minimum|at least)\s+)?(\d+)\+? years? (?:of )?experience (?:with|in) (.+)$/iu.exec(
      text,
    );
  if (duration) {
    const parsed = requirementGroup(`Experience with ${duration[2]}`, category);
    // Component JD spans are literal substrings of the original parent.
    return { ...parsed, minimumYears: Number(duration[1]) };
  }
  if (
    /\b(?:personally|beyond (?:the )?prototype)\b/iu.test(text) &&
    !/^Personally (?:built|developed) and (?:delivered|deployed) at least one .+ application (?:beyond the prototype stage|to production)$/iu.test(
      text,
    )
  )
    return group('UNKNOWN', [text]);
  const reverseEducation =
    /^(equivalent practical experience)\s+or\s+(.+degree.+)$/iu.exec(text);
  if (reverseEducation)
    return group(
      'OR',
      [reverseEducation[1]!, reverseEducation[2]!],
      'education',
    );
  const education = /^(.*)\s+or\s+(equivalent practical experience)$/iu.exec(
    text,
  );
  if (education && /\bdegree\b/iu.test(education[1]!))
    return group(
      'OR',
      [education[1]!.replace(/,\s*$/u, ''), education[2]!],
      'education',
    );
  const delivery =
    /^Personally (?:built|developed) and (?:delivered|deployed) at least one (.+) application (?:beyond the prototype stage|to production)$/iu.exec(
      text,
    );
  if (delivery)
    return group(
      'OR',
      delivery[1]!.split(/,\s*(?:or\s+)?|\s+or\s+/iu),
      'experience',
      true,
    );
  // Recognize the one-of quantifier only inside this database/proficiency
  // grammar, before the conservative unresolved-quantity fallback below.
  const databaseAlternatives =
    /^(?:thành thạo|sử dụng thành thạo)\s+(?:ít nhất một(?: trong(?: các)?)?|một trong(?: các)?)\s+(?:hệ quản trị cơ sở dữ liệu|cơ sở dữ liệu)(?: sau)?\s*:\s*(.+)$/iu.exec(
      text,
    );
  if (databaseAlternatives) {
    const labels = databaseAlternatives[1]!
      .split(/[,;/]\s*(?:(?:or|hoặc)\s+)?|\s+(?:or|hoặc)\s+/iu)
      .map((label) => label.trim())
      .filter(Boolean);
    if (
      labels.length >= 2 &&
      labels.length <= 20 &&
      labels.every((label) => databaseName.test(label))
    )
      return group('OR', labels, 'proficiency');
    return group('UNKNOWN', [text]);
  }
  if (singleManagedLanguage.test(text)) return group('SINGLE', [text]);
  const languages = /\bat least one managed language such as (.+)$/iu.exec(
    text,
  );
  if (languages)
    return {
      ...group(
        'OR',
        languages[1]!
          .replace(/,?\s+or similar$/iu, '')
          .split(/,\s*|\s+or\s+/iu),
        'experience',
      ),
      managedLanguage: true,
    };
  const languageProficiency =
    /^(?:(?:strong|solid|proven|advanced)\s+)?proficiency in at least one programming language such as (.+?)(?:,?\s+or\s+(?:equivalent|similar)(?:\s+[\p{L}-]+){0,2})?$/iu.exec(
      text,
    );
  if (languageProficiency) {
    const labels = languageProficiency[1]!
      .split(/\s*,\s*|\s+or\s+/iu)
      .map((label) => label.trim())
      .filter(Boolean);
    if (
      labels.length >= 2 &&
      labels.length <= 10 &&
      !/\band\b/iu.test(languageProficiency[1]!) &&
      labels.every((label) => /^[\w+#.-]{1,20}$/u.test(label))
    )
      return {
        ...group('OR', labels, 'experience'),
        languageProficiency: true,
      };
  }
  const named =
    /^(?:(?:strong|solid|proven|hands-on)\s+)?experience (?:working )?(?:with|in|using)\s+[\p{L} /-]{1,60}?\s+such as\s+(.+?)(?:,?\s+or\s+(?:equivalent|similar)(?:\s+[\p{L}-]+){0,2})?$/iu.exec(
      text,
    );
  if (named) {
    const labels = named[1]!.split(/\s*,\s*|\s+or\s+/iu).map((l) => l.trim());
    if (
      labels.length >= 2 &&
      labels.length <= 10 &&
      !/\band\b/iu.test(named[1]!) &&
      // Quantities ("multiple languages such as ...") are not one-of alternatives.
      !/\b(?:multiple|several|various|at least|two|three|all)\b/iu.test(text) &&
      labels.every((label) => /^[\w+#./-]+(?: [\w+#./-]+)?$/u.test(label))
    )
      return { ...group('OR', labels, 'experience'), demonstratedUse: true };
  }
  if (
    /\b(?:multiple|at least (?:[0-9]+|two|three|four|five)|such as|including|either.*and)\b|ít nhất|một trong/iu.test(
      text,
    )
  )
    return group('UNKNOWN', [text]);
  let context: RequirementGroup['context'] = 'skill';
  let body = text;
  const prefix =
    /^(?:Experience designing|Working knowledge of|Understanding of|Experience (?:with|in|using)|Knowledge of)\s+/iu.exec(
      text,
    );
  if (prefix) {
    context = /designing/iu.test(prefix[0])
      ? 'design'
      : /knowledge|understanding/iu.test(prefix[0])
        ? 'knowledge'
        : 'experience';
    body = text.slice(prefix[0].length);
  }
  body = body.replace(/^(?:(?:at least )?one of|either)\s+/iu, '');
  const hasAnd = /\band\b/iu.test(body);
  const hasOr = /\bor\b/iu.test(body);
  if (hasAnd && hasOr) return group('UNKNOWN', [text], context);
  if (hasAnd || hasOr || (prefix && /[,;]/u.test(body))) {
    const labels = body
      .split(/[,;]\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/iu)
      .map((part) => part.trim())
      .filter(Boolean);
    // Coordinated verbs/nested qualifications cannot safely become a flat list.
    if (
      labels.length < 2 ||
      labels.length > 20 ||
      labels.some((label) =>
        /\b(?:designing|delivering|ability|including)\b/iu.test(label),
      )
    )
      return group('UNKNOWN', [text], context);
    return group(hasOr ? 'OR' : 'AND', labels, context);
  }
  return group('SINGLE', [text], context);
}

const databaseName = /^(?:MySQL|Oracle|SQL Server|PostgreSQL|MariaDB)$/iu;

const aliases: readonly [RegExp, RegExp][] = [
  [
    /^(?:mcp|model context protocol)$/iu,
    /\b(?:mcp|model context protocol)\b/iu,
  ],
  [
    /^(?:rag|retrieval[- ]augmented generation)$/iu,
    /\b(?:rag|retrieval[- ]augmented generation)\b/iu,
  ],
  [/^llm$/iu, /\b(?:llms?|large language models?)\b/iu],
  [/^agent-based$/iu, /\bagent[- ]based\b/iu],
  [
    /^cloud[- ]based architectures?$/iu,
    /\bcloud[- ](?:based )?architectures?\b/iu,
  ],
  [/^apis?$/iu, /\b(?:apis?|application programming interfaces?)\b/iu],
  [
    /^ci\/cd practices$/iu,
    /\b(?:ci\s*\/\s*cd|continuous integration and (?:continuous )?delivery)\b/iu,
  ],
  [/^vector search$/iu, /\bvector (?:search|retrieval)\b/iu],
  [/^tool calling$/iu, /\b(?:tool|function) calling\b/iu],
  [/^sql$/iu, /\b(?:sql|postgresql|sql server)\b/iu],
  [/^nosql data stores$/iu, /\b(?:nosql|mongodb|dynamodb)\b/iu],
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
function mentions(label: string, text: string): boolean {
  // Explicit integration action, not mere LLM API usage or a tool declaration.
  if (/^LLM API integration$/iu.test(label))
    return /\b(?:integrat(?:ed|ing) LLM APIs?|LLM API integration)\b/iu.test(
      text,
    );
  const alias = aliases.find(([pattern]) => pattern.test(label));
  if (alias) return alias[1].test(text);
  // A small spelling normalization, not fuzzy entailment or a skill ontology.
  const words = normalize(label)
    .replace(/[-–]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
  return (
    words.length > 0 &&
    words.every((word) =>
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escape(word.replace(/s$/u, ''))}s?(?![\\p{L}\\p{N}])`,
        'iu',
      ).test(text),
    )
  );
}
// Match PDF spacing around contraction apostrophes without rewriting source quotes.
// Callers retain their existing passage-level scope and contradiction checks.
const negative = (text: string) =>
  /\b(?:no|not|never|without|lack|lacking|unable|cannot)\b|\b(?:can|couldn|don|doesn|didn|won|wouldn|isn|aren|wasn|weren|hasn|haven|hadn)\s*['’]\s*t\b|\b(?:không|chưa)\b/iu.test(
    text,
  );
const uncertain = (text: string) =>
  /\b(?:seeking|aspiring|interested|hope|plan to|learning|uncertain|maybe|familiarity only)\b/iu.test(
    text,
  );
const active = (text: string) =>
  /\b(?:built|build|designed|design|architected|developed|delivered|implemented|used|using|worked|experience|skills|knowledge|understand|proficient|integrated|deployed|led|created)\b/iu.test(
    text,
  );
const passages = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|[\r\n;]+/u)
    .map((line) => line.trim())
    .filter(Boolean);

// A work bullet wrapped across physical PDF lines, as one exact source slice.
// Continuation lines are joined only when the boundary is unambiguous: the
// bullet line does not end a sentence, and the next line is not a bullet,
// heading, blank line or declaration ("Skills: …"), and either starts in
// lowercase or follows a comma/connector. At most 3 lines, like allowed passages.
const bulletStart = /^\s*(?:[-*•–▪●◦]|\d{1,2}[.)])\s+\S/u;
const declarationLine = /^\s*[\p{L}][\p{L} &/+-]{0,30}:\s/u;
const headingLine = /^\s*[^\p{Ll}]*\p{Lu}[^\p{Ll}]*$/u;
const sentenceEnd = /[.!?:;]\s*$/u;
const connectorEnd =
  /(?:,|\b(?:and|or|with|using|via|to|for|of|in|on|into|from|by|the|a|an))\s*$/iu;
export function bulletUnits(cv: string): string[] {
  const lines: { start: number; end: number; text: string }[] = [];
  let start = 0;
  for (const match of cv.matchAll(/\r\n|[\r\n\u2028\u2029]/gu)) {
    lines.push({ start, end: match.index, text: cv.slice(start, match.index) });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: cv.length, text: cv.slice(start) });
  const units: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!bulletStart.test(lines[i]!.text)) continue;
    let last = i;
    while (last - i < 2 && last + 1 < lines.length) {
      const previous = lines[last]!.text;
      const next = lines[last + 1]!.text;
      if (
        !next.trim() ||
        bulletStart.test(next) ||
        headingLine.test(next) ||
        declarationLine.test(next) ||
        skillsDeclaration.test(next) ||
        sentenceEnd.test(previous) ||
        !(/^\s*\p{Ll}/u.test(next) || connectorEnd.test(previous))
      )
        break;
      last++;
    }
    if (last > i)
      units.push(cv.slice(lines[i]!.start, lines[last]!.end).trim());
  }
  return units;
}

// Broker demonstrated use: a wrapped bullet is one unit, and its lines are
// never judged alone (a verb or negation on another line stays in context).
function demonstratedPassages(selected: string[], cv: string): string[] {
  const units = bulletUnits(cv);
  const inUnit = (passage: string) =>
    units.some((unit) => unit.includes(passage));
  return [
    ...units.filter((unit) =>
      selected.some((quote) =>
        passages(unit).some((part) => quote.includes(part)),
      ),
    ),
    ...selected.flatMap(passages).filter((passage) => !inUnit(passage)),
  ];
}

// Diagnostics only (never used for scoring): why a broker alternative was not
// credited. Fixed codes; inspects the CV but returns no text.
export type DemonstratedUseReason =
  | 'EVIDENCED'
  | 'NO_MENTION'
  | 'NEGATED'
  | 'SKILLS_ONLY'
  | 'WRAPPED_SPLIT'
  | 'NO_WORK_VERB'
  // Any other outcome (CONFLICT, AI-tool use, uncertainty, …).
  | 'UNKNOWN';
export function demonstratedUseReason(
  label: string,
  cv: string,
  group: RequirementGroup,
  status: string,
): DemonstratedUseReason {
  if (status === 'EVIDENCED') return 'EVIDENCED';
  if (status !== 'NOT_EVIDENCED') return 'UNKNOWN';
  const lines = cv.split(/\r\n|[\r\n\u2028\u2029]/u);
  const mentioned = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => componentMention(label, line, group));
  if (!mentioned.length) return 'NO_MENTION';
  const units = bulletUnits(cv);
  if (
    mentioned.some(({ line }) => negative(line)) ||
    units.some((unit) => componentMention(label, unit, group) && negative(unit))
  )
    return 'NEGATED';
  const work = mentioned.filter(
    ({ line }) => !skillsDeclaration.test(line) && !declarationLine.test(line),
  );
  if (!work.length) return 'SKILLS_ONLY';
  // A work verb only on an adjacent line that could not be joined safely.
  if (
    work.some(
      ({ line, index }) =>
        !recoveryWork.test(line) &&
        !units.some((unit) => unit.includes(line.trim())) &&
        [lines[index - 1], lines[index + 1]].some(
          (near) => !!near?.trim() && recoveryWork.test(near),
        ),
    )
  )
    return 'WRAPPED_SPLIT';
  if (
    work.every(
      ({ line }) =>
        !recoveryWork.test(line) &&
        !units.some(
          (unit) => unit.includes(line.trim()) && recoveryWork.test(unit),
        ),
    )
  )
    return 'NO_WORK_VERB';
  return 'UNKNOWN';
}

const ciCdPractices = /^ci\/cd practices$/iu;
const ciCdAutomation = String.raw`(?:(?:ci\s*\/\s*cd|continuous integration and (?:continuous )?(?:delivery|deployment))\s+(?:pipelines?|workflows?|automation)|automated\s+build(?:,\s*test)?\s+and\s+(?:test|deployment)\s+(?:pipelines?|workflows?))`;
const ciCdPracticeDeclaration = /\bci\s*\/\s*cd\s+practices\b/iu;
const ciCdPipelineContext = new RegExp(String.raw`\b${ciCdAutomation}\b`, 'iu');
const ciCdDesignExperience = new RegExp(
  String.raw`\b${ciCdAutomation}\s+design experience\b`,
  'iu',
);
const ciCdModifiers = String.raw`(?:(?:the|our|existing|automated|gitlab|jenkins|github(?: actions)?)\s+){0,4}`;
const ciCdAppliedWork = new RegExp(
  String.raw`\b(?:designed|architected|implemented|configured|optimi[sz]ed|experience (?:in |with )?(?:designing|implementing|configuring|optimi[sz]ing))\s+(?:(?:REST(?:ful)?\s+)?APIs?\s+and\s+)?${ciCdModifiers}${ciCdAutomation}\b`,
  'iu',
);
const andCiCdPractices = (label: string, group: RequirementGroup) =>
  group.mode === 'AND' &&
  group.context === 'design' &&
  ciCdPractices.test(label);
function supportsCiCdPractices(text: string): boolean {
  if (
    /\b(?:will|would|want|wish|intend|aim|planning|hoping|goal|if|incomplete|pending|planned|draft|abandoned|documentation|manual|tutorial|courses?)\b/iu.test(
      text,
    )
  )
    return false;
  // Preserve explicit design declarations, including coordinated design lists.
  if (
    /\b(?:designed|designing|architected|design experience)\b/iu.test(text) &&
    ciCdPracticeDeclaration.test(text)
  )
    return true;
  // Implementation/optimization must act on the pipeline/automation itself,
  // not an unrelated object that merely uses a CI/CD tool.
  return ciCdAppliedWork.test(text) || ciCdDesignExperience.test(text);
}

const educationFieldsIn = (text: string) =>
  ['computer science', 'software engineering', 'information technology'].filter(
    (field) => normalize(text).includes(field),
  );

function componentMention(
  label: string,
  text: string,
  group: RequirementGroup,
): boolean {
  if (group.context === 'education') {
    if (/equivalent practical experience/iu.test(label))
      return /\b(?:equivalent practical experience|equivalent professional experience)\b/iu.test(
        text,
      );
    const fields = educationFieldsIn(label);
    return (
      /\b(?:bachelor'?s?|bsc|b\.sc\.?|bs)\b/iu.test(text) &&
      fields.some((field) => normalize(text).includes(field))
    );
  }
  return (
    mentions(label, text) ||
    (andCiCdPractices(label, group) && ciCdPipelineContext.test(text))
  );
}
function supports(
  label: string,
  text: string,
  group: RequirementGroup,
): boolean {
  if (group.aiFamiliarityOrInterest) return supportsAiFamiliarity(label, text);
  if (
    !componentMention(label, text, group) ||
    negative(text) ||
    uncertain(text)
  )
    return false;
  if (group.minimumYears !== undefined) {
    const years = /\b(\d+)\+?\s+years?\b/iu.exec(text);
    if (!years || Number(years[1]) < group.minimumYears) return false;
  }
  if (group.managedLanguage) return supportsManagedLanguage(label, text);
  if (group.languageProficiency)
    return languageProficiencyDeclared(label, text);
  if (group.demonstratedUse)
    return (
      recoveryWork.test(text) &&
      !skillsDeclaration.test(text) &&
      !aiToolUse.test(text)
    );
  if (group.context === 'proficiency')
    return supportsDatabaseProficiency(label, text);
  if (group.context === 'education') {
    if (/equivalent practical experience/iu.test(label))
      return (
        /\b\d+\+?\s+years?\b|\b(?:eight|six|ten) years\b/iu.test(text) &&
        /\b(?:built|building|delivered|developed|developing)\b/iu.test(text)
      );
    return !/\b(?:incomplete|pursuing|candidate|expected|course)\b/iu.test(
      text,
    );
  }
  if (group.personalDelivery)
    return (
      /\b(?:personally|independently|i|sole developer)\b/iu.test(text) &&
      /\b(?:built|developed|implemented)\b/iu.test(text) &&
      /\b(?:delivered|deployed|launched)\b/iu.test(text) &&
      /\b(?:production|beyond (?:the )?prototype|real users)\b/iu.test(text) &&
      !/\b(?:prototype only|only a prototype|team built)\b/iu.test(text)
    );
  if (andCiCdPractices(label, group)) return supportsCiCdPractices(text);
  if (group.context === 'design')
    return /\b(?:designed|designing|architected|design experience)\b/iu.test(
      text,
    );
  return (
    active(text) ||
    /^\s*(?:technical skills[:\s]*|(?:backend|databases)\s*[:—–-])/iu.test(text)
  );
}

const managedAttribution =
  /^(?:(?:employer|company|role|project)\s*:|(?:(?:professional|work|employment)\s+(?:experience|history)|experience)\s*:?$|(?:learning|academic|personal|practice|tutorial|coursework|hobby|planned|study)(?:\s+projects?)?\s*:?$)/iu;
function completeAttribution(cv: string, quote: string): boolean {
  const lines = quote.split(/[\r\n\u2028\u2029]+/u);
  for (const marker of [
    /^(?:employer|company)\s*:/iu,
    /^role\s*:/iu,
    /^project\s*:/iu,
  ])
    if (lines.filter((line) => marker.test(line.trim())).length > 1)
      return false;
  const activity = lines.findIndex((line) =>
    /\b(?:developed|built|implemented|used|administered|tuned|optimized|designed|troubleshot)\b/iu.test(
      line,
    ),
  );
  if (
    activity >= 0 &&
    lines
      .slice(activity + 1)
      .some((line) => managedAttribution.test(line.trim()))
  )
    return false;
  const start = cv.indexOf(quote);
  if (start < 0 || cv.indexOf(quote, start + 1) >= 0) return false;
  const prefix = cv.slice(0, start).split(/\r\n|[\r\n\u2028\u2029]/u);
  if (prefix.at(-1)?.trim()) return false; // no mid-line context truncation
  const previous = prefix
    .slice(0, -1)
    .reverse()
    .find((line) => line.trim())
    ?.trim();
  return !previous || !managedAttribution.test(previous);
}

// Only the recognized managed-language experience OR family uses this guard.
// A source statement must name the language and the actual development work;
// professional context may be in the same bounded, contiguous source passage.
function supportsManagedLanguage(label: string, text: string): boolean {
  if (
    !/^(?:Java|Scala|Go|C#)$/iu.test(label) ||
    /\b(?:will|would|could|want|wish|intend|aim|plan(?:ned|ning)?|hoping|goal|if|tutorial|courses?|academic|student|homework|hobby|personal projects?|prototype only|team|we|they|copilot|chatgpt)\b|ai[- ]assisted/iu.test(
      text,
    )
  )
    return false;
  const lines = text.split(/[\r\n\u2028\u2029]+/u);
  // A bounded quote must not merge employers, roles, projects or work sections.
  for (const marker of [
    /^(?:employer|company)\s*:/iu,
    /^role\s*:/iu,
    /^project\s*:/iu,
    /^(?:(?:professional|work|employment)\s+(?:experience|history)|experience)\s*:?$/iu,
  ])
    if (lines.filter((line) => marker.test(line.trim())).length > 1)
      return false;
  return lines.some((line, index) => {
    if (
      !mentions(label, line) ||
      !/\b(?:built|developed|implemented|delivered|designed|led)\b/iu.test(
        line,
      ) ||
      !/\b(?:software|applications?|services?|apis?|features?|systems?|backend)\b/iu.test(
        line,
      ) ||
      /^(?:technical skills|skills|languages|frameworks|backend)\s*[:—–-]/iu.test(
        line.trim(),
      )
    )
      return false;
    if (
      /^Go$/iu.test(label) &&
      !/\b(?:using|with|in) Go\b|\bGo (?:services?|applications?|apis?|software|language)\b/u.test(
        line,
      )
    )
      return false;
    if (
      lines
        .slice(index + 1)
        .some((next) => managedAttribution.test(next.trim()))
    )
      return false;
    const preceding = lines.slice(0, index + 1).join('\n');
    return /\b(?:professional|commercial|production|enterprise|employment|employer|client)\b|\b(?:software|backend|application|systems?) (?:engineer|developer)\b|^(?:work experience|experience)\s*:?$/imu.test(
      preceding,
    );
  });
}

// The familiarity-or-interest exception belongs only to the exact Axon family.
const aiTool =
  /\b(?:Claude|ChatGPT|GitHub Copilot|Cursor)\b|ai[- ]assisted (?:development|coding) tools?/iu;
const aiScope =
  /ai[- ]assisted (?:development|coding)|code generation|automation workflows|\brefactor(?:ing|ed)?\b|\bdebug(?:ging|ged)?\b|\bprototyp(?:ing|ed)\b|code review/iu;
function aiRelevant(text: string): boolean {
  return (
    aiTool.test(text) &&
    (aiScope.test(text) ||
      (/technical documentation/iu.test(text) &&
        /software|development|engineering/iu.test(text)))
  );
}
function supportsAiFamiliarity(label: string, text: string): boolean {
  if (negative(text)) return false;
  return text.split(/[\r\n\u2028\u2029]+/u).some((line) => {
    if (!aiRelevant(line)) return false;
    if (label === 'interest')
      return /\b(?:interested in|interest in)\b/iu.test(line);
    return (
      !uncertain(line) &&
      !/\b(?:will|would|could|want|plan|intend|hope)\b/iu.test(line) &&
      /\b(?:used|using|integrated|applied|familiar with|familiarity with)\b/iu.test(
        line,
      )
    );
  });
}
function aiDenial(label: string, text: string): boolean {
  if (!aiRelevant(text) || !negative(text)) return false;
  return label === 'interest'
    ? /\b(?:not interested|no interest|lack interest)\b/iu.test(text)
    : /\b(?:never used|not used|no familiarity|not familiar|haven['’]t used|didn['’]t use)\b/iu.test(
        text,
      );
}

function databaseProfessionalUse(text: string): boolean {
  return (
    !/\b(?:team|we|they|personal|tutorial|course|learning|hobby|basic)\b/iu.test(
      text,
    ) &&
    /\b(?:professional|commercial|production|enterprise|employment|employer|client)\b|\b(?:backend|software|data) (?:engineer|developer)\b|^(?:work experience|experience)\s*:?$/imu.test(
      text,
    )
  );
}

// Full credit: an explicit prose declaration of the level for this language,
// never a skills-list line ("Languages: Java").
function languageProficiencyDeclared(label: string, text: string): boolean {
  const name = escape(label);
  return text
    .split(/[\r\n\u2028\u2029]+/u)
    .some(
      (line) =>
        !languageListLine.test(line.trim()) &&
        new RegExp(
          String.raw`\b(?:proficient|expert|advanced|strong proficiency)\s+(?:(?:in|with)\s+)?${name}(?![\w+#])|\b${name}\s+(?:expert|proficiency)\b`,
          'iu',
        ).test(line),
    );
}
// PARTIAL: professional use of this language on a work line (not a skills
// list, aspiration, coursework or AI-tool use). The level stays unverified.
function languageProfessionalUse(label: string, text: string): boolean {
  if (
    negative(text) ||
    uncertain(text) ||
    aiToolUse.test(text) ||
    /\b(?:will|would|want|wish|intend|aim|planning|hoping|goal|tutorial|courses?|academic|student|homework|hobby)\b/iu.test(
      text,
    )
  )
    return false;
  return text
    .split(/[\r\n\u2028\u2029]+/u)
    .some(
      (line) =>
        mentions(label, line) &&
        recoveryWork.test(line) &&
        !languageListLine.test(line.trim()),
    );
}
const languageListLine =
  /^(?:(?:technical |programming )?skills|languages|programming languages|frameworks|backend|tools|tech stack)\s*[:—–-]/iu;

// This policy is used only by the recognized Vietnamese database one-of
// family. Ordinary use and bare skills lists cannot establish proficiency.
function supportsDatabaseProficiency(label: string, text: string): boolean {
  if (
    !databaseName.test(label) ||
    /\b(?:will|would|want|wish|intend|aim|planning|hoping|goal|if|only|basic|beginner|prototype|tutorial|course|personal|hobby|learning|team|we|they)\b|dự định|dự kiến|mong muốn|kế hoạch|hy vọng|đang học|sẽ học|muốn học|sẽ thành thạo|chỉ biết|cơ bản/iu.test(
      text,
    )
  )
    return false;
  if (
    /^Oracle$/iu.test(label) &&
    /\bOracle\s+(?:Cloud|Java|JDK|VirtualBox)\b/iu.test(text)
  )
    return false;
  const database = String.raw`(?:MySQL|Oracle|SQL Server|PostgreSQL|MariaDB)(?![\p{L}\p{N}])`;
  const declarations = new RegExp(
    String.raw`(?:\b(?:proficient|expert|advanced)\s+(?:(?:in|with)\s+)?|thành thạo\s+)(?<databases>${database}(?:\s*(?:,|/|\band\b|\bor\b|và|hoặc)\s*${database})*)`,
    'giu',
  );
  for (const declaration of text.matchAll(declarations)) {
    const names = declaration.groups!.databases!.split(
      /\s*(?:,|\/|\band\b|\bor\b|và|hoặc)\s*/iu,
    );
    if (names.some((name) => normalize(name) === normalize(label))) return true;
  }
  // Direct independent responsibility with an explicit database and work scope
  // can establish practical proficiency without a literal level declaration.
  const independent =
    /\b(?:independently|personally|owned|sole|responsible for)\b/iu.test(
      text,
    ) || /^(?:I )?(?:designed|tuned|optimized|troubleshot)\b/imu.test(text);
  const responsibility = new RegExp(
    String.raw`\b(?:designed|tuned|optimized|troubleshot)\s+(?:production\s+)?${escape(label)}\s+(?:(?:database\s+)?schemas?|queries|database performance|production incidents|databases?)\b`,
    'iu',
  );
  if (independent && responsibility.test(text) && databaseProfessionalUse(text))
    return true;
  // Existing concrete production administration remains sufficient as well.
  const ownership = new RegExp(
    String.raw`\b(?:administered|optimized|tuned|designed)\s+(?:production\s+)?${escape(label)}\s+(?:databases?|clusters?)\b`,
    'iu',
  );
  const tasks = [
    /\bquery tuning\b/iu,
    /\bindex(?:ing| optimization)\b/iu,
    /\breplication\b/iu,
    /\bfailover\b/iu,
    /\bbackup (?:and )?restor(?:e|ation)\b/iu,
  ];
  return (
    ownership.test(text) &&
    [...text.matchAll(new RegExp(database, 'giu'))].every(
      (match) => normalize(match[0]) === normalize(label),
    ) &&
    /\bproduction\b/iu.test(text) &&
    tasks.filter((task) => task.test(text)).length >= 2
  );
}

// Preserve source-backed observations separately from proficiency support.
// Do not infer a database for an adjacent generic MyBatis/optimization bullet.
function nominalDatabaseUse(label: string, quote: string): boolean {
  const lines = quote.split(/\r\n|[\r\n\u2028\u2029]/u);
  const database = new RegExp(
    String.raw`^(?:Microsoft\s+)?${escape(label).replace(/\s+/gu, String.raw`\s+`)}(?![\p{L}\p{N}])`,
    'iu',
  );
  return lines.some((_line, index) => {
    // Later role/project headings cannot lend ownership to this responsibility.
    if (
      lines
        .slice(index + 1)
        .some((next) => managedAttribution.test(next.trim()))
    )
      return false;
    const clauses = databaseSemanticClauses(
      lines.slice(index, index + 2).join('\n'),
    );
    return clauses.some((clause) => {
      const nominal =
        /^\s*(?:[-*•]\s*)?(?:(?:led\s+the\s+)?(?:development|implementation)\s+of|responsible\s+for\s+(?:developing|implementing))\s+(?<object>[^.!?;:\r\n]{1,160}?)\s+(?:using|with|on)\s+(?<tools>[^.!?;:\r\n]{1,160})(?:[.!?]|$)/iu.exec(
          clause,
        );
      if (
        !nominal ||
        !/\b(?:features?|functionality|applications?|services?|software|systems?|backend)\b/iu.test(
          nominal.groups!.object!,
        )
      )
        return false;
      const context = [
        ...lines
          .slice(0, index)
          .filter((prior) => managedAttribution.test(prior.trim())),
        clause,
      ].join('\n');
      // A named item in an explicit coordinated use list is not incidental stack
      // co-occurrence. No other technology or qualification is inferred from it.
      return (
        databaseProfessionalUse(context) &&
        nominal
          .groups!.tools!.split(/\s*(?:,|·|\/|&|\band\b)\s*/iu)
          .some((tool) => {
            const match = database.exec(tool);
            return (
              !!match &&
              !/^\s+(?:documentation|manuals?|reference|tutorials?)\b/iu.test(
                tool.slice(match[0].length),
              )
            );
          })
      );
    });
  });
}

function databaseObservations(
  label: string,
  source: string,
  candidates: string[],
): NonNullable<ComponentCoverage['observations']> {
  const eligible = candidates.filter(
    (quote) =>
      quote.length <= 2000 &&
      source.includes(quote) &&
      !(
        /^Oracle$/iu.test(label) &&
        /\bOracle\s+(?:Cloud|Java|JDK|VirtualBox)\b/iu.test(quote)
      ) &&
      mentions(label, quote) &&
      !negative(quote) &&
      !uncertain(quote) &&
      !/\b(?:will|would|want|wish|intend|aim|planning|hoping|goal|if|only|prototype|tutorial|course)\b|dự định|dự kiến|mong muốn|kế hoạch|hy vọng|đang học|sẽ học|muốn học/iu.test(
        quote,
      ),
  );
  const database = escape(label).replace(/\s+/gu, String.raw`\s+`);
  const applied = new RegExp(
    String.raw`\b(?:developed|built|implemented|delivered)\b[^.!?;\r\n]{0,200}\b(?:using|with|on)\s+(?:Microsoft\s+)?${database}(?![\p{L}\p{N}])|\b(?:optimized|tuned|administered|designed)\s+(?:production\s+)?${database}\s+(?:databases?|queries|clusters?)\b`,
    'iu',
  );
  const work = eligible.find(
    (quote) =>
      databaseProfessionalUse(quote) &&
      (databaseSemanticClauses(quote).some((clause) => applied.test(clause)) ||
        nominalDatabaseUse(label, quote)),
  );
  const mention = eligible.find(
    (quote) =>
      quote !== work &&
      /^(?:technical skills|skills|databases)\s*[:—–-]/iu.test(quote),
  );
  if (work)
    return [
      { kind: 'experience', cvQuote: work },
      ...(mention ? [{ kind: 'mention' as const, cvQuote: mention }] : []),
    ];
  const quote = mention ?? eligible[0];
  return quote ? [{ kind: 'mention', cvQuote: quote }] : [];
}

// Recovery is deliberately restricted to these named design competencies. Each
// component needs its own literal/validated equivalent and design-context check;
// infrastructure or broker keywords alone are never architecture evidence.
const andDesignTerms: readonly [RegExp, RegExp][] = [
  [/^apis?$/iu, /\b(?:apis?|application programming interfaces?)\b/iu],
  [
    /^ci\/cd practices$/iu,
    /\b(?:ci\s*\/\s*cd|continuous integration and (?:continuous )?delivery)\s+(?:pipelines?|practices?)\b/iu,
  ],
  [/^integrations?$/iu, /\bintegrations?\b/iu],
  [/^data flows?$/iu, /\bdata[- ]flows?\b/iu],
  [
    /^cloud[- ]based architectures?$/iu,
    /\bcloud[- ](?:based )?architectures?\b/iu,
  ],
];
function recoverAndDesign(
  component: RequirementComponent,
  group: RequirementGroup,
  source: string[],
): string | undefined {
  if (group.mode !== 'AND' || group.context !== 'design') return undefined;
  const term = andDesignTerms.find(([label]) => label.test(component.label));
  if (!term) return undefined;
  return source.find(
    (quote) =>
      quote.length <= 2000 &&
      (andCiCdPractices(component.label, group)
        ? ciCdPipelineContext.test(quote) || ciCdPracticeDeclaration.test(quote)
        : term[1].test(quote)) &&
      !/\b(?:will|would|want|wish|intend|aim|planning|hoping|goal|if|incomplete|pending|planned|draft|abandoned|documentation|manual|tutorial|courses?)\b/iu.test(
        quote,
      ) &&
      !/copilot|cursor|claude code|codeium|tabnine|chatgpt|ai[- ]assisted|coding (?:tools?|assistants?)/iu.test(
        quote,
      ) &&
      (andCiCdPractices(component.label, group) ||
        /\b(?:designed|architected|design experience|experience designing)\b/iu.test(
          quote,
        )) &&
      supports(component.label, quote, group),
  );
}

const degreeLevel =
  /\b(?:bachelor(?:['’]s)?(?:\s+degree|\s+of\s+(?:science|engineering))|bsc|b\.sc\.?|bs)\b/iu;
const degreeIncomplete =
  /\b(?:incomplete|pending|pursuing|candidate|expected|course|program|in[- ]progress|ongoing|enrolled|attending|attended|studying|awaiting|will|would|want|intend|if|wish|aim|planning|hoping|plans?)\b/iu;
const degreeContext =
  /\b(?:graduat\w*|complet\w*|awarded|earned|received|status|incomplete|pending|pursuing|candidate|expected|in[- ]progress|enrolled|studying|awaiting)\b/iu;

// A degree assertion is qualification evidence; attendance or dates alone are
// not. Join only a missing field on the immediately adjacent field-only line,
// retaining original offsets and nearby status qualifiers from the same entry.
function educationPassages(cv: string): string[] {
  const lines = [...cv.matchAll(/[^\r\n]+/gu)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const adjacent = (left: number, right: number) =>
    lines[right] !== undefined &&
    !!lines[right]!.text.trim() &&
    !/\r?\n[ \t]*\r?\n/u.test(cv.slice(lines[left]!.end, lines[right]!.start));
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const level = degreeLevel.exec(line.text);
    if (!level) {
      if (
        negative(line.text) &&
        /\b(?:bachelor(?:['’]s)?|degree)\b/iu.test(line.text)
      )
        result.push(line.text);
      continue;
    }
    let start = i,
      end = i;
    const remainder = line.text.slice(level.index + level[0].length);
    if (
      /^\s*(?:in|:|[-–—])?\s*$/iu.test(remainder) &&
      adjacent(i, i + 1) &&
      /^\s*(?:in\s+|(?:major|field)\s*:\s*)?(?:computer science|software engineering|information technology)\.?\s*$/iu.test(
        lines[i + 1]!.text,
      )
    )
      end++;
    if (
      adjacent(end, end + 1) &&
      !degreeLevel.test(lines[end + 1]!.text) &&
      degreeContext.test(lines[end + 1]!.text)
    )
      end++;
    if (
      i > 0 &&
      adjacent(i - 1, i) &&
      !degreeLevel.test(lines[i - 1]!.text) &&
      degreeContext.test(lines[i - 1]!.text)
    )
      start--;
    const quote = cv.slice(lines[start]!.start, lines[end]!.end);
    if (quote.length <= 2000) result.push(quote);
  }
  return result;
}

export function evaluateCoverage(
  group: RequirementGroup,
  selected: string[],
  cv: string,
  allowRecovery = false,
) {
  if (group.components.every((component) => component.qualification))
    return evaluateQualifications(group, selected, cv, allowRecovery);
  const contextual =
    group.managedLanguage ||
    group.aiFamiliarityOrInterest ||
    group.context === 'proficiency';
  const quotes = contextual
    ? selected.filter(
        (quote) => cv.includes(quote) && completeAttribution(cv, quote),
      )
    : group.demonstratedUse
      ? demonstratedPassages(selected, cv)
      : selected.flatMap(passages);
  // Reuse the existing source-passage enumeration and exact quote resolver.
  // Shortest sufficient contiguous passage wins; never concatenate source spans.
  const contextCandidates = contextual
    ? [
        ...new Set(
          cvQuoteChoices(cv)
            .concat(
              passages(cv),
              group.context === 'proficiency'
                ? databaseAttributedQuoteChoices(cv)
                : [],
            )
            .map((quote) => resolveCvQuote(cv, quote))
            .filter((quote): quote is string => quote !== null),
        ),
      ]
        .filter(
          (quote) => quote.length <= 2000 && completeAttribution(cv, quote),
        )
        .sort((a, b) => a.length - b.length)
    : [];
  const all = passages(cv);
  const education =
    group.mode === 'OR' && group.context === 'education'
      ? educationPassages(cv)
      : [];
  const components: ComponentCoverage[] = group.components.map((component) => {
    // Omitted evidence is recoverable only for an explicit OR and a known
    // alias-policy term. Never turn arbitrary source keywords or an AND gap
    // into a match, and apply the same shared-constraint/positive-context checks.
    const proficiencyRecovery =
      allowRecovery && group.context === 'proficiency'
        ? contextCandidates.find((quote) =>
            supports(component.label, quote, group),
          )
        : undefined;
    const managedRecovery =
      allowRecovery && (group.managedLanguage || group.aiFamiliarityOrInterest)
        ? contextCandidates.find((quote) =>
            supports(component.label, quote, group),
          )
        : undefined;
    const demonstratedRecovery =
      allowRecovery && group.demonstratedUse
        ? demonstratedPassages([cv], cv).find(
            (quote) =>
              quote.length <= 2000 && supports(component.label, quote, group),
          )
        : undefined;
    // Only an explicit, non-negated proficiency declaration is recovered.
    const languageRecovery =
      allowRecovery && group.languageProficiency
        ? all.find(
            (quote) =>
              quote.length <= 2000 && supports(component.label, quote, group),
          )
        : undefined;
    const recovered =
      languageRecovery ??
      demonstratedRecovery ??
      managedRecovery ??
      proficiencyRecovery ??
      (allowRecovery &&
      group.mode === 'OR' &&
      aliases.some(([pattern]) => pattern.test(component.label))
        ? all.find(
            (quote) =>
              quote.length <= 2000 &&
              (!group.personalDelivery || !/\b(?:zero|0)\b/iu.test(quote)) &&
              !/\b(?:will|would|want|wish|intend|aim|planning|hoping|goal|if)\b/iu.test(
                quote,
              ) &&
              /\b(?:built|designed|architected|developed|delivered|implemented|used|worked|integrated|deployed|led|created|skills|knowledge|proficient|experience)\b/iu.test(
                quote,
              ) &&
              !/copilot|cursor|claude code|codeium|tabnine|chatgpt|ai[- ]assisted|coding (?:tools?|assistants?)/iu.test(
                quote,
              ) &&
              supports(component.label, quote, group),
          )
        : undefined);
    const degree =
      group.mode === 'OR' &&
      group.context === 'education' &&
      degreeLevel.test(component.label);
    const degreeSupported = (quote: string) =>
      degreeLevel.test(quote) &&
      !degreeIncomplete.test(quote) &&
      supports(component.label, quote, group);
    const positive = degree
      ? education.find(
          (quote) =>
            degreeSupported(quote) &&
            (allowRecovery ||
              selected.some(
                (selection) =>
                  selection.trim() &&
                  degreeLevel.test(selection) &&
                  (selection.includes(quote) || quote.includes(selection)),
              )),
        )
      : (quotes.find((quote) => supports(component.label, quote, group)) ??
        recovered ??
        (allowRecovery && group.minimumYears !== undefined
          ? all.find(
              (quote) =>
                quote.length <= 2000 &&
                supports(component.label, quote, group) &&
                statedDuration(component.label, quote, group.minimumYears!),
            )
          : undefined) ??
        (allowRecovery ? recoverAndDesign(component, group, all) : undefined));
    const source = degree ? education : all;
    const positiveInCv =
      positive ??
      (contextual ? contextCandidates : source).find((quote) =>
        degree
          ? degreeSupported(quote)
          : supports(component.label, quote, group),
      );
    const negatives = source.filter((quote) =>
      group.aiFamiliarityOrInterest
        ? aiDenial(component.label, quote)
        : (componentMention(component.label, quote, group) ||
            (degree &&
              negative(quote) &&
              /\b(?:bachelor(?:['’]s)?|degree)\b/iu.test(quote) &&
              !/\b(?:degree|science|engineering)\s+in\s+\S/iu.test(
                normalize(quote),
              ))) &&
          (negative(quote) ||
            (degree && degreeIncomplete.test(quote)) ||
            (group.personalDelivery &&
              /\b(?:prototype only|only (?:a |built )?(?:\w+ )?prototypes?)\b/iu.test(
                quote,
              ))) &&
          (!degree ||
            !positiveInCv ||
            !educationFieldsIn(quote).length ||
            educationFieldsIn(quote).some((field) =>
              educationFieldsIn(positiveInCv).includes(field),
            )),
    );
    const observations: NonNullable<ComponentCoverage['observations']> =
      group.context === 'proficiency' && !positive
        ? databaseObservations(
            component.label,
            cv,
            allowRecovery ? contextCandidates : quotes,
          )
        : [];
    // Use without the stated duration is shown, never credited; duration is
    // never inferred from job tenure or a general summary.
    const usedQuote =
      group.minimumYears !== undefined && !positive && !negatives.length
        ? [...quotes, ...all].find(
            (quote) =>
              supports(component.label, quote, {
                ...group,
                minimumYears: undefined,
              }) &&
              // Never claim the duration is unverified for a passage stating it.
              !statedDuration(component.label, quote, group.minimumYears!),
          )
        : undefined;
    if (usedQuote)
      observations.push({
        kind: active(usedQuote) ? 'experience' : 'mention',
        cvQuote: usedQuote,
      });
    if (group.languageProficiency && !positive) {
      const use = [...quotes, ...(allowRecovery ? all : [])].find(
        (quote) =>
          quote.length <= 2000 &&
          languageProfessionalUse(component.label, quote),
      );
      if (use) observations.push({ kind: 'experience', cvQuote: use });
    }
    const work = observations.find((item) => item.kind === 'experience');
    const partial =
      (group.context === 'proficiency' &&
        !!work &&
        databaseProfessionalUse(work.cvQuote)) ||
      (!!group.languageProficiency && !!work);
    // Work contradicts a denial of use/development responsibility, but not a
    // disclaimer of proficiency or database-administration responsibility.
    const deniedWork = negatives.some(
      (quote) =>
        /\b(?:never (?:used|worked)|no (?:work )?experience|have not used|haven['’]t used|didn['’]t use)\b|chưa (?:từng )?sử dụng|không có kinh nghiệm/iu.test(
          quote,
        ) ||
        /\b(?:no responsibility for|not responsible for)\b[^.!?;\r\n]{0,100}\b(?:development|developing|implementation|implementing)\b/iu.test(
          quote,
        ),
    );
    const conflict =
      (negatives.length > 0 && !!positiveInCv) || (!!work && deniedWork);
    return {
      ...component,
      status: conflict
        ? 'CONFLICT'
        : positive
          ? 'EVIDENCED'
          : partial
            ? 'PARTIAL'
            : 'NOT_EVIDENCED',
      cvQuote:
        positive ??
        (conflict
          ? (positiveInCv ?? work?.cvQuote)
          : partial
            ? work?.cvQuote
            : '') ??
        '',
      conflictingQuotes: conflict ? negatives : [],
      ...(!conflict && observations.length
        ? {
            observations,
            qualificationReason: usedQuote
              ? `Use is evidenced in the CV; the required ${group.minimumYears}+ years is not established.`
              : work
                ? 'Project experience is evidenced; proficiency remains unverified.'
                : 'Mentioned in the CV; proficiency remains unverified.',
          }
        : {}),
    };
  });
  const conflict = components.some((item) => item.status === 'CONFLICT');
  const supported = components.filter(
    (item) => item.status === 'EVIDENCED',
  ).length;
  const credit =
    group.mode === 'UNKNOWN' || conflict
      ? 0
      : group.mode === 'OR'
        ? supported > 0
          ? 1
          : (group.context === 'proficiency' || group.languageProficiency) &&
              components.some((item) => item.status === 'PARTIAL')
            ? 0.5
            : 0
        : supported / components.length;
  const status: CoverageStatus = conflict
    ? 'CONFLICT'
    : credit === 1
      ? 'EVIDENCED'
      : credit > 0
        ? 'PARTIAL'
        : 'NOT_EVIDENCED';
  const workLabels = components
    .filter((component) =>
      component.observations?.some((item) => item.kind === 'experience'),
    )
    .map((component) => component.label);
  const proficiencyReason = workLabels.length
    ? `${workLabels.join(', ')} project experience is evidenced; proficiency at the requested level remains unverified.`
    : components.some((component) => component.observations?.length)
      ? 'Database mentions are present in the CV; proficiency at the requested level remains unverified.'
      : 'Proficiency in one database alternative is not evidenced; names or ordinary use alone do not establish the requested level.';
  return {
    mode: group.mode,
    components,
    credit,
    status,
    reason:
      group.mode === 'UNKNOWN'
        ? 'Compound meaning needs review.'
        : conflict
          ? 'Contradictory CV statements need review.'
          : group.languageProficiency && credit < 1
            ? credit > 0
              ? 'Professional use of a listed language is evidenced; proficiency at the requested level remains unverified.'
              : 'Proficiency in one listed language is not evidenced; a skills list or name alone does not establish it.'
            : group.context === 'proficiency' && credit < 1
              ? proficiencyReason
              : group.personalDelivery && !credit
                ? 'Personal delivery beyond prototype is not evidenced.'
                : 'Review the selected component evidence.',
  };
}

const skillsDeclaration =
  /^\s*(?:(?:technical )?skills|backend|databases|tools|frontend)\s*[:—–-]/iu;
const simpleLabel = (requirement: string) =>
  requirement
    .trim()
    .replace(/\.$/u, '')
    .replace(
      /^(?:(?:(?:strong|solid|proven|hands-on)\s+)?experience (?:with|in|using)|familiarity with|working knowledge of|knowledge of|understanding of|proficiency (?:with|in)|backend)\s+/iu,
      '',
    );
const recoveryWork =
  /\b(?:built|designed|architected|developed|delivered|implemented|used|worked|integrated|deployed|led|created|maintained|wrote|administered|migrated|operated|containeri[sz]ed|consumed|consuming|published|publishing)\b/iu;
const aiToolUse =
  /copilot|cursor|claude code|codeium|tabnine|chatgpt|ai[- ]assisted|coding (?:tools?|assistants?)/iu;

// Recover a single named skill only from an exact CV passage describing work
// with it; a skills-list or other keyword-only mention never establishes it.
export function recoverSimpleQuote(
  requirement: string,
  category: string,
  cv: string,
): string {
  const label = simpleLabel(requirement);
  if (category !== 'skill' || !/^[\w+#./-]+$/u.test(label)) return '';
  return (
    passages(cv).find(
      (line) =>
        line.length <= 2000 &&
        recoveryWork.test(line) &&
        !aiToolUse.test(line) &&
        simpleEvidenceStatus(requirement, line, cv, category) === 'EVIDENCED',
    ) ?? ''
  );
}

// Technology-specific duration must be stated for that technology
// ("4 years of experience with Node.js"), never job tenure or general experience.
function statedDuration(label: string, text: string, years: number): boolean {
  for (const match of text.matchAll(
    /\b(\d+)\+?\s+years?\s+(?:of\s+)?(?:[\p{L}-]+\s+)?experience\s+(?:with|in|using)\s+(.*)$/giu,
  ))
    if (Number(match[1]) >= years && mentions(label, match[2]!)) return true;
  return false;
}

// Simple requirements retain their established semantic model links, with narrow
// vetoes for verifiable negatives and insufficient generic duration.
// A named technology row: one token ("Docker"), or up to three tokens that
// each carry a capital, digit or symbol ("REST APIs", "Spring Boot"). Mixed
// descriptive labels ("CI/CD pipelines", "communication skills") are not.
interface NamedTechnology {
  label: string;
  // "Experience with X", "Hands-on experience with X", "X experience".
  experience: boolean;
}
function namedTechnology(
  requirement: string,
  category: string,
): NamedTechnology | null {
  if (category !== 'skill' || /^experience$/iu.test(requirement.trim()))
    return null;
  const text = requirement.trim().replace(/\.$/u, '');
  const suffix = /^(.+?)\s+experience$/iu.exec(text);
  const label = suffix ? suffix[1]!.trim() : simpleLabel(text);
  const experience =
    !!suffix ||
    /^(?:(?:strong|solid|proven|hands-on)\s+)?experience (?:with|in|using)\s+/iu.test(
      text,
    );
  const tokens = label.split(/\s+/u);
  const named =
    tokens.every((token) => /^[\w+#./-]+$/u.test(token)) &&
    (tokens.length === 1 ||
      (tokens.length <= 3 &&
        tokens.every((token) => /[\p{Lu}+#./\d]/u.test(token))));
  // CI/CD pipelines is the one approved lowercase-word capability (PO, PR68).
  return named || ciCdPipelines.test(label) ? { label, experience } : null;
}
const ciCdPipelines = /^CI\/CD pipelines?$/iu;
// Exact mention or approved alias; REST API and REST APIs are equivalent.
function mentionsTechnology(label: string, text: string): boolean {
  if (/^REST APIs?$/iu.test(label)) return /\bREST APIs?\b/iu.test(text);
  // "CI/CD" or the existing CI/CD automation phrases; no wider DevOps terms.
  if (ciCdPipelines.test(label))
    return (
      /\bci\s*\/\s*cd\b/iu.test(text) ||
      new RegExp(ciCdAutomation, 'iu').test(text)
    );
  return mentions(label, text);
}
const passingMention =
  /\b(?:attend(?:ed|ing|s)?|meetups?|workshops?|conferences?|webinars?|courses?|coursework|tutorials?|training|bootcamps?|certifications?|interested|interests?|learning|exploring|reading|curious)\b/iu;
// Work related to the technology: a work verb in the same clause as the
// mention, with no passing-mention marker in that clause.
function relatedWork(label: string, passage: string): boolean {
  return passage
    .split(
      /;|(?<=[.!?])\s+|\b(?:after|before|while|during|but|although|though)\b/iu,
    )
    .some(
      (clause) =>
        mentionsTechnology(label, clause) &&
        (recoveryWork.test(clause) ||
          // Existing CI/CD automation wording ("Automated build and test pipelines").
          (ciCdPipelines.test(label) &&
            /\bautomat(?:ed|ing)\b/iu.test(clause))) &&
        !passingMention.test(clause),
    );
}
function namedTechnologyStatus(
  { label, experience }: NamedTechnology,
  quote: string,
  cv: string,
): CoverageStatus {
  // A wrapped bullet is one unit (PR67 boundaries); its lines are not judged alone.
  const candidates = demonstratedPassages([quote], cv).filter(
    (passage) =>
      mentionsTechnology(label, passage) &&
      !negative(passage) &&
      !uncertain(passage),
  );
  const declaration = (passage: string) =>
    skillsDeclaration.test(passage) || declarationLine.test(passage);
  const supported = candidates.some(
    (passage) =>
      (!declaration(passage) && relatedWork(label, passage)) ||
      // Skills declarations support bare and familiarity rows only (PR57).
      (!experience && declaration(passage)),
  );
  if (!supported) return 'NOT_EVIDENCED';
  return passages(cv).some(
    (line) => mentionsTechnology(label, line) && negative(line),
  )
    ? 'CONFLICT'
    : 'EVIDENCED';
}

export function simpleEvidenceStatus(
  requirement: string,
  quote: string,
  cv: string,
  category = 'skill',
): CoverageStatus {
  if (!quote) return 'NOT_EVIDENCED';
  // Legacy generic Experience rows are semantic duration assessments, not a skill token.
  // A single named skill, bare or behind a generic prefix ("Experience with
  // Kubernetes"), needs a passage that names it; an exact CV substring alone is not evidence.
  const bareSkill =
    category === 'skill' &&
    /^[\w+#./-]+$/u.test(simpleLabel(requirement)) &&
    !/^experience$/iu.test(requirement);
  if (bareSkill && !mentions(simpleLabel(requirement), quote))
    return 'NOT_EVIDENCED';
  const minimum =
    /^(?:(?:minimum|at least|min\.?)\s+)?(\d+)\+?\s+(?:years?|yrs?)$/iu.exec(
      requirement.trim(),
    );
  if (minimum) {
    const duration = /\b(\d+)\+?\s+(?:years?|yrs?)\b/iu.exec(quote);
    if (
      negative(quote) ||
      uncertain(quote) ||
      !duration ||
      Number(duration[1]) < Number(minimum[1])
    )
      return 'NOT_EVIDENCED';
    return 'EVIDENCED';
  }
  const language = singleManagedLanguage.exec(
    requirement.trim().replace(/\.$/u, ''),
  )?.[1];
  const named =
    language === undefined && namedTechnology(requirement, category);
  if (named) return namedTechnologyStatus(named, quote, cv);
  const label = language ?? simpleLabel(requirement);
  // Descriptive requirements keep the model's semantic link, but only to a
  // passage that names the requirement or states work/skills (not a name or contact line).
  const selected = passages(quote).filter(
    (line) =>
      !negative(line) &&
      !uncertain(line) &&
      (mentions(label, line) ||
        active(line) ||
        skillsDeclaration.test(line) ||
        /\b\d+\+?\s+(?:years?|yrs?)\b/iu.test(line)),
  );
  const negatives = passages(cv).filter(
    (line) => mentions(label, line) && negative(line),
  );
  if (
    (language !== undefined || bareSkill) &&
    !selected.some((line) => mentions(label, line))
  )
    return 'NOT_EVIDENCED';
  if (negatives.length && selected.some((line) => mentions(label, line)))
    return 'CONFLICT';
  return selected.length ? 'EVIDENCED' : 'NOT_EVIDENCED';
}

export function simpleContradictions(
  requirement: string,
  cv: string,
): string[] {
  const language = singleManagedLanguage.exec(
    requirement.trim().replace(/\.$/u, ''),
  )?.[1];
  const label = language ?? simpleLabel(requirement);
  return passages(cv).filter((line) => mentions(label, line) && negative(line));
}
