import type { MigrationInterface, QueryRunner } from 'typeorm';

// Web beta PR1: accounts, opaque sessions and one-time invite/reset codes.
// Only hashes of session tokens and codes are stored.
export class Auth1794600000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE ai_job_hunter.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email varchar(254) NOT NULL UNIQUE,
      "passwordHash" text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await runner.query(`CREATE TABLE ai_job_hunter.auth_sessions (
      "tokenHash" bytea PRIMARY KEY,
      "userId" uuid NOT NULL REFERENCES ai_job_hunter.users(id) ON DELETE CASCADE,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "expiresAt" timestamptz NOT NULL
    )`);
    await runner.query(
      'CREATE INDEX auth_sessions_user ON ai_job_hunter.auth_sessions ("userId")',
    );
    // INVITE: "userId" optionally fixes the new account's id (local owner).
    // RESET: "userId" is the account whose password the code may replace.
    await runner.query(`CREATE TABLE ai_job_hunter.auth_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind varchar(10) NOT NULL CHECK (kind IN ('INVITE','RESET')),
      "codeHash" bytea NOT NULL UNIQUE,
      "userId" uuid,
      "expiresAt" timestamptz NOT NULL,
      "usedAt" timestamptz,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE ai_job_hunter.auth_codes');
    await runner.query('DROP TABLE ai_job_hunter.auth_sessions');
    await runner.query('DROP TABLE ai_job_hunter.users');
  }
}
