import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthService, authError } from './auth.service.js';
import type { Queryable } from './auth.service.js';
import { normalizeEmail, validEmail, verifyPassword } from './auth.crypto.js';

const S = 'ai_job_hunter';

type AuditAction =
  'INVITE_CREATE' | 'INVITE_REVOKE' | 'USER_LOOKUP' | 'RESET_ISSUE';

/** Integer in [1, max]; omitted means the CLI default. */
function amount(value: unknown, fallback: number, max: number): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max)
    throw authError('INVALID_INPUT');
  return n;
}

const body = (value: unknown) => (value ?? {}) as Record<string, unknown>;

/** Every admin write commits together with its audit row, or not at all. Audit rows never hold codes or emails. */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthService,
  ) {}

  private audit(
    q: Queryable,
    adminId: string,
    action: AuditAction,
    targetId: string | null,
  ) {
    return q.query(
      `INSERT INTO ${S}.admin_audit_log ("adminUserId", action, "targetId") VALUES ($1, $2, $3)`,
      [adminId, action, targetId],
    );
  }

  createInvite(adminId: string, input: unknown) {
    const days = amount(body(input).days, 7, 90);
    return this.db.transaction(async (tx) => {
      const issued = await this.auth.issueCode(tx, 'INVITE', days * 24, null);
      await this.audit(tx, adminId, 'INVITE_CREATE', issued.id);
      return issued;
    });
  }

  // shortcut: newest 200 only, no paging; add paging if invites outgrow it.
  listInvites() {
    return this.db.query(
      `SELECT id, "createdAt", "expiresAt", "usedAt", "revokedAt",
              CASE WHEN "revokedAt" IS NOT NULL THEN 'revoked'
                   WHEN "usedAt" IS NOT NULL THEN 'used'
                   WHEN "expiresAt" <= now() THEN 'expired'
                   ELSE 'active' END AS status
         FROM ${S}.auth_codes WHERE kind = 'INVITE'
        ORDER BY "createdAt" DESC LIMIT 200`,
    ) as Promise<unknown[]>;
  }

  /** Setting usedAt too keeps redemption (`"usedAt" IS NULL`) unchanged. */
  revokeInvite(adminId: string, id: string) {
    return this.db.transaction(async (tx) => {
      const [rows] = (await tx.query(
        `UPDATE ${S}.auth_codes SET "usedAt" = now(), "revokedAt" = now()
          WHERE id = $1 AND kind = 'INVITE' AND "usedAt" IS NULL RETURNING id`,
        [id],
      )) as [unknown[], number];
      if (!rows.length) throw authError('NOT_FOUND');
      await this.audit(tx, adminId, 'INVITE_REVOKE', id);
    });
  }

  async findUser(adminId: string, rawEmail: unknown) {
    const email = normalizeEmail(typeof rawEmail === 'string' ? rawEmail : '');
    if (!validEmail(email)) throw authError('INVALID_INPUT');
    // Misses are audited too, so the 404 is raised after the commit.
    const user = await this.db.transaction(async (tx) => {
      const [row] = (await tx.query(
        `SELECT id, email, "createdAt" FROM ${S}.users WHERE email = $1`,
        [email],
      )) as { id: string; email: string; createdAt: Date }[];
      await this.audit(tx, adminId, 'USER_LOOKUP', row?.id ?? null);
      return row;
    });
    if (!user) throw authError('NOT_FOUND');
    return user;
  }

  async issueReset(adminId: string, userId: string, input: unknown) {
    const { hours: rawHours, password } = body(input);
    const hours = amount(rawHours, 24, 168);
    if (typeof password !== 'string' || !password || password.length > 1024)
      throw authError('INVALID_INPUT');
    if (userId === adminId) throw authError('SELF_RESET_FORBIDDEN');
    const [admin] = (await this.db.query(
      `SELECT "passwordHash" FROM ${S}.users WHERE id = $1`,
      [adminId],
    )) as { passwordHash: string }[];
    if (!admin || !(await verifyPassword(password, admin.passwordHash)))
      throw authError('REAUTH_FAILED');
    return this.db.transaction(async (tx) => {
      const [target] = (await tx.query(
        `SELECT id FROM ${S}.users WHERE id = $1`,
        [userId],
      )) as unknown[];
      if (!target) throw authError('NOT_FOUND');
      const issued = await this.auth.issueResetFor(tx, userId, hours);
      await this.audit(tx, adminId, 'RESET_ISSUE', userId);
      return issued;
    });
  }
}
