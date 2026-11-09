import type { TailoredDraftDocument } from './tailored-draft.contract.js';
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import type {
  ProfileDocument,
  ParserProvenance,
} from './tailored-cv.contract.js';

@Entity({ schema: 'ai_job_hunter', name: 'cv_source_revisions' })
export class CvSourceRevision {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') ownerId!: string;
  @Column('text') fileName!: string;
  @Column({ type: 'text', select: false }) text!: string;
  @Column('varchar', { length: 64 }) textHash!: string;
  @Column('timestamptz') savedCvUpdatedAt!: Date;
  @Column({ type: 'jsonb', select: false }) provenance!: ParserProvenance;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'ai_job_hunter', name: 'cv_profile_revisions' })
export class CvProfileRevision {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') ownerId!: string;
  @Column('uuid') profileId!: string;
  @Column('integer') revision!: number;
  @Column('uuid') sourceRevisionId!: string;
  @Column({ type: 'jsonb', select: false }) document!: ProfileDocument;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ schema: 'ai_job_hunter', name: 'tailored_cv_drafts' })
export class TailoredCvDraft {
  @PrimaryColumn('uuid') id!: string;
  @Column('uuid') ownerId!: string;
  @Column('uuid') jobId!: string;
  @Column('uuid') profileRevisionId!: string;
  @Column('timestamptz') jobUpdatedAt!: Date;
  @Column('integer') revision!: number;
  @Column({ type: 'jsonb', select: false }) document!:
    ProfileDocument | TailoredDraftDocument;
  @Column({ type: 'jsonb', nullable: true, select: false })
  generationMetadata!: Record<string, unknown> | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column('timestamptz') updatedAt!: Date;
}
