import { TailoredCvModule } from './tailored-cv/tailored-cv.module.js';
import { InterviewPrepModule } from './interview-prep/interview-prep.module.js';
import { DiscoveryQueueModule } from './discovery/discovery-queue.module.js';
import { OpportunitiesModule } from './opportunities/opportunities.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AnalysisModule } from './analysis/analysis.module.js';
import { ExtractionModule } from './extraction/extraction.module.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MatchingModule } from './matching/matching.module.js';

@Module({
  imports: [
    DatabaseModule,
    TailoredCvModule,
    OpportunitiesModule,
    DiscoveryQueueModule,
    JobsModule,
    HealthModule,
    ExtractionModule,
    MatchingModule,
    AnalysisModule,
    InterviewPrepModule,
  ],
})
export class AppModule {}
