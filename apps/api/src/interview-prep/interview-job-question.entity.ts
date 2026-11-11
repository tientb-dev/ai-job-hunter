import { Column, Entity, PrimaryColumn } from 'typeorm';

// Exposed to clients as "jd-<id>"; that string keys saved answers.
@Entity({ schema: 'ai_job_hunter', name: 'interview_job_questions' })
export class InterviewJobQuestion {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ type: 'uuid' }) ownerId!: string;
  @Column({ type: 'uuid' }) setId!: string;
  @Column({ type: 'smallint' }) position!: number;
  @Column({ type: 'text' }) category!:
    'skill' | 'architecture' | 'troubleshooting' | 'experience';
  @Column({ type: 'text' }) kind!: 'general' | 'hypothetical' | 'personal';
  @Column({ type: 'text' }) question!: string;
  @Column({ type: 'text' }) why!: string;
  @Column({ type: 'text' }) evidence!: string;
}
