import type { IncomingMessage, ServerResponse } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { SESSION_DAYS, AuthService } from './auth.service.js';
import { AUTH_SECURE_COOKIES } from './auth.tokens.js';
import type { SessionUser } from './auth.service.js';

export interface AuthRequest extends IncomingMessage {
  authUser?: SessionUser;
  sessionToken?: string;
}

export interface AuthHttpOptions {
  /** Exact browser origins allowed to send state-changing requests. */
  origins: readonly string[];
  /** Attempts per client address per window on login/register/reset. */
  rateLimit?: { max: number; windowMs: number };
  /** Behind the production reverse proxy (the API's only client): key limits on the client it forwards. */
  trustProxy?: boolean;
}

/**
 * The proxy appends the address it received the request from, so the last
 * X-Forwarded-For entry is the client; earlier entries are client-supplied.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean) {
  const forwarded = req.headers['x-forwarded-for'];
  const last = trustProxy
    ? String(forwarded ?? '')
        .split(',')
        .at(-1)
        ?.trim()
    : '';
  return last || req.socket.remoteAddress || 'unknown';
}

export const sessionCookieName = (secure: boolean) =>
  secure ? '__Host-ajh_session' : 'ajh_session';

export function sessionCookie(token: string | null, secure: boolean): string {
  const parts = [
    `${sessionCookieName(secure)}=${token ?? ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? SESSION_DAYS * 86_400 : 0}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name)
      return part.slice(at + 1).trim() || undefined;
  }
  return undefined;
}

const PUBLIC =
  /^\/api\/v1\/(?:health(?:\/|\?|$)|auth\/(?:login|register|reset-password|logout)(?:\?|$))/;
const LIMITED = /^\/api\/v1\/auth\/(?:login|register|reset-password)(?:\?|$)/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function deny(res: ServerResponse, status: number, errorCode: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ errorCode }));
}

/**
 * Express-level so it also covers raw middleware routes such as POST /analyses.
 * Must be installed before any other app.use() handler.
 */
export function configureAuth(
  app: INestApplication,
  options: AuthHttpOptions,
): void {
  const auth = app.get(AuthService);
  const cookieName = sessionCookieName(app.get<boolean>(AUTH_SECURE_COOKIES));
  const { max, windowMs } = options.rateLimit ?? {
    max: 10,
    windowMs: 15 * 60_000,
  };
  // shortcut: in-memory, one API instance only; move to the database or Redis
  // before running more than one API replica.
  const attempts = new Map<string, { count: number; resetAt: number }>();

  app.use(
    '/api',
    async (
      req: AuthRequest,
      res: ServerResponse,
      next: (e?: unknown) => void,
    ) => {
      try {
        const path = `/api${req.url ?? ''}`;
        if (!SAFE_METHODS.has(req.method ?? '')) {
          // CSRF: cookie-authenticated writes must come from our own pages.
          const origins = req.rawHeaders.filter(
            (_, i) =>
              i % 2 === 0 && req.rawHeaders[i]!.toLowerCase() === 'origin',
          );
          if (
            origins.length !== 1 ||
            !options.origins.includes(String(req.headers.origin))
          )
            return deny(res, 403, 'ORIGIN_DENIED');
        }
        if (LIMITED.test(path) && req.method === 'POST') {
          const key = clientAddress(req, options.trustProxy ?? false);
          const now = Date.now();
          const entry = attempts.get(key);
          if (!entry || entry.resetAt <= now)
            attempts.set(key, { count: 1, resetAt: now + windowMs });
          else if (++entry.count > max) {
            res.setHeader(
              'Retry-After',
              String(Math.ceil((entry.resetAt - now) / 1000)),
            );
            return deny(res, 429, 'TOO_MANY_ATTEMPTS');
          }
        }
        const token = readCookie(req, cookieName);
        if (token) {
          req.sessionToken = token;
          req.authUser = (await auth.sessionUser(token)) ?? undefined;
        }
        if (PUBLIC.test(path)) return next();
        if (!req.authUser) return deny(res, 401, 'UNAUTHENTICATED');
        // Data access is scoped per account by @CurrentOwner() in each handler.
        next();
      } catch (error: unknown) {
        next(error);
      }
    },
  );
}
