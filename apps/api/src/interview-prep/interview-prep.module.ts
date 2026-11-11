import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { TailoredCvModule } from '../tailored-cv/tailored-cv.module.js';
import { FoundationLocalGuard } from '../tailored-cv/tailored-cv.http.js';
import { InterviewPrepController } from './interview-prep.controller.js';
import { InterviewPrepService } from './interview-prep.service.js';
import { InterviewAnswersService } from './interview-answers.service.js';
import { JobQuestionsService } from './job-questions.service.js';
import { TranscriptionService } from './transcription.service.js';
import { OpportunitiesModule } from '../opportunities/opportunities.module.js';

// Persists only the current reference answer per question (interview_answers).
// Practice text, AI feedback, audio and transcripts are never stored. PR15 adds append-only
// JD-generated question sets (interview_question_sets/interview_job_questions).
@Module({
  imports: [AiModule, TailoredCvModule, OpportunitiesModule],
  controllers: [InterviewPrepController],
  providers: [
    InterviewPrepService,
    InterviewAnswersService,
    JobQuestionsService,
    TranscriptionService,
    FoundationLocalGuard,
  ],
})
export class InterviewPrepModule {}
