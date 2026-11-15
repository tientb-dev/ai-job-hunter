import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthRequest } from './auth.http.js';
import { authError } from './auth.service.js';

/** The signed-in account's id, set by the session middleware; never read from request input. */
export const CurrentOwner = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const id = ctx.switchToHttp().getRequest<AuthRequest>().authUser?.id;
    // The auth middleware rejects anonymous requests first; this fails closed if it is not installed.
    if (!id) throw authError('UNAUTHENTICATED');
    return id;
  },
);
