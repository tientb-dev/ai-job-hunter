import { groupOf, spokenLanguage, type MatchRequirement } from './cv-match.js';
import { strengthLabel } from './cv-match.evidence-strength.js';
import { normalize } from './matching.policy.js';
import type {
  CvEvidenceOrigin,
  ReviewedCvText,
} from '../reviewed-cv/reviewed-cv.text.js';

export type ConditionStatus = 'MET' | 'UNKNOWN' | 'NOT_MET';
type ConditionKind =
  | 'LANGUAGE'
  | 'LANGUAGE_CERTIFICATE'
  | 'EXPERIENCE'
  | 'EDUCATION'
  | 'CERTIFICATION';
type Finding = ConditionStatus | undefined;
interface ConditionRule {
  kind: ConditionKind;
  assess: (line: string) => Finding;
}
export interface ConditionAssessment {
  parentId?: string;
  componentId?: string;
  mode: ReturnType<typeof groupOf>['mode'];
  kind: ConditionKind;
  jdQuote: string;
  status: ConditionStatus;
  reason?: 'DATED_PROGRAMMING' | 'IT_QUALIFICATION';
  unknownExperience?: {
    evidence: 'NONE' | 'UNDATED' | 'DATED';
    years: number;
    javaFullStack?: boolean;
  };
  evidence: {
    cvQuote: string;
    start: number;
    end: number;
    cvOrigin?: CvEvidenceOrigin;
  }[];
}

const unknown = (kind: ConditionKind): ConditionRule => ({
  kind,
  assess: () => undefined,
});

const cefr = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
function proficiency(text: string) {
  const level =
    /^(?:(?:at least|minimum) )?(.+?)[ :]+(?:cefr )?([abc][12])$/u.exec(text);
  if (level && spokenLanguage(level[1]!))
    return { language: level[1]!, level: level[2]! };
  const description =
    /^(?:fluent in|fluency in|conversational(?: in)?) (.+)$/u.exec(text);
  if (description && spokenLanguage(description[1]!))
    return {
      language: description[1]!,
      level: text.startsWith('conversational') ? 'conversational' : 'fluent',
    };
  const declaration = /^(.+?)[ :]+(fluent|conversational)$/u.exec(text);
  if (declaration && spokenLanguage(declaration[1]!))
    return { language: declaration[1]!, level: declaration[2]! };
  return null;
}
function languageRule(text: string): ConditionRule | null {
  const required = proficiency(text);
  if (!required) {
    return spokenLanguage(text) || spokenLanguage(strengthLabel(text) ?? '')
      ? unknown('LANGUAGE')
      : null;
  }
  return {
    kind: 'LANGUAGE',
    assess(line) {
      const found = proficiency(
        line.replace(/^(?:languages?|ngôn ngữ):\s*/u, ''),
      );
      if (found?.language !== required.language) return undefined;
      if (found.level === required.level) return 'MET';
      const minimum = cefr.indexOf(required.level);
      const actual = cefr.indexOf(found.level);
      if (minimum >= 0 && actual >= 0)
        return actual >= minimum ? 'MET' : 'NOT_MET';
      return 'UNKNOWN';
    },
  };
}

const examName = 'ielts|toeic|toefl|jlpt';
const exam = new RegExp(
  `^(?:(?:at least|minimum) )?(${examName})(?: (?:score|band))?(?:[ :]+(n[1-5]|\\d+(?:\\.\\d+)?)(\\+)?)?(?: (?:certificate|certification|required))?$`,
  'u',
);
function languageCertificate(text: string): ConditionRule | null {
  const required = exam.exec(text);
  if (!required)
    return /^(?:ielts|toeic|toefl|jlpt)\b/u.test(text)
      ? unknown('LANGUAGE_CERTIFICATE')
      : null;
  return {
    kind: 'LANGUAGE_CERTIFICATE',
    assess(line) {
      const found = exam.exec(
        line.replace(/^(?:certifications?|certificates?):\s*/u, ''),
      );
      if (
        !found ||
        found[1] !== required[1] ||
        (!found[2] && !/certificate$/u.test(line))
      )
        return undefined;
      if (!required[2]) return 'MET';
      if (!found[2]) return 'UNKNOWN';
      if (
        required[1] === 'jlpt' &&
        /^n[1-5]$/u.test(required[2]) &&
        /^n[1-5]$/u.test(found[2])
      )
        return Number(found[2][1]) <= Number(required[2][1])
          ? 'MET'
          : 'UNKNOWN';
      // IELTS overall bands share a scale. Other scores can be test-version
      // specific, so preserve the cited evidence without comparing them.
      const band = /^(?:[0-8](?:\.[05])?|9(?:\.0)?)$/u;
      if (
        required[1] !== 'ielts' ||
        !band.test(required[2]) ||
        !band.test(found[2])
      )
        return 'UNKNOWN';
      if (Number(found[2]) >= Number(required[2])) return 'MET';
      return found[3] ? 'UNKNOWN' : 'NOT_MET';
    },
  };
}

const years =
  /^(?:(?:at least|minimum) )?(\d+)(\+)?\s*(?:years?|yrs?)\b\s*(of )?(.*)$/u;
const general =
  /^(?:(?:total|general|professional|work|relevant) )?experience$/u;
function duration(text: string, requirement: boolean) {
  const suffix = /^(.*?)\s*\((\d+)\+?\s+years?\)$/u.exec(text);
  const match = years.exec(text);
  if (!match && !suffix) return null;
  if (suffix && requirement) {
    const scope = strengthLabel(suffix[1]!);
    return scope ? { scope, years: Number(suffix[2]), lowerBound: true } : null;
  }
  if (!match) return null;
  const tail = match[4]!;
  const named =
    /^(?:(?:professional )?experience (?:with|in|using)|working with) (.+)$/u.exec(
      tail,
    ) ?? /^(.+?) (?:professional )?experience$/u.exec(tail);
  const scope =
    (!tail && requirement) || general.test(tail)
      ? ''
      : named && !/\b(?:or|and)\b|[,;]/u.test(named[1]!)
        ? normalize(named[1]!)
        : (requirement || match[3]) &&
            strengthLabel(tail) === tail &&
            !/\bexperience\b/u.test(tail)
          ? tail
          : null;
  if (scope === null) return null;
  return {
    scope,
    years: Number(match[1]),
    lowerBound: !!match[2] || /^(?:at least|minimum) /u.test(text),
  };
}
function experienceRule(text: string): ConditionRule | null {
  const required = duration(text, true);
  if (!required)
    return /(?<!\p{L})\d+\+?\s*(?:years?|yrs?|months?|năm)(?!\p{L})/u.test(text)
      ? unknown('EXPERIENCE')
      : null;
  return {
    kind: 'EXPERIENCE',
    assess(line) {
      const found = duration(
        line
          .replace(
            /^(?:(?:professional )?summary|experience|total experience):\s*/u,
            '',
          )
          .replace(/^(?:i have |only )+/u, ''),
        false,
      );
      if (found?.scope !== required.scope) return undefined;
      if (found.years >= required.years) return 'MET';
      return found.lowerBound ? 'UNKNOWN' : 'NOT_MET';
    },
  };
}

const degree =
  /^(associate|bachelor|master|doctorate|ph\.?d\.?)['’]?(?:s)?(?: degree)?(?: (?:in|of) (.+?))?$/u;
const degreeLevels = ['associate', 'bachelor', 'master', 'doctorate'];
const degreeLevel = (level: string) =>
  /^ph/u.test(level) ? 'doctorate' : level;
function educationRule(text: string): ConditionRule | null {
  const required = degree.exec(text);
  if (!required || /\b(?:or|and)\b/u.test(text))
    return /\b(?:degree|diploma)\b|^(?:bachelor|master|doctorate|ph\.?d\.?)\b|cử nhân|bằng cấp|tốt nghiệp/u.test(
      text,
    )
      ? unknown('EDUCATION')
      : null;
  return {
    kind: 'EDUCATION',
    assess(line) {
      const highest = /^highest (?:completed )?degree:\s*/u.test(line);
      const found = degree.exec(
        line.replace(
          /^(?:highest (?:completed )?degree:\s*|(?:education|qualification):\s*|(?:earned|completed|awarded) (?:a )?)/u,
          '',
        ),
      );
      if (!found) return undefined;
      if (
        degreeLevel(found[1]!) === degreeLevel(required[1]!) &&
        (!required[2] || found[2] === required[2])
      )
        return 'MET';
      if (
        highest &&
        degreeLevels.indexOf(degreeLevel(found[1]!)) <
          degreeLevels.indexOf(degreeLevel(required[1]!))
      )
        return 'NOT_MET';
      return 'UNKNOWN';
    },
  };
}

function credential(text: string) {
  return (
    /^(?:certifications?|certificates?):\s*(.+)$/u.exec(text)?.[1] ??
    /^(.+?) (?:certification|certificate)(?: required)?$/u.exec(text)?.[1] ??
    (/^.+\bcertified\b.+$/u.test(text) ? text.replace(/ required$/u, '') : null)
  );
}
function certificationRule(text: string): ConditionRule | null {
  const required = credential(text);
  if (!required)
    return /^(?:certif\w*\b|chứng chỉ)|\bcertif\w* required$/u.test(text)
      ? unknown('CERTIFICATION')
      : null;
  return {
    kind: 'CERTIFICATION',
    assess(line) {
      const assertion =
        /^(?:certifications?|certificates?|credentials?):\s*(.+)$/u.exec(
          line,
        )?.[1] ?? /^(?:earned|hold|awarded) (?:the )?(.+)$/u.exec(line)?.[1];
      const found = assertion
        ? (credential(assertion) ?? assertion)
        : /\bcertified\b/u.test(line)
          ? credential(line)
          : null;
      return found === required ? 'MET' : undefined;
    },
  };
}

const ambiguous =
  /\b(?:not|never|without|no|expired|unverified|pending|incomplete|pursuing|candidate|expected|studying|practice|mock|planned|planning|about|approximately|interested|seeking|personal|hobby|enrolled|attending|attended|awaiting|training|coursework)\b/u;
function conditionRule(text: string): ConditionRule | null {
  return (
    languageCertificate(text) ??
    languageRule(text) ??
    educationRule(text) ??
    certificationRule(text) ??
    experienceRule(text)
  );
}

export const programmingYears =
  /^(?:kinh nghiệm:\s*)?có trên (\d+) năm kinh nghiệm thực tế trong lĩnh vực lập trình(?: và phát triển phần mềm)?$/u;
const itEducation =
  /^(?:học vấn:\s*)?tốt nghiệp đại học chuyên ngành công nghệ thông tin$/iu;

function datedProgramming(review: ReviewedCvText, years: number) {
  const entries = new Map<string, (typeof review.lines)[number][]>();
  for (const line of review.lines) {
    if (line.sectionKind !== 'experience') continue;
    const group = entries.get(line.entryId) ?? [];
    group.push(line);
    entries.set(line.entryId, group);
  }
  const intervals = [];
  const now = new Date();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const lines of entries.values()) {
    const value = (line: (typeof lines)[number]) =>
      review.text.slice(line.start, line.end);
    const roles = lines.filter((line) => line.field === 'role');
    const dates = lines.filter((line) => line.field === 'dates');
    if (
      roles.length !== 1 ||
      dates.length !== 1 ||
      !/^Role: (?:software developer|software engineer|programmer|(?:front[- ]?end|back[- ]?end|full[- ]?stack|web) developer)$/iu.test(
        value(roles[0]!),
      )
    )
      continue;
    const range =
      /^Dates: ([a-z]{3}) (\d{4})\s*[–—-]\s*([a-z]{3}) (\d{4})$/iu.exec(
        value(dates[0]!),
      );
    if (!range) continue;
    const months = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
    const first = months.indexOf(range[1]!.toLowerCase());
    const last = months.indexOf(range[3]!.toLowerCase());
    if (first < 0 || last < 0) continue;
    // Only interior months are certain when employment days are unspecified.
    const start = Number(range[2]) * 12 + first + 1;
    const end = Number(range[4]) * 12 + last;
    if (end > start && end <= currentMonth)
      intervals.push({ start, end, lines: [roles[0]!, dates[0]!] });
  }
  let covered = 0;
  let until = 0;
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    covered += Math.max(0, interval.end - Math.max(until, interval.start));
    until = Math.max(until, interval.end);
  }
  return covered > years * 12
    ? intervals.flatMap((interval) =>
        interval.lines.map(({ start, end }) => ({
          status: 'MET' as const,
          source: { start, end, cvQuote: review.text.slice(start, end) },
        })),
      )
    : [];
}

export function unknownExperience(
  label: string,
  review: ReviewedCvText,
): ConditionAssessment['unknownExperience'] {
  const required = duration(normalize(label).replace(/\.$/u, ''), true);
  if (!required?.scope) return undefined;
  const javaFullStack = /^java full[- ]stack(?: development)?$/u.test(
    required.scope,
  );
  const scope = required.scope.replace(/ development$/u, '');
  const entries = new Map<string, { related: boolean; dated: boolean }>();
  for (const line of review.lines) {
    if (line.sectionKind !== 'experience') continue;
    const entry = entries.get(line.entryId) ?? { related: false, dated: false };
    const text = normalize(review.text.slice(line.start, line.end));
    if (line.field === 'dates') {
      entry.dated ||= /\b(?:19|20)\d{2}\b/u.test(text);
    } else if (!/\b(?:no|never|without|learning|aspiring|not)\b/u.test(text)) {
      entry.related ||= javaFullStack
        ? /\b(?:java|full[- ]stack)\b/u.test(text)
        : (' ' + text.replace(/[^\p{L}\p{N}+#.]+/gu, ' ') + ' ').includes(
            ' ' + scope + ' ',
          );
    }
    entries.set(line.entryId, entry);
  }
  const relevant = [...entries.values()].filter(({ related }) => related);
  return {
    evidence: relevant.some(({ dated }) => dated)
      ? 'DATED'
      : relevant.length
        ? 'UNDATED'
        : 'NONE',
    years: required.years,
    ...(javaFullStack && { javaFullStack }),
  };
}

export function assessConditions(
  canonical: readonly MatchRequirement[],
  jd: string,
  cv: string,
  review?: ReviewedCvText,
): ConditionAssessment[] {
  const lines = [...cv.matchAll(/[^\r\n\u2028\u2029]+/gu)].map((match) => ({
    cvQuote: match[0],
    start: match.index,
    end: match.index + match[0].length,
    text: normalize(match[0])
      .replace(/^[-*•]\s+/u, '')
      .replace(/\.$/u, ''),
  }));
  return canonical.flatMap((parent) => {
    if (!parent.jdQuote.trim() || !jd.includes(parent.jdQuote)) return [];
    const group = groupOf(parent);
    const label = normalize(parent.requirement).replace(/\.$/u, '');
    const programming = programmingYears.exec(label);
    const education = itEducation.test(label);
    const components =
      !programming && (group.mode === 'AND' || group.mode === 'OR')
        ? group.components
        : [];
    const seeds: {
      rule: ConditionRule;
      jdQuote: string;
      componentId?: string;
    }[] = components.flatMap((component) => {
      const rule = conditionRule(
        normalize(component.label).replace(/\.$/u, ''),
      );
      return rule && parent.jdQuote.includes(component.jdQuote)
        ? [{ rule, jdQuote: component.jdQuote, componentId: component.id }]
        : [];
    });
    const parentRule = conditionRule(label);
    if (group.minimumYears !== undefined || (!seeds.length && parentRule)) {
      seeds.push({
        rule:
          group.minimumYears !== undefined && components.length > 1
            ? unknown('EXPERIENCE')
            : (parentRule ?? unknown('EXPERIENCE')),
        jdQuote: parent.jdQuote,
      });
    }
    return seeds.map(({ rule, jdQuote, componentId }) => {
      const findings =
        programming && review
          ? datedProgramming(review, Number(programming[1]))
          : lines.flatMap(({ text, ...source }, index) => {
              if (ambiguous.test(text)) return [];
              const status =
                education && review
                  ? review.lines.some(
                      (line) =>
                        line.sectionKind === 'education' &&
                        line.field === 'qualification' &&
                        line.start === source.start,
                    ) &&
                    /^qualification: bachelor[’']s degree in information technology$/u.test(
                      text,
                    )
                    ? ('MET' as const)
                    : undefined
                  : rule.assess(text);
              if (
                status &&
                (rule.kind === 'EDUCATION' || rule.kind === 'CERTIFICATION')
              ) {
                const next = lines[index + 1];
                if (
                  next &&
                  /^\r?\n$/u.test(cv.slice(source.end, next.start)) &&
                  /^(?:status:|expiry:|\b(?:expected|in progress|pending|degree not awarded)\b)/u.test(
                    next.text,
                  ) &&
                  (ambiguous.test(next.text) || /in progress/u.test(next.text))
                )
                  return [
                    {
                      status: 'UNKNOWN' as const,
                      source: {
                        cvQuote: cv.slice(source.start, next.end),
                        start: source.start,
                        end: next.end,
                      },
                    },
                  ];
              }
              return status ? [{ status, source }] : [];
            });
      const statuses = new Set(findings.map(({ status }) => status));
      const status = statuses.size === 1 ? findings[0]!.status : 'UNKNOWN';
      const explanation =
        status === 'UNKNOWN' && rule.kind === 'EXPERIENCE' && review
          ? unknownExperience(label, review)
          : undefined;
      return {
        parentId: parent.parentId,
        componentId,
        mode: group.mode,
        kind: rule.kind,
        jdQuote,
        status,
        ...(explanation && { unknownExperience: explanation }),
        ...(statuses.size !== 1 &&
          programming && { reason: 'DATED_PROGRAMMING' as const }),
        ...(statuses.size !== 1 &&
          education && { reason: 'IT_QUALIFICATION' as const }),
        evidence: findings.map(({ source }) => source),
      };
    });
  });
}
