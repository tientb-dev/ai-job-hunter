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
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { LOCAL_OWNER_ID } from '../opportunities/opportunities.service.js';
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
  // Browser same-origin GETs omit Origin. POST reads preserve the strict guard.
  @Post('sources/:id')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  sourceRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.getSource(LOCAL_OWNER_ID, id);
  }
  @Post('sources/:id/content')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  contentRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.getSource(LOCAL_OWNER_ID, id, true);
  }
  @Post('sources/:id/profile')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  latestRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.latestForSource(LOCAL_OWNER_ID, id);
  }
  @Post('sources/:id/reusable-review')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reusableRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.reusableReview(LOCAL_OWNER_ID, id);
  }
  @Post('profile-revisions/:id')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  profileRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.service.getProfile(LOCAL_OWNER_ID, id);
  }
  @Post('drafts/:id')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  draftRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    version(body, []);
    return this.drafts.get(LOCAL_OWNER_ID, id);
  }
  @Post('jobs/:id/drafts/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  draftsRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const value = version(body, ['before']);
    return this.drafts.list(
      LOCAL_OWNER_ID,
      id,
      value.before === null ? {} : { before: value.before },
    );
  }
  @Post('sources')
  @Header('Cache-Control', 'no-store')
  capture(@Body() body: unknown) {
    return this.service.capture(LOCAL_OWNER_ID, body);
  }
  @Get('sources/:id')
  @Header('Cache-Control', 'no-store')
  source(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getSource(LOCAL_OWNER_ID, id);
  }
  // Full parsed text is available only through this explicit, protected read.
  @Get('sources/:id/content')
  @Header('Cache-Control', 'no-store')
  content(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getSource(LOCAL_OWNER_ID, id, true);
  }
  @Get('sources/:id/profile')
  @Header('Cache-Control', 'no-store')
  latest(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.latestForSource(LOCAL_OWNER_ID, id);
  }
  @Get('sources/:id/reusable-review')
  @Header('Cache-Control', 'no-store')
  reusable(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.reusableReview(LOCAL_OWNER_ID, id);
  }
  @Post('profiles/:id/proposal')
  @Header('Cache-Control', 'no-store')
  propose(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.propose(LOCAL_OWNER_ID, id, body);
  }
  @Post('profiles/:id/rebuild')
  @Header('Cache-Control', 'no-store')
  rebuild(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.propose(LOCAL_OWNER_ID, id, body, true);
  }
  @Post('profiles/:id/confirm-section')
  @Header('Cache-Control', 'no-store')
  confirmSection(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.confirmSection(LOCAL_OWNER_ID, id, body);
  }
  @Delete('sources/:id')
  @Header('Cache-Control', 'no-store')
  deleteSource(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.deleteSource(LOCAL_OWNER_ID, id);
  }
  @Post('profiles')
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown) {
    return this.service.createProfile(LOCAL_OWNER_ID, body);
  }
  @Get('profile-revisions/:id')
  @Header('Cache-Control', 'no-store')
  profile(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getProfile(LOCAL_OWNER_ID, id);
  }
  @Post('profiles/:id/revisions')
  @Header('Cache-Control', 'no-store')
  append(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.appendProfile(LOCAL_OWNER_ID, id, body);
  }
  @Delete('profiles/:id')
  @Header('Cache-Control', 'no-store')
  deleteProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.deleteProfile(LOCAL_OWNER_ID, id, body);
  }
  @Post('jobs/:id/drafts')
  @Header('Cache-Control', 'no-store')
  generateDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.generate(LOCAL_OWNER_ID, id, body);
  }
  // Read-only facts for the Dashboard; next steps are decided client-side.
  // POST like other private reads: browsers omit Origin on same-origin GETs.
  @Post('job-progress')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  jobProgress(@Body() body: unknown) {
    version(body, []);
    return this.drafts.progress(LOCAL_OWNER_ID);
  }
  @Post('jobs/:id/drafts/readiness')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  readiness(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.readiness(LOCAL_OWNER_ID, id, body);
  }
  @Get('jobs/:id/drafts')
  @Header('Cache-Control', 'no-store')
  listDrafts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
  ) {
    return this.drafts.list(LOCAL_OWNER_ID, id, query);
  }
  @Get('drafts/:id')
  @Header('Cache-Control', 'no-store')
  getDraft(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.drafts.get(LOCAL_OWNER_ID, id);
  }
  @Post('drafts/:id/review')
  @Header('Cache-Control', 'no-store')
  saveReview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.review(LOCAL_OWNER_ID, id, body);
  }
  @Post('drafts/:id/approve')
  @Header('Cache-Control', 'no-store')
  approveDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.drafts.review(LOCAL_OWNER_ID, id, body, true);
  }
  @Post('drafts/:id/export')
  async exportDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Res() response: ServerResponse,
  ) {
    const result = await this.exports.export(LOCAL_OWNER_ID, id, body);
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
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.deleteDraft(LOCAL_OWNER_ID, id, body);
  }
}
