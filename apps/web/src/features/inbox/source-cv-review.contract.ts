export const cvFactFields = [
  'name',
  'headline',
  'skill_category',
  'email',
  'phone',
  'location',
  'link',
  'summary',
  'skill',
  'employer',
  'role',
  'dates',
  'qualification',
  'institution',
  'project',
  'certification',
  'language',
  'description',
  'text',
  'heading',
  'source_passage',
] as const;
export const cvSectionKinds = [
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
] as const;
export type CvSectionKind = (typeof cvSectionKinds)[number];
export interface CvFact {
  id: string;
  field: string;
  value: string;
  origin: 'source' | 'user_entered';
  review: 'pending' | 'confirmed' | 'needs_clarification';
  evidence: {
    sourceRevisionId: string;
    start: number;
    end: number;
    quote: string;
  }[];
  replacesFactId?: string;
}
export interface CvProfileDocument {
  contractVersion: '1';
  reconstruction?: { version: '2' | '3'; previousRevisionId: string | null };
  sections: {
    id: string;
    kind: CvSectionKind;
    review: CvFact['review'];
    entries: { id: string; facts: CvFact[]; employerFactId?: string }[];
  }[];
  coverage: {
    start: number;
    end: number;
    disposition: 'mapped' | 'unresolved' | 'excluded';
    factIds: string[];
    reason: string | null;
  }[];
}
export interface CvSource {
  contractVersion: '1';
  id: string;
  fileName: string;
  savedCvUpdatedAt: string;
  text: string;
}
export interface CvProfile {
  contractVersion: '1';
  id: string;
  profileId: string;
  revision: number;
  sourceRevisionId: string;
  document: CvProfileDocument;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
const review = (value: unknown) =>
  ['pending', 'confirmed', 'needs_clarification'].includes(value as string);
export function decodeCvSource(value: unknown): CvSource {
  if (
    !object(value) ||
    value.contractVersion !== '1' ||
    !uuid(value.id) ||
    typeof value.fileName !== 'string' ||
    !value.fileName ||
    typeof value.savedCvUpdatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.savedCvUpdatedAt)) ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    value.text.length > 12000
  )
    throw new Error(
      'The API returned an invalid source CV. Retry loading the review.',
    );
  return value as unknown as CvSource;
}
export function decodeCvProfile(value: unknown, source: CvSource): CvProfile {
  const bad = () => {
    throw new Error(
      'The API returned an invalid source profile. Your edits are retained.',
    );
  };
  if (
    !object(value) ||
    value.contractVersion !== '1' ||
    !uuid(value.id) ||
    !uuid(value.profileId) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    value.sourceRevisionId !== source.id ||
    !object(value.document)
  )
    return bad();
  const document = value.document;
  if (
    document.reconstruction !== undefined &&
    (!object(document.reconstruction) ||
      (document.reconstruction.version !== '2' &&
        document.reconstruction.version !== '3') ||
      (document.reconstruction.previousRevisionId !== null &&
        !uuid(document.reconstruction.previousRevisionId)))
  )
    return bad();
  if (
    document.contractVersion !== '1' ||
    !Array.isArray(document.sections) ||
    document.sections.length > 20 ||
    !Array.isArray(document.coverage) ||
    document.coverage.length > 1000 ||
    new TextEncoder().encode(JSON.stringify(document)).length > 98304
  )
    return bad();
  const ids = new Set<string>();
  const facts = new Map<string, CvFact>();
  function id(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 100 ||
      ids.has(value)
    )
      return bad();
    ids.add(value);
  }
  for (const section of document.sections) {
    if (
      !object(section) ||
      !cvSectionKinds.includes(section.kind as CvSectionKind) ||
      !review(section.review) ||
      !Array.isArray(section.entries) ||
      section.entries.length > 100
    )
      return bad();
    id(section.id);
    for (const entry of section.entries) {
      if (
        !object(entry) ||
        !Array.isArray(entry.facts) ||
        entry.facts.length > 50
      )
        return bad();
      id(entry.id);
      for (const fact of entry.facts) {
        if (
          !object(fact) ||
          typeof fact.field !== 'string' ||
          !fact.field ||
          typeof fact.value !== 'string' ||
          !fact.value.trim() ||
          fact.value.length > 4000 ||
          !['source', 'user_entered'].includes(fact.origin as string) ||
          !review(fact.review) ||
          !Array.isArray(fact.evidence) ||
          fact.evidence.length > 10
        )
          return bad();
        id(fact.id);
        if (
          (fact.origin === 'source' && !fact.evidence.length) ||
          (fact.origin === 'user_entered' && fact.evidence.length)
        )
          return bad();
        for (const ref of fact.evidence)
          if (
            !object(ref) ||
            ref.sourceRevisionId !== source.id ||
            !Number.isSafeInteger(ref.start) ||
            !Number.isSafeInteger(ref.end) ||
            (ref.start as number) < 0 ||
            (ref.end as number) <= (ref.start as number) ||
            (ref.end as number) > source.text.length ||
            ref.quote !==
              source.text.slice(ref.start as number, ref.end as number)
          )
            return bad();
        if (
          fact.origin === 'source' &&
          !fact.evidence.some((ref) => ref.quote.includes(fact.value))
        )
          return bad();
        facts.set(fact.id as string, fact as unknown as CvFact);
        if (facts.size > 300) return bad();
      }
    }
  }
  for (const section of document.sections as CvProfileDocument['sections'])
    for (const entry of section.entries)
      if (entry.employerFactId !== undefined && !sharedEmployer(section, entry))
        return bad();
  let cursor = 0;
  for (const row of document.coverage) {
    if (
      !object(row) ||
      row.start !== cursor ||
      !Number.isSafeInteger(row.end) ||
      (row.end as number) <= cursor ||
      (row.end as number) > source.text.length ||
      !['mapped', 'unresolved', 'excluded'].includes(
        row.disposition as string,
      ) ||
      !Array.isArray(row.factIds) ||
      !row.factIds.every(
        (id) => typeof id === 'string' && facts.get(id)?.origin === 'source',
      ) ||
      (row.reason !== null && typeof row.reason !== 'string') ||
      (row.disposition === 'excluded' &&
        (typeof row.reason !== 'string' || !row.reason.trim()))
    )
      return bad();
    cursor = row.end as number;
  }
  if (cursor !== source.text.length) return bad();
  return structuredClone(value) as unknown as CvProfile;
}
export async function sourceCvRequest(
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`/api/v1/tailored-cv${path}`, {
    method: 'POST',
    cache: 'no-store',
    ...(body === undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contractVersion: '1' }),
        }
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contractVersion: '1', ...(body as object) }),
        }),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      object(value) && typeof value.errorCode === 'string'
        ? value.errorCode
        : '';
    const messages: Record<string, string> = {
      CV_PROFILE_BUSY: 'A source proposal is already running. Retry shortly.',
      CV_PROFILE_CONTEXT_LIMIT:
        'This CV exceeds the organizing limit. Upload a shorter CV in CV Match and organize it again. Your saved work is unchanged.',
      CV_PROFILE_INVALID_OUTPUT:
        'The model could not organize this CV safely. Your saved review is unchanged. Choose Organize my CV to retry.',
      CV_PROFILE_TIMEOUT:
        'Organizing took too long. Your saved review is unchanged. Choose Organize my CV to retry.',
      CV_PROFILE_UNAVAILABLE:
        'The AI service is unavailable. Check it (start Ollama if you run AI locally), then choose Organize my CV to retry. Your saved review is unchanged.',
    };
    throw new Error(
      messages[code] ??
        (response.status === 409
          ? 'The CV or profile changed. Your edits are retained. Reload the saved review before retrying.'
          : 'Could not load or save the source review. Your inputs are retained; check the local API and retry.'),
    );
  }
  return value;
}

// Experience positions may reference one shared source employer fact held by
// another entry of the same section. Returns that fact, or undefined.
export function sharedEmployer(
  section: CvProfileDocument['sections'][number],
  entry: CvProfileDocument['sections'][number]['entries'][number],
): CvFact | undefined {
  if (typeof entry.employerFactId !== 'string' || section.kind !== 'experience')
    return undefined;
  const owner = section.entries.find((e) =>
    e.facts.some((f) => f.id === entry.employerFactId),
  );
  const fact = owner?.facts.find((f) => f.id === entry.employerFactId);
  return owner &&
    owner !== entry &&
    owner.employerFactId === undefined &&
    fact?.field === 'employer' &&
    fact.origin === 'source' &&
    !entry.facts.some((f) => f.field === 'employer')
    ? fact
    : undefined;
}
// Drops links an in-session edit (e.g. moving the employer) has broken, so a
// save never carries a dangling reference. Links are never created here.
export function pruneEmployerLinks(document: CvProfileDocument): void {
  for (const section of document.sections)
    for (const entry of section.entries)
      if (entry.employerFactId !== undefined && !sharedEmployer(section, entry))
        delete entry.employerFactId;
}

// Detects a trailing date range on an institution line (e.g. "University
// Aug 2015 - Sep 2019"). Used only to offer an optional, user-confirmed split.
const MONTH =
  '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?\\s+';
const TRAILING_RANGE = new RegExp(
  `^(.*?\\S)\\s+((?:${MONTH})?\\d{4}\\s*[-–—]\\s*(?:(?:${MONTH})?\\d{4}|Present|Now|Current))$`,
  'iu',
);
export function splitDates(value: string) {
  const match = TRAILING_RANGE.exec(value.trim());
  return match ? { name: match[1]!, dates: match[2]! } : null;
}
