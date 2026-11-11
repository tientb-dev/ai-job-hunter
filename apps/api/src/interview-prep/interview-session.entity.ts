import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { SessionItem } from './interview-sessions.policy.js';

// Writes go through atomic SQL in InterviewSessionsService, not repository.save().
@Entity({ schema: 'ai_job_hunter', name: 'interview_sessions' })
export class InterviewSession {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'text' }) source!: 'curated' | 'job';
  @Column({ type: 'uuid', nullable: true }) jobId!: string | null;
  @Column({ type: 'text' }) status!: 'active' | 'completed';
  @Column({ type: 'jsonb' }) items!: SessionItem[];
  @Column({ type: 'smallint' }) currentIndex!: number;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz' }) updatedAt!: Date;
}
