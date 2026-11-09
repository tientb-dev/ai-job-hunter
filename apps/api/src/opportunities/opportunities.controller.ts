import { CvSuggestionsError } from '../matching/cv-suggestions.error.js';
import { importTopcvPage } from './topcv-page-import.js';
import { PinnedJobPageTransport } from './job-url.transport.js';
import { JobUrlImportService } from './job-url-import.js';
import { CvMatchError } from '../matching/cv-match.error.js';
import { JobMatchService } from '../matching/job-match.service.js';
import { JobDocumentError } from './job-document.error.js';
import { localWrite } from './opportunities.security.js';
import { JobImportService } from './job-import.service.js';
import { readJobUpload } from './job-import.upload.js';
import { Catch, HttpException, UseFilters } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { OpportunitiesService } from './opportunities.service.js';
import { EXTRACTION_LIMITS } from '../extraction/extraction.limits.js';
@Catch()
export class OpportunityErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    response.statusCode = status;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'close');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        statusCode: status,
        ...(error instanceof CvMatchError || error instanceof CvSuggestionsError
          ? { errorCode: error.errorCode }
          : {}),
        ...(error instanceof JobDocumentError
          ? {
              errorCode: error.errorCode,
              parserReason: error.parserReason ?? null,
            }
          : {}),
        message:
          error instanceof HttpException
            ? error.message
            : 'Opportunity storage unavailable. Retry later.',
      }),
    );
  }
}
@Controller('opportunities')
@UseFilters(OpportunityErrors)
export class OpportunitiesController {
  private readonly urlImports = new JobUrlImportService(
    new PinnedJobPageTransport(),
  );
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly imports: JobImportService,
    private readonly matches: JobMatchService,
  ) {}
  @Get() @Header('Cache-Control', 'no-store') list() {
    return this.opportunities.list();
  }
  @Get('duplicate-url')
  @Header('Cache-Control', 'no-store')
  duplicateUrl(@Query('url') url: unknown) {
    return this.opportunities.duplicateUrl(url);
  }
  @Post('import-url')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  importUrl(@Req() req: IncomingMessage, @Body() body: unknown) {
    localWrite(req);
    const url =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).url
        : undefined;
    return this.urlImports.preview(url);
  }
  @Post('import-page')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  importPage(@Req() req: IncomingMessage, @Body() body: unknown) {
    localWrite(req);
    return importTopcvPage(body);
  }
  @Post('discover')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  discover(@Req() req: IncomingMessage) {
    localWrite(req);
    throw new GoneException(
      'Direct discovery import has been retired. Reload Discover Jobs to review candidates in the queue and explicitly save them to Inbox.',
    );
  }
  @Get('cv/current')
  @Header('Cache-Control', 'no-store')
  cv() {
    return this.matches.cv();
  }
  @Post('cv/current')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async saveCv(@Req() req: IncomingMessage) {
    localWrite(req);
    return this.matches.saveCv((await readJobUpload(req)).document);
  }
  @Get(':id/match')
  @Header('Cache-Control', 'no-store')
  currentMatch(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.matches.currentMatch(id);
  }
  @Post(':id/match')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  match(
    @Req() req: IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    localWrite(req);
    return this.matches.analyze(id);
  }
  @Post(':id/cv-improvement-suggestions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  suggest(
    @Req() req: IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    localWrite(req);
    return this.matches.suggest(id, body);
  }
  @Get(':id') @Header('Cache-Control', 'no-store') get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.opportunities.get(id);
  }
  @Post() async create(@Req() req: IncomingMessage, @Body() body: unknown) {
    localWrite(req);
    if (req.headers['content-type']?.startsWith('multipart/form-data')) {
      const upload = await readJobUpload(req);
      return this.opportunities.create(upload.record, upload.document);
    }
    return this.opportunities.create(body);
  }
  @Put(':id') async update(
    @Req() req: IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    localWrite(req);
    if (req.headers['content-type']?.startsWith('multipart/form-data')) {
      const upload = await readJobUpload(req);
      return this.opportunities.update(id, upload.record, upload.document);
    }
    return this.opportunities.update(id, body);
  }
  @Post('extract')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async extract(@Req() req: IncomingMessage) {
    localWrite(req);
    return this.imports.extract(await readJobUpload(req));
  }
  @Post(':id/extract')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async extractExisting(
    @Req() req: IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    localWrite(req);
    const row = await this.opportunities.get(id);
    const upload = await readJobUpload(req);
    if (row.documentName) {
      if (upload.document)
        throw new BadRequestException('The original JD is preserved.');
      upload.document = await this.opportunities.document(id);
    }
    return this.imports.extract(upload);
  }
  @Get(':id/document')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: ServerResponse,
  ) {
    const document = await this.opportunities.document(id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName).replace(/'/g, '%27')}`,
    );
    res.end(document.bytes);
  }
  @Post('parse-document')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async parse(@Req() req: IncomingMessage) {
    localWrite(req);
    const type = req.headers['content-type'];
    const extension =
      type === 'application/pdf'
        ? 'pdf'
        : type ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ? 'docx'
          : null;
    if (!extension)
      throw new BadRequestException(
        'Only PDF and DOCX are supported. Paste text for other formats.',
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const fail = () => {
          req.pause();
          reject(new BadRequestException('Upload failed or exceeds 5 MiB.'));
        };
        timer = setTimeout(fail, 15000);
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > EXTRACTION_LIMITS.fileBytes) {
            fail();
            return;
          }
          chunks.push(chunk);
        });
        req.once('end', () => resolve(Buffer.concat(chunks)));
        req.once('error', fail);
        req.once('aborted', fail);
      });
      clearTimeout(timer);
      const parsed = await this.imports.parse({
        bytes,
        fileName: `job.${extension}`,
        mediaType: type!,
      });
      return { text: parsed.source.text, warnings: parsed.warnings };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'Could not parse document. Paste JD text instead.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
