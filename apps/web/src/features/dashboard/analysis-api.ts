import { isPartialDocument } from './partial-validation';
import type { AnalysisResponse } from './analysis.types';
export const ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_INPUT',
  'LOCAL_REQUEST_DENIED',
  'UPLOAD_TIMEOUT',
  'REQUEST_TOO_LARGE',
  'DOCUMENT_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNSUPPORTED_FILE_TYPE',
  'INVALID_JSON',
  'SCHEMA_VALIDATION_FAILURE',
  'INVALID_OUTPUT',
  'INVALID_EVIDENCE',
  'DUPLICATE_FACT',
  'OUTPUT_TOO_LARGE',
  'PROMPT_TOO_LARGE',
  'CONTEXT_LIMIT_EXCEEDED',
  'OUTPUT_LIMIT_EXCEEDED',
  'RESPONSE_TOO_LARGE',
  'PARSING_FAILED',
  'PASSWORD_PROTECTED_DOCUMENT',
  'RESOURCE_ACCESS_DENIED',
  'NO_EXTRACTABLE_TEXT',
  'ANALYSIS_BUSY',
  'EXTRACTION_BUSY',
  'PARSER_BUSY',
  'ANALYSIS_UNAVAILABLE',
  'EXTRACTION_UNAVAILABLE',
  'PARSER_UNAVAILABLE',
  'CONTEXT_UNVERIFIED',
  'CONNECTION_FAILURE',
  'UPSTREAM_HTTP_FAILURE',
  'MALFORMED_RESPONSE',
  'ANALYSIS_TIMEOUT',
  'TIMEOUT',
  'PARSING_TIMEOUT',
  'INVALID_SCHEMA',
  'INVALID_SOURCE',
  'INVALID_MATCHING_INPUT',
  'INSUFFICIENT_MATCHING_INPUT',
  'EXTRACTION_FAILED',
  'ANALYSIS_FAILED',
] as const;
const diagnosticFields = [
  'cv',
  'jd',
  'cv.name',
  'cv.email',
  'cv.phone',
  'cv.location',
  'cv.skills[].name',
  'cv.skills[].experienceText',
  'cv.experience[]',
  'cv.education[]',
  'cv.experience[].employer',
  'cv.experience[].title',
  'cv.experience[].startDateText',
  'cv.experience[].endDateText',
  'cv.experience[].descriptionText',
  'cv.education[].institution',
  'cv.education[].qualification',
  'cv.education[].dateText',
  'jd.title',
  'jd.company',
  'jd.location',
  'jd.employmentType',
  'jd.compensationText',
  'jd.requirements[].text',
  'jd.requirements[].priority',
  'jd.responsibilities[]',
];
const diagnosticRules: Record<string, string> = {
  OUTPUT_NOT_SERIALIZABLE: 'OUTPUT',
  SCHEMA_MISMATCH: 'OUTPUT',
  REQUIRED_COLLECTION_VALUE_NULL: 'OUTPUT',
  EMPTY_HISTORY_RECORD: 'OUTPUT',
  SEGMENT_UNKNOWN: 'EVIDENCE',
  QUOTE_EMPTY: 'EVIDENCE',
  QUOTE_TOO_LONG: 'EVIDENCE',
  QUOTE_NOT_FOUND: 'EVIDENCE',
  QUOTE_AMBIGUOUS: 'EVIDENCE',
  QUOTE_BOUNDARY_INVALID: 'EVIDENCE',
  NULL_WITH_EVIDENCE: 'EVIDENCE',
  VALUE_EMPTY: 'EVIDENCE',
  VALUE_TOO_LONG: 'EVIDENCE',
  EVIDENCE_MISSING: 'EVIDENCE',
  EVIDENCE_DUPLICATE: 'EVIDENCE',
  VALUE_UNSUPPORTED: 'EVIDENCE',
  PRIORITY_CUE_MISSING: 'EVIDENCE',
  PRIORITY_LINK_INVALID: 'EVIDENCE',
};
export class AnalysisClientError extends Error {
  constructor(readonly kind: 'network' | 'malformed') {
    super(kind);
  }
}
type Check = (value: unknown) => boolean;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const string: Check = (v) => typeof v === 'string';
const number: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const count: Check = (v) =>
  number(v) && Number.isInteger(v) && (v as number) >= 0;
const bool: Check = (v) => typeof v === 'boolean';
const one =
  (...values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const list =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
const shape =
  (checks: Record<string, Check>): Check =>
  (v) =>
    record(v) &&
    Object.entries(checks).every(
      ([key, check]) => Object.hasOwn(v, key) && check(v[key]),
    );
const category = one(
  'technicalSkills',
  'experience',
  'architecture',
  'engineeringPractices',
  'domainKnowledge',
);
const uncertainty = list(
  one(
    'SEMANTICS_NOT_VERIFIED',
    'CV_FACT_NOT_STATED',
    'DURATION_UNKNOWN',
    'CONFLICTING_CV_EVIDENCE',
    'AMBIGUOUS_JD_REQUIREMENT',
    'UNSUPPORTED_REQUIREMENT',
    'PRIORITY_UNKNOWN',
    'PRIORITY_CONFLICT',
    'CONTEXT_NOT_SUPPORTED',
    'POSSIBLE_REQUIREMENT_OVERLAP',
  ),
);
const score: Check = (v) =>
  number(v) && (v as number) >= 0 && (v as number) <= 100;
const stages = shape(
  Object.fromEntries(
    ['upload', 'cv', 'jd', 'matching'].map((key) => [
      key,
      one('NOT_RUN', 'SUCCEEDED', 'REJECTED', 'TIMED_OUT', 'FAILED'),
    ]),
  ),
);
const evidence = shape({
  document: one('cv', 'jd'),
  factPath: string,
  role: one('support', 'contradiction', 'context', 'priority'),
  reference: shape({
    segmentId: string,
    quote: string,
    start: count,
    end: count,
  }),
});
const requirement = shape({
  id: string,
  jdRequirementIndexes: list(count),
  originalTexts: list(string),
  category: nullable(category),
  canonicalTerm: nullable(string),
  predicate: one(
    'termPresence',
    'experiencePresence',
    'minimumDuration',
    'unsupported',
  ),
  minimumMonths: nullable(number),
  priority: one('required', 'preferred', 'unknown'),
  importanceWeight: one(1, 2),
  status: one('MATCHED', 'PARTIAL', 'MISSING_EVIDENCE', 'NOT_MATCHED'),
  evaluability: one('EVALUABLE', 'AMBIGUOUS_JD', 'UNSUPPORTED'),
  includedInScore: bool,
  credit: nullable(number),
  observedMonths: nullable(number),
  ruleIds: list(string),
  evidence: list(evidence),
  explanation: shape({
    code: one(
      'EXPLICIT_SUPPORT',
      'DURATION_BELOW_MINIMUM',
      'EXPLICIT_NEGATIVE',
      'NO_USABLE_CV_SUPPORT',
      'UNKNOWN_DURATION',
      'CONFLICTING_EVIDENCE',
      'REQUIREMENT_NOT_EVALUABLE',
    ),
    text: string,
    params: (v) =>
      record(v) && Object.values(v).every((x) => string(x) || number(x)),
  }),
  uncertainty,
});
const warning: Check = (v) =>
  record(v) &&
  (v.code === 'PAGE_WITHOUT_TEXT'
    ? count(v.page) && (v.page as number) > 0
    : one(
        'IMAGE_CONTENT_NOT_INTERPRETED',
        'PDF_RECOVERY_USED',
        'DOCX_CONTENT_WARNING',
        'EXTRACTION_COMPLETENESS_NOT_VERIFIED',
      )(v.code));
const result = shape({
  contractVersion: one('1'),
  policyVersion: one('matching-v1'),
  scoreMeaning: one('DOCUMENTED_REQUIREMENT_SUPPORT'),
  overallScore: nullable(score),
  scoreExplanation: nullable(string),
  categories: list(
    shape({
      category,
      configuredWeight: one(35, 25, 20, 10),
      effectiveWeight: number,
      score: nullable(score),
      earnedWeight: number,
      denominatorWeight: number,
      eligibleRequirementCount: count,
      excludedRequirementCount: count,
      missingEvidenceCount: count,
    }),
  ),
  requirements: list(requirement),
  coverage: shape({
    inputRequirementCount: count,
    canonicalRequirementCount: count,
    evaluableRequirementCount: count,
    excludedRequirementCount: count,
    unclassifiedRequirementCount: count,
    activeCategoryWeight: number,
    jdEvaluabilityRatio: nullable(number),
  }),
  extractionWarnings: list(shape({ document: one('cv', 'jd'), warning })),
  uncertainty,
  reviewRequired: one(true),
});
function diagnostic(v: unknown, code: unknown): boolean {
  if (v === null) return true;
  if (!record(v)) return false;
  if (code === 'INVALID_JSON')
    return (
      v.stage === 'AI_DECODE' &&
      v.rule === 'JSON_INVALID' &&
      v.field === 'output'
    );
  if (code === 'SCHEMA_VALIDATION_FAILURE')
    return (
      v.stage === 'AI_SCHEMA' &&
      v.rule === 'SCHEMA_MISMATCH' &&
      v.field === 'output'
    );
  return (
    typeof v.rule === 'string' &&
    Object.hasOwn(diagnosticRules, v.rule) &&
    diagnosticRules[v.rule] === v.stage &&
    (v.stage === 'OUTPUT'
      ? code === 'INVALID_OUTPUT'
      : code === 'INVALID_EVIDENCE') &&
    typeof v.field === 'string' &&
    diagnosticFields.includes(v.field)
  );
}
export function decodeAnalysis(value: unknown, ok: boolean): AnalysisResponse {
  const base = shape({
    contractVersion: one('1'),
    requestId: (v) =>
      typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        v,
      ),
    stages,
  });
  const document = nullable(
    shape({
      text: string,
      facts: nullable(list(shape({ path: string, value: nullable(string) }))),
    }),
  );
  const partialDocumentsValid = (documents: unknown): boolean =>
    record(documents) &&
    (['cv', 'jd'] as const).every((kind) => {
      const doc = documents[kind];
      return (
        doc === null ||
        (record(doc) &&
          (doc.partial === undefined ||
            (typeof doc.text === 'string' &&
              isPartialDocument(doc.partial, doc.text, kind, ERROR_CODES))))
      );
    });
  if (
    record(value) &&
    base(value) &&
    (value.documents === undefined ||
      (shape({ cv: document, jd: document })(value.documents) &&
        partialDocumentsValid(value.documents)))
  ) {
    if (
      ok &&
      value.outcome === 'PARTIAL' &&
      value.result === null &&
      value.error === null &&
      record(value.documents) &&
      record(value.documents.cv) &&
      record(value.documents.jd) &&
      value.documents.cv.partial !== undefined &&
      value.documents.jd.partial !== undefined &&
      value.documents.cv.facts === null &&
      value.documents.jd.facts === null &&
      record(value.stages) &&
      value.stages.upload === 'SUCCEEDED' &&
      value.stages.matching === 'NOT_RUN'
    )
      return value as unknown as AnalysisResponse;
    if (
      ok &&
      value.outcome === 'PARSED' &&
      value.result === null &&
      value.error === null &&
      record(value.documents) &&
      record(value.documents.cv) &&
      (value.documents.jd === null || record(value.documents.jd)) &&
      value.documents.cv.facts === null &&
      (value.documents.jd === null || value.documents.jd.facts === null) &&
      record(value.stages) &&
      value.stages.upload === 'SUCCEEDED' &&
      ['cv', 'jd', 'matching'].every(
        (key) => (value.stages as Record<string, unknown>)[key] === 'NOT_RUN',
      )
    )
      return value as unknown as AnalysisResponse;
    if (
      ok &&
      value.outcome === 'COMPLETED' &&
      value.error === null &&
      result(value.result) &&
      record(value.stages) &&
      Object.values(value.stages).every((v) => v === 'SUCCEEDED')
    )
      return value as unknown as AnalysisResponse;
    if (
      !ok &&
      value.outcome === 'INCOMPLETE' &&
      value.result === null &&
      shape({
        stage: one('REQUEST', 'CV', 'JD', 'MATCHING'),
        code: one(...ERROR_CODES),
      })(value.error) &&
      record(value.error) &&
      diagnostic(value.error.diagnostic, value.error.code)
    )
      return value as unknown as AnalysisResponse;
  }
  throw new AnalysisClientError('malformed');
}
export async function analyze(
  file: File,
  jdText: string,
  signal: AbortSignal,
  parseOnly = false,
): Promise<AnalysisResponse> {
  const body = new FormData();
  body.append('cv', file);
  body.append('jdText', jdText);
  let response: Response;
  try {
    response = await fetch(
      parseOnly
        ? '/api/v1/analyses?mode=parse-only'
        : '/api/v1/analyses?mode=partial',
      {
        method: 'POST',
        body,
        signal,
        cache: 'no-store',
        redirect: 'error',
      },
    );
  } catch {
    throw new AnalysisClientError('network');
  }
  try {
    return decodeAnalysis(await response.json(), response.ok);
  } catch {
    throw new AnalysisClientError('malformed');
  }
}
