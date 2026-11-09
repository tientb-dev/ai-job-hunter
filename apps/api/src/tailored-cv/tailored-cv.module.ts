import { TailoredCvExportService } from './tailored-cv-export.js';
import { TailoredDraftGenerator } from './tailored-draft.generator.js';
import { TailoredDraftService } from './tailored-draft.service.js';
import { AiModule } from '../ai/ai.module.js';
import { SourceProfileProposalService } from './source-profile-proposal.js';
import { Module } from '@nestjs/common';
import { OpportunitiesModule } from '../opportunities/opportunities.module.js';
import { TailoredCvController } from './tailored-cv.controller.js';
import { TailoredCvService } from './tailored-cv.service.js';
import { FoundationLocalGuard } from './tailored-cv.http.js';

@Module({
  imports: [OpportunitiesModule, AiModule],
  controllers: [TailoredCvController],
  providers: [
    TailoredCvService,
    TailoredCvExportService,
    TailoredDraftGenerator,
    TailoredDraftService,
    FoundationLocalGuard,
    SourceProfileProposalService,
  ],
})
export class TailoredCvModule {}
