import type { SavedCvProvenance } from '../extraction/extraction.types.js';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'ai_job_hunter', name: 'saved_cvs' })
export class SavedCv {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'text' }) name!: string;
  @Column({ type: 'boolean', default: false }) isDefault!: boolean;
  @Column({ type: 'text' }) fileName!: string;
  @Column({ type: 'text', select: false }) text!: string;
  @Column({ type: 'jsonb', nullable: true, select: false })
  sourceMetadata!: SavedCvProvenance | null;
  // CV content is immutable after upload; this is its version identity, so
  // renaming or changing the default must not move it.
  @Column({ type: 'timestamptz', default: () => 'now()' }) updatedAt!: Date;
  // Original upload, kept unchanged for download; null for CVs saved before
  // originals were retained.
  @Column({ type: 'bytea', nullable: true, select: false })
  originalBytes!: Buffer | null;
  @Column({ type: 'text', nullable: true }) mediaType!: string | null;
  @Column({ type: 'integer', nullable: true }) fileSize!: number | null;
}
