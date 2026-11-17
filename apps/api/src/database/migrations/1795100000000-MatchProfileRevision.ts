import type { MigrationInterface, QueryRunner } from 'typeorm';

// CV Match runs on a completed Source CV Review revision. Earlier matches used
// raw CV text, keep a null revision and read as stale until reanalyzed.
export class MatchProfileRevision1795100000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.cv_matches ADD COLUMN "profileRevisionId" uuid NULL`,
    );
  }

  async down(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.cv_matches DROP COLUMN "profileRevisionId"`,
    );
  }
}
