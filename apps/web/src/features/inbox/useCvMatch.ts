import { tr } from '../../app/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COVERAGE_HIDDEN_REASONS,
  type EvidenceReview,
  type MatchResult,
  type SkillMatch,
} from './cv-match.types';
import { validSourceDate } from './cv-suggestions.contract';
import { importUpload, opportunityRequest } from './opportunities-api';

export interface SavedCv {
  id: string;
  name: string;
  fileName: string;
  isDefault: boolean;
  updatedAt: string;
  /** Original upload size; absent for CVs saved before originals were kept. */
  fileSize?: number | null;
  originalAvailable?: boolean;
}

/**
 * Shared CV Match state for Job Detail and Tailored CV. Saved matches are
 * persisted server-side and never expire by time; `matchValidForMs` is only a
 * recheck interval. Status changes (STALE_CV, STALE_JOB, EXPIRED = matching
 * policy changed) come from the server. Analysis runs only on explicit request.
 */
export function useCvMatch(
  jobId: string,
  revision: string,
  jobUpdatedAt?: string,
) {
  const [cvLoaded, setCvLoaded] = useState(false);
  const [matchStatus, setMatchStatus] = useState(
    jobUpdatedAt ? 'CHECKING' : 'MISSING',
  );
  const [matchReadError, setMatchReadError] = useState('');
  const [matchReload, setMatchReload] = useState(0);
  const matchIdentity = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  // P7 suggestion invalidation only. P8 uses its own authoritative preflight.
  const [contextRejected, setContextRejected] = useState(false);
  const rejectContext = useCallback(() => setContextRejected(true), []);
  const [cv, setCv] = useState<SavedCv | null>(null);
  const [cvs, setCvs] = useState<SavedCv[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [sourceSkillMatch, setSourceSkillMatch] = useState<SkillMatch>();
  const [result, setResult] = useState<MatchResult | null>(null);
  /** CV whose Source CV Review must be completed before matching. */
  const [reviewCvId, setReviewCvId] = useState('');
  const [source, setSource] = useState({ jobId, revision });
  if (source.jobId !== jobId || source.revision !== revision) {
    setSource({ jobId, revision });
    setResult(null);
    setSourceSkillMatch(undefined);
    setBusy(false);
    setContextRejected(false);
  }
  useEffect(() => {
    const invalidateRequests = () => {
      generation.current++;
    };
    invalidateRequests();
    return invalidateRequests;
  }, [jobId, revision]);
  useEffect(() => {
    let active = true;
    // This job's CV (its own selection, else the CV its match used, else the default).
    opportunityRequest<SavedCv | null>(`/${jobId}/cv/current`).then(
      (row) => {
        if (active) {
          setCv(row);
          setCvLoaded(true);
        }
      },
      () => {
        if (active) {
          setCvLoaded(true);
          setError(tr('Could not load saved CV. Check the local API.'));
        }
      },
    );
    // The picker list is optional; matching works without it.
    opportunityRequest<unknown>('/cv').then(
      (list) => {
        if (active) setCvs(Array.isArray(list) ? (list as SavedCv[]) : []);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [jobId]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Restore only after the view has loaded its saved job revision.
    if (busy || !cvLoaded || !jobUpdatedAt) return;
    const request = generation.current;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      // Background revalidation retains the last known presentation until
      // the server supplies a new status, rather than showing initial loading.
      setMatchReadError('');
      try {
        const value = await opportunityRequest<unknown>(`/${jobId}/match`);
        if (cancelled || request !== generation.current) return;
        if (!value || typeof value !== 'object' || !('status' in value))
          throw Error();
        if (value.status === 'VALID') {
          if (
            !('result' in value) ||
            !isMatchResult(value.result) ||
            !value.result.matchId ||
            value.result.cvUpdatedAt !== cv?.updatedAt ||
            value.result.jobUpdatedAt !== jobUpdatedAt ||
            !validSourceDate(value.result.analyzedAt) ||
            !('matchValidForMs' in value) ||
            typeof value.matchValidForMs !== 'number' ||
            value.matchValidForMs <= 0 ||
            value.matchValidForMs > 900000
          )
            throw Error();
          setResult(value.result);
          setSourceSkillMatch(undefined);
          if (matchIdentity.current !== value.result.matchId)
            setContextRejected(false);
          matchIdentity.current = value.result.matchId;
          setMatchStatus('VALID');
          timer = setTimeout(
            () => setMatchReload((n) => n + 1),
            value.matchValidForMs,
          );
        } else if (
          typeof value.status === 'string' &&
          Object.hasOwn(matchStatusMessages, value.status)
        ) {
          if (value.status === 'CV_REVIEW_REQUIRED') {
            if (
              !('cvId' in value) ||
              typeof value.cvId !== 'string' ||
              !/^[0-9a-f-]{36}$/iu.test(value.cvId)
            )
              throw Error();
            setReviewCvId(value.cvId);
          }
          if ('skillMatch' in value) {
            if (
              !('cvUpdatedAt' in value) ||
              value.cvUpdatedAt !== cv?.updatedAt ||
              !validSkillMatch(value.skillMatch)
            )
              throw Error();
            setSourceSkillMatch(value.skillMatch);
          } else setSourceSkillMatch(undefined);
          setMatchStatus(value.status);
          setContextRejected(true);
        } else throw Error();
      } catch {
        if (!cancelled && request === generation.current) {
          setMatchStatus('ERROR');
          setSourceSkillMatch(undefined);
          setMatchReadError(
            tr(
              'Could not load the current CV Match. Retry loading it; analysis is never started automatically.',
            ),
          );
        }
      }
    });
    const focus = () => setMatchReload((n) => n + 1);
    window.addEventListener('focus', focus);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener('focus', focus);
    };
  }, [jobId, jobUpdatedAt, cv?.updatedAt, cvLoaded, busy, matchReload]);
  /** Re-read the saved match from the server; never starts analysis. */
  const reload = useCallback((showChecking = false) => {
    if (showChecking) setMatchStatus('CHECKING');
    setMatchReload((n) => n + 1);
  }, []);
  /** Saves a CV for this job; resolves to its id so the caller can open its review. */
  async function upload(file: File): Promise<string | null> {
    const request = ++generation.current;
    setAttempt((value) => value + 1);
    setBusy(true);
    setError('');
    try {
      // Adds a CV and selects it for this job only; other jobs keep theirs.
      const added = await opportunityRequest<SavedCv>('/cv', {
        method: 'POST',
        body: importUpload({}, file),
      });
      const saved = await opportunityRequest<SavedCv>(`/${jobId}/cv/current`, {
        method: 'PUT',
        body: JSON.stringify({ cvId: added.id }),
      });
      if (request === generation.current) {
        setCvs((list) => [...list, added]);
        setCv(saved);
        setResult(null);
        setSourceSkillMatch(undefined);
        // A new CV always starts with its Source CV Review.
        setReviewCvId(added.id);
        setMatchStatus('CV_REVIEW_REQUIRED');
        return added.id;
      }
    } catch (error) {
      if (request === generation.current)
        setError(
          error instanceof Error ? tr(error.message) : tr('CV upload failed.'),
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
    return null;
  }
  /** Uses another saved CV for this job; the saved match is rechecked, never re-run. */
  async function select(cvId: string) {
    const request = ++generation.current;
    setAttempt((value) => value + 1);
    setBusy(true);
    setError('');
    try {
      const saved = await opportunityRequest<SavedCv>(`/${jobId}/cv/current`, {
        method: 'PUT',
        body: JSON.stringify({ cvId }),
      });
      if (request === generation.current) {
        setCv(saved);
        setResult(null);
        setSourceSkillMatch(undefined);
        setMatchStatus('CHECKING');
      }
    } catch (error) {
      if (request === generation.current)
        setError(
          error instanceof Error
            ? error.message
            : tr('Could not change the CV.'),
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function analyze() {
    setContextRejected(true);
    const request = ++generation.current;
    setAttempt((value) => value + 1);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/opportunities/${jobId}/match`, {
        method: 'POST',
      }).catch(() => {
        throw new Error(
          tr(
            'Could not reach the local matching API. Check the local API and retry. No new assessment was saved.',
          ),
        );
      });
      const value: unknown = await response.json().catch(() => {
        throw new Error(
          tr(
            'The local API returned unreadable matching output. Retry. No new assessment was saved.',
          ),
        );
      });
      if (!response.ok) {
        const code =
          value && typeof value === 'object' && 'errorCode' in value
            ? value.errorCode
            : null;
        throw new Error(
          typeof code === 'string' && analyzeErrors[code]
            ? analyzeErrors[code]
            : tr(
                'CV matching failed. Check your saved CV, saved job requirements and the AI service, then retry.',
              ),
        );
      }
      if (!isMatchResult(value))
        throw new Error(
          tr(
            'The API returned an invalid matching result. Retry. No new assessment was saved.',
          ),
        );
      if (request === generation.current) {
        setResult(value);
        setSourceSkillMatch(undefined);
        matchIdentity.current = value.matchId;
        setMatchStatus('VALID');
        setContextRejected(false);
      }
    } catch (error) {
      if (request === generation.current)
        setError(
          error instanceof Error
            ? error.message
            : tr('CV matching failed. Check the local API and retry.'),
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return {
    jobId,
    cv,
    cvs,
    cvLoaded,
    busy,
    error,
    result,
    skillMatch: matchStatus === 'VALID' ? result?.skillMatch : sourceSkillMatch,
    matchStatus,
    reviewCvId,
    matchReadError,
    /** Increments on each upload/analysis attempt (P7 suggestion reset key). */
    attempt,
    contextRejected,
    rejectContext,
    reload,
    upload,
    select,
    analyze,
  };
}
export type CvMatchState = ReturnType<typeof useCvMatch>;

export const matchStatusMessages: Record<string, string> = {
  get MISSING() {
    return tr('Not analyzed yet. Analyze CV Match to continue.');
  },
  get EXPIRED() {
    return tr(
      'Outdated. Matching rules were updated since this analysis. Re-analyze CV Match; your source review and drafts are retained.',
    );
  },
  get STALE_CV() {
    return tr(
      'Outdated. This job now uses a different CV than the saved match. Re-analyze CV Match with the selected CV.',
    );
  },
  get STALE_JOB() {
    return tr(
      'Outdated. The job changed since the saved match. Re-analyze CV Match with the current job requirements.',
    );
  },
  get CV_UNAVAILABLE() {
    return tr(
      'Save a source CV before analyzing CV Match. Existing drafts can still be resumed.',
    );
  },
  get CV_REVIEW_REQUIRED() {
    return tr(
      'Review this CV before matching. CV Match uses only the details you confirm in Source CV Review; saved review progress is kept.',
    );
  },
};
/** Opens the review of the job's CV and returns to this job's Match tab. */
export const reviewHref = (cvId: string, jobId: string) =>
  `/cv/${cvId}/review?returnTo=${encodeURIComponent(`/jobs/${jobId}/match`)}`;
const analyzeErrors: Record<string, string> = {
  get CV_MATCH_REVIEW_REQUIRED() {
    return tr(
      'Complete the Source CV Review for this CV before analyzing. CV Match uses only reviewed CV details.',
    );
  },
  get CV_MATCH_CV_UNAVAILABLE() {
    return tr(
      'Saved CV text is missing or empty. Save a readable CV again before analyzing.',
    );
  },
  get CV_MATCH_TIMEOUT() {
    return tr(
      'Matching timed out. Check the AI service and retry. No new assessment was saved.',
    );
  },
  get CV_MATCH_INVALID_OUTPUT() {
    return tr(
      'The AI model returned invalid matching output. Retry. No new assessment was saved.',
    );
  },
  get CV_MATCH_INCOMPLETE() {
    return tr(
      'The AI model returned an incomplete assessment. Retry. No new assessment was saved.',
    );
  },
  get CV_MATCH_EVIDENCE_REJECTED() {
    return tr(
      'The AI cited CV text that could not be verified, so your saved assessment is unchanged. Retry; results can differ between attempts.',
    );
  },
  get CV_MATCH_OUTPUT_LIMIT() {
    return tr(
      "AI couldn't complete this match within the response limit. Your previous result is unchanged. Please try again.",
    );
  },
  get CV_MATCH_PROVIDER_BUSY() {
    return tr(
      'The AI service is temporarily busy. Your saved match is unchanged. Try again in a few minutes.',
    );
  },
};

function validCoverage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as NonNullable<
    MatchResult['requirements'][number]['coverage']
  >;
  return (
    ['SINGLE', 'AND', 'OR', 'UNKNOWN'].includes(row.mode) &&
    typeof row.reason === 'string' &&
    typeof row.credit === 'number' &&
    row.credit >= 0 &&
    row.credit <= 1 &&
    Array.isArray(row.components) &&
    row.components.length > 0 &&
    row.components.every(
      (component) =>
        component &&
        typeof component.id === 'string' &&
        typeof component.label === 'string' &&
        typeof component.jdQuote === 'string' &&
        typeof component.cvQuote === 'string' &&
        [
          'EVIDENCED',
          'PARTIAL',
          'NOT_EVIDENCED',
          'CONFLICT',
          'UNDECOMPOSED',
        ].includes(component.status) &&
        (!['EVIDENCED', 'PARTIAL'].includes(component.status) ||
          component.cvQuote.trim()) &&
        (component.observations === undefined ||
          (Array.isArray(component.observations) &&
            component.observations.length <= 2 &&
            component.observations.every(
              (observation) =>
                observation &&
                ['mention', 'experience'].includes(observation.kind) &&
                typeof observation.cvQuote === 'string' &&
                !!observation.cvQuote.trim(),
            ))) &&
        (component.qualificationReason === undefined ||
          typeof component.qualificationReason === 'string') &&
        Array.isArray(component.conflictingQuotes) &&
        component.conflictingQuotes.every((quote) => typeof quote === 'string'),
    )
  );
}

// Guidance is optional (older saved matches); when present it must be intact.
function validGuidance(value: unknown): boolean {
  const row = value as MatchResult['guidance'];
  return (
    !!row &&
    ['WORTH_APPLYING', 'CONSIDER_CAREFULLY', 'STRETCH_OPPORTUNITY'].includes(
      row.recommendation,
    ) &&
    ['NORMAL', 'LOW'].includes(row.confidence) &&
    !!row.core &&
    typeof row.core.withEvidence === 'number' &&
    typeof row.core.evaluated === 'number' &&
    Array.isArray(row.actions) &&
    row.actions.length <= 3 &&
    row.actions.every(
      (action) =>
        action &&
        typeof action.code === 'string' &&
        typeof action.label === 'string',
    )
  );
}

function validConditions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (condition: NonNullable<MatchResult['conditions']>[number]) =>
        condition &&
        (condition.parentId === undefined ||
          typeof condition.parentId === 'string') &&
        (condition.componentId === undefined ||
          typeof condition.componentId === 'string') &&
        ['SINGLE', 'AND', 'OR', 'UNKNOWN'].includes(condition.mode) &&
        [
          'LANGUAGE',
          'LANGUAGE_CERTIFICATE',
          'EXPERIENCE',
          'EDUCATION',
          'CERTIFICATION',
        ].includes(condition.kind) &&
        ['MET', 'UNKNOWN', 'NOT_MET'].includes(condition.status) &&
        typeof condition.jdQuote === 'string' &&
        !!condition.jdQuote.trim() &&
        Array.isArray(condition.evidence) &&
        (condition.status === 'UNKNOWN' || condition.evidence.length > 0) &&
        condition.evidence.every(
          (item) =>
            item &&
            typeof item.cvQuote === 'string' &&
            !!item.cvQuote.trim() &&
            Number.isSafeInteger(item.start) &&
            Number.isSafeInteger(item.end) &&
            item.start >= 0 &&
            item.end - item.start === item.cvQuote.length &&
            (item.cvOrigin === undefined ||
              item.cvOrigin === 'source' ||
              item.cvOrigin === 'user_entered'),
        ),
    )
  );
}

function validSkillMatch(value: unknown): value is SkillMatch {
  if (!value || typeof value !== 'object') return false;
  const match = value as SkillMatch;
  return (
    match.version === 1 &&
    (match.findings === undefined ||
      (Array.isArray(match.findings) &&
        match.findings.every(
          (f) =>
            f &&
            ['skill', 'related', 'clause', 'requirement'].includes(f.kind) &&
            typeof f.label === 'string' &&
            Array.isArray(f.sources) &&
            f.sources.length > 0 &&
            f.sources.every(
              (s) =>
                s &&
                typeof s.quote === 'string' &&
                Number.isSafeInteger(s.start) &&
                s.end - s.start === s.quote.length,
            ) &&
            (['skill', 'related'].includes(f.kind)
              ? typeof f.evidence?.quote === 'string' &&
                ['source', 'user_entered'].includes(f.evidence.origin)
              : f.evidence === null),
        ))) &&
    (match.fieldConflict === undefined ||
      typeof match.fieldConflict === 'boolean') &&
    (match.partialScore == null ||
      (match.limitation === 'INCOMPLETE_INVENTORY' &&
        match.totalCount > 0 &&
        Array.isArray(match.unresolved) &&
        Number.isFinite(match.partialScore) &&
        match.partialScore >= 0 &&
        match.partialScore <= 100)) &&
    Number.isSafeInteger(match.totalCount) &&
    Number.isSafeInteger(match.matchedCount) &&
    match.matchedCount >= 0 &&
    match.matchedCount <= match.totalCount &&
    (match.unresolved === undefined ||
      (Array.isArray(match.unresolved) &&
        match.unresolved.every((item) => typeof item === 'string'))) &&
    (match.limitation === null
      ? Number.isFinite(match.score) && match.score! >= 0 && match.score! <= 100
      : match.score === null &&
        ['INCOMPLETE_INVENTORY', 'NO_SKILLS'].includes(match.limitation)) &&
    Array.isArray(match.rows) &&
    match.rows.length === match.totalCount &&
    match.rows.every(
      (row) =>
        row &&
        ['required', 'preferred'].includes(row.priority) &&
        typeof row.source?.quote === 'string' &&
        Array.isArray(row.skills) &&
        row.skills.length > 0 &&
        row.skills.every(
          (skill: SkillMatch['rows'][number]['skills'][number]) =>
            skill &&
            typeof skill.name === 'string' &&
            (skill.evidence === null ||
              (typeof skill.evidence?.quote === 'string' &&
                ['source', 'user_entered'].includes(skill.evidence.origin))),
        ),
    )
  );
}

function validEvidenceReview(
  value: EvidenceReview,
  jobUpdatedAt?: string,
): boolean {
  const rawFields = ['jdText', 'description', 'postText'];
  const savedFields = ['skills', 'preferredSkills', 'experience', 'domain'];
  const validSpan = ({
    quote,
    start,
    end,
  }: {
    quote: string;
    start: number;
    end: number;
  }) =>
    typeof quote === 'string' &&
    !!quote.trim() &&
    Number.isSafeInteger(start) &&
    start >= 0 &&
    Number.isSafeInteger(end) &&
    end - start === quote.length;
  return Boolean(
    value &&
    value.version === 1 &&
    validSourceDate(value.jobRevision) &&
    (!jobUpdatedAt ||
      Date.parse(value.jobRevision) === Date.parse(jobUpdatedAt)) &&
    typeof value.profileRevisionId === 'string' &&
    value.profileRevisionId &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) =>
        source &&
        rawFields.includes(source.field) &&
        typeof source.text === 'string',
    ) &&
    Array.isArray(value.rows) &&
    value.rows.every(
      (row) =>
        row &&
        validSpan(row) &&
        (savedFields.includes(row.field)
          ? row.status === 'NEEDS_REVIEW' && row.reason === 'SAVED_FIELD'
          : value.sources.some(
              ({ field, text }) =>
                field === row.field &&
                text.slice(row.start, row.end) === row.quote,
            )) &&
        [
          'VERIFIED_EVIDENCE',
          'PARTIAL_EVIDENCE',
          'NO_DOCUMENTED_EVIDENCE',
          'NEEDS_REVIEW',
        ].includes(row.status) &&
        [
          'DECLARED',
          'MISSING',
          'LIMITED',
          'SCOPE',
          'WORK_CONTEXT',
          'TEAM_DEPLOYMENT',
          'PRODUCTION_SCOPE',
          'PROFICIENCY',
          'SOURCE',
          'SAVED_FIELD',
          'VERIFY',
        ].includes(row.reason) &&
        Array.isArray(row.missing) &&
        row.missing.every((item) => typeof item === 'string') &&
        Array.isArray(row.evidence) &&
        row.evidence.every(
          (ref) =>
            ref &&
            validSpan(ref) &&
            typeof ref.entryId === 'string' &&
            !!ref.entryId &&
            ['source', 'user_entered'].includes(ref.origin) &&
            ['declaration', 'review', 'context'].includes(ref.kind),
        ) &&
        (row.status !== 'VERIFIED_EVIDENCE' ||
          row.evidence.some(({ kind }) => kind === 'declaration')),
    ),
  );
}

export function isMatchResult(value: unknown): value is MatchResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<MatchResult>;
  return (
    (row.matchId === undefined ||
      (typeof row.matchId === 'string' &&
        /^[A-Za-z0-9_-]{1,100}$/u.test(row.matchId))) &&
    (row.cvUpdatedAt === undefined || validSourceDate(row.cvUpdatedAt)) &&
    (row.jobUpdatedAt === undefined || validSourceDate(row.jobUpdatedAt)) &&
    (row.score === null ||
      (typeof row.score === 'number' &&
        Number.isInteger(row.score) &&
        row.score >= 0 &&
        row.score <= 100)) &&
    (row.coverageHidden === undefined ||
      (row.coverageHidden === null
        ? row.score !== null
        : row.score === null &&
          COVERAGE_HIDDEN_REASONS.includes(row.coverageHidden))) &&
    ['Apply', 'Consider', 'Low Fit', 'Review requirements'].includes(
      row.recommendation ?? '',
    ) &&
    typeof row.explanation === 'string' &&
    typeof row.advice === 'string' &&
    (row.guidance == null || validGuidance(row.guidance)) &&
    (row.conditions === undefined || validConditions(row.conditions)) &&
    (row.evidenceReview === undefined ||
      validEvidenceReview(row.evidenceReview, row.jobUpdatedAt)) &&
    (row.skillMatch === undefined || validSkillMatch(row.skillMatch)) &&
    Array.isArray(row.requirements) &&
    row.requirements.length > 0 &&
    row.requirements.every(
      (item) =>
        item &&
        (item.parentId === undefined || typeof item.parentId === 'string') &&
        typeof item.requirement === 'string' &&
        typeof item.jdQuote === 'string' &&
        item.jdQuote.trim() &&
        typeof item.cvQuote === 'string' &&
        ['required', 'preferred'].includes(item.priority) &&
        ['skill', 'experience', 'domain'].includes(item.category) &&
        [
          'EVIDENCED',
          'PARTIAL',
          'NOT_EVIDENCED',
          'CONFLICT',
          'UNDECOMPOSED',
        ].includes(item.status) &&
        (item.status !== 'EVIDENCED' || item.cvQuote.trim()) &&
        (item.coverage === undefined || validCoverage(item.coverage)) &&
        (!['PARTIAL', 'CONFLICT'].includes(item.status) ||
          item.coverage !== undefined),
    )
  );
}
