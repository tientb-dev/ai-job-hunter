import { TailoredCvExportService } from './tailored-cv-export.js';
import { TailoredDraftGenerator } from './tailored-draft.generator.js';
import { TailoredDraftService } from './tailored-draft.service.js';
import { AiModule } from '../ai/ai.module.js';
import { SourceProfileProposalService } from './source-profile-proposal.js';
import { Module } from '@nestjs/common';
import { ReviewedCvModule } from '../reviewed-cv/reviewed-cv.module.js';
import { OpportunitiesModule } from '../opportunities/opportunities.module.js';
import { TailoredCvController } from './tailored-cv.controller.js';
import { TailoredCvService } from './tailored-cv.service.js';
import { FoundationLocalGuard } from './tailored-cv.http.js';

@Module({
  imports: [OpportunitiesModule, AiModule, ReviewedCvModule],
  controllers: [TailoredCvController],
  providers: [
    TailoredCvService,
    TailoredCvExportService,
    TailoredDraftGenerator,
    TailoredDraftService,
    FoundationLocalGuard,
    SourceProfileProposalService,
  ],
  // Interview Prep reads reviewed facts only through reviewedFacts().
  exports: [TailoredDraftService],
})
export class TailoredCvModule {}
