import type { INestApplication } from '@nestjs/common';
import type { AuthRequest } from '../../src/auth/auth.http.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';

/**
 * Feature specs exercise their module, not sign-in: act as the local owner the
 * way the session middleware would. Auth and isolation have their own specs.
 */
export function asLocalOwner(app: INestApplication): void {
  app.use((req: AuthRequest, _res: unknown, next: () => void) => {
    req.authUser ??= { id: LOCAL_OWNER_ID, email: 'local-owner@example.test' };
    next();
  });
}
