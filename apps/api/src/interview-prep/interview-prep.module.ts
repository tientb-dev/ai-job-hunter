import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { TailoredCvModule } from '../tailored-cv/tailored-cv.module.js';
import { FoundationLocalGuard } from '../tailored-cv/tailored-cv.http.js';
import { InterviewPrepController } from './interview-prep.controller.js';
import { InterviewPrepService } from './interview-prep.service.js';
import { InterviewAnswersService } from './interview-answers.service.js';

// Persists only the current reference answer per question (interview_answers).
// Practice text, AI feedback and audio are never stored.
@Module({
  imports: [AiModule, TailoredCvModule],
  controllers: [InterviewPrepController],
  providers: [
    InterviewPrepService,
    InterviewAnswersService,
    FoundationLocalGuard,
  ],
})
export class InterviewPrepModule {}
