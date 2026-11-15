import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { initialStages } from './analysis.contracts.js';
import type {
  AnalysisDocumentsDto,
  AnalysisResponseDto,
  StageSummary,
} from './analysis.contracts.js';
import {
  AnalysisError,
  analysisError,
  ANALYSIS_HTTP_STATUS,
} from './analysis.errors.js';
import {
  checkAnalysisSecurity,
  localAnalysisSecurity,
} from './analysis-security.js';
import type { AnalysisSecurity } from './analysis-security.js';
import { checkUploadHeaders } from './analysis-upload.js';
import { AnalysisService } from './analysis.service.js';
import { aiRequest } from '../ai/ai-usage.js';
import type { AuthRequest } from '../auth/auth.http.js';
import type { AnalysisErrorDto } from './analysis.contracts.js';

export interface AnalysisRequest extends IncomingMessage {
  analysis?: {
    requestId: string;
    stages: StageSummary;
    documents?: AnalysisDocumentsDto;
    parseOnly?: boolean;
    cvOnly?: boolean;
    partialOnly?: boolean;
  };
}
export const REJECT_CLOSE_MS = 250;
export function sendAnalysisError(
  req: AnalysisRequest,
  res: ServerResponse,
  error: unknown,
  stage: AnalysisErrorDto['stage'] = 'REQUEST',
): void {
  const safe = analysisError(error, stage);
  const context: NonNullable<AnalysisRequest['analysis']> = req.analysis ?? {
    requestId: randomUUID(),
    stages: initialStages(),
  };
  if (context.stages.upload === 'NOT_RUN')
    context.stages.upload =
      safe.code === 'UPLOAD_TIMEOUT'
        ? 'TIMED_OUT'
        : safe.code === 'ANALYSIS_FAILED'
          ? 'FAILED'
          : 'REJECTED';
  const body: AnalysisResponseDto = {
    contractVersion: '1',
    requestId: context.requestId,
    outcome: 'INCOMPLETE',
    stages: context.stages,
    documents: context.documents,
    result: null,
    error: safe,
  };
  req.pause(); // Never drain an unbounded rejected body.
  if (res.destroyed || res.writableEnded || res.headersSent) return;
  res.statusCode = ANALYSIS_HTTP_STATUS[safe.code];
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Connection', 'close');
  // Bound even a peer that never reads the response. Do not keep the process alive.
  const socket = req.socket;
  const timer = setTimeout(() => socket.destroy(), REJECT_CLOSE_MS);
  timer.unref();
  const closed = () => {
    clearTimeout(timer);
    res.off('finish', finished);
  };
  const finished = () => socket.end();
  res.once('finish', finished);
  socket.once('close', closed);
  res.end(JSON.stringify(body));
}
// Install before Nest's built-in body parsers. JSON/URL-encoded bodies must not
// be read before this endpoint's Host/Origin/content-type checks.
export function configureAnalysisHttp(
  app: INestApplication,
  security: AnalysisSecurity = localAnalysisSecurity(3000),
): void {
  const analysis = app.get(AnalysisService);
  app.use(
    '/api/v1/analyses',
    (req: AnalysisRequest, res: ServerResponse, next: () => void) => {
      if (
        req.method !== 'POST' ||
        !['', '/'].includes((req.url ?? '').split('?')[0]!)
      ) {
        next();
        return;
      }
      req.analysis = { requestId: randomUUID(), stages: initialStages() };
      res.setHeader('Cache-Control', 'no-store');
      try {
        checkAnalysisSecurity(req, security);
        const query = new URL(
          (req as AnalysisRequest & { originalUrl?: string }).originalUrl ??
            req.url ??
            '/',
          'http://localhost',
        ).searchParams;
        if (
          [...query.keys()].some((key) => key !== 'mode') ||
          query.getAll('mode').length > 1 ||
          (query.has('mode') &&
            !['parse-only', 'partial', 'cv-only'].includes(query.get('mode')!))
        )
          throw new AnalysisError('INVALID_REQUEST');
        req.analysis.parseOnly = ['parse-only', 'cv-only'].includes(
          query.get('mode')!,
        );
        req.analysis.cvOnly = query.get('mode') === 'cv-only';
        req.analysis.partialOnly = query.get('mode') === 'partial';
        checkUploadHeaders(req);
        // Raw route: no Nest interceptor, so bind the owner's AI context here.
        const ownerId = (req as AuthRequest).authUser?.id;
        if (ownerId) aiRequest.run({ ownerId }, () => analysis.admit(req, res));
        else analysis.admit(req, res);
        next();
      } catch (error: unknown) {
        sendAnalysisError(req, res, error);
      }
    },
  );
}
