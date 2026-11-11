import { Column, Entity, PrimaryColumn } from 'typeorm';

// Append-only; the newest set per (ownerId, jobId) is the active one.
@Entity({ schema: 'ai_job_hunter', name: 'interview_question_sets' })
export class InterviewQuestionSet {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'uuid' }) jobId!: string;
  @Column({ type: 'char', length: 64 }) jdHash!: string;
  @Column({ type: 'timestamptz' }) createdAt!: Date;
}
