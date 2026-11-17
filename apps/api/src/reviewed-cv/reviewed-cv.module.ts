import { Module } from '@nestjs/common';
import { ReviewedCvService } from './reviewed-cv.service.js';

// No imports: Matching and Tailored CV both consume it without a cycle.
@Module({ providers: [ReviewedCvService], exports: [ReviewedCvService] })
export class ReviewedCvModule {}
