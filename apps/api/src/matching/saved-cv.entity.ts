import type { SavedCvProvenance } from '../extraction/extraction.types.js';
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ schema: 'ai_job_hunter', name: 'saved_cvs' })
export class SavedCv {
  @PrimaryColumn({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'text' }) fileName!: string;
  @Column({ type: 'text', select: false }) text!: string;
  @Column({ type: 'jsonb', nullable: true, select: false })
  sourceMetadata!: SavedCvProvenance | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
