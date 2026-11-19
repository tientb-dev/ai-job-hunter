import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { STACKS } from '../discovery/discovery.js';
import { TECH } from '../interview-prep/interview-prep.policy.js';
import type { Opportunity } from '../opportunities/opportunity.entity.js';
import {
  requirementHeading,
  requirementLines,
} from '../opportunities/job-import.sections.js';
import type { ReviewedCvText } from '../reviewed-cv/reviewed-cv.text.js';
import { assessConditions, programmingYears } from './cv-match.conditions.js';
import { evidenceRules } from './cv-match.coverage.js';
import { canonicalRequirements } from './cv-match.js';
import { normalize, TERMS } from './matching.policy.js';

const originalFields = ['jdText', 'description', 'postText'] as const;
const savedFields = ['skills', 'preferredSkills', 'experience'] as const;
type Field = (typeof originalFields)[number] | (typeof savedFields)[number];
type Priority = 'required' | 'preferred';
type Source = { field: Field; quote: string; start: number; end: number };
type SkillGroup = {
  options: string[];
  priority: Priority;
  source: Source;
  openFallback?: boolean;
};
type ConfirmedStructure = {
  mandatory: string[];
  contextual: string[];
  alternatives: string[];
  mandatoryPriority: Priority;
  alternativePriority: Priority;
  openFallback: boolean;
};

function addGroup(
  groups: Map<string, SkillGroup>,
  options: string[],
  priority: Priority,
  source: Source,
) {
  const key = JSON.stringify([...options].sort());
  const previous = groups.get(key);
  if (
    !previous ||
    (previous.priority === 'preferred' && priority === 'required')
  )
    groups.set(key, { options, priority, source });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const literal = (name: string) => new RegExp(escape(name), 'iu');
const catalog: [string, RegExp][] = [
  ...TERMS.filter(([, category]) => category === 'technicalSkills').map(
    ([name, , aliases]): [string, RegExp] => [
      (
        {
          sql: 'SQL',
          c: 'C',
          'c++': 'C++',
          'c#': 'C#',
          '.net': '.NET',
        } as Record<string, string>
      )[name] ?? name[0]!.toUpperCase() + name.slice(1),
      new RegExp([name, ...aliases].map(escape).join('|'), 'iu'),
    ],
  ),
  ...TECH,
  ...STACKS.map((name): [string, RegExp] => [
    name,
    name === 'Node.js'
      ? /node\.?js/iu
      : name === 'Spring Boot'
        ? /spring\s*boot/iu
        : literal(name),
  ]),
  ['Vue', /vue(?:\.?js)?/iu],
  ['Nuxt', /nuxt(?:\.?js)?/iu],
  ['HTML', /html/iu],
  ['Salesforce', /salesforce/iu],
  ['HubSpot CRM', /hubspot crm/iu],
  ['B2B Sales', /b2b sales/iu],
  ['SEO', /seo/iu],
  ['Google Ads', /google ads/iu],
  ['GA4', /ga4|google analytics 4/iu],
  ['REST API', /REST(?:ful)?(?:\s+(?:APIs?|(?:web )?services?))?/iu],
  ['Cloud', /cloud/iu],
  ['AJAX', /ajax/iu],
  ['CSS', /css/iu],
  ['jQuery', /jquery/iu],
  ['DB2', /db2/iu],
  ['SQL', /sql/iu],
  ['MVC Framework', /mvc frameworks?/iu],
];
// Keep a product family or generic skill distinct from a named product.
const nestedName: Record<string, string> = {
  Spring: String.raw`\s+[Bb][Oo][Oo][Tt]\b`,
  SQL: String.raw`\s+server\b`,
};
const technologies = [
  ...new Map(catalog.map((entry) => [normalize(entry[0]), entry])).values(),
].map(([name, pattern]) => {
  const boundary = String.raw`[\p{L}\p{N}_+#-]|\.[\p{L}\p{N}]`;
  const end = [boundary, nestedName[name]].filter(Boolean).join('|');
  const flags = ['C', 'React', 'Spring', 'REST API'].includes(name)
    ? 'u'
    : 'iu';
  const work = name === 'REST API' ? 'REST(?:ful)?|Restful' : pattern.source;
  return {
    name,
    exact: new RegExp(`^(?:${pattern.source})$`, 'iu'),
    mention: new RegExp(
      String.raw`(?<![\p{L}\p{N}_.+#-])(?:${work})(?!${end})`,
      flags,
    ),
  };
});
// These additional names are qualitative only. Keep v5 extraction and scoring stable.
const salesTerms = ['CRM', 'Lead generation'].map((name) => ({
  name,
  mention: new RegExp(`\\b${name}\\b`, 'iu'),
  exact: new RegExp(`^${name}$`, 'iu'),
}));
const evidenceTerms = [...technologies, ...salesTerms];
const term = (value: string) =>
  technologies.find(({ exact }) => exact.test(normalize(value)));

const clean = (text: string) =>
  normalize(text)
    .replace(/^(?:[-*•–]\s*|\d+[.)]\s+)/u, '')
    .replace(/[.;]+$/u, '')
    .replace(
      /^(?:(?:required|preferred)(?: skills?)?|requirements?|nice[- ]to[- ]have|ưu tiên)\s*:\s*/u,
      '',
    )
    .replace(
      /\s*\((?:required|preferred|nice to have)\)$|\s+(?:is a plus|is preferred|preferred|required)$/u,
      '',
    )
    .trim();

// Evidence term -> requirement it can support. Exact evidence takes precedence.
const directionalEvidence = [['Spring Boot', 'Spring']] as const;

const qualificationHeading =
  /^(?:(?:required|essential|minimum|preferred) qualifications?|required knowledge and skills)[:：]?$/u;
const contextQualification =
  /^(?:(?:prior |professional |hands-on |strong |good |practical |proven )?(?:experience|knowledge|understanding) (?:in|with|of) .*(?:banking|insurance|financial (?:services|industry)|multicultural|cross-cultural|global (?:teams|environments)|high[- ]traffic)|(?:business[- ]level |excellent |strong |good |fluent )?(?:english|communication)\b|.*\b(?:english (?:communication|proficiency)|(?:communication|proficiency) in english)\b|^(?:experience .*\b(?:global or multicultural collaboration|high-traffic systems or global service)\b|(?:\w+ )?knowledge of insurance\b))/u;
const vietnameseDuration =
  /^(?:có |tối thiểu |ít nhất |từ )*\d+\+?\s*(?:năm|tháng)\s+kinh nghiệm(?:\s|$)/u;
const scopedDuration =
  /^(?:(?:at least|minimum(?: of)?) )?\d+\+? (?:years?|months?) (?:of )?(?:professional )?experience (?:in|with|using)\s+/u;
const exampleMarker =
  /(?:^|[\s,(])(?:such as\b|for example\b|e\.g\.|ví dụ(?: như)?(?=\s|[:,]))|(?<=cơ sở dữ liệu|công cụ|nền tảng|công nghệ|kỹ năng)\s+như(?=\s|:)/u;

const or = /\s+(?:or|hoặc)\s+|\s*\/\s*/u;
const and = /\s*[,;]\s*(?:(?:and|và)\s+)?|\s+(?:and|và)\s+|\s*&\s*/u;
const nontechnical =
  /^(?:(?:(?:excellent|good|strong|effective|interpersonal|verbal|written|oral) )*(?:communication|teamwork|team collaboration)(?: skills?)?|(?:ability to |able to )?work(?:ing)? (?:well )?(?:in|as part of) a team|(?:kỹ năng )?(?:giao tiếp|làm việc nhóm)(?: tốt)?)$/u;
const generalExperience =
  /^(?:(?:at least|minimum) )?\d+\+? (?:years?|yrs?|months?|năm)(?: (?:of )?(?:(?:relevant|professional|work|working|industry|overall|general|practical|hands-on|related|software development) )*experience(?: in software development)?| kinh nghiệm(?: làm việc)?)?$/u;
function skillGroups(label: string) {
  const value = label
    .replace(
      /^(?:(?:at least|minimum) )?\d+\+?\s+(?:years?|months?)\s+(?:of\s+)?/u,
      '',
    )
    .replace(
      /^(?:(?:hands-on |strong |solid |proven )?experience (?:with|in|using)|(?:(?:good|strong|working|solid) )?(?:proficiency|knowledge|familiarity) (?:in|with|of)|có kinh nghiệm (?:với|về)|thành thạo)\s+/u,
      '',
    )
    .replace(/^(?:có kinh nghiệm )?viết (?=sql(?:\s|,|$))/u, '')
    .replace(/^(?:write|writing) queries (?:with|using)\s+/u, '')
    .replace(/^(?:experience )?writing (?=sql(?:\s|,|$))/u, '')
    .replace(/\s+experience$/u, '');
  const single =
    term(
      value.replace(
        / (?:design and integration|for back[- ]end development)$/u,
        '',
      ),
    ) ??
    term(
      value.replace(
        /^(?:hands-on )?(?:design(?:ing)? and integrat(?:ion|ing) (?:of |with )?|back[- ]end development (?:using|with) )/u,
        '',
      ),
    );
  const explicitUse =
    /^(?:build(?:ing)?|develop(?:ing)?) (?:applications|services) (?:using|with) (.+)$/u.exec(
      value,
    );
  const named = single ?? (explicitUse && term(explicitUse[1]!));
  if (named) return { groups: [[named.name]], unresolved: [] };
  const alternative = or.test(value);
  const items = value.split(alternative ? or : and);
  if (items.length < 2 || items.some((item) => !item.trim())) return null;
  // Commas before the final OR are safe. An explicit AND mixed with OR is ambiguous.
  if (alternative && /\s+(?:and|và)\s+|[&;]/u.test(value)) return null;
  const parts = alternative
    ? items.flatMap((item) => item.replace(/,$/u, '').split(/,\s*/u))
    : items;
  const groups: string[][] = [];
  const unresolved: string[] = [];
  for (const part of parts) {
    // A positive knowledge requirement can introduce an explicit list after a colon.
    const introduced = /^(có kiến thức tốt về [^:]+):\s*(.+)$/u.exec(part);
    const item = (introduced?.[2] ?? part).trim();
    const skill =
      term(item.replace(/ for back[- ]end development$/u, '')) ??
      (!alternative
        ? term(
            item.replace(
              /^(?:hands-on |practical )?(?:back[- ]end development (?:with|using)|(?:design(?:ing)?|integrat(?:ion|ing)) (?:with|of))\s+/u,
              '',
            ),
          )
        : undefined);
    if (introduced && skill && !alternative) unresolved.push(introduced[1]!);
    if (skill) groups.push([skill.name]);
    else if (!nontechnical.test(part.trim())) unresolved.push(part.trim());
  }
  if (alternative) {
    if (parts.some((part) => !term(part))) return null;
    return { groups: [[...new Set(groups.flat())]], unresolved };
  }
  return groups.length ? { groups, unresolved } : null;
}

const sqlProducts = [
  ['PostgreSQL', 'postgre(?:s|sql)'],
  ['SQL Server', 'sql server'],
  ['Oracle', 'oracle'],
] as const;
const evidenceRelationships = sqlProducts.map(
  ([specific]) =>
    ({
      specific,
      general: 'SQL',
      evidence: 'EXPLICIT_SQL_WORK',
      applied: true,
    }) as const,
);
const sqlWork = sqlProducts.map(([name, product]) => ({
  name,
  action: new RegExp(
    String.raw`\b(?:wrote|writing|authored|executed|optimized|tuned|implemented|developed|maintained|created|viết|tối ưu)\s+(?:\w+\s+){0,3}(?:(?:${product})\s+(?:queries|stored procedures)|(?:queries|stored procedures|truy vấn)\s+(?:in|on|for|using|against|trên|với)\s+(?:${product}))\b`,
    'iu',
  ),
}));
const inventoryVersion = 2;
const extractionPolicyVersion = 5;
type Candidate = { literal: string; canonical: string | null; source: Source };
type RequirementGroup = {
  id: string;
  eligibleOptions: string[][];
  alternatives:
    'EQUAL' | 'NAMED_WITH_FALLBACK' | 'OPEN_ENDED' | 'UNKNOWN' | null;
  namedAlternatives?: string[];
  confirmation?: ConfirmedStructure;
  unresolvedLabel: string;
  kind: 'TECHNICAL' | 'NONTECHNICAL' | 'UNCLASSIFIED';
  mode: 'SINGLE' | 'AND' | 'OR' | 'UNKNOWN';
  priority: Priority | 'unknown';
  sources: { source: Source; priority: Priority }[];
  candidates: Candidate[];
  eligible: boolean;
  reason:
    | 'AMBIGUOUS_GROUP'
    | 'ILLUSTRATIVE_LIST'
    | 'UNSUPPORTED_TERM'
    | 'UNPARSED_REQUIREMENT'
    | 'SOURCE_CONFLICT'
    | 'UNVERIFIED_SOURCE'
    | 'NOT_TECHNICAL'
    | null;
};

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function jdInventoryFingerprint(job: Opportunity) {
  return digest([
    ...[...originalFields, ...savedFields].map((field) => job[field] ?? ''),
    Boolean(job.discovery),
    job.discovery?.requirementSkills ?? (job.discovery ? job.title : null),
  ]);
}

function candidatesFor(source: Source): Candidate[] {
  const found: Candidate[] = [];
  const candidate = (match: RegExpMatchArray, canonical: string | null) => {
    const start = source.start + match.index!;
    const literal = match[0];
    found.push({
      literal,
      canonical,
      source: {
        field: source.field,
        quote: literal,
        start,
        end: start + literal.length,
      },
    });
  };
  for (const { mention, name } of technologies) {
    for (const match of source.quote.matchAll(
      new RegExp(mention.source, 'giu'),
    ))
      candidate(match, name);
  }
  for (const match of source.quote.matchAll(
    /(?<![\p{L}\p{N}_.+-])(?:html5?|git|svn|jira|redmine|ci\/cd|devops)(?![\p{L}\p{N}_.+-])/giu,
  ))
    candidate(match, null);
  found.sort(
    (a, b) =>
      a.source.start - b.source.start || b.literal.length - a.literal.length,
  );
  let previousEnd = -1;
  return found.filter(({ source: { end } }) => {
    if (end <= previousEnd) return false;
    previousEnd = end;
    return true;
  });
}

function inventory(job: Opportunity) {
  const requirements = new Map<string, RequirementGroup>();
  const savedGroups = new Map<string, SkillGroup>();
  const originalGroups = new Map<string, SkillGroup>();
  const unresolved = new Set<string>();
  let originalUnresolved = false;
  let fieldConflict = false;
  const sourceFor = (
    field: Field,
    quote: string,
    from = 0,
  ): Source | undefined => {
    const text = job[field];
    if (!quote) return undefined;
    const line = [...text.matchAll(/[^\r\n]+/gu)].find(
      (match) => match.index >= from && match[0].trim() === quote,
    );
    let start = line
      ? line.index + line[0].indexOf(quote)
      : text.indexOf(quote, from);
    if (start < 0) {
      const wrapped = new RegExp(
        quote
          .split(/\s+/u)
          .map(escape)
          .join(String.raw`\s+`),
        'u',
      ).exec(text.slice(from));
      if (wrapped) {
        start = from + wrapped.index;
        quote = wrapped[0];
      }
    }
    return start < 0
      ? undefined
      : { field, quote, start, end: start + quote.length };
  };
  const parse = (label: string, priority: Priority, quote: string) => {
    if (
      requirementHeading(quote) ||
      qualificationHeading.test(label) ||
      (contextQualification.test(label) &&
        !technologies.some(({ mention }) => mention.test(quote)))
    )
      return { groups: [], unresolved: [] };
    const example = exampleMarker.exec(label);
    const obligation = example
      ? label.slice(0, example.index).replace(/[\s,(]+$/u, '')
      : label;
    const duration =
      scopedDuration.test(obligation) || vietnameseDuration.test(obligation);
    if (duration) {
      const scope = obligation
        .replace(scopedDuration, '')
        .replace(vietnameseDuration, '')
        .replace(
          /^(?:with |using |in |(?:phát triển (?:phần mềm|ứng dụng|hệ thống|dịch vụ) )?(?:với|bằng|sử dụng) )/u,
          '',
        );
      const skill = term(scope);
      if (skill) return { groups: [[skill.name]], unresolved: [] };
      return {
        groups: [],
        unresolved: example || or.test(scope) || and.test(scope) ? [label] : [],
      };
    }
    if (example) {
      const generic = skillGroups(obligation);
      return generic?.groups.length === 1 &&
        generic.groups[0]?.length === 1 &&
        !generic.unresolved.length
        ? generic
        : { groups: [], unresolved: [label] };
    }
    const skills = skillGroups(label);
    if (skills) return skills;
    if (
      programmingYears.test(label) ||
      generalExperience.test(label) ||
      label.split(and).every((part) => nontechnical.test(part.trim()))
    )
      return { groups: [], unresolved: [] };
    // A duration tied to an unrecognized technology may conceal a JD skill.
    const condition = assessConditions(
      [
        {
          requirement: label,
          priority,
          category: 'skill',
          jdQuote: quote,
          cvQuote: '',
        },
      ],
      quote,
      '',
    );
    if (
      (!or.test(label) || !label.split(or).some((part) => term(part))) &&
      condition.some(({ kind }) => kind !== 'EXPERIENCE')
    )
      return { groups: [], unresolved: [] };
    return { groups: [], unresolved: [label || quote] };
  };
  const collect = (
    groups: Map<string, SkillGroup>,
    label: string,
    priority: Priority,
    quote: string,
    source?: Source,
    priorityKnown = true,
  ) => {
    const cleaned = clean(label);
    const candidates = source ? candidatesFor(source) : [];
    const parsed = parse(cleaned, priority, quote);
    // Normalize formatting and common bilingual list separators for source variants.
    const key = cleaned
      .replace(/\b(?:or|hoặc)\b/gu, 'or')
      .replace(/,\s*(?=or\b)/gu, ' ')
      .replace(/[–—]/gu, '-')
      .replace(/\s*([,:/()])\s*/gu, '$1')
      .replace(/\s+/gu, ' ');
    const alternatives = or.test(cleaned);
    const openEnded =
      /(?:or|hoặc) (?:an? )?(?:equivalent|other|các .* khác|các công nghệ front-?end|tương đương)/u.test(
        cleaned,
      );
    const namedAlternatives =
      openEnded && /(?:frontend|front-end)/u.test(cleaned)
        ? [
            ...new Set(
              candidates
                .filter(({ literal }) =>
                  /^(?:vue|nuxt)(?:\.?js)?$/iu.test(literal),
                )
                .map(({ literal, canonical }) => canonical ?? literal),
            ),
          ]
        : [];
    const mode =
      parsed.groups.length > 1
        ? 'AND'
        : parsed.groups[0]?.length && parsed.groups[0].length > 1
          ? 'OR'
          : parsed.groups.length
            ? 'SINGLE'
            : 'UNKNOWN';
    // Preserve explicit relationships between bare names even when some lack a canonical term.
    const parts = cleaned.split(alternatives ? or : and);
    const bareNames = parts.every((part) =>
      candidates.some(({ literal }) => normalize(literal) === part.trim()),
    );
    const unsupported = candidates.some(({ literal }) => !term(literal));
    const reason = !source
      ? 'UNVERIFIED_SOURCE'
      : parsed.unresolved.length
        ? exampleMarker.test(cleaned)
          ? 'ILLUSTRATIVE_LIST'
          : bareNames && unsupported
            ? 'UNSUPPORTED_TERM'
            : alternatives
              ? 'AMBIGUOUS_GROUP'
              : unsupported
                ? 'UNSUPPORTED_TERM'
                : 'UNPARSED_REQUIREMENT'
        : parsed.groups.length
          ? null
          : 'NOT_TECHNICAL';
    const group: RequirementGroup = requirements.get(key) ?? {
      id: digest([job.id ?? null, key]),
      eligibleOptions: [],
      ...(namedAlternatives.length && { namedAlternatives }),
      alternatives: namedAlternatives.length
        ? 'NAMED_WITH_FALLBACK'
        : openEnded
          ? 'OPEN_ENDED'
          : mode === 'OR' || (alternatives && bareNames)
            ? 'EQUAL'
            : alternatives
              ? 'UNKNOWN'
              : null,
      unresolvedLabel: alternatives
        ? (source?.quote ?? quote)
        : (parsed.unresolved[0] &&
            new RegExp(escape(parsed.unresolved[0]), 'iu').exec(label)?.[0]) ||
          (source?.quote ?? quote),
      kind:
        reason === 'NOT_TECHNICAL'
          ? 'NONTECHNICAL'
          : parsed.groups.length || candidates.length
            ? 'TECHNICAL'
            : 'UNCLASSIFIED',
      mode:
        mode !== 'UNKNOWN' || !bareNames
          ? mode
          : parts.length === 1
            ? 'SINGLE'
            : alternatives
              ? 'OR'
              : 'AND',
      priority: priorityKnown ? priority : 'unknown',
      sources: [],
      candidates: [],
      eligible: false,
      reason,
    };
    if (
      source &&
      !group.sources.some(
        (item) =>
          item.source.field === source.field &&
          item.source.start === source.start,
      )
    )
      group.sources.push({ source, priority });
    group.candidates.push(
      ...candidates.filter(
        (candidate) =>
          !group.candidates.some(
            (existing) =>
              existing.source.field === candidate.source.field &&
              existing.source.start === candidate.source.start,
          ),
      ),
    );
    if (!requirements.has(key) || groups === originalGroups) {
      group.priority = priorityKnown ? priority : 'unknown';
      group.reason = reason;
    }
    requirements.set(key, group);
    if (groups === originalGroups && (parsed.unresolved.length || !source))
      originalUnresolved = true;
    for (const item of parsed.unresolved) {
      const original = new RegExp(escape(item), 'iu').exec(label)?.[0];
      unresolved.add(original ?? item);
    }
    if (!source) unresolved.add(quote || label);
    else
      for (const options of parsed.groups)
        addGroup(groups, options, priority, source);
  };

  const saved = Boolean(job.skills.trim() || job.preferredSkills.trim());
  if (saved) {
    for (const row of canonicalRequirements(job)) {
      if (row.category === 'domain') continue;
      const fields =
        row.category === 'experience'
          ? (['experience', ...originalFields] as const)
          : ([
              row.priority === 'required' ? 'skills' : 'preferredSkills',
              ...originalFields,
            ] as const);
      const source = fields
        .map((field) => sourceFor(field, row.jdQuote))
        .find(Boolean);
      collect(savedGroups, row.requirement, row.priority, row.jdQuote, source);
    }
  }

  for (const field of originalFields) {
    const text = job[field].trim();
    if (!text) continue;
    const rows = requirementLines(text, true);
    const structured = rows.some(
      ({ kind, structured, excluded }) => !excluded && kind && structured,
    );
    let from = 0;
    for (const { kind, line, excluded } of rows) {
      if (!line) continue;
      const source = sourceFor(field, line, from);
      if (source) from = source.end;
      if (excluded || (structured && !kind)) continue;
      const priority = kind === 'preferredSkills' ? 'preferred' : 'required';
      collect(originalGroups, line, priority, line, source, kind !== null);
    }
  }

  const useOriginal = originalGroups.size > 0 || originalUnresolved;
  const groups = useOriginal ? originalGroups : savedGroups;
  if (saved && useOriginal) {
    fieldConflict =
      savedGroups.size !== originalGroups.size ||
      [...originalGroups].some(
        ([key, group]) => savedGroups.get(key)?.priority !== group.priority,
      );
    for (const [key, group] of savedGroups) {
      if (!originalGroups.has(key)) unresolved.add(group.source.quote);
    }
  }

  const used = new Set<string>();
  const repeated = new Set<string>();
  for (const { options } of groups.values()) {
    for (const name of options) {
      if (used.has(name)) repeated.add(name);
      used.add(name);
    }
  }
  const reliable = [...groups.values()].filter(({ options, source }) => {
    if (!options.some((name) => repeated.has(name))) return true;
    unresolved.add(source.quote);
    return false;
  });
  for (const requirement of requirements.values()) {
    const assessed = reliable.filter((group) =>
      requirement.sources.some(
        ({ source, priority }) =>
          group.priority === priority &&
          group.source.field === source.field &&
          group.source.start === source.start &&
          group.source.end === source.end,
      ),
    );
    requirement.eligibleOptions = assessed.map(({ options }) => options);
    requirement.eligible = assessed.length > 0;
    if (assessed[0]) requirement.priority = assessed[0].priority;
    if (!requirement.eligible && requirement.reason === null) {
      requirement.reason = 'SOURCE_CONFLICT';
    }
  }
  return {
    requirements: [...requirements.values()],
    evidenceRelationships,
    groups: reliable,
    fieldConflict,
    incomplete: fieldConflict || unresolved.size > 0,
    unresolved: [...unresolved],
  };
}

export type JdSkillInventory = ReturnType<typeof inventory> & {
  id: string;
  jobId: string | null;
  fingerprint: string;
  version: number;
  extractionPolicyVersion: number;
  status: 'COMPLETE' | 'INCOMPLETE' | 'FAILED';
};

export function extractJdSkillInventory(job: Opportunity): JdSkillInventory {
  const sourceFingerprint = jdInventoryFingerprint(job);
  const metadata = {
    id: digest([
      job.id ?? null,
      sourceFingerprint,
      inventoryVersion,
      extractionPolicyVersion,
    ]),
    jobId: job.id ?? null,
    fingerprint: sourceFingerprint,
    version: inventoryVersion,
    extractionPolicyVersion,
  };
  try {
    const extracted = inventory(job);
    return {
      ...metadata,
      ...extracted,
      status: extracted.incomplete ? 'INCOMPLETE' : 'COMPLETE',
    };
  } catch {
    return {
      ...metadata,
      status: 'FAILED',
      groups: [],
      requirements: [],
      evidenceRelationships,
      fieldConflict: false,
      incomplete: true,
      unresolved: [],
    };
  }
}

export function jdInventoryState(job: Opportunity) {
  const stored = job.jdSkillInventory;
  if (!stored) return 'MISSING' as const;
  if (
    stored.jobId !== job.id ||
    stored.fingerprint !== jdInventoryFingerprint(job) ||
    stored.version !== inventoryVersion ||
    stored.extractionPolicyVersion !== extractionPolicyVersion
  )
    return 'STALE' as const;
  return stored.status;
}

/** Confirm source-listed branches on the exact current inventory revision. */
export function confirmJdStructure(
  job: Opportunity,
  input: unknown,
): JdSkillInventory {
  const payload = input as Partial<
    ConfirmedStructure & {
      inventoryId: string;
      groupId: string;
    }
  > | null;
  const stored = job.jdSkillInventory;
  if (
    !payload ||
    !stored ||
    jdInventoryState(job) !== 'INCOMPLETE' ||
    payload.inventoryId !== stored.id
  )
    throw new ConflictException(
      'Reload the current JD inventory before confirming.',
    );
  const group = stored.requirements.find(({ id }) => id === payload.groupId);
  if (!group || group.reason !== 'AMBIGUOUS_GROUP' || group.eligible)
    throw new ConflictException(
      'This requirement is no longer available for confirmation.',
    );
  const {
    mandatory,
    contextual,
    alternatives,
    mandatoryPriority,
    alternativePriority,
  } = payload;
  const validPriority = (value: unknown): value is Priority =>
    value === 'required' || value === 'preferred';
  if (
    !Array.isArray(mandatory) ||
    !Array.isArray(alternatives) ||
    !Array.isArray(contextual) ||
    mandatory.length + alternatives.length + contextual.length > 32 ||
    (!mandatory.length && !alternatives.length) ||
    !validPriority(mandatoryPriority) ||
    !validPriority(alternativePriority)
  )
    throw new BadRequestException(
      'Select source-listed requirements and their priority.',
    );

  const openFallback =
    group.alternatives === 'OPEN_ENDED' ||
    group.alternatives === 'NAMED_WITH_FALLBACK';
  if (
    (alternatives.length === 1 && !openFallback) ||
    (openFallback && !alternatives.length)
  )
    throw new BadRequestException(
      'Keep the named options and the source fallback in an alternative branch.',
    );
  if (
    group.namedAlternatives?.length &&
    (group.namedAlternatives.length !== alternatives.length ||
      group.namedAlternatives.some((name) => !alternatives.includes(name)))
  )
    throw new BadRequestException(
      'Keep the source-listed named options together in the alternative branch.',
    );
  const occupied = new Set(stored.groups.flatMap(({ options }) => options));
  const available = new Set(
    group.candidates.flatMap(({ canonical, literal, source }) =>
      canonical &&
      term(literal)?.name === canonical &&
      job[source.field].slice(source.start, source.end) === literal
        ? [canonical]
        : [],
    ),
  );
  const assigned = [...mandatory, ...alternatives, ...contextual];
  if (
    assigned.length !== available.size ||
    new Set(assigned).size !== assigned.length ||
    assigned.some((name) => typeof name !== 'string' || !available.has(name)) ||
    [...mandatory, ...alternatives].some((name) => occupied.has(name))
  )
    throw new BadRequestException(
      'Assign every supported source-listed skill once and avoid repeated requirements.',
    );
  const reference =
    group.sources.find(
      ({ source }) =>
        originalFields.some((field) => field === source.field) &&
        job[source.field].slice(source.start, source.end) === source.quote,
    ) ??
    group.sources.find(
      ({ source }) =>
        job[source.field].slice(source.start, source.end) === source.quote,
    );
  if (!reference)
    throw new ConflictException(
      'Reload the current JD inventory before confirming.',
    );
  const confirmation = {
    mandatory,
    contextual,
    alternatives,
    mandatoryPriority,
    alternativePriority,
    openFallback,
  };
  const added: SkillGroup[] = mandatory.map((name) => ({
    options: [name],
    priority: mandatoryPriority,
    source: reference.source,
  }));
  if (alternatives.length)
    added.push({
      options: alternatives,
      priority: alternativePriority,
      source: reference.source,
      openFallback,
    });
  const requirements = stored.requirements.map((item) =>
    item.id === group.id
      ? {
          ...item,
          confirmation,
          reason: null,
          eligible: true,
          mode:
            added.length > 1
              ? ('AND' as const)
              : alternatives.length
                ? ('OR' as const)
                : ('SINGLE' as const),
          eligibleOptions: added.map(({ options }) => options),
        }
      : item,
  );
  const incomplete =
    stored.fieldConflict ||
    requirements.some(
      ({ reason, kind }) => reason !== null && kind !== 'NONTECHNICAL',
    );
  return {
    ...stored,
    requirements,
    groups: [...stored.groups, ...added],
    id: digest([stored.id, group.id, confirmation]),
    incomplete,
    status: incomplete ? 'INCOMPLETE' : 'COMPLETE',
  };
}

// Legacy jobs are read-only until explicitly refreshed. Bound memory across jobs
// and reuse the same deterministic extraction for repeated reads in a process.
const legacyInventories = new Map<string, JdSkillInventory>();

export function buildCvSkillMatch(job: Opportunity, cv: ReviewedCvText) {
  const inventoryStatus = jdInventoryState(job);
  let selected: JdSkillInventory | null | undefined =
    inventoryStatus === 'STALE' ? null : job.jdSkillInventory;
  if (inventoryStatus === 'MISSING') {
    const key = digest([job.id ?? null, jdInventoryFingerprint(job)]);
    selected = legacyInventories.get(key);
    if (!selected) {
      selected = extractJdSkillInventory(job);
      if (legacyInventories.size >= 50)
        legacyInventories.delete(legacyInventories.keys().next().value!);
      legacyInventories.set(key, selected);
    }
  }
  const {
    groups,
    incomplete: inventoryIncomplete,
    fieldConflict,
  } = selected ?? {
    groups: [],
    incomplete: true,
    fieldConflict: false,
  };
  const unresolvedGroups = (selected?.requirements ?? []).filter(
    (group) => group.reason !== null && group.kind !== 'NONTECHNICAL',
  );
  const unresolvedTechnicalGroups = unresolvedGroups.filter(
    ({ kind }) => kind === 'TECHNICAL',
  );
  const unresolved = unresolvedTechnicalGroups.map(
    ({ unresolvedLabel }) => unresolvedLabel,
  );
  type Evidence = {
    quote: string;
    start: number;
    end: number;
    factId: string;
    origin: 'source' | 'user_entered';
    sectionKind: 'skills' | 'experience' | 'projects';
    relationship?: {
      from: string;
      reason: 'DIRECTIONAL_SKILL' | 'EXPLICIT_SQL_WORK';
    };
  };
  const evidence = new Map<string, Evidence>();
  const wanted = new Set(groups.flatMap(({ options }) => options));
  const requirements = selected?.requirements ?? [];
  const hasOriginal = requirements.some((group) =>
    group.sources.some(({ source }) =>
      originalFields.some((field) => field === source.field),
    ),
  );
  const named = new Map<string, Candidate[]>();
  const clauses: Source[] = [];
  const explicitSales = new Map<string, Source>();
  for (const group of requirements) {
    for (const { source } of group.sources) {
      if (
        hasOriginal &&
        !originalFields.some((field) => field === source.field)
      )
        continue;
      const example = exampleMarker.exec(source.quote.toLowerCase());
      const obligation = source.quote.slice(0, example?.index);
      const candidates = group.candidates.filter(
        (item) =>
          item.source.field === source.field &&
          item.source.start >= source.start &&
          item.source.end <= source.start + obligation.length,
      );
      for (const { name, mention } of salesTerms) {
        if (
          group.priority === 'required' &&
          clean(obligation) === normalize(name)
        )
          explicitSales.set(name, source);
        const hit = mention.exec(obligation);
        if (hit)
          candidates.push({
            canonical: name,
            literal: hit[0],
            source: {
              field: source.field,
              quote: hit[0],
              start: source.start + hit.index,
              end: source.start + hit.index + hit[0].length,
            },
          });
      }
      let namedInClause = false;
      for (const candidate of candidates.sort(
        (a, b) => a.source.start - b.source.start,
      )) {
        const name = candidate.canonical;
        if (!name || group.confirmation?.contextual.includes(name)) continue;
        wanted.add(name);
        namedInClause = true;
        const occurrences = named.get(name) ?? [];
        occurrences.push(candidate);
        named.set(name, occurrences);
      }
      if (
        namedInClause &&
        group.reason &&
        group.reason !== 'SOURCE_CONFLICT' &&
        (candidates.length > 1 || group.alternatives !== null) &&
        !example &&
        !clauses.some(
          (item) => normalize(item.quote) === normalize(source.quote),
        )
      )
        clauses.push(source);
    }
  }
  if (wanted.has('CRM')) wanted.add('Salesforce');
  for (const [from, to] of directionalEvidence) {
    if (wanted.has(to)) wanted.add(from);
  }
  let qualifiedSql: Evidence | undefined;
  for (const { sectionKind, start, end, factId, origin } of cv.lines) {
    if (
      sectionKind !== 'skills' &&
      sectionKind !== 'experience' &&
      sectionKind !== 'projects'
    )
      continue;
    const quote = cv.text.slice(start, end);
    const clauses = quote
      .split(/;|(?<=[.!?])\s+/u)
      .filter(
        (clause) =>
          !evidenceRules.negative(clause) &&
          !evidenceRules.uncertain(clause) &&
          !evidenceRules.aspiration(clause) &&
          !evidenceRules.passingMention(clause),
      );
    const reference = { quote, start, end, factId, origin, sectionKind };
    if (wanted.has('SQL') && sectionKind !== 'skills' && !qualifiedSql) {
      const product = sqlWork.find(({ action }) =>
        clauses.some((clause) => action.test(clause)),
      );
      if (product)
        qualifiedSql = {
          ...reference,
          relationship: { from: product.name, reason: 'EXPLICIT_SQL_WORK' },
        };
    }
    for (const { name, mention } of evidenceTerms) {
      if (!wanted.has(name) || evidence.has(name)) continue;
      if (
        clauses.some((clause) =>
          sectionKind === 'skills'
            ? clause
                .replace(/^[^:]+:\s*/u, '')
                .split(/[,;•|/]|\s+(?:and|và)\s+/iu)
                .some((item) => {
                  const value = item.trim().replace(/\.$/u, '');
                  return (
                    evidenceTerms.find(({ exact }) =>
                      exact.test(normalize(value)),
                    )?.name === name
                  );
                })
            : mention.test(clause),
        )
      )
        evidence.set(name, reference);
    }
  }
  if (qualifiedSql && !evidence.has('SQL')) evidence.set('SQL', qualifiedSql);
  for (const [from, to] of directionalEvidence) {
    const supporting = evidence.get(from);
    if (supporting && !evidence.has(to))
      evidence.set(to, {
        ...supporting,
        relationship: { from, reason: 'DIRECTIONAL_SKILL' },
      });
  }
  const evidenceRows = groups.map(
    ({ options, priority, source, openFallback }) => ({
      ...(openFallback &&
        !options.some(
          (name) => evidence.has(name) && !evidence.get(name)?.relationship,
        ) && {
          fallbackStatus: 'NEEDS_REVIEW' as const,
        }),
      priority,
      source,
      skills: options.map((name) => ({
        name,
        evidence:
          openFallback && evidence.get(name)?.relationship
            ? null
            : (evidence.get(name) ?? null),
      })),
    }),
  );
  const fallbackReview = evidenceRows.filter(
    ({ fallbackStatus }) => fallbackStatus,
  );
  const rows = evidenceRows.filter(({ fallbackStatus }) => !fallbackStatus);
  const incomplete = inventoryIncomplete || fallbackReview.length > 0;
  const weight = (priority: Priority) => (priority === 'required' ? 3 : 1);
  const totalWeight = rows.reduce(
    (total, row) => total + weight(row.priority),
    0,
  );
  const matched = rows.filter(({ skills }) =>
    skills.some(({ evidence }) => evidence),
  );
  const matchedWeight = matched.reduce(
    (total, row) => total + weight(row.priority),
    0,
  );
  const findings: {
    kind: 'skill' | 'related' | 'clause' | 'requirement';
    label: string;
    sources: Source[];
    evidence: Evidence | null;
  }[] = [];
  for (const [name, occurrences] of named) {
    const direct = evidence.get(name);
    const related = name === 'CRM' ? evidence.get('Salesforce') : undefined;
    const support = direct ?? related;
    if (!support) {
      const source = explicitSales.get(name);
      if (source)
        findings.push({
          kind: 'requirement',
          label: occurrences[0]!.literal,
          sources: [source],
          evidence: null,
        });
      continue;
    }
    findings.push({
      kind:
        !direct || direct.relationship?.reason === 'DIRECTIONAL_SKILL'
          ? 'related'
          : 'skill',
      label: occurrences[0]!.literal,
      sources: occurrences.map((item) => item.source),
      evidence: support,
    });
  }
  for (const { source } of fallbackReview) {
    if (
      !clauses.some((item) => normalize(item.quote) === normalize(source.quote))
    )
      clauses.push(source);
  }
  for (const source of clauses)
    findings.push({
      kind: 'clause',
      label: source.quote,
      sources: [source],
      evidence: null,
    });
  for (const row of rows) {
    if (
      row.priority !== 'required' ||
      row.skills.some((skill) => skill.evidence)
    )
      continue;
    findings.push({
      kind: 'requirement',
      label: row.skills.map((skill) => skill.name).join(' / '),
      sources: [row.source],
      evidence: null,
    });
  }
  return {
    version: 1 as const,
    findings,
    inventoryStatus,
    inventoryId: selected?.id ?? null,
    inventoryExtractionStatus: selected?.status ?? null,
    score:
      !incomplete && totalWeight ? (100 * matchedWeight) / totalWeight : null,
    partialScore:
      incomplete && totalWeight ? (100 * matchedWeight) / totalWeight : null,
    fieldConflict,
    limitation: incomplete
      ? ('INCOMPLETE_INVENTORY' as const)
      : !totalWeight
        ? ('NO_SKILLS' as const)
        : null,
    matchedCount: matched.length,
    totalCount: rows.length,
    fallbackReview,
    unresolved,
    unresolvedTechnicalGroupCount: unresolvedTechnicalGroups.length,
    unclassifiedRequirementCount:
      unresolvedGroups.length - unresolvedTechnicalGroups.length,
    mixedGroups: unresolved.filter(
      (item) =>
        /\s+(?:or|hoặc)\s+|\s+\/\s+/u.test(normalize(item)) &&
        /\s+(?:and|và)\s+|[&;]/u.test(normalize(item)),
    ),
    rows,
  };
}
