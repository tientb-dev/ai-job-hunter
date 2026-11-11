import type { MigrationInterface, QueryRunner } from 'typeorm';

// One current English reference answer per owner and question. No history.
// Constraints mirror the API validation (code points, trimmed, no C0 controls
// except tab/newline); the integer version enables atomic conflict detection.
export class InterviewAnswers1794200000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE ai_job_hunter.interview_answers (
      "ownerId" uuid NOT NULL,
      "questionId" text NOT NULL CHECK (char_length("questionId") BETWEEN 1 AND 64),
      answer text NOT NULL,
      version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY ("ownerId", "questionId"),
      CONSTRAINT interview_answers_answer_valid CHECK (
        char_length(answer) BETWEEN 1 AND 2000
        AND answer = btrim(answer, E' \\t\\n\\r')
        AND answer !~ E'[\\\\x01-\\\\x08\\\\x0B-\\\\x1F\\\\x7F]'
      )
    )`);
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query('DROP TABLE ai_job_hunter.interview_answers');
  }
}
