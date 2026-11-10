import {
  profileDocument,
  type ProfileDocument,
  type ProfileFact,
} from './tailored-cv.contract.js';
export type Kind = ProfileDocument['sections'][number]['kind'];
export interface Passage {
  id: string;
  start: number;
  end: number;
  text: string;
  kind: Kind | null;
  heading: boolean;
  block: number;
  hint?: string;
  skillRow?: string;
  skillOrder?: number;
  /** Server-recognized Experience position layout (role/dates/project/stack). */
  position?: boolean;
  /** Source offset of the employer heading this passage is grouped under. */
  employerGroup?: number;
  uncertain?: boolean;
  issue?: string;
  evidence?: { start: number; end: number };
}
export class StructureLimitError extends Error {}
const headings: Record<string, Kind> = {
  'employment history': 'experience',
  'work history': 'experience',
  'career history': 'experience',
  'professional profile': 'summary',
  'core competencies': 'skills',
  'technology stack': 'skills',
  publications: 'additional',
  awards: 'additional',
  volunteering: 'additional',
  hobbies: 'additional',
  contact: 'contact',
  'contact information': 'contact',
  links: 'links',
  profiles: 'links',
  summary: 'summary',
  profile: 'summary',
  'professional summary': 'summary',
  'about me': 'summary',
  skills: 'skills',
  'technical skills': 'skills',
  'skill set': 'skills',
  'technical expertise': 'skills',
  experience: 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  projects: 'projects',
  'personal projects': 'projects',
  'independent projects': 'projects',
  education: 'education',
  certifications: 'certifications',
  certificates: 'certifications',
  languages: 'languages',
  additional: 'additional',
  interests: 'additional',
  'kinh nghiệm': 'experience',
  'học vấn': 'education',
  'kỹ năng': 'skills',
  'tóm tắt': 'summary',
};
export const instructionLike = (text: string) =>
  /\b(?:ignore|system prompt|instructions?|return json|invent|pretend)\b/iu.test(
    text,
  ) || /(?:^|\n)\s*(?:system|assistant|developer)\s*:/iu.test(text);
const bullet = (text: string) => /^\s*(?:[•●▪◦*-]|\d+[.)])\s+/u.test(text);
const profession = (text: string) =>
  /\b(?:engineer|developer|architect|designer|analyst|consultant|manager|scientist|specialist|lead|intern|software|development|engineering|backend|front.?end|full.?stack|devops)\b|kỹ sư|lập trình viên/iu.test(
    text,
  );
const dates = (text: string) =>
  /^(?:(?:dates?|period):\s*)?(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(?:19|20)\d{2}\s*(?:[-–—/]|to)\s*(?:(?:[a-z]+\s+)?(?:19|20)\d{2}|present|current|now)/iu.test(
    text.trim(),
  );
function explicit(text: string, kind: Kind | null): string | undefined {
  const value = text.trim();
  const labels: [RegExp, string][] = [
    [/^(?:name|full name):/iu, 'name'],
    [/^(?:headline|professional headline):/iu, 'headline'],
    [/^email:|^[^\s@]+@[^\s@]+\.[^\s@]+/iu, 'email'],
    [/^(?:phone|telephone):|^\+?\d[\d ()-]{7,}/iu, 'phone'],
    [/^(?:location|address):/iu, 'location'],
    [/^(?:link|website|linkedin|github):|^https?:\/\//iu, 'link'],
    [/^(?:employer|company):/iu, 'employer'],
    [
      /^(?:role|title|position):/iu,
      kind === null || kind === 'contact' ? 'headline' : 'role',
    ],
    [/^(?:dates?|start date|end date):/iu, 'dates'],
    [/^(?:qualification|degree):/iu, 'qualification'],
    [/^(?:institution|university|school):/iu, 'institution'],
    [/^(?:project|project name):/iu, 'project'],
    [/^certification:/iu, 'certification'],
  ];
  return (
    labels.find(([pattern]) => pattern.test(value))?.[1] ??
    (dates(value) ? 'dates' : undefined)
  );
}
const artifact = /[\uFFFD\u25A1\u25AF\u25A0\uE000-\uF8FF\u2709]/u;
const contactIssue =
  'Unrecognized contact fragment. Assign it explicitly or exclude it after review.';
const artifactIssue =
  'PDF icon or separator artifact. Review before excluding.';
function locationHint(value: string): string | undefined {
  return /\b(?:city|vietnam|viet nam|hanoi|ho chi minh)\b/iu.test(value) &&
    !/(?:\d[\s().\u2010-\u2015-]*){7}/u.test(value) &&
    !artifact.test(value) &&
    (value.match(/\(/gu)?.length ?? 0) === (value.match(/\)/gu)?.length ?? 0)
    ? 'location'
    : undefined;
}
interface ContactPart {
  start: number;
  end: number;
  value: string;
  hint?: string;
  skillRow?: string;
  skillOrder?: number;
  issue?: string;
}
// Never normalize the saved text: factual values remain exact substrings.
function contactParts(text: string): ContactPart[] {
  const cores: ContactPart[] = [];
  const damaged = [
    ...text.matchAll(
      /[^\s|•·]*[\p{L}\p{N}][\uFFFD\u25A1\u25AF\u25A0\uE000-\uF8FF\u2709][\p{L}\p{N}][^\s|•·]*/gu,
    ),
  ];
  for (const m of damaged)
    cores.push({
      start: m.index,
      end: m.index + m[0].length,
      value: m[0],
      issue:
        'Contact text contains an unreadable character. Check the original before assigning it.',
    });
  const patterns: [RegExp, string][] = [
    [
      /(?:(?:email|e-mail):\s*)?[\p{L}\p{N}.!#$%&'*+/=?^_`{}~-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}/giu,
      'email',
    ],
    [
      /(?:(?:website|linkedin|github|link):\s*)?(?:https?:\/\/|www\.)[^\s|•·\uFFFD\u25A1\u25AF\u25A0\uE000-\uF8FF\u2709<>"']+/giu,
      'link',
    ],
    [
      /(?:(?:phone|telephone|tel|mobile):\s*)?(?:\(\+\d{1,3}\)|\+\d|\b0\d|\(\d{2,4}\))[\d\s().\u2010-\u2015-]{5,}\d/giu,
      'phone',
    ],
  ];
  for (const [pattern, hint] of patterns)
    for (const m of text.matchAll(pattern)) {
      if (cores.some((c) => c.start < m.index + m[0].length && c.end > m.index))
        continue;
      const value = m[0];
      if (
        hint === 'phone' &&
        (value.replace(/\D/gu, '').length < 8 ||
          value.replace(/\D/gu, '').length > 15)
      )
        continue;
      cores.push({ start: m.index, end: m.index + value.length, value, hint });
    }
  for (const m of text.matchAll(
    /[\uFFFD\u25A1\u25AF\u25A0\uE000-\uF8FF\u2709]/gu,
  )) {
    if (!cores.some((c) => m.index >= c.start && m.index < c.end))
      cores.push({
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        issue: artifactIssue,
      });
  }
  if (!cores.length) return [];
  cores.sort((a, b) => a.start - b.start);
  const result: ContactPart[] = [];
  const remainder = (start: number, end: number) => {
    const gap = text.slice(start, end);
    for (const m of gap.matchAll(/[^|•·]+/gu)) {
      const value = m[0].trim();
      if (!value) continue;
      const from = start + m.index + m[0].indexOf(value);
      const hint =
        explicit(value, 'contact') ??
        (profession(value) ? 'headline' : locationHint(value));
      result.push({
        start: from,
        end: from + value.length,
        value,
        ...(hint ? { hint } : { issue: contactIssue }),
      });
    }
  };
  let end = 0;
  for (const core of cores) {
    remainder(end, core.start);
    result.push(core);
    end = core.end;
  }
  remainder(end, text.length);
  return result;
}
// Experience positions laid out as consecutive source lines:
//   <title> / <date range> / <CODE | Project name> [/ <a · b · c stack>]
// Only the complete title+dates+project sequence establishes the attribution;
// partial or labelled sequences are left to the existing review flow.
const projectReference =
  /^[\p{Lu}\d][\p{Lu}\d.&-]{1,24}\s+\|\s+[^|•·]{2,120}$/u;
const stackLine = (value: string) => {
  const items = value.split(/\s+·\s+/u);
  return (
    items.length >= 2 &&
    items.every((i) => /^[\p{L}\d][\p{L}\d .#+/&-]{0,30}$/u.test(i)) &&
    !/[.]$/u.test(value)
  );
};
function markPositionLayouts(raw: Passage[]): void {
  const plain = (p: Passage | undefined) =>
    Boolean(
      p &&
      p.kind === 'experience' &&
      !p.heading &&
      !p.issue &&
      !bullet(p.text) &&
      !instructionLike(p.text),
    );
  for (let i = 0; i + 2 < raw.length; i++) {
    const [title, period, project, stack] = raw.slice(i, i + 4);
    const value = title!.text.trim();
    if (
      !plain(title) ||
      !plain(period) ||
      !plain(project) ||
      title!.hint ||
      !profession(value) ||
      dates(value) ||
      value.split(/\s+/u).length > 7 ||
      /[.;,!?|·:]/u.test(value) ||
      period!.hint !== 'dates' ||
      project!.hint ||
      !projectReference.test(project!.text.trim())
    )
      continue;
    const marked: [Passage, string][] = [
      [title!, 'role'],
      [period!, 'dates'],
      [project!, 'project'],
    ];
    if (plain(stack) && !stack!.hint && stackLine(stack!.text.trim()))
      marked.push([stack!, 'skill']);
    for (const [p, hint] of marked) {
      p.hint = hint;
      p.position = true;
      delete p.uncertain;
    }
    i += marked.length - 1;
  }
  markEmployerGroups(raw, plain);
}
const monthIndex = (text: string, end: boolean): number | undefined => {
  if (/^(?:present|current|now)$/iu.test(text.trim())) return Infinity;
  const m = /^(?:([a-z]{3})[a-z]*\s+)?((?:19|20)\d{2})$/iu.exec(text.trim());
  if (!m) return undefined;
  const months = 'janfebmaraprmayjunjulaugsepoctnovdec';
  const month = m[1] ? months.indexOf(m[1].toLowerCase()) / 3 : end ? 11 : 0;
  return month < 0 ? undefined : Number(m[2]) * 12 + month;
};
const period = (text: string) => {
  const m =
    /^(.+?)\s*(?:[-–—]|to)\s*((?:[a-z]+\s+)?(?:19|20)\d{2}|present|current|now)\b/iu.exec(
      text.trim(),
    );
  const from = m && monthIndex(m[1]!, false),
    to = m && monthIndex(m[2]!, true);
  return from != null && to != null ? { from, to } : undefined;
};
// An employer heading groups positions only when the source shows the whole
// structure: <employer> / <tenure with duration> / position blocks + bullets,
// uninterrupted until something else begins. Dates only stop a group (any
// position outside the tenure abstains); they never establish one.
function markEmployerGroups(
  raw: Passage[],
  plain: (p: Passage | undefined) => boolean,
): void {
  for (let r = 2; r < raw.length; r++) {
    const [employer, tenure, role] = raw.slice(r - 2, r + 1);
    const before = raw[r - 3];
    const name = employer!.text.trim();
    if (
      !(role!.position && role!.hint === 'role') ||
      !plain(employer) ||
      employer!.hint ||
      employer!.position ||
      name.split(/\s+/u).length > 8 ||
      /[.;,!?:|·]/u.test(name) ||
      dates(name) ||
      !plain(tenure) ||
      tenure!.hint !== 'dates' ||
      tenure!.position ||
      !/·\s*\d+\s*(?:yrs?|years?|mos?|months?)\b/iu.test(tenure!.text) ||
      !before ||
      (!(before.heading && before.kind === 'experience') &&
        !bullet(before.text))
    )
      continue;
    const span = period(tenure!.text);
    if (!span) continue;
    const members: Passage[] = [];
    let j = r,
      valid = true;
    while (j < raw.length) {
      const p = raw[j]!;
      if (p.kind !== 'experience' || p.heading || p.issue || p.uncertain) break;
      if (p.position && p.hint === 'role') {
        const dated = period(raw[j + 1]!.text);
        if (!dated || dated.from < span.from || dated.to > span.to)
          valid = false;
      } else if (
        !p.position &&
        !bullet(p.text) &&
        // Wrapped bullet text: a lowercase line directly after bullet content.
        !(
          /^\s*\p{Ll}/u.test(p.text) &&
          members.length > 0 &&
          !members.at(-1)!.position
        )
      )
        break;
      members.push(p);
      j++;
    }
    // The group must end at a section boundary or the end, not mid-content.
    const next = raw[j];
    if (!valid || (next && !next.heading)) continue;
    for (const p of [employer!, tenure!, ...members])
      p.employerGroup = employer!.start;
    employer!.hint = 'employer';
    for (const p of [employer!, tenure!]) {
      p.position = true;
      delete p.uncertain;
    }
    r = j;
  }
}
export const knownSkillCategory =
  /^(?:back[ -]?end|front[ -]?end|leadership(?:\s*(?:&|and)\s*communication)?|communication|soft skills|architecture|databases?|cloud(?:\s*&\s*devops)?|devops|ai[ -]assisted development|tools|frameworks|programming languages|languages|testing|quality assurance)$/iu;
export function segmentSource(source: string): Passage[] {
  if (
    !source.trim() ||
    source.length > 12000 ||
    Buffer.byteLength(source) > 49152
  )
    throw new StructureLimitError();
  const raw: Passage[] = [];
  let kind: Kind | null = null,
    block = 0,
    leading = 0;
  function push(
    start: number,
    end: number,
    heading: boolean,
    hint?: string,
    uncertain = false,
  ) {
    raw.push({
      id: '',
      start,
      end,
      text: source.slice(start, end),
      kind,
      heading,
      block,
      ...(hint ? { hint } : {}),
      ...(uncertain ? { uncertain: true } : {}),
    });
  }
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/gu)) {
    const text = match[0];
    if (!text) continue;
    if (!text.trim()) {
      block++;
      const last = raw.at(-1);
      if (last) {
        last.end += text.length;
        last.text = source.slice(last.start, last.end);
        if (last.evidence) last.evidence.end = last.end;
      } else leading += text.length;
      continue;
    }
    const start = match.index - leading,
      end = match.index + text.length;
    leading = 0;
    const value = text.trim(),
      title = value.replace(/:$/u, '').toLowerCase(),
      label = explicit(text, kind);
    if (label === 'employer' && kind !== 'projects') {
      kind = 'experience';
    }
    if (label === 'institution' && kind !== 'experience') {
      kind = 'education';
    }
    if (instructionLike(text)) {
      push(start, end, false, undefined, true);
      raw.at(-1)!.issue =
        'Instruction-like source text requires manual review.';
      continue;
    }
    if (kind === null || kind === 'contact') {
      const pieces = contactParts(text);
      if (pieces.length) {
        for (const [i, piece] of pieces.entries()) {
          const from = i === 0 ? start : match.index + piece.start;
          const to = pieces[i + 1] ? match.index + pieces[i + 1]!.start : end;
          push(from, to, false, piece.hint, Boolean(piece.issue));
          Object.assign(raw.at(-1)!, {
            text: piece.value,
            evidence: { start: from, end: to },
            ...(piece.issue ? { issue: piece.issue } : {}),
          });
        }
        continue;
      }
    }
    const colon = value.indexOf(':');
    const prefix = colon < 0 ? '' : value.slice(0, colon).toLowerCase();
    const inlineKind =
      !label && ['summary', 'skills'].includes(headings[prefix] ?? '')
        ? headings[prefix]
        : undefined;
    const skillCategory =
      kind === 'skills' &&
      colon >= 0 &&
      !bullet(text) &&
      !label &&
      prefix.length < 60 &&
      (!headings[prefix] || prefix === 'languages');
    if (skillCategory) {
      const split = match.index + text.indexOf(':') + 1;
      push(
        start,
        value.endsWith(':') ? end : split,
        false,
        'skill_category',
        !knownSkillCategory.test(prefix),
      );
      if (!value.endsWith(':')) {
        raw.at(-1)!.evidence = { start, end };
        push(split, end, false, 'skill');
        raw.at(-1)!.evidence = { start, end };
      }
      continue;
    }
    if (inlineKind) {
      kind = inlineKind;
      block++;
      const split = match.index + text.indexOf(':') + 1;
      push(start, split, true);
      if (source.slice(split, end).trim())
        push(split, end, false, kind === 'summary' ? 'summary' : 'skill');
      else {
        raw.at(-1)!.end = end;
        raw.at(-1)!.text = source.slice(start, end);
      }
      continue;
    }
    if (kind === 'skills' && !label && knownSkillCategory.test(title)) {
      // Without PDF geometry a lone category word right after a value line may
      // be that line's wrap ("…, Stakeholder / Communication"); ask the user.
      const previous = raw.at(-1);
      push(
        start,
        end,
        false,
        'skill_category',
        previous?.kind === 'skills' &&
          !previous.heading &&
          previous.hint !== 'skill_category' &&
          previous.block === block,
      );
      continue;
    }
    if (
      kind === 'experience' &&
      !label &&
      /^(?:projects?|selected projects?|technology stack|technologies|tech stack|tools|responsibilities|achievements|contributions|key contributions|highlights|duties)(?::.*)?$/iu.test(
        value,
      )
    ) {
      push(
        start,
        end,
        false,
        'text',
        /^(?:projects?|selected projects?):?$/iu.test(value) &&
          /\n\s*\n\s*$/u.test(raw.at(-1)?.text ?? ''),
      );
      continue;
    }
    const known = headings[title];
    const uppercase =
      /^[\p{Lu}\d &/.-]{3,80}$/u.test(value) && !/^\d/u.test(value);
    const uncertainCapital =
      uppercase &&
      ['experience', 'projects', 'education'].includes(kind ?? '') &&
      !known &&
      !label &&
      !/SECTION$/u.test(value);
    const unknown =
      !known &&
      !label &&
      !bullet(text) &&
      ((/^[\p{Lu}\d &/-]{3,60}$/u.test(value) &&
        !/^\d/u.test(value) &&
        kind !== null &&
        !uncertainCapital &&
        kind !== 'skills' &&
        kind !== 'contact') ||
        (/:\s*$/u.test(text) &&
          !['experience', 'projects', 'education', 'skills'].includes(
            kind ?? '',
          )));
    if (known || unknown) {
      kind = known ?? 'additional';
      block++;
      push(start, end, true);
      continue;
    }
    const contactHint =
      (kind === null || kind === 'contact') && profession(value) && !label
        ? 'headline'
        : (kind === null || kind === 'contact') && locationHint(value)
          ? 'location'
          : (kind === null || kind === 'contact') &&
              raw.length === 0 &&
              /^[\p{L}][\p{L} .'-]+$/u.test(value) &&
              value.split(/\s+/u).length >= 2 &&
              value.split(/\s+/u).length <= 5 &&
              !/curriculum|resume|résumé|contact/iu.test(value)
            ? 'name'
            : undefined;
    const localLabel =
      /^(?:responsibilities|achievements|contributions|key contributions|highlights|duties):\s*$/iu.test(
        value,
      );
    const possibleHeader =
      ['experience', 'education', 'projects'].includes(kind ?? '') &&
      !label &&
      !bullet(text) &&
      !localLabel &&
      /^\p{Lu}/u.test(value) &&
      value.split(/\s+/u).length <= 7 &&
      !/[.;,!?]/u.test(value) &&
      !/^(?:built|developed|created|implemented|designed|worked|led|assisted|supported|used|maintained|documented|tested|delivered|contributed|improved|collaborated|managed|helped|phát triển|xây dựng|hỗ trợ|tham gia|thiết kế)(?:\s|$)/iu.test(
        value,
      );
    push(
      start,
      end,
      false,
      label ??
        contactHint ??
        (localLabel
          ? 'text'
          : kind === 'skills' &&
              raw.some(
                (p) => p.kind === 'skills' && p.hint === 'skill_category',
              )
            ? 'skill'
            : undefined),
      Boolean(
        (contactHint === 'name' && !label) ||
        uncertainCapital ||
        possibleHeader ||
        (!localLabel &&
          ['experience', 'projects', 'education'].includes(kind ?? '') &&
          /:\s*$/u.test(value) &&
          !label &&
          !bullet(text)),
      ),
    );
    if (
      (kind === null || kind === 'contact') &&
      ((!label && !contactHint) ||
        (label === 'location' &&
          /(?:\d[\s().\u2010-\u2015-]*){7}/u.test(value)))
    )
      raw.at(-1)!.issue = contactIssue;
  }
  markPositionLayouts(raw);
  const logical: Passage[] = [];
  for (const passage of raw) {
    const previous = logical.at(-1),
      gap = previous ? source.slice(previous.end, passage.start) : '';
    const protectedField =
      passage.hint && passage.hint !== 'summary' && passage.hint !== 'skill';
    const summary =
      previous?.kind === 'summary' &&
      passage.kind === 'summary' &&
      !previous.heading &&
      !passage.heading &&
      !protectedField;
    const continuation =
      previous &&
      !previous.hint &&
      (bullet(previous.text) || !profession(previous.text)) &&
      !profession(passage.text) &&
      !/\n\s*\n\s*$/u.test(previous.text) &&
      !bullet(passage.text) &&
      !protectedField &&
      !passage.heading &&
      previous.kind === passage.kind &&
      ['experience', 'projects', 'education', 'additional'].includes(
        passage.kind ?? '',
      ) &&
      (/^[ \t]+\S/u.test(passage.text) || /^\s*\p{Ll}/u.test(passage.text)) &&
      !/[.!?:]\s*$/u.test(previous.text);
    if (
      previous &&
      !instructionLike(previous.text) &&
      !instructionLike(passage.text) &&
      !previous.uncertain &&
      !passage.uncertain &&
      previous.end === passage.start &&
      !gap &&
      (summary || continuation) &&
      !previous.heading
    ) {
      if (passage.end - previous.start > 4000) throw new StructureLimitError();
      previous.end = passage.end;
      previous.text = source.slice(previous.start, previous.end);
      continue;
    }
    logical.push({ ...passage });
  }
  if (logical.length > 240 || logical.some((p) => p.text.length > 4000))
    throw new StructureLimitError();
  logical.forEach((p, i) => {
    p.id = `p${i + 1}`;
  });
  return logical;
}
interface Classified {
  passage: Passage;
  kind: Kind;
  field: string;
  explicit: boolean;
  repeated: boolean;
}
export function reconstructSource(
  sourceId: string,
  source: string,
  passages: Passage[],
  choices: Map<string, { kind: Kind; field: string }>,
): ProfileDocument {
  const document: ProfileDocument = {
    contractVersion: '1',
    reconstruction: { version: '3', previousRevisionId: null },
    sections: [],
    coverage: [],
  };
  const classified: Classified[] = passages.flatMap((p) => {
    const selected = choices.get(p.id);
    const deterministic = Boolean(
      p.hint &&
      ((p.kind === 'skills' && ['skill', 'skill_category'].includes(p.hint)) ||
        (p.kind === 'experience' && p.position) ||
        ((!p.kind || p.kind === 'contact') &&
          ['name', 'headline', 'email', 'phone', 'link', 'location'].includes(
            p.hint,
          ))),
    );
    if (
      (!selected && !p.heading && !deterministic) ||
      p.issue ||
      instructionLike(p.text)
    )
      return [];
    let kind: Kind = p.kind ?? selected?.kind ?? 'additional';
    if (
      p.hint &&
      ['name', 'headline', 'email', 'phone', 'location', 'link'].includes(
        p.hint,
      ) &&
      (!p.kind || p.kind === 'contact')
    )
      kind = p.hint === 'link' ? 'links' : 'contact';
    let field = p.heading ? 'heading' : (p.hint ?? selected!.field);
    if (!p.heading && kind === 'summary' && !p.hint) field = 'summary';
    if (
      !p.heading &&
      kind === 'skills' &&
      (!p.hint || ['skill', 'skill_category'].includes(p.hint)) &&
      ![
        'qualification',
        'certification',
        'institution',
        'employer',
        'role',
        'dates',
      ].includes(field)
    )
      field = p.hint === 'skill_category' ? 'skill_category' : 'skill';
    if (
      !p.heading &&
      kind !== 'contact' &&
      !p.hint &&
      ['name', 'headline', 'email', 'phone', 'location'].includes(field)
    )
      field = 'text';
    return [
      {
        passage: p,
        kind,
        field,
        explicit: Boolean(p.hint),
        repeated:
          source.indexOf(p.text.trim()) !== source.lastIndexOf(p.text.trim()),
      },
    ];
  });
  let section: ProfileDocument['sections'][number] | undefined,
    entry: ProfileDocument['sections'][number]['entries'][number] | undefined;
  const records = new Map<string, Classified[]>();
  const layoutEntries = new Map<string, NonNullable<typeof entry>>();
  let boundary = 0,
    previousEnd = 0;
  for (const item of classified) {
    const { passage: p, kind, field } = item;
    const intervening = section && previousEnd !== p.start;
    previousEnd = p.end;
    if (!section || p.heading || section.kind !== kind) {
      boundary++;
      section = {
        id: `section-${boundary}`,
        kind,
        review: 'pending',
        entries: [],
      };
      document.sections.push(section);
      entry = undefined;
    }
    const last = entry ? (records.get(entry.id) ?? []) : [];
    const anchor =
      kind === 'experience'
        ? 'employer'
        : kind === 'projects'
          ? 'project'
          : kind === 'education'
            ? 'institution'
            : kind === 'certifications'
              ? 'certification'
              : kind === 'skills'
                ? 'skill_category'
                : null;
    const nextAnchor = Boolean(
      anchor && field === anchor && last.some((f) => f.field === anchor),
    );
    const nextRole =
      kind === 'experience' &&
      field === 'role' &&
      last.some((f) => f.field === 'role');
    const extendsRecord = Boolean(
      anchor &&
      last.some((i) => i.field === anchor) &&
      ['role', 'dates', 'qualification'].includes(field) &&
      !last.some((i) => i.field === field),
    );
    const uncertainBreak =
      (p.uncertain && !extendsRecord) || Boolean(intervening);
    const layoutEntry = p.skillRow ? layoutEntries.get(p.skillRow) : undefined;
    if (layoutEntry) entry = layoutEntry;
    else if (p.skillRow || !entry || nextAnchor || nextRole || uncertainBreak) {
      entry = {
        id: `${section.id}-record-${section.entries.length + 1}`,
        facts: [],
      };
      section.entries.push(entry);
      records.set(entry.id, []);
      if (p.skillRow) layoutEntries.set(p.skillRow, entry);
    }
    records.get(entry.id)!.push(item);
    // Every factual value is an exact source slice. Categories retain their labels;
    // comma lists remain verbatim so qualifiers cannot detach from technologies.
    const fact: ProfileFact = {
      id: `fact-${p.id}`,
      field,
      value: p.text,
      origin: 'source',
      review: 'pending',
      evidence: [
        {
          sourceRevisionId: sourceId,
          start: p.evidence?.start ?? p.start,
          end: p.evidence?.end ?? p.end,
          quote: source.slice(
            p.evidence?.start ?? p.start,
            p.evidence?.end ?? p.end,
          ),
        },
      ],
    };
    entry.facts.push(fact);
  }
  // Layout order affects the new structured entries, never source serialization
  // or the offset-ordered coverage partition. Nonadjacent slices stay separate.
  for (const s of document.sections) {
    const order = (e: (typeof s.entries)[number]) =>
      records.get(e.id)?.find((i) => i.passage.skillRow)?.passage.skillOrder ??
      -1;
    if (s.kind === 'skills') s.entries.sort((a, b) => order(a) - order(b));
    for (const e of s.entries) {
      const positions = new Map(
        records
          .get(e.id)!
          .map((i) => [`fact-${i.passage.id}`, i.passage.skillOrder ?? -1]),
      );
      if (records.get(e.id)!.some((i) => i.passage.skillRow))
        e.facts.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
    }
  }
  const links = new Map<string, string>();
  for (const s of document.sections)
    for (const e of s.entries) {
      const items = records.get(e.id)!;
      const count = (field: string) =>
        items.filter((f) => f.field === field).length;
      const anchors =
        s.kind === 'experience'
          ? ['employer', 'role']
          : s.kind === 'projects'
            ? ['project']
            : s.kind === 'education'
              ? ['institution', 'qualification']
              : s.kind === 'certifications'
                ? ['certification']
                : [];
      // Positions inside a source-established employer group inherit the
      // group's single employer heading (kept once, in the first entry).
      const group = items[0]?.passage.employerGroup;
      const inherited =
        s.kind === 'experience' &&
        group !== undefined &&
        count('employer') === 0 &&
        items.every((i) => i.passage.employerGroup === group) &&
        s.entries.some((other) =>
          records
            .get(other.id)!
            .some(
              (i) =>
                i.field === 'employer' &&
                i.explicit &&
                i.passage.start === group,
            ),
        );
      if (inherited)
        e.employerFactId = `fact-${
          passages.find((p) => p.start === group && p.employerGroup === group)!
            .id
        }`;
      const clear =
        anchors.every(
          (field) => count(field) === 1 || (field === 'employer' && inherited),
        ) &&
        !items.some((i) => i.passage.uncertain) &&
        !items.some((i) => anchors.includes(i.field) && !i.explicit);
      for (const fact of e.facts) {
        const item = items.find((i) => `fact-${i.passage.id}` === fact.id)!;
        const allowed: Record<string, Kind[]> = {
          name: ['contact'],
          headline: ['contact'],
          email: ['contact'],
          phone: ['contact'],
          location: ['contact'],
          employer: ['experience', 'projects'],
          role: ['experience', 'projects'],
          dates: [
            'contact',
            'experience',
            'projects',
            'education',
            'certifications',
          ],
          institution: ['education'],
          qualification: ['education', 'certifications'],
          project: ['projects', 'experience'],
          certification: ['certifications', 'education'],
        };
        const incompatible =
          allowed[fact.field] && !allowed[fact.field]!.includes(s.kind);
        const protectedClaim = [
          'employer',
          'role',
          'dates',
          'qualification',
          'institution',
          'certification',
          'project',
        ].includes(fact.field);
        const ambiguous =
          fact.field !== 'heading' &&
          (incompatible ||
            (item.repeated &&
              !item.passage.skillRow &&
              !(anchors.length > 0 && clear)) ||
            item.passage.uncertain ||
            (!item.passage.kind && !item.explicit) ||
            (anchors.length > 0 &&
              !clear &&
              (protectedClaim ||
                (!items.some((i) => anchors.includes(i.field)) &&
                  e.facts.find((f) => f.field !== 'heading')?.id ===
                    fact.id))) ||
            (protectedClaim && !item.explicit));
        fact.review = ambiguous ? 'needs_clarification' : 'pending';
        links.set(item.passage.id, fact.id);
      }
    }
  for (const p of passages) {
    const factId = links.get(p.id);
    document.coverage.push({
      start: p.start,
      end: p.end,
      disposition: factId ? 'mapped' : 'unresolved',
      factIds: factId ? [factId] : [],
      reason: factId
        ? null
        : p.issue
          ? p.issue
          : instructionLike(p.text)
            ? 'Instruction-like source text requires manual review.'
            : 'Not assigned by the proposal; review the original passage.',
    });
  }
  if (
    document.sections.length > 20 ||
    document.sections.some(
      (s) =>
        s.entries.length > 100 || s.entries.some((e) => e.facts.length > 50),
    ) ||
    Buffer.byteLength(JSON.stringify(document)) > 96 * 1024
  )
    throw new StructureLimitError();
  assertSkillSourceCoverage(document, passages);
  // Validate all exact quotes and the full, gap-free partition before persistence.
  return profileDocument(document, sourceId, source);
}

// A structurally recognized category/list cannot disappear into "unresolved"
// merely because AI omitted it. This invariant is for newly assembled proposals,
// not explicit later user exclusions or edits.
export function assertSkillSourceCoverage(
  document: ProfileDocument,
  passages: Passage[],
): void {
  let categoryEntry: string | undefined;
  const layoutEntries = new Map<string, string>();
  for (const p of passages) {
    if (p.heading || p.issue || instructionLike(p.text) || p.kind !== 'skills')
      categoryEntry = undefined;
    if (
      p.kind !== 'skills' ||
      p.issue ||
      instructionLike(p.text) ||
      !['skill_category', 'skill'].includes(p.hint ?? '')
    )
      continue;
    const section = document.sections.find((s) =>
      s.entries.some((e) => e.facts.some((f) => f.id === `fact-${p.id}`)),
    );
    const entry = section?.entries.find((e) =>
      e.facts.some((f) => f.id === `fact-${p.id}`),
    );
    const fact = entry?.facts.find((f) => f.id === `fact-${p.id}`);
    if (
      !fact ||
      section?.kind !== 'skills' ||
      fact.field !== p.hint ||
      fact.value !== p.text ||
      fact.origin !== 'source' ||
      !document.coverage.some(
        (c) =>
          c.start === p.start &&
          c.end === p.end &&
          c.disposition === 'mapped' &&
          c.factIds.includes(fact.id),
      )
    )
      throw new Error('Invalid structured skills coverage');
    if (p.skillRow) {
      const expected = layoutEntries.get(p.skillRow);
      if (
        (expected && expected !== entry!.id) ||
        [...layoutEntries].some(
          ([row, id]) => row !== p.skillRow && id === entry!.id,
        )
      )
        throw new Error('Invalid structured skill layout association');
      layoutEntries.set(p.skillRow, entry!.id);
      continue;
    }
    if (p.hint === 'skill_category') categoryEntry = entry!.id;
    else if (categoryEntry && entry!.id !== categoryEntry)
      throw new Error('Invalid structured skill category association');
  }
}
