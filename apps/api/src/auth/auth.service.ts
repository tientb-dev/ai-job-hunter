import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  newCode,
  newSessionToken,
  normalizeCode,
  normalizeEmail,
  sha256,
  validEmail,
  validPassword,
  verifyPassword,
} from './auth.crypto.js';

const S = 'ai_job_hunter';
export const SESSION_DAYS = 7;

export type AuthErrorCode =
  | 'INVALID_INPUT'
  | 'REGISTRATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'RESET_FAILED'
  | 'UNAUTHENTICATED';

const STATUS: Record<AuthErrorCode, HttpStatus> = {
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  REGISTRATION_FAILED: HttpStatus.BAD_REQUEST,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  RESET_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
};

export const authError = (errorCode: AuthErrorCode) =>
  new HttpException({ errorCode }, STATUS[errorCode]);

export interface SessionUser {
  id: string;
  email: string;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

@Injectable()
export class AuthService {
  constructor(private readonly db: DataSource) {}

  /** Redeems a one-time invite atomically; a failed account insert rolls the redemption back. */
  async register(body: unknown): Promise<string> {
    const input = (body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(text(input.email));
    const password = text(input.password);
    const code = normalizeCode(text(input.invitationCode));
    if (!validEmail(email) || !validPassword(password) || !code)
      throw authError('INVALID_INPUT');
    // Hash before the transaction so the code row is never locked during scrypt.
    const passwordHash = await hashPassword(password);
    const userId = await this.db.transaction(async (tx) => {
      // The row lock makes concurrent redemptions of one code serialize; only one sees "usedAt" IS NULL.
      const [invite] = (await tx.query(
        `UPDATE ${S}.auth_codes SET "usedAt" = now()
          WHERE "codeHash" = $1 AND kind = 'INVITE' AND "usedAt" IS NULL AND "expiresAt" > now()
          RETURNING "userId"`,
        [sha256(code)],
      )) as [{ userId: string | null }[], number];
      if (!invite?.[0]) throw authError('REGISTRATION_FAILED');
      const [user] = (await tx.query(
        `INSERT INTO ${S}.users (id, email, "passwordHash")
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
           ON CONFLICT DO NOTHING RETURNING id`,
        [invite[0].userId, email, passwordHash],
      )) as { id: string }[];
      // Same error as a bad code: registration does not confirm which emails exist.
      if (!user) throw authError('REGISTRATION_FAILED');
      return user.id;
    });
    return this.createSession(userId);
  }

  async login(body: unknown): Promise<string> {
    const input = (body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(text(input.email));
    const password = text(input.password);
    if (!email || !password || password.length > 1024)
      throw authError('INVALID_CREDENTIALS');
    const [user] = (await this.db.query(
      `SELECT id, "passwordHash" FROM ${S}.users WHERE email = $1`,
      [email],
    )) as { id: string; passwordHash: string }[];
    const ok = await verifyPassword(
      password,
      user?.passwordHash ?? (await DUMMY_PASSWORD_HASH),
    );
    if (!user || !ok) throw authError('INVALID_CREDENTIALS');
    return this.createSession(user.id);
  }

  private async createSession(userId: string): Promise<string> {
    const token = newSessionToken();
    await this.db.query(
      `DELETE FROM ${S}.auth_sessions WHERE "userId" = $1 AND "expiresAt" <= now()`,
      [userId],
    );
    await this.db.query(
      `INSERT INTO ${S}.auth_sessions ("tokenHash", "userId", "expiresAt")
         VALUES ($1, $2, now() + make_interval(days => $3))`,
      [sha256(token), userId, SESSION_DAYS],
    );
    return token;
  }

  async sessionUser(token: string): Promise<SessionUser | null> {
    const [user] = (await this.db.query(
      `SELECT u.id, u.email FROM ${S}.auth_sessions s
         JOIN ${S}.users u ON u.id = s."userId"
        WHERE s."tokenHash" = $1 AND s."expiresAt" > now()`,
      [sha256(token)],
    )) as SessionUser[];
    return user ?? null;
  }

  async logout(token: string): Promise<void> {
    await this.db.query(
      `DELETE FROM ${S}.auth_sessions WHERE "tokenHash" = $1`,
      [sha256(token)],
    );
  }

  /** Consumes an admin-issued reset code, sets the password and revokes every session. */
  async resetPassword(body: unknown): Promise<void> {
    const input = (body ?? {}) as Record<string, unknown>;
    const password = text(input.password);
    const code = normalizeCode(text(input.resetCode));
    if (!validPassword(password) || !code) throw authError('INVALID_INPUT');
    const passwordHash = await hashPassword(password);
    await this.db.transaction(async (tx) => {
      const [rows] = (await tx.query(
        `UPDATE ${S}.auth_codes SET "usedAt" = now()
          WHERE "codeHash" = $1 AND kind = 'RESET' AND "usedAt" IS NULL AND "expiresAt" > now()
          RETURNING "userId"`,
        [sha256(code)],
      )) as [{ userId: string }[], number];
      const userId = rows?.[0]?.userId;
      if (!userId) throw authError('RESET_FAILED');
      await tx.query(
        `UPDATE ${S}.users SET "passwordHash" = $2 WHERE id = $1`,
        [userId, passwordHash],
      );
      await tx.query(`DELETE FROM ${S}.auth_sessions WHERE "userId" = $1`, [
        userId,
      ]);
    });
  }

  /** Admin CLI: returns the plaintext code once; only its hash is stored. */
  async issueInvite(days: number, userId: string | null = null) {
    return this.issueCode('INVITE', days * 24, userId);
  }

  /** Admin CLI: replaces any earlier unused reset code for the account. */
  async issueReset(email: string, hours: number): Promise<string | null> {
    const [user] = (await this.db.query(
      `SELECT id FROM ${S}.users WHERE email = $1`,
      [normalizeEmail(email)],
    )) as { id: string }[];
    if (!user) return null;
    await this.db.query(
      `UPDATE ${S}.auth_codes SET "usedAt" = now()
        WHERE kind = 'RESET' AND "userId" = $1 AND "usedAt" IS NULL`,
      [user.id],
    );
    return this.issueCode('RESET', hours, user.id);
  }

  private async issueCode(
    kind: 'INVITE' | 'RESET',
    hours: number,
    userId: string | null,
  ): Promise<string> {
    const code = newCode();
    await this.db.query(
      `INSERT INTO ${S}.auth_codes (kind, "codeHash", "userId", "expiresAt")
         VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
      [kind, sha256(normalizeCode(code)), userId, hours],
    );
    return code;
  }
}
