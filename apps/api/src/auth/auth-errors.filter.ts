import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { QueryFailedError } from 'typeorm';

/**
 * Nest's default handler logs the whole error, and a QueryFailedError carries
 * its SQL parameters (password and code hashes here). Log only the type and
 * driver code; the response body matches Nest's defaults.
 */
@Catch()
export class AuthErrors implements ExceptionFilter {
  private readonly logger = new Logger('Auth');

  catch(error: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<ServerResponse>();
    let status = 500;
    let body: unknown = { statusCode: 500, message: 'Internal server error' };
    if (error instanceof HttpException) {
      status = error.getStatus();
      const r = error.getResponse();
      body = typeof r === 'string' ? { statusCode: status, message: r } : r;
    } else {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: unknown }).code
          : undefined;
      this.logger.error(
        `${error instanceof Error ? error.name : 'Error'}${code ? ` (${String(code)})` : ''}`,
      );
    }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  }
}
