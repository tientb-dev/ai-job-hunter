import type { ImportCandidate } from './job-import.contract.js';
// Section boundaries are part of source evidence, not inferred from job titles.
const nonSkillHeading =
  /^(?:benefits?|compensation|salary(?: and benefits)?|working hours|office location|insurance benefits|leave|time off|team activities|phúc lợi|quyền lợi(?: được hưởng| ứng viên)?|chế độ đãi ngộ|đãi ngộ|thời gian làm việc|giờ làm việc|địa điểm(?: làm việc)?)(?:\s*[:：].*)?$/iu;
const employmentContent =
  /^(?:(?:mức\s+)?lương|thu nhập|salary|compensation|working hours|work schedule|office (?:address|location)|location\s*:|thời gian làm việc|giờ làm việc|địa điểm(?: làm việc)?|địa chỉ|(?:đóng\s+)?(?:BHXH|BHYT|BHTN|bảo hiểm xã hội|bảo hiểm y tế)|nghỉ phép|nghỉ lễ|paid leave|annual leave|vacation|team building|team activities|du lịch|ngân sách đào tạo|annual learning budget|được đào tạo|hỗ trợ chi phí)/iu;
const explicitQualification =
  /bắt buộc|yêu cầu|thành thạo|(?:có|cần)\s+(?:kinh nghiệm|kiến thức)|(?:experience|knowledge|proficiency|understanding)\s+(?:in|with|of)/iu;
export function requirementLines(text: string): {
  line: string;
  kind: 'skills' | 'preferredSkills' | null;
  structured: boolean;
  excluded: boolean;
}[] {
  let section: 'skills' | 'preferredSkills' | null = null;
  let structured = false;
  let excludedSection = false;
  let taxonomy = false;
  return text
    .split(/\r?\n/u)
    .flatMap<ReturnType<typeof requirementLines>[number]>((raw) => {
      const line = raw.trim();
      const clean = line
        .replace(/^[-•*\s]+/u, '')
        .replace(/^#{1,6}\s*/u, '')
        .replace(/^\d+(?:\.\d+)*[.)]?\s+/u, '')
        .replace(/\*{1,2}$/u, '')
        .trim();
      if (
        /^(?:nice[- ]to[- ]have|preferred skills?|preferred qualifications?|ưu tiên|điểm cộng|lợi thế)\s*[:：]?$/iu.test(
          clean,
        )
      ) {
        excludedSection = false;
        section = 'preferredSkills';
        structured = true;
        return [{ line, kind: null, structured, excluded: true }];
      }
      if (
        /^(?:must[- ]have|requirements?|required skills?|qualifications?|your skills and experience|yêu cầu(?: ứng viên| công việc)?)\s*[:：]?$/iu.test(
          clean,
        )
      ) {
        excludedSection = false;
        section = 'skills';
        structured = true;
        return [{ line, kind: null, structured, excluded: true }];
      }
      if (
        /^(?:kinh nghiệm ứng dụng AI|AI application experience|AI experience)\s*[:：]?$/iu.test(
          clean,
        )
      ) {
        excludedSection = false;
        section = null;
        structured = true;
        return [{ line, kind: null, structured, excluded: true }];
      }
      if (clean === 'ITviec Job Domain:') taxonomy = true;
      if (clean === 'End ITviec Job Domain') taxonomy = false;
      if (
        taxonomy ||
        /^(?:ITviec Job (?:Expertise|Domain):|End ITviec Job Domain$)/u.test(
          clean,
        )
      ) {
        section = null;
        structured = false;
        excludedSection = true;
        return [{ line, kind: null, structured, excluded: true }];
      }
      if (nonSkillHeading.test(clean)) {
        section = null;
        structured = false;
        excludedSection = true;
        return [{ line, kind: null, structured, excluded: true }];
      }
      if (
        /^(?:benefits?|why .+|about .+|responsibilities|job description|job title|company|location|domain|source industry|salary|what we offer|your responsibilities|phúc lợi|supplemental skill tags)\s*[:：]/iu.test(
          clean,
        ) ||
        /^(?:benefits?|responsibilities|what we offer|why .+|about .+|phúc lợi|quyền lợi(?: ứng viên)?|mô tả công việc|kinh nghiệm ứng dụng AI)$/iu.test(
          clean,
        )
      ) {
        section = null;
        structured = false;
      }
      if (
        /^(?:job title|vị trí|company|location|source industry|domain|salary|original url|experience|experience metadata|work mode metadata|supplemental skill tags \(not requirements\)|ignored salary placeholders \(not compensation\))\s*[:：]/iu.test(
          clean,
        ) ||
        /^\d+\.\d+\.?\s+/u.test(line) ||
        /^[a-z]\)\s/iu.test(line)
      )
        return [{ line, kind: null, structured, excluded: true }];
      const clearQualification =
        explicitQualification.test(clean) && !employmentContent.test(clean);
      const excluded =
        employmentContent.test(clean) ||
        (excludedSection && !clearQualification);
      if (excluded)
        return [{ line, kind: null, structured: false, excluded: true }];
      // Separate mixed required/preferred clauses, not individual crypto examples.
      const structuredLine =
        structured || (excludedSection && clearQualification);
      const clauses = structuredLine
        ? line
            .replace(/\s*\((ưu tiên[^)]*)\)/giu, '\n$1')
            .split('\n')
            .flatMap((part) =>
              part
                .split(/(?<=\.)\s+(?=\p{Lu})/u)
                .flatMap((part) =>
                  /is a plus|là (?:một )?lợi thế|điểm cộng|not required|^(?:Backend|Mobile):/iu.test(
                    part,
                  )
                    ? part.split(/;\s*/u)
                    : [part],
                ),
            )
        : [line];
      return clauses.map((clause) => {
        const inlinePreferred = structuredLine
          ? /is a plus|(?:prior )?experience.*(?:is )?preferred|ưu tiên|điểm cộng|là (?:một )?lợi thế|nice[- ]to[- ]have/iu.test(
              clause,
            )
          : /ưu tiên|preferred|nice[- ]to[- ]have|desirable|is a plus|điểm cộng|là (?:một )?lợi thế/iu.test(
              clause,
            );
        const inlineRequired =
          /bắt buộc|thành thạo|required|must[- ]have|(?:ít nhất|tối thiểu|at least|minimum)\s*\d+\s*(?:năm|years?)\s*(?:kinh nghiệm|experience)/iu.test(
            clause,
          );
        const competence =
          /^(?:có kinh nghiệm|có kiến thức|hiểu biết|thành thạo|bắt buộc)/iu.test(
            clause.trim(),
          );
        return {
          excluded: false,
          line: structuredLine
            ? clause.replace(/\s*\([^)]*not required[^)]*\).*$/iu, '')
            : clause,
          kind: inlinePreferred
            ? ('preferredSkills' as const)
            : section === 'preferredSkills'
              ? section
              : inlineRequired || competence
                ? ('skills' as const)
                : section,
          structured: structuredLine,
        };
      });
    });
}
export function skillSourceKind(
  text: string,
  value: string,
): 'skills' | 'preferredSkills' | null {
  const contexts = requirementLines(text).filter(
    (item) => item.kind !== null && containsTerm(item.line, value),
  );
  // Explicit qualification wording outranks a section inherited by a project
  // description. A genuinely explicit mandatory qualification still wins.
  if (
    contexts.some(
      (item) =>
        item.kind === 'skills' &&
        /bắt buộc|phải có|must|required|thành thạo|(?:ít nhất|tối thiểu|at least|minimum)\s*\d+\s*(?:năm|years?)\s*(?:kinh nghiệm|experience)/iu.test(
          item.line,
        ),
    )
  )
    return 'skills';
  if (
    contexts.some(
      (item) =>
        item.kind === 'skills' &&
        item.line
          .replace(/^[-•*\s]+/u, '')
          .trim()
          .toLocaleLowerCase() === value.trim().toLocaleLowerCase(),
    )
  )
    return 'skills';
  if (contexts.some((item) => item.kind === 'preferredSkills'))
    return 'preferredSkills';
  const kinds = contexts.map((item) => item.kind);
  return kinds.includes('skills')
    ? 'skills'
    : kinds.includes('preferredSkills')
      ? 'preferredSkills'
      : null;
}
// Qualification clauses remain literal source spans. Split lists only outside
// parentheses so alternatives and language thresholds stay together.
function qualificationParts(line: string): string[] {
  const clean = line.replace(/^[-•*\s]+/u, '').replace(/[.;]$/u, '');
  const prefix =
    /^(?:(?:Strong |Hands-on )?experience (?:with|in|working in|handling) |understanding of |proficiency in )/iu;
  if (
    !prefix.test(clean) &&
    !/^(?:Business-level |Domain knowledge |\d+ years of experience)/iu.test(
      clean,
    )
  )
    return [];
  const body = clean
    .replace(prefix, '')
    .replace(/^front-end technologies such as /iu, '');
  if (
    !/,|\band\b/iu.test(body) ||
    /^(?:Domain knowledge|\d+ years)/iu.test(body) ||
    /financial services|global or|high-traffic|English/iu.test(body)
  )
    return [body];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++;
    if (body[i] === ')') depth--;
    if (depth !== 0) continue;
    const delimiter = body
      .slice(i)
      .match(/^(?:,\s*(?:and\s+)?|\s+and\s+)/iu)?.[0];
    if (
      !delimiter ||
      (delimiter.trim() === 'and' &&
        !body.includes(',') &&
        !/^(?:cloud platforms|DevOps)\b/iu.test(
          body.slice(i + delimiter.length),
        ))
    )
      continue;
    parts.push(body.slice(start, i).trim());
    i += delimiter.length - 1;
    start = i + 1;
  }
  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

function containsTerm(text: string, value: string): boolean {
  const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    'iu',
  ).test(text);
}

// An initial OR group may be followed by independently mandatory list items.
// A comma before the first "or" instead denotes the complete alternatives list.
function structuredParts(line: string): string[] {
  const group = /^[^,]+?\bor\b[^,]+(?=,)/iu.exec(line)?.[0];
  if (!group || /\([^)]*$/u.test(group)) return [line];
  return [
    group,
    ...line
      .slice(group.length + 1)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  ];
}

function conciseParts(line: string): string[] {
  if (
    /ít nhất\s+(?:một|0?1)\s+(?:trong|công nghệ)|at least one|one of/iu.test(
      line,
    )
  )
    return [line];
  let value = line
    .trim()
    .replace(/^ưu tiên\s+/iu, '')
    .replace(/\s+is (?:a plus|preferred)\.?$/iu, '')
    .replace(/[.;]+$/u, '');
  const proficiencyList = /^(?:thành thạo|proficient in)\s+(.+)$/iu.exec(
    value,
  )?.[1];
  if (
    proficiencyList &&
    /^[\p{L}\p{N}+#/& .-]+(?:,\s*[\p{L}\p{N}+#/& .-]+)+$/u.test(
      proficiencyList,
    ) &&
    !/hoặc|\bor\b|các |như |kiến thức|kinh nghiệm/iu.test(proficiencyList)
  )
    value = proficiencyList;
  if (
    /^[\p{L}\p{N}+#/& .-]+(?:,\s*[\p{L}\p{N}+#/& .-]+)+$/u.test(value) &&
    !/\b(?:or|and|with|for|via|using|experience|knowledge|understanding|familiarity)\b|hoặc|kinh nghiệm|kiến thức|thành thạo|tốt nghiệp|đại học|học viện|degree|university|college|bachelor|master|các |có /iu.test(
      value,
    )
  )
    return value.split(/,\s*/u);
  // Plain technology lists can be separated; lists containing alternatives,
  // parentheses, knowledge levels or prose retain their technical constraints.
  return /^(?:RESTful API|SQL\/NoSQL databases)(?:,|$)/iu.test(value)
    ? value.split(/,\s*/u)
    : structuredParts(value);
}

function experienceOnly(line: string): boolean {
  return /^(?:\d+\s*[-–]\s*)?\d+ years? of experience(?: in software development)?\.?$/iu.test(
    line.trim(),
  );
}

// Reconcile model sentences/components against the same explicit numbered
// source clauses used by recovery. Evidence remains literal; no fuzzy matching.
export function normalizeRequirementCandidates(
  candidates: ImportCandidate[],
  post: string,
  jd: string,
): ImportCandidate[] {
  const sources = { post, jd };
  const recovered = {
    post: sectionCandidates(post, 'post'),
    jd: sectionCandidates(jd, 'jd'),
  };
  const result: ImportCandidate[] = [];
  let reconciled = false;
  for (const candidate of candidates) {
    if (!['skills', 'preferredSkills'].includes(candidate.field)) {
      result.push(candidate);
      continue;
    }
    const text = sources[candidate.source];
    const rows = requirementLines(text).filter(
      (row) => row.structured && row.kind,
    );
    const physical = text
      .split(/\r?\n/u)
      .find(
        (line) =>
          line.includes(candidate.value) &&
          (line.includes(candidate.quote) || candidate.quote.includes(line)),
      );
    if (!physical) {
      const normalized = (value: string) =>
        value.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
      const value = normalized(candidate.value),
        quote = normalized(candidate.quote);
      const fragments = recovered[candidate.source].filter(
        (item) =>
          value.includes(normalized(item.value)) &&
          quote.includes(normalized(item.quote)),
      );
      const containsExcluded = requirementLines(text).some(
        (row) =>
          row.excluded && row.line && value.includes(normalized(row.line)),
      );
      if (fragments.length >= 2 || (fragments.length && containsExcluded)) {
        reconciled = true;
        result.push(...fragments);
        continue;
      }
    }
    if (
      !physical ||
      !rows.some(
        (row) =>
          physical.includes(row.line) &&
          (row.line.includes(candidate.value) ||
            candidate.value.includes(row.line)),
      )
    ) {
      result.push(candidate);
      continue;
    }
    reconciled = true;
    const clauses = recovered[candidate.source].filter((item) =>
      physical.includes(item.quote),
    );
    if (clauses.length) result.push(...clauses);
    else if (!experienceOnly(candidate.value)) result.push(candidate);
  }
  if (reconciled)
    result.sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        sources[a.source].indexOf(a.quote) - sources[b.source].indexOf(b.quote),
    );
  return result.filter(
    (candidate, index) =>
      result.findIndex(
        (other) => JSON.stringify(other) === JSON.stringify(candidate),
      ) === index,
  );
}

export function sectionCandidates(
  text: string,
  source: 'post' | 'jd',
): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  for (const { line, kind, structured } of requirementLines(text)) {
    if (
      !kind ||
      /không (?:yêu cầu|bắt buộc|cần)|not required|no experience|ignore.*instructions/iu.test(
        line,
      )
    )
      continue;
    if (
      experienceOnly(line) ||
      /^(?:tham gia dự án|dự án|project\s*:)/iu.test(line)
    )
      continue;
    if (structured) {
      if (
        /deep expertise.*not required|from scratch.*not required/iu.test(line)
      )
        continue;
      // A preferred domain-knowledge qualification is not a technical stack.
      const domainKnowledge =
        kind === 'preferredSkills'
          ? /lĩnh vực\s+([^.;]+)[.;]?$/iu.exec(line)?.[1]
          : undefined;
      if (domainKnowledge) {
        candidates.push({
          field: kind,
          value: domainKnowledge,
          source,
          quote: line,
        });
        continue;
      }
      // Keep source modality (basic knowledge/familiarity), examples and ORs.
      for (const value of conciseParts(line))
        candidates.push({ field: kind, value, source, quote: line });
      continue;
    }
    const clauses = qualificationParts(line);
    if (clauses.length) {
      for (const value of clauses)
        candidates.push({ field: kind, value, source, quote: line });
      continue;
    }
    // Match only technology terms literally present in explicit requirement
    // context. Never infer a stack from role, search filters or benefits.
    if (
      /ít nhất\s+(?:một|0?1)\s+(?:trong|công nghệ)|at least one|one of/iu.test(
        line,
      )
    ) {
      candidates.push({ field: kind, value: line, source, quote: line });
      continue;
    }
    const terms =
      /(?<![\p{L}\p{N}])(?:viễn thông|containers?|K8S|Microservices?|SQL\s*\/\s*NoSQL|NoSQL|OOP|data structures?|algorithms?|design patterns?|Git|Jira|Spring Framework|WebSocket|SOAP\/RESTful Web Services|HTML5\/CSS|BE\s+Java|Backend\s+Java|JPA\s*\/\s*Hibernate|Spring Boot|REST APIs?|TypeScript|Java|SQL|Angular|Kafka|Docker|Kubernetes|CI\/CD|DDD|Hexagonal Architecture|Multi[- ]Tenancy|ARC42|TDD|Pair Programming|AI[- ]assisted development tools)(?![\p{L}\p{N}])/giu;
    for (const match of line.matchAll(terms))
      candidates.push({ field: kind, value: match[0], source, quote: line });
  }
  return candidates;
}

const listDelimiter = /\s*,\s*(?:or\s+)?|\s+or\s+/giu;
const folded = (value: string) =>
  value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
// The exact source sentence in which the values are consecutive items of one
// "or" list (e.g. "degree in A, B, or C"). Items joined by "and" never qualify.
export function alternativeClause(
  text: string,
  values: readonly string[],
): string | undefined {
  const wanted = values.map(folded);
  if (!wanted.length || wanted.some((value) => !value)) return undefined;
  for (const line of text.split(/\r?\n/u))
    for (const piece of line.split(/(?<=[.!?;])\s+/u)) {
      const sentence = piece
        .trim()
        .replace(/^[-•*]\s+/u, '')
        .replace(/^[\p{L} ]{1,40}:\s+/u, '')
        .replace(/[.;]$/u, '');
      if (sentence.length > 2000 || !/\bor\b/iu.test(sentence)) continue;
      const parts = sentence.split(listDelimiter).map(folded);
      const delimiters = [...sentence.matchAll(listDelimiter)].map((m) => m[0]);
      const start = parts.findIndex(
        (part) => part === wanted[0] || part.endsWith(` ${wanted[0]}`),
      );
      const or = delimiters.findIndex(
        (delimiter, index) => index >= start && /\bor\b/iu.test(delimiter),
      );
      if (
        start < 0 ||
        or < 0 ||
        /\band\b/u.test(parts[start]!) ||
        start + wanted.length - 1 > or + 1 ||
        parts.slice(start + 1, or + 2).some((part) => /^and\b/u.test(part)) ||
        !wanted.every((value, k) => k === 0 || parts[start + k] === value)
      )
        continue;
      return sentence;
    }
  return undefined;
}

export function requiredAlternativeLine(
  text: string,
  value: string,
): string | undefined {
  for (const item of requirementLines(text)) {
    if (item.kind !== 'skills') continue;
    const parts = item.structured
      ? structuredParts(item.line)
      : qualificationParts(item.line);
    for (const clause of parts.length ? parts : [item.line]) {
      if (
        ((item.structured && /\bor\b/iu.test(clause)) ||
          /ít nhất\s+(?:một|0?1)\s+(?:trong|công nghệ)|at least one|one of/iu.test(
            clause,
          ) ||
          /\([^)]*\bor\b[^)]*\)/iu.test(clause)) &&
        containsTerm(clause, value)
      )
        return clause;
    }
  }
  return undefined;
}

export function preferredSourceLine(
  text: string,
  value: string,
): string | undefined {
  return requirementLines(text).find(
    (item) =>
      item.kind === 'preferredSkills' &&
      item.line
        .toLocaleLowerCase()
        .includes(value.trim().toLocaleLowerCase()) &&
      /ưu tiên|preferred|nice[- ]to[- ]have|desirable|is a plus|điểm cộng|là (?:một )?lợi thế/iu.test(
        item.line,
      ),
  )?.line;
}

export function requiredSourceLine(
  text: string,
  value: string,
): string | undefined {
  const contexts = requirementLines(text).filter(
    (item) => item.kind === 'skills' && containsTerm(item.line, value),
  );
  return (
    contexts.find((item) => /bắt buộc|phải có|must|required/iu.test(item.line))
      ?.line ??
    contexts.find(
      (item) => !/^(?:tham gia dự án|dự án|project\s*:)/iu.test(item.line),
    )?.line
  );
}

export function institutionalSkillOnly(text: string, value: string): boolean {
  const contexts = text
    .split(/\r?\n/u)
    .filter((line) => containsTerm(line, value));
  const metadata =
    /^(?:company|source industry|supplemental skill tags \(not requirements\)):/iu;
  if (contexts.length && contexts.every((line) => metadata.test(line.trim())))
    return true;
  if (
    /tốt nghiệp|đại học|học viện|các trường|university|college|degree/iu.test(
      value,
    )
  )
    return false;
  return (
    Boolean(contexts.length) &&
    contexts.every(
      (line) =>
        /các trường|trường (?:đại học|cao đẳng)|đại học|học viện|university|college/iu.test(
          line,
        ) || metadata.test(line.trim()),
    )
  );
}

// Quote presence alone does not establish the semantic category of evidence.
// Minimal quotes can use any legitimate occurrence; explicit benefit quotes
// cannot borrow a technology occurrence from a different requirements clause.
export function excludedSkillEvidence(
  text: string,
  value: string,
  quote: string,
): boolean {
  const normalize = (part: string) =>
    part.toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
  const v = normalize(value),
    q = normalize(quote);
  const contexts = requirementLines(text).filter((row) => {
    const line = normalize(row.line);
    return (
      line &&
      (line.includes(v) || v.includes(line)) &&
      (line.includes(q) || q.includes(line))
    );
  });
  return Boolean(contexts.length) && contexts.every((row) => row.excluded);
}
