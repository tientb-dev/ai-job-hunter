import type { MigrationInterface, QueryRunner } from 'typeorm';

export class JdSkillInventory1795200000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      'ALTER TABLE ai_job_hunter.opportunities ADD COLUMN "jdSkillInventory" jsonb NULL',
    );
  }

  async down(r: QueryRunner) {
    await r.query(
      'ALTER TABLE ai_job_hunter.opportunities DROP COLUMN "jdSkillInventory"',
    );
  }
}
