import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TailoredCvFoundation1794000000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE ai_job_hunter.saved_cvs ADD COLUMN "sourceMetadata" jsonb NULL CHECK (
      "sourceMetadata" IS NULL OR (jsonb_typeof("sourceMetadata") = 'object' AND octet_length("sourceMetadata"::text) <= 131072))`);
    await r.query(`CREATE TABLE ai_job_hunter.cv_source_revisions (
      id uuid PRIMARY KEY, "ownerId" uuid NOT NULL,
      "fileName" text NOT NULL CHECK (length("fileName") BETWEEN 1 AND 1024),
      text text NOT NULL CHECK (length(text) BETWEEN 1 AND 12000 AND octet_length(text) <= 49152),
      "textHash" varchar(64) NOT NULL CHECK ("textHash" ~ '^[a-f0-9]{64}$'),
      "savedCvUpdatedAt" timestamptz NOT NULL CHECK (isfinite("savedCvUpdatedAt")),
      provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object' AND octet_length(provenance::text) <= 131072),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("ownerId", id), UNIQUE ("ownerId", "savedCvUpdatedAt", "textHash", "fileName")
    )`);
    await r.query(`CREATE TABLE ai_job_hunter.cv_profile_revisions (
      id uuid PRIMARY KEY, "ownerId" uuid NOT NULL, "profileId" uuid NOT NULL,
      revision integer NOT NULL CHECK (revision > 0), "sourceRevisionId" uuid NOT NULL,
      document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document @> '{"contractVersion":"1"}'::jsonb AND octet_length(document::text) <= 131072),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("ownerId", id), UNIQUE ("ownerId", "profileId", revision),
      FOREIGN KEY ("ownerId", "sourceRevisionId") REFERENCES ai_job_hunter.cv_source_revisions ("ownerId", id) ON DELETE RESTRICT
    )`);
    await r.query(
      `CREATE UNIQUE INDEX opportunities_p8_owner_id ON ai_job_hunter.opportunities ("ownerId", id)`,
    );
    await r.query(`CREATE TABLE ai_job_hunter.tailored_cv_drafts (
      id uuid PRIMARY KEY, "ownerId" uuid NOT NULL, "jobId" uuid NOT NULL, "profileRevisionId" uuid NOT NULL,
      "jobUpdatedAt" timestamptz NOT NULL CHECK (isfinite("jobUpdatedAt")), revision integer NOT NULL CHECK (revision > 0),
      document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document @> '{"contractVersion":"1"}'::jsonb AND octet_length(document::text) <= 131072),
      "generationMetadata" jsonb NULL CHECK ("generationMetadata" IS NULL OR (jsonb_typeof("generationMetadata") = 'object' AND octet_length("generationMetadata"::text) <= 16384)),
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY ("ownerId", "jobId") REFERENCES ai_job_hunter.opportunities ("ownerId", id) ON DELETE RESTRICT,
      FOREIGN KEY ("ownerId", "profileRevisionId") REFERENCES ai_job_hunter.cv_profile_revisions ("ownerId", id) ON DELETE RESTRICT
    )`);
    await r.query(
      `CREATE INDEX tailored_cv_drafts_job ON ai_job_hunter.tailored_cv_drafts ("ownerId", "jobId")`,
    );
    await r.query(
      `CREATE INDEX tailored_cv_drafts_profile ON ai_job_hunter.tailored_cv_drafts ("ownerId", "profileRevisionId")`,
    );
    await r.query(
      `CREATE INDEX cv_profiles_source ON ai_job_hunter.cv_profile_revisions ("ownerId", "sourceRevisionId")`,
    );
    await r.query(`CREATE FUNCTION ai_job_hunter.reject_cv_revision_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'CV revisions are immutable' USING ERRCODE = '23514'; END; $$`);
    for (const table of ['cv_source_revisions', 'cv_profile_revisions']) {
      await r.query(`CREATE TRIGGER immutable_revision BEFORE UPDATE ON ai_job_hunter.${table}
        FOR EACH ROW EXECUTE FUNCTION ai_job_hunter.reject_cv_revision_update()`);
    }
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE ai_job_hunter.tailored_cv_drafts');
    await r.query('DROP INDEX ai_job_hunter.opportunities_p8_owner_id');
    await r.query('DROP TABLE ai_job_hunter.cv_profile_revisions');
    await r.query('DROP TABLE ai_job_hunter.cv_source_revisions');
    await r.query('DROP FUNCTION ai_job_hunter.reject_cv_revision_update()');
    await r.query(
      'ALTER TABLE ai_job_hunter.saved_cvs DROP COLUMN "sourceMetadata"',
    );
  }
}
