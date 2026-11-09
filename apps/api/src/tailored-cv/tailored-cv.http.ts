import { TailoredDraftError } from './tailored-draft.contract.js';
import { SourceProfileError } from './source-profile-proposal.js';
import { Catch, HttpException, Injectable } from '@nestjs/common';
import type {
  ArgumentsHost,
  CanActivate,
  ExceptionFilter,
  ExecutionContext,
  HttpServer,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { QueryFailedError } from 'typeorm';
import { localWrite } from '../opportunities/opportunities.security.js';
import { CvSuggestionsRequestErrors } from '../matching/cv-suggestions-request.filter.js';

export function foundationError(error: unknown) {
  const databaseCode: unknown =
    error instanceof QueryFailedError
      ? (error.driverError as { code?: unknown }).code
      : null;
  const parserType: unknown =
    error instanceof Error && 'type' in error ? error.type : null;
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : databaseCode === '23503' || databaseCode === '23505'
        ? 409
        : parserType === 'entity.too.large'
          ? 413
          : parserType === 'entity.parse.failed'
            ? 400
            : parserType === 'encoding.unsupported' ||
                parserType === 'charset.unsupported'
              ? 415
              : 503;
  const messages: Record<number, string> = {
    400: 'Invalid P8 request. Check contract version, limits and evidence.',
    403: 'A local browser Host and Origin are required.',
    404: 'CV resource not found.',
    409: 'CV resource changed or is referenced. Reload, or explicitly delete dependent drafts and profiles first.',
    413: 'P8 request exceeds input limits.',
    415: 'Unsupported P8 request encoding.',
  };
  return {
    contractVersion: '1',
    statusCode: status,
    errorCode:
      error instanceof SourceProfileError || error instanceof TailoredDraftError
        ? error.errorCode
        : `CV_FOUNDATION_${status}`,
    message:
      error instanceof SourceProfileError || error instanceof TailoredDraftError
        ? error.message
        : (messages[status] ?? 'CV storage unavailable. Retry later.'),
  };
}
@Injectable()
export class FoundationLocalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Reads include personal data. Apply the same strict local policy as writes.
    localWrite(context.switchToHttp().getRequest<IncomingMessage>());
    return true;
  }
}
@Catch()
export class FoundationErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const safe = foundationError(error);
    response.statusCode = safe.statusCode;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(safe));
  }
}
// Body-parser failures precede controller guards/filters. Keep P7's fallback intact.
@Catch()
export class FoundationRequestErrors extends CvSuggestionsRequestErrors {
  constructor(private readonly httpAdapter: HttpServer) {
    super(httpAdapter);
  }
  override catch(error: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<IncomingMessage>();
    if (/^\/api\/v1\/tailored-cv(?:\/|\?|$)/u.test(req.url ?? '')) {
      const response = host.switchToHttp().getResponse();
      const safe = foundationError(error);
      this.httpAdapter.setHeader(response, 'Cache-Control', 'no-store');
      this.httpAdapter.reply(response, safe, safe.statusCode);
      return;
    }
    super.catch(error, host);
  }
}
