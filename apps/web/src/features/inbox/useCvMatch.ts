import { useCallback, useEffect, useRef, useState } from 'react';
import { type MatchResult } from './cv-match.types';
import { validSourceDate } from './cv-suggestions.contract';
import { importUpload, opportunityRequest } from './opportunities-api';

export interface SavedCv {
  fileName: string;
  updatedAt: string;
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
    opportunityRequest<SavedCv | null>('/cv/current').then(
      (row) => {
        if (active) {
          setCv(row);
          setCvLoaded(true);
        }
      },
      () => {
        if (active) {
          setCvLoaded(true);
          setError('Could not load saved CV. Check the local API.');
        }
      },
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
            'Could not load the current CV Match. Retry loading it; analysis is never started automatically.',
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
      const saved = await opportunityRequest<SavedCv>('/cv/current', {
        method: 'POST',
        body: importUpload({}, file),
      });
      if (request === generation.current) {
        setCv(saved);
        setResult(null);
        setMatchStatus('STALE_CV');
      }
    } catch (error) {
      if (request === generation.current)
        setError(error instanceof Error ? error.message : 'CV upload failed.');
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
          'Could not reach the local matching API. Check the local API and retry; no new fit score was produced.',
        );
      });
      const value: unknown = await response.json().catch(() => {
        throw new Error(
          'The local API returned unreadable matching output. Retry; no new fit score was produced.',
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
            : 'CV matching failed. Check your saved CV, saved job requirements and local Ollama service, then retry.',
        );
      }
      if (!isMatchResult(value))
        throw new Error(
          'The API returned an invalid matching result. Retry; no new fit score was produced.',
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
            : 'CV matching failed. Check the local API and retry.',
        );
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return {
    cv,
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
    analyze,
  };
}
export type CvMatchState = ReturnType<typeof useCvMatch>;

export const matchStatusMessages: Record<string, string> = {
  MISSING: 'Not analyzed yet. Analyze CV Match to continue.',
  EXPIRED:
    'Matching rules were updated since this analysis. Re-analyze CV Match; your source review and drafts are retained.',
  STALE_CV:
    'Your CV changed since the saved match. Re-analyze CV Match with the current CV.',
  STALE_JOB:
    'The job changed since the saved match. Re-analyze CV Match with the current job requirements.',
  CV_UNAVAILABLE:
    'Save a source CV before analyzing CV Match. Existing drafts can still be resumed.',
};
const analyzeErrors: Record<string, string> = {
  CV_MATCH_CV_UNAVAILABLE:
    'Saved CV text is missing or empty. Save a readable CV again before analyzing.',
  CV_MATCH_TIMEOUT:
    'Local matching timed out. Check Ollama and retry; no new fit score was produced.',
  CV_MATCH_INVALID_OUTPUT:
    'Local model returned invalid matching output. Retry; no new fit score was produced.',
  CV_MATCH_INCOMPLETE:
    'Local model returned an incomplete assessment. Retry; no new fit score was produced.',
  CV_MATCH_EVIDENCE_REJECTED:
    'Evidence could not be verified against the saved sources. Retry; no new fit score was produced.',
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
    ['Apply', 'Consider', 'Low Fit'].includes(row.recommendation ?? '') &&
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
