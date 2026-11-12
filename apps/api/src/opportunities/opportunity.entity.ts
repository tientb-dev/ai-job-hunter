import type { DiscoveredJob } from '../discovery/discovery.js';
import type { ImportField } from './job-import.contract.js';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
export const SOURCES = [
  'Website',
  'Facebook',
  'Zalo',
  'Email',
  'Other',
] as const;
export const STATUSES = [
  'SAVED',
  'CONTACTED',
  'JD_RECEIVED',
  'APPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'CLOSED',
] as const;
export const FOLLOW_UP_STATUSES = ['PENDING', 'DONE', 'DISMISSED'] as const;
@Entity({ schema: 'ai_job_hunter', name: 'opportunities' })
export class Opportunity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'varchar', length: 300 }) title!: string;
  @Column({ type: 'varchar', length: 300 }) company!: string;
  @Column({ type: 'varchar', length: 20 }) source!: (typeof SOURCES)[number];
  @Column({ type: 'varchar', length: 20 }) status!: (typeof STATUSES)[number];
  @Column({ type: 'text' }) originalLink!: string;
  @Column({ type: 'text' }) contactNotes!: string;
  @Column({ type: 'text' }) description!: string;
  @Column({ type: 'text' }) notes!: string;
  @Column({ type: 'jsonb' }) contactDates!: string[];
  @Column({ type: 'date', nullable: true }) appliedDate!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true })
  applicationChannel!: string | null;
  @Column({ type: 'date', nullable: true }) followUpDate!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  followUpStatus!: (typeof FOLLOW_UP_STATUSES)[number];
  @Column({ type: 'text', default: '' }) agency!: string;
  @Column({ type: 'text', default: '' }) location!: string;
  @Column({ type: 'text', default: '' }) workMode!: string;
  @Column({ type: 'text', default: '' }) employmentType!: string;
  @Column({ type: 'text', default: '' }) seniority!: string;
  @Column({ type: 'text', default: '' }) skills!: string;
  @Column({ type: 'text', default: '' }) experience!: string;
  @Column({ type: 'text', default: '' }) preferredSkills!: string;
  @Column({ type: 'text', default: '' }) domain!: string;
  @Column({ type: 'text', default: '' }) salary!: string;
  @Column({ type: 'text', default: '' }) postText!: string;
  @Column({ type: 'text', default: '' }) jdText!: string;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  importReview!: ImportField[];
  @Column({ type: 'text', nullable: true }) documentName!: string | null;
  @Column({ type: 'text', nullable: true }) documentType!: string | null;
  @Column({ type: 'bytea', nullable: true, select: false })
  documentBytes!: Buffer | null;
  @Column({ type: 'jsonb', nullable: true }) discovery!:
    DiscoveredJob['discovery'] | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
