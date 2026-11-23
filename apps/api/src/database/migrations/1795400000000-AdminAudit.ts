import type { MigrationInterface, QueryRunner } from 'typeorm';

// Admin MVP: revoked invites are told apart from used ones, and admin actions
// leave an audit trail. Neither column nor table ever holds a code or an email.
export class AdminAudit1795400000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.auth_codes ADD COLUMN "revokedAt" timestamptz NULL`,
    );
    // No FK on adminUserId/targetId: the trail must outlive the accounts it names.
    await r.query(`CREATE TABLE ai_job_hunter.admin_audit_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "adminUserId" uuid NOT NULL,
      action varchar(20) NOT NULL
        CHECK (action IN ('INVITE_CREATE','INVITE_REVOKE','USER_LOOKUP','RESET_ISSUE')),
      "targetId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
  }

  // Reverting drops the audit trail; revoked invites stay unusable (usedAt is set) but read as used.
  async down(r: QueryRunner) {
    await r.query('DROP TABLE ai_job_hunter.admin_audit_log');
    await r.query(
      `ALTER TABLE ai_job_hunter.auth_codes DROP COLUMN "revokedAt"`,
    );
  }
}
