import type { MigrationInterface, QueryRunner } from 'typeorm';

// PR19: follow-up outcome, independent of the application status.
export class FollowUpStatus1794500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE ai_job_hunter.opportunities
      ADD COLUMN "followUpStatus" varchar(20) NOT NULL DEFAULT 'PENDING'
      CHECK ("followUpStatus" IN ('PENDING','DONE','DISMISSED'))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE ai_job_hunter.opportunities
      DROP COLUMN "followUpStatus"`);
  }
}
