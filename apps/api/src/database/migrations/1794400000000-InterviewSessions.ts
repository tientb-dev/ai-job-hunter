import type { MigrationInterface, QueryRunner } from 'typeorm';

// PR17 mock interview sessions. Items hold the question text snapshot, the
// confirmed answer text and optional AI feedback (validated in the API); never
// audio or raw transcripts. Discard deletes the row; completed rows stay until
// the user deletes them. At most one active session per owner.
export class InterviewSessions1794400000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE ai_job_hunter.interview_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ownerId" uuid NOT NULL,
      source text NOT NULL CHECK (source IN ('curated','job')),
      "jobId" uuid,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
      items jsonb NOT NULL CHECK (
        CASE WHEN jsonb_typeof(items) = 'array'
          THEN jsonb_array_length(items) BETWEEN 1 AND 8
            AND octet_length(items::text) <= 131072
          ELSE false END
      ),
      "currentIndex" smallint NOT NULL DEFAULT 0 CHECK (
        CASE WHEN jsonb_typeof(items) = 'array'
          THEN "currentIndex" BETWEEN 0 AND jsonb_array_length(items)
          ELSE false END
      ),
      version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      CHECK ((source = 'job') = ("jobId" IS NOT NULL)),
      FOREIGN KEY ("ownerId", "jobId") REFERENCES ai_job_hunter.opportunities ("ownerId", id) ON DELETE CASCADE
    )`);
    await r.query(
      `CREATE UNIQUE INDEX interview_sessions_one_active ON ai_job_hunter.interview_sessions ("ownerId") WHERE status = 'active'`,
    );
    // Serves the cascade from opportunities.
    await r.query(
      `CREATE INDEX interview_sessions_job ON ai_job_hunter.interview_sessions ("ownerId", "jobId") WHERE "jobId" IS NOT NULL`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE ai_job_hunter.interview_sessions');
  }
}
