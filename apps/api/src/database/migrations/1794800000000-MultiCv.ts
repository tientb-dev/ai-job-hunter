import type { MigrationInterface, QueryRunner } from 'typeorm';

// Each account keeps several CVs with exactly one default. Jobs may pin a CV
// and matches record the CV they analyzed. Existing single CVs become the
// default under a new id; existing matches are bound to that CV.
export class MultiCv1794800000000 implements MigrationInterface {
  async up(r: QueryRunner) {
    await r.query(
      `ALTER TABLE ai_job_hunter.saved_cvs
        ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN name text,
        ADD COLUMN "isDefault" boolean NOT NULL DEFAULT false`,
    );
    await r.query(
      `UPDATE ai_job_hunter.saved_cvs SET name = left("fileName", 120), "isDefault" = true`,
    );
    await r.query(
      `ALTER TABLE ai_job_hunter.saved_cvs
        ALTER COLUMN name SET NOT NULL,
        ADD CONSTRAINT saved_cvs_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
        DROP CONSTRAINT saved_cvs_pkey,
        ADD PRIMARY KEY (id),
        ADD CONSTRAINT saved_cvs_owner_id UNIQUE ("ownerId", id)`,
    );
    await r.query(
      `CREATE UNIQUE INDEX saved_cvs_one_default ON ai_job_hunter.saved_cvs ("ownerId") WHERE "isDefault"`,
    );
    // Composite keys keep a job or match from referencing another account's CV.
    await r.query(
      `ALTER TABLE ai_job_hunter.opportunities ADD COLUMN "cvId" uuid NULL,
        ADD CONSTRAINT opportunities_cv FOREIGN KEY ("ownerId", "cvId")
          REFERENCES ai_job_hunter.saved_cvs ("ownerId", id)`,
    );
    await r.query(
      `ALTER TABLE ai_job_hunter.cv_matches ADD COLUMN "cvId" uuid NULL,
        ADD CONSTRAINT cv_matches_cv FOREIGN KEY ("ownerId", "cvId")
          REFERENCES ai_job_hunter.saved_cvs ("ownerId", id)`,
    );
    await r.query(
      `UPDATE ai_job_hunter.cv_matches m SET "cvId" = c.id
        FROM ai_job_hunter.saved_cvs c WHERE c."ownerId" = m."ownerId"`,
    );
  }

  // Reverting keeps only each account's default CV; other CVs are deleted.
  async down(r: QueryRunner) {
    await r.query(
      'ALTER TABLE ai_job_hunter.cv_matches DROP CONSTRAINT cv_matches_cv, DROP COLUMN "cvId"',
    );
    await r.query(
      'ALTER TABLE ai_job_hunter.opportunities DROP CONSTRAINT opportunities_cv, DROP COLUMN "cvId"',
    );
    await r.query('DELETE FROM ai_job_hunter.saved_cvs WHERE NOT "isDefault"');
    await r.query('DROP INDEX ai_job_hunter.saved_cvs_one_default');
    await r.query(
      `ALTER TABLE ai_job_hunter.saved_cvs
        DROP CONSTRAINT saved_cvs_owner_id,
        DROP CONSTRAINT saved_cvs_pkey,
        DROP CONSTRAINT saved_cvs_name_length,
        ADD PRIMARY KEY ("ownerId"),
        DROP COLUMN id, DROP COLUMN name, DROP COLUMN "isDefault"`,
    );
  }
}
