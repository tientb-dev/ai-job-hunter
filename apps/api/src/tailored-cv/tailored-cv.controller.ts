import { version } from './tailored-cv.contract.js';
import { TailoredCvExportService } from './tailored-cv-export.js';
import type { ServerResponse } from 'node:http';
import { TailoredDraftService } from './tailored-draft.service.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { CurrentOwner } from '../auth/current-owner.js';
import { TailoredCvService } from './tailored-cv.service.js';
import { FoundationErrors, FoundationLocalGuard } from './tailored-cv.http.js';

@Controller('tailored-cv')
@UseGuards(FoundationLocalGuard)
@UseFilters(FoundationErrors)
export class TailoredCvController {
  constructor(
    private readonly service: TailoredCvService,
    private readonly drafts: TailoredDraftService,
    private readonly exports: TailoredCvExportService,
  ) {}
  // My CV review summaries: read-only, never captures a source.
  @Post('saved-cv-reviews/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  savedCvReviews(@CurrentOwner() owner: string, @Body() body: unknown) {
    version(body, []);
    return this.service.savedCvReviews(owner);
  }
  // Browser same-origin GETs omit Origin. POST reads preserve the strict guard.
  @Post('sources/:id')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  sourceRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.getSource(owner, id);
  }
  @Post('sources/:id/content')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  contentRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.getSource(owner, id, true);
  }
  @Post('sources/:id/profile')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  latestRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.latestForSource(owner, id);
  }
  @Post('sources/:id/reusable-review')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reusableRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.reusableReview(owner, id);
  }
  @Post('profile-revisions/:id')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  profileRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.getProfile(owner, id);
  }
  @Post('drafts/:id')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  draftRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.drafts.get(owner, id);
  }
  @Post('jobs/:id/drafts/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  draftsRead(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const value = version(body, ['before']);
    return this.drafts.list(
      owner,
      id,
      value.before === null ? {} : { before: value.before },
    );
  }
  @Post('sources')
  @Header('Cache-Control', 'no-store')
  capture(@CurrentOwner() owner: string, @Body() body: unknown) {
    return this.service.capture(owner, body);
  }
  @Get('sources/:id')
  @Header('Cache-Control', 'no-store')
  source(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.getSource(owner, id);
  }
  // Full parsed text is available only through this explicit, protected read.
  @Get('sources/:id/content')
  @Header('Cache-Control', 'no-store')
  content(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.getSource(owner, id, true);
  }
  @Get('sources/:id/profile')
  @Header('Cache-Control', 'no-store')
  latest(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.latestForSource(owner, id);
  }
  @Get('sources/:id/reusable-review')
  @Header('Cache-Control', 'no-store')
  reusable(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.reusableReview(owner, id);
  }
  @Post('profiles/:id/proposal')
  @Header('Cache-Control', 'no-store')
  propose(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.propose(owner, id, body);
  }
  @Post('profiles/:id/rebuild')
  @Header('Cache-Control', 'no-store')
  rebuild(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.propose(owner, id, body, true);
  }
  @Post('profiles/:id/confirm-section')
  @Header('Cache-Control', 'no-store')
  confirmSection(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.confirmSection(owner, id, body);
  }
  @Delete('sources/:id')
  @Header('Cache-Control', 'no-store')
  deleteSource(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.deleteSource(owner, id);
  }
  @Post('profiles')
  @Header('Cache-Control', 'no-store')
  create(@CurrentOwner() owner: string, @Body() body: unknown) {
    return this.service.createProfile(owner, body);
  }
  @Get('profile-revisions/:id')
  @Header('Cache-Control', 'no-store')
  profile(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.getProfile(owner, id);
  }
  @Post('profiles/:id/revisions')
  @Header('Cache-Control', 'no-store')
  append(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.appendProfile(owner, id, body);
  }
  @Delete('profiles/:id')
  @Header('Cache-Control', 'no-store')
  deleteProfile(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.deleteProfile(owner, id, body);
  }
  @Post('jobs/:id/drafts')
  @Header('Cache-Control', 'no-store')
  generateDraft(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.generate(owner, id, body);
  }
  // Read-only facts for the Dashboard; next steps are decided client-side.
  // POST like other private reads: browsers omit Origin on same-origin GETs.
  @Post('job-progress')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  jobProgress(@CurrentOwner() owner: string, @Body() body: unknown) {
    version(body, []);
    return this.drafts.progress(owner);
  }
  @Post('jobs/:id/drafts/readiness')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readiness(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.readiness(owner, id, body);
  }
  @Get('jobs/:id/drafts')
  @Header('Cache-Control', 'no-store')
  listDrafts(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return this.drafts.list(owner, id, query);
  }
  @Get('drafts/:id')
  @Header('Cache-Control', 'no-store')
  getDraft(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.drafts.get(owner, id);
  }
  @Post('drafts/:id/review')
  @Header('Cache-Control', 'no-store')
  saveReview(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.review(owner, id, body);
  }
  /** Saves the PDF export template only; revision and approval are unchanged. */
  @Put('drafts/:id/template')
  @Header('Cache-Control', 'no-store')
  setTemplate(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.setTemplate(owner, id, body);
  }
  @Post('drafts/:id/approve')
  @Header('Cache-Control', 'no-store')
  approveDraft(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.review(owner, id, body, true);
  }
  @Post('drafts/:id/source-update/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  previewSourceUpdate(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.sourceUpdate(owner, id, body, false);
  }

  @Post('drafts/:id/source-update')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  applySourceUpdate(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.sourceUpdate(owner, id, body, true);
  }

  @Post('drafts/:id/export')
  async exportDraft(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() response: ServerResponse,
  ) {
    const result = await this.exports.export(owner, id, body);
    response.statusCode = 200;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', result.mime);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    response.setHeader('Content-Length', result.buffer.length);
    response.end(result.buffer);
  }
  @Delete('drafts/:id')
  @Header('Cache-Control', 'no-store')
  deleteDraft(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.deleteDraft(owner, id, body);
  }
}
