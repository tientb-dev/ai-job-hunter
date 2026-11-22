import type { MigrationInterface, QueryRunner } from 'typeorm';

// Each tailored CV draft remembers its PDF export template. Existing drafts
// keep NULL, which reads as Classic; content, revision and approval are unchanged.
export class DraftExportTemplate1795300000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.tailored_cv_drafts
        ADD COLUMN "exportTemplate" text NULL
        CONSTRAINT tailored_cv_drafts_export_template
        CHECK ("exportTemplate" IN ('classic', 'modern', 'compact'))`,
    );
  }

  // Reverting forgets saved template choices; exports fall back to Classic.
  async down(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.tailored_cv_drafts DROP COLUMN "exportTemplate"`,
    );
  }
}
