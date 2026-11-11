import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { TailoredCvModule } from '../tailored-cv/tailored-cv.module.js';
import { FoundationLocalGuard } from '../tailored-cv/tailored-cv.http.js';
import { InterviewPrepController } from './interview-prep.controller.js';
import { InterviewPrepService } from './interview-prep.service.js';

// No entities and no persistence: practice text and audio are never stored.
@Module({
  imports: [AiModule, TailoredCvModule],
  controllers: [InterviewPrepController],
  providers: [InterviewPrepService, FoundationLocalGuard],
})
export class InterviewPrepModule {}
