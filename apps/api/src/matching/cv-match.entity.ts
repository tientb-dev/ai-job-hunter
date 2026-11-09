import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { SavedCvAssessment } from './match-context.js';

@Entity({ schema: 'ai_job_hunter', name: 'cv_matches' })
export class CvMatchRecord {
  @PrimaryColumn({ type: 'uuid' }) matchId!: string;
  @Column({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'uuid' }) jobId!: string;
  @Column({ type: 'varchar', length: 64 }) cvTextHash!: string;
  @Column({ type: 'timestamptz' }) cvUpdatedAt!: Date;
  @Column({ type: 'timestamptz' }) jobUpdatedAt!: Date;
  @Column({ type: 'text' }) policyVersion!: string;
  @Column({ type: 'jsonb' }) assessment!: SavedCvAssessment;
  @Column({ type: 'timestamptz' }) analyzedAt!: Date;
}
