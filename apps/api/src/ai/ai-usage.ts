import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerResponse } from 'node:http';
import {
  HttpStatus,
  type ArgumentsHost,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import type { DataSource } from 'typeorm';
import type { AuthRequest } from '../auth/auth.http.js';
import type { AiLimits } from './ai.config.js';
import { AiError } from './ai.errors.js';

export const AI_LIMIT_CODES = [
  'AI_DAILY_USER_LIMIT',
  'AI_DAILY_GLOBAL_LIMIT',
  'AI_BUSY',
  'AI_UNAVAILABLE',
] as const;
export type AiLimitCode = (typeof AI_LIMIT_CODES)[number];
export const AI_LIMIT_STATUS: Record<AiLimitCode, number> = {
  AI_DAILY_USER_LIMIT: HttpStatus.TOO_MANY_REQUESTS,
  AI_DAILY_GLOBAL_LIMIT: HttpStatus.TOO_MANY_REQUESTS,
  AI_BUSY: HttpStatus.TOO_MANY_REQUESTS,
  AI_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

/** Who an AI request is for, and the first limit it hit, for one HTTP request. */
interface AiRequestContext {
  readonly ownerId: string;
  limit?: AiLimitCode;
}
export const aiRequest = new AsyncLocalStorage<AiRequestContext>();

export function isAiLimit(error: unknown): error is AiError {
  return (
    error instanceof AiError &&
    (AI_LIMIT_CODES as readonly string[]).includes(error.code)
  );
}
/** Response body for a limit error; filters return it unchanged. */
export function aiLimitBody(error: AiError) {
  const code = error.code as AiLimitCode;
  return {
    statusCode: AI_LIMIT_STATUS[code],
    errorCode: code,
    message: error.message,
  };
}

/**
 * Runs each handler inside the signed-in owner's AI context. Feature services
 * map AI failures to their own errors or partial results, so a limit hit is
 * re-raised here and reaches the client as one consistent error.
 */
@Injectable()
export class AiRequestInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ownerId = context.switchToHttp().getRequest<AuthRequest>()
      .authUser?.id;
    if (!ownerId) return next.handle();
    const store: AiRequestContext = { ownerId };
    const limited = () => (store.limit ? new AiError(store.limit) : null);
    return new Observable((subscriber) =>
      aiRequest.run(store, () =>
        next
          .handle()
          .pipe(
            map((value) => {
              const error = limited();
              if (error) throw error;
              return value;
            }),
            catchError((error: unknown) =>
              throwError(() => limited() ?? error),
            ),
          )
          .subscribe(subscriber),
      ),
    );
  }
}

const S = 'ai_job_hunter';
/** The beta-wide counter row; no account has this id. */
export const GLOBAL_USAGE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Hosted AI limits: a per-process concurrency cap and daily request
 * counts per account and for the whole beta, in PostgreSQL. A request counts
 * when it is sent to the provider, whatever the outcome; the provider's own
 * transient retries inside one request count once.
 */
export class AiUsageService {
  private active = 0;
  constructor(
    private readonly db: DataSource,
    private readonly limits: AiLimits,
  ) {}

  async run<T>(send: () => Promise<T>): Promise<T> {
    const store = aiRequest.getStore();
    // Fail closed: never send to the provider without an accountable owner.
    if (!store) throw new AiError('AI_UNAVAILABLE');
    const fail = (code: AiLimitCode): never => {
      store.limit ??= code;
      throw new AiError(code);
    };
    if (this.active >= this.limits.concurrent) fail('AI_BUSY');
    this.active++;
    try {
      const exceeded = await this.reserve(store.ownerId);
      if (exceeded) fail(exceeded);
      return await send();
    } finally {
      this.active--;
    }
  }

  /** Atomically counts one request, or returns the limit that refused it. */
  async reserve(ownerId: string): Promise<AiLimitCode | null> {
    try {
      await this.db.transaction(async (tx) => {
        // Conditional upserts lock the counter rows, so concurrent requests
        // serialize; always user first, then global, so there is no deadlock.
        // now() is fixed for the transaction, so both rows use the same day.
        const count = async (id: string, max: number) =>
          (
            (await tx.query(
              `INSERT INTO ${S}.ai_usage (day, "ownerId", requests)
                 VALUES ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, $1, 1)
               ON CONFLICT (day, "ownerId") DO UPDATE
                 SET requests = ai_usage.requests + 1
                 WHERE ai_usage.requests < $2
               RETURNING requests`,
              [id, max],
            )) as unknown[]
          ).length === 1;
        if (!(await count(ownerId, this.limits.dailyPerUser)))
          throw new AiError('AI_DAILY_USER_LIMIT');
        // Throwing rolls back the user's increment as well.
        if (!(await count(GLOBAL_USAGE_ID, this.limits.dailyGlobal)))
          throw new AiError('AI_DAILY_GLOBAL_LIMIT');
      });
      return null;
    } catch (error: unknown) {
      if (isAiLimit(error)) return error.code as AiLimitCode;
      throw new AiError('AI_UNAVAILABLE');
    }
  }
}

/** For exception filters: answers a limit error as-is; false for anything else. */
export function replyAiLimit(error: unknown, host: ArgumentsHost): boolean {
  if (!isAiLimit(error)) return false;
  const body = aiLimitBody(error);
  const response = host.switchToHttp().getResponse<ServerResponse>();
  response.statusCode = body.statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
  return true;
}
