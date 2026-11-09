import type { MigrationInterface, QueryRunner } from 'typeorm';
// Persisted CV Match results: one current result per owner and job, reused only
// while the CV text hash, job revision and matching policy are unchanged.
export class CvMatches1794100000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(
      `CREATE TABLE ai_job_hunter.cv_matches (
        "matchId" uuid PRIMARY KEY,
        "ownerId" uuid NOT NULL,
        "jobId" uuid NOT NULL REFERENCES ai_job_hunter.opportunities(id) ON DELETE CASCADE,
        "cvTextHash" varchar(64) NOT NULL,
        "cvUpdatedAt" timestamptz NOT NULL,
        "jobUpdatedAt" timestamptz NOT NULL,
        "policyVersion" text NOT NULL,
        assessment jsonb NOT NULL,
        "analyzedAt" timestamptz NOT NULL,
        CONSTRAINT cv_matches_owner_job UNIQUE ("ownerId", "jobId")
      )`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE ai_job_hunter.cv_matches');
  }
}
