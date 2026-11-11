import type { MigrationInterface, QueryRunner } from 'typeorm';

// JD-generated interview question sets per saved job. Sets are append-only:
// the newest set is active, older ones stay readable. Saved answers live in
// interview_answers under "jd-<question uuid>" and are never touched here.
// Text constraints mirror interview_answers: trimmed, no C0 controls except tab/newline.
const text = (column: string, min: number, max: number) =>
  `CHECK (char_length(${column}) BETWEEN ${min} AND ${max}
    AND ${column} = btrim(${column}, E' \\t\\n\\r')
    AND ${column} !~ E'[\\\\x01-\\\\x08\\\\x0B-\\\\x1F\\\\x7F]')`;

export class InterviewJobQuestions1794300000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    // shortcut: no job-delete endpoint exists; when one is added it must also
    // delete that job's "jd-" rows in interview_answers (no FK from text IDs).
    await r.query(`CREATE TABLE ai_job_hunter.interview_question_sets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ownerId" uuid NOT NULL,
      "jobId" uuid NOT NULL,
      "jdHash" char(64) NOT NULL CHECK ("jdHash" ~ '^[0-9a-f]{64}$'),
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE ("ownerId", id),
      FOREIGN KEY ("ownerId", "jobId") REFERENCES ai_job_hunter.opportunities ("ownerId", id) ON DELETE CASCADE
    )`);
    // Newest-first per job; also serves the cascade from opportunities.
    await r.query(
      `CREATE INDEX interview_question_sets_job ON ai_job_hunter.interview_question_sets ("ownerId", "jobId", "createdAt" DESC, id DESC)`,
    );
    await r.query(`CREATE TABLE ai_job_hunter.interview_job_questions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "ownerId" uuid NOT NULL,
      "setId" uuid NOT NULL,
      position smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
      category text NOT NULL CHECK (category IN ('skill','architecture','troubleshooting','experience')),
      kind text NOT NULL CHECK (kind IN ('general','hypothetical','personal')),
      question text NOT NULL ${text('question', 10, 200)},
      why text NOT NULL ${text('why', 1, 200)},
      evidence text NOT NULL ${text('evidence', 15, 300)},
      UNIQUE ("setId", position),
      FOREIGN KEY ("ownerId", "setId") REFERENCES ai_job_hunter.interview_question_sets ("ownerId", id) ON DELETE CASCADE
    )`);
    await r.query(
      `CREATE INDEX interview_job_questions_set ON ai_job_hunter.interview_job_questions ("ownerId", "setId")`,
    );
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE ai_job_hunter.interview_job_questions');
    await r.query('DROP TABLE ai_job_hunter.interview_question_sets');
  }
}
