import { tr } from '../../app/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type MatchResult } from './cv-match.types';
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
  const [result, setResult] = useState<MatchResult | null>(null);
  const [source, setSource] = useState({ jobId, revision });
  if (source.jobId !== jobId || source.revision !== revision) {
    setSource({ jobId, revision });
    setResult(null);
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
          setMatchStatus(value.status);
          setContextRejected(true);
        } else throw Error();
      } catch {
        if (!cancelled && request === generation.current) {
          setMatchStatus('ERROR');
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
  async function upload(file: File) {
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
        setMatchStatus('STALE_CV');
      }
    } catch (error) {
      if (request === generation.current)
        setError(
          error instanceof Error ? tr(error.message) : tr('CV upload failed.'),
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
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
            'Could not reach the local matching API. Check the local API and retry; no new fit score was produced.',
          ),
        );
      });
      const value: unknown = await response.json().catch(() => {
        throw new Error(
          tr(
            'The local API returned unreadable matching output. Retry; no new fit score was produced.',
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
            'The API returned an invalid matching result. Retry; no new fit score was produced.',
          ),
        );
      if (request === generation.current) {
        setResult(value);
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
    cv,
    cvs,
    cvLoaded,
    busy,
    error,
    result,
    matchStatus,
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
};
const analyzeErrors: Record<string, string> = {
  get CV_MATCH_CV_UNAVAILABLE() {
    return tr(
      'Saved CV text is missing or empty. Save a readable CV again before analyzing.',
    );
  },
  get CV_MATCH_TIMEOUT() {
    return tr(
      'Matching timed out. Check the AI service and retry; no new fit score was produced.',
    );
  },
  get CV_MATCH_INVALID_OUTPUT() {
    return tr(
      'The AI model returned invalid matching output. Retry; no new fit score was produced.',
    );
  },
  get CV_MATCH_INCOMPLETE() {
    return tr(
      'The AI model returned an incomplete assessment. Retry; no new fit score was produced.',
    );
  },
  get CV_MATCH_EVIDENCE_REJECTED() {
    return tr(
      'The AI cited CV text that could not be verified, so no new fit score was produced. Your saved match is unchanged. Retry; results can differ between attempts.',
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
        ['EVIDENCED', 'PARTIAL', 'NOT_EVIDENCED', 'CONFLICT'].includes(
          component.status,
        ) &&
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
    ['Apply', 'Consider', 'Low Fit', 'Review requirements'].includes(
      row.recommendation ?? '',
    ) &&
    typeof row.explanation === 'string' &&
    typeof row.advice === 'string' &&
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
        ['EVIDENCED', 'PARTIAL', 'NOT_EVIDENCED', 'CONFLICT'].includes(
          item.status,
        ) &&
        (item.status !== 'EVIDENCED' || item.cvQuote.trim()) &&
        (item.coverage === undefined || validCoverage(item.coverage)) &&
        (!['PARTIAL', 'CONFLICT'].includes(item.status) ||
          item.coverage !== undefined),
    )
  );
}
