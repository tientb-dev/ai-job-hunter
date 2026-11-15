import { replyAiLimit } from '../ai/ai-usage.js';
import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { CvSuggestionsError } from './cv-suggestions.error.js';

// Body-parser failures occur before a controller's filter can run. Scope their
// safe response to this route; delegate every unrelated error to Nest unchanged.
@Catch()
export class CvSuggestionsRequestErrors extends BaseExceptionFilter {
  constructor(private readonly adapter: HttpServer) {
    super(adapter);
  }
  override catch(error: unknown, host: ArgumentsHost): void {
    if (replyAiLimit(error, host)) return;
    const http = host.switchToHttp();
    const req = http.getRequest<IncomingMessage>();
    const path = (req.url ?? '').split('?')[0]!;
    const parserType =
      error instanceof Error && 'type' in error ? error.type : null;
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : parserType === 'entity.too.large'
          ? 413
          : parserType === 'entity.parse.failed'
            ? 400
            : parserType === 'encoding.unsupported' ||
                parserType === 'charset.unsupported'
              ? 415
              : null;
    if (
      req.method === 'POST' &&
      /^\/api\/v1\/opportunities\/[^/]+\/cv-improvement-suggestions\/?$/u.test(
        path,
      ) &&
      (status === 400 || status === 413 || status === 415)
    ) {
      const safe = new CvSuggestionsError('CV_SUGGESTIONS_INVALID_REQUEST');
      const response = http.getResponse();
      this.adapter.setHeader(response, 'Cache-Control', 'no-store');
      this.adapter.setHeader(response, 'Connection', 'close');
      this.adapter.reply(
        response,
        {
          statusCode: status,
          errorCode: safe.errorCode,
          message: safe.message,
        },
        status,
      );
      return;
    }
    super.catch(error, host);
  }
}
