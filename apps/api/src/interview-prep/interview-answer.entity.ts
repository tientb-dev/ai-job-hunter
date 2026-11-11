import { Column, Entity, PrimaryColumn } from 'typeorm';

// Writes go through atomic SQL in InterviewAnswersService, not repository.save().
@Entity({ schema: 'ai_job_hunter', name: 'interview_answers' })
export class InterviewAnswer {
  @PrimaryColumn({ type: 'uuid' }) ownerId!: string;
  @PrimaryColumn({ type: 'text' }) questionId!: string;
  @Column({ type: 'text' }) answer!: string;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'timestamptz' }) updatedAt!: Date;
}
