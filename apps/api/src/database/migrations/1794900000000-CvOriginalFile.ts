import type { MigrationInterface, QueryRunner } from 'typeorm';

// New CV uploads keep their original file so it can be downloaded unchanged.
// Earlier CVs stored extracted text only; their file columns stay null.
export class CvOriginalFile1794900000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.saved_cvs
        ADD COLUMN "originalBytes" bytea NULL,
        ADD COLUMN "mediaType" text NULL,
        ADD COLUMN "fileSize" integer NULL`,
    );
  }

  // Reverting discards retained originals; CV text and metadata are kept.
  async down(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.saved_cvs
        DROP COLUMN "originalBytes",
        DROP COLUMN "mediaType",
        DROP COLUMN "fileSize"`,
    );
  }
}
