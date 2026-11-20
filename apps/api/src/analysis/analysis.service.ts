import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { missingPartial } from '../extraction/partial-extraction.js';
import { createExtractionSource } from '../extraction/extraction.validation.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { EXTRACTION_LIMITS } from '../extraction/extraction.limits.js';
import type { ExtractionResult } from '../extraction/extraction.types.js';
import type { AiSettings } from '../ai/ai.config.js';
import { readAnalysisUpload, UPLOAD_LIMITS } from './analysis-upload.js';
import type { AnalysisUpload } from './analysis-upload.js';
import {
  AnalysisError,
  analysisError,
  ANALYSIS_HTTP_STATUS,
} from './analysis.errors.js';
import { sendAnalysisError } from './analysis-http.js';
import type { AnalysisRequest } from './analysis-http.js';
import type {
  AnalysisDocumentsDto,
  AnalysisErrorDto,
  AnalysisResponseDto,
  StageSummary,
} from './analysis.contracts.js';
import { withPdfParserDiagnosticRequest } from '../extraction/pdf-parser.diagnostics.js';
import { withAiGenerationDiagnosticRequest } from '../ai/ai-generation.diagnostics.js';

export const PARTIAL_ANALYSIS_MAX_MS = 180_000;
export const ANALYSIS_TIMING = Symbol('ANALYSIS_TIMING');
export interface AnalysisTiming {
  readonly uploadMs: number;
  readonly analysisMs: number;
}
export function analysisTiming(config: AiSettings): AnalysisTiming {
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 1000 ||
    config.timeoutMs > 300000
  )
    throw new AnalysisError('ANALYSIS_UNAVAILABLE');
  return {
    uploadMs: UPLOAD_LIMITS.uploadMs,
    analysisMs:
      2 * config.timeoutMs +
      UPLOAD_LIMITS.uploadMs +
      EXTRACTION_LIMITS.parserTimeoutMs +
      EXTRACTION_LIMITS.parserTerminationMs +
      5000,
  };
}
interface Ownership {
  req: AnalysisRequest;
  res: ServerResponse;
  stage: keyof StageSummary;
  terminal: boolean;
  started: boolean;
  released: boolean;
  expires: number;
  uploadExpires: number;
  abort: AbortController;
  uploadTimer: ReturnType<typeof setTimeout>;
  analysisTimer: ReturnType<typeof setTimeout>;
  disconnected: () => void;
  done: Promise<void>;
  finish: () => void;
}
const errorStage = (stage: keyof StageSummary): AnalysisErrorDto['stage'] =>
  stage === 'upload'
    ? 'REQUEST'
    : stage === 'cv'
      ? 'CV'
      : stage === 'jd'
        ? 'JD'
        : 'MATCHING';

function visibleFacts(
  data: unknown,
  path = '',
): { path: string; value: string | null }[] {
  if (!data || typeof data !== 'object') return [];
  if (
    'value' in data &&
    (typeof data.value === 'string' || data.value === null)
  )
    return [{ path, value: data.value }];
  return Object.entries(data).flatMap(([key, child]) =>
    visibleFacts(child, path ? `${path}.${key}` : key),
  );
}
function documentResult(result: ExtractionResult) {
  return { text: result.source.text, facts: visibleFacts(result.data) };
}

@Injectable()
export class AnalysisService implements OnModuleDestroy {
  private active: Ownership | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly extraction: ExtractionService,
    private readonly matching: MatchingService,
    @Inject(ANALYSIS_TIMING) private readonly timing: AnalysisTiming,
  ) {
    extraction.coordinateShutdown(() => this.shutdown());
  }

  // Called synchronously by the security middleware, before any body consumer.
  admit(req: AnalysisRequest, res: ServerResponse): void {
    if (this.closed) throw new AnalysisError('ANALYSIS_UNAVAILABLE');
    if (this.active) throw new AnalysisError('ANALYSIS_BUSY');
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const now = performance.now();
    const analysisMs = req.analysis?.partialOnly
      ? Math.min(this.timing.analysisMs, PARTIAL_ANALYSIS_MAX_MS)
      : this.timing.analysisMs;
    const owner: Ownership = {
      req,
      res,
      stage: 'upload',
      terminal: false,
      started: false,
      released: false,
      expires: now + analysisMs,
      uploadExpires: now + this.timing.uploadMs,
      abort: new AbortController(),
      done,
      finish,
      disconnected: () => this.terminate(owner, undefined),
      uploadTimer: setTimeout(
        () => this.terminate(owner, new AnalysisError('UPLOAD_TIMEOUT')),
        this.timing.uploadMs,
      ),
      analysisTimer: setTimeout(
        () => this.terminate(owner, new AnalysisError('ANALYSIS_TIMEOUT')),
        analysisMs,
      ),
    };
    owner.uploadTimer.unref();
    owner.analysisTimer.unref();
    this.active = owner;
    req.once('aborted', owner.disconnected);
    res.once('close', owner.disconnected);
  }

  async run(req: AnalysisRequest, res: ServerResponse): Promise<void> {
    const owner = this.active;
    if (!owner || owner.req !== req || owner.terminal || owner.started) return;
    owner.started = true;
    try {
      if (!this.live(owner)) return;
      let upload: AnalysisUpload | undefined = await readAnalysisUpload(
        req,
        Math.max(1, owner.uploadExpires - performance.now()),
        owner.abort.signal,
        req.analysis!.cvOnly,
      );
      if (!this.live(owner)) return;
      clearTimeout(owner.uploadTimer);
      req.analysis!.stages.upload = 'SUCCEEDED';
      const documents: AnalysisDocumentsDto = {
        cv: null,
        jd: req.analysis!.cvOnly ? null : { text: upload.jdText, facts: null },
      };
      req.analysis!.documents = documents;
      owner.stage = 'cv';
      if (req.analysis!.partialOnly) {
        const cvSource = await this.extraction.parseCv(upload.cv);
        if (!this.live(owner)) return;
        documents.cv = {
          text: cvSource.text,
          facts: null,
          partial: missingPartial('cv'),
        };
        const jdSource = createExtractionSource({
          format: 'text',
          text: upload.jdText,
          segments: [
            { id: 'jd-1', start: 0, end: upload.jdText.length, page: null },
          ],
        });
        documents.jd!.partial = missingPartial('jd');
        upload = undefined;
        for (const [kind, source] of [
          ['cv', cvSource],
          ['jd', jdSource],
        ] as const) {
          if (!this.live(owner)) return;
          owner.stage = kind;
          const document = documents[kind]!;
          try {
            const partial = await this.extraction.extractPartial(kind, source, {
              signal: owner.abort.signal,
              deadline: owner.expires,
            });
            if (!this.live(owner)) return;
            document.partial = partial;
            req.analysis!.stages[kind] = partial.rejectedCandidateCount
              ? 'REJECTED'
              : 'SUCCEEDED';
          } catch (error: unknown) {
            if (!this.live(owner)) return;
            const safe = analysisError(error, kind === 'cv' ? 'CV' : 'JD');
            document.partial = missingPartial(kind, safe.code);
            req.analysis!.stages[kind] =
              ANALYSIS_HTTP_STATUS[safe.code] === 504 ? 'TIMED_OUT' : 'FAILED';
          }
        }
        // Partial documents never enter MatchingService, including all-VALID results.
        if (!this.live(owner)) return;
        owner.terminal = true;
        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            contractVersion: '1',
            requestId: req.analysis!.requestId,
            outcome: 'PARTIAL',
            stages: req.analysis!.stages,
            documents,
            result: null,
            error: null,
          } satisfies AnalysisResponseDto),
        );
        return;
      }
      if (req.analysis!.parseOnly) {
        const source = await this.extraction.parseCv(upload.cv);
        if (!this.live(owner)) return;
        documents.cv = { text: source.text, facts: null };
        owner.terminal = true;
        res.statusCode = 200;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            contractVersion: '1',
            requestId: req.analysis!.requestId,
            outcome: 'PARSED',
            stages: req.analysis!.stages,
            documents,
            result: null,
            error: null,
          } satisfies AnalysisResponseDto),
        );
        return;
      }
      const cvUpload = upload.cv;
      const cv = await withAiGenerationDiagnosticRequest(
        req.analysis!.requestId,
        'CV',
        () =>
          withPdfParserDiagnosticRequest(req.analysis!.requestId, () =>
            this.extraction.extractCv(cvUpload, (source) => {
              if (!owner.terminal)
                documents.cv = { text: source.text, facts: null };
            }),
          ),
      );
      if (!this.live(owner)) return;
      documents.cv = documentResult(cv);
      req.analysis!.stages.cv = 'SUCCEEDED';
      owner.stage = 'jd';
      const text = upload.jdText;
      // Do not retain the upload buffer throughout JD inference.
      upload = undefined;
      const jd = await withAiGenerationDiagnosticRequest(
        req.analysis!.requestId,
        'JD',
        () => this.extraction.extractJd({ text }),
      );
      if (!this.live(owner)) return;
      documents.jd = documentResult(jd);
      req.analysis!.stages.jd = 'SUCCEEDED';
      owner.stage = 'matching';
      // Conservative MVP gate: evidence validation alone permits empty data.
      const cvSupport = [
        ...cv.data.skills.map((item) => item.name),
        ...cv.data.experience.flatMap((item) => [
          item.title,
          item.descriptionText,
        ]),
      ];
      if (
        !cvSupport.some((fact) => fact.value !== null) ||
        !jd.data.requirements.some((item) => item.text.value !== null)
      )
        throw new AnalysisError('INSUFFICIENT_MATCHING_INPUT');
      const result = this.matching.match({ cv, jd });
      if (!this.live(owner)) return;
      req.analysis!.stages.matching = 'SUCCEEDED';
      const response: AnalysisResponseDto = {
        contractVersion: '1',
        requestId: req.analysis!.requestId,
        outcome: 'COMPLETED',
        documents,
        stages: req.analysis!.stages,
        result,
        error: null,
      };
      owner.terminal = true;
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(response));
    } catch (error: unknown) {
      if (!owner.terminal) this.terminate(owner, error);
    } finally {
      this.release(owner);
    }
  }

  private live(owner: Ownership): boolean {
    // Destruction flags change before the asynchronous close event. Check them
    // at every stage boundary, including promise continuations in the same turn.
    if (
      !owner.terminal &&
      (owner.req.aborted ||
        (owner.req.destroyed && !owner.req.complete) ||
        owner.res.destroyed ||
        owner.req.socket.destroyed)
    )
      this.terminate(owner, undefined);
    if (!owner.terminal && performance.now() >= owner.expires)
      this.terminate(owner, new AnalysisError('ANALYSIS_TIMEOUT'));
    if (
      !owner.terminal &&
      owner.stage === 'upload' &&
      performance.now() >= owner.uploadExpires
    )
      this.terminate(owner, new AnalysisError('UPLOAD_TIMEOUT'));
    return !owner.terminal;
  }
  private terminate(owner: Ownership, error: unknown): void {
    if (owner.terminal) return;
    owner.terminal = true;
    clearTimeout(owner.uploadTimer);
    clearTimeout(owner.analysisTimer);
    // Partial generation observes this request signal; legacy extraction remains
    // unchanged. Never close the shared parser/provider on request cancellation.
    owner.abort.abort();
    if (error !== undefined) {
      const safe = analysisError(error, errorStage(owner.stage));
      const status = ANALYSIS_HTTP_STATUS[safe.code];
      owner.req.analysis!.stages[owner.stage] =
        status === 408 || status === 504
          ? 'TIMED_OUT'
          : status >= 500
            ? 'FAILED'
            : 'REJECTED';
      sendAnalysisError(owner.req, owner.res, error, errorStage(owner.stage));
    }
    if (!owner.started) this.release(owner);
  }
  private release(owner: Ownership): void {
    if (owner.released) return;
    owner.released = true;
    clearTimeout(owner.uploadTimer);
    clearTimeout(owner.analysisTimer);
    owner.req.off('aborted', owner.disconnected);
    owner.res.off('close', owner.disconnected);
    if (this.active === owner) this.active = undefined;
    owner.finish();
  }
  shutdown(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      const owner = this.active;
      if (owner)
        this.terminate(owner, new AnalysisError('ANALYSIS_UNAVAILABLE'));
      this.closing = owner?.done ?? Promise.resolve();
    }
    return this.closing;
  }
  onModuleDestroy(): Promise<void> {
    return this.shutdown();
  }
}
