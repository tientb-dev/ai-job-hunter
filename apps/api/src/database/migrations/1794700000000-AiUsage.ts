import type { MigrationInterface, QueryRunner } from 'typeorm';

// Web beta PR 4: daily hosted AI request counts per account, plus one
// beta-wide row (ownerId 00000000-0000-0000-0000-000000000000).
export class AiUsage1794700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE ai_job_hunter.ai_usage (
      day date NOT NULL,
      "ownerId" uuid NOT NULL,
      requests integer NOT NULL CHECK (requests > 0),
      PRIMARY KEY (day, "ownerId")
    )`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE ai_job_hunter.ai_usage');
  }
}
