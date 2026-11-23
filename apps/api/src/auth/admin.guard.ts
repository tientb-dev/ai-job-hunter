import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthRequest } from './auth.http.js';
import { ADMIN_EMAILS } from './auth.tokens.js';

/**
 * Signed-out requests never get here (configureAuth answers 401). Signed-in
 * non-admins get the same 404 as an unknown route, so the area stays hidden.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @Inject(ADMIN_EMAILS) private readonly admins: ReadonlySet<string>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.authUser && this.admins.has(req.authUser.email)) return true;
    throw new NotFoundException(`Cannot ${req.method} ${req.url}`);
  }
}
