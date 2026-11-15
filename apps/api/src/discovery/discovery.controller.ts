import { replyAiLimit } from '../ai/ai-usage.js';
import {
  Body,
  Catch,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { localWrite } from '../opportunities/opportunities.security.js';
import { CurrentOwner } from '../auth/current-owner.js';
import { DiscoveryQueueService } from './discovery-queue.service.js';
import { DiscoveryQueueActionsService } from './discovery-queue-actions.service.js';
import { DiscoveryConflict } from './discovery-conflict.js';
import type { DiscoveryCandidate } from './discovery-candidate.entity.js';

export function candidateDto(row: DiscoveryCandidate, detail = false) {
  const {
    title,
    company,
    location,
    workMode,
    seniority,
    originalLink,
    discovery,
  } = row.snapshot;
  return {
    id: row.id,
    status: row.status,
    title,
    company,
    location,
    workMode,
    seniority,
    originalLink,
    sourceName: discovery.sourceName,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    opportunityId: row.opportunityId,
    ...(detail
      ? {
          description: row.snapshot.description,
          skills: row.snapshot.skills,
          preferredSkills: row.snapshot.preferredSkills,
          discovery,
        }
      : {}),
  };
}
@Catch()
export class DiscoveryErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    if (replyAiLimit(error, host)) return;
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    response.statusCode = status;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        statusCode: status,
        message:
          error instanceof HttpException
            ? error.message
            : 'Discovery storage unavailable. Retry later.',
        ...(error instanceof DiscoveryConflict
          ? { errorCode: error.errorCode, matches: error.matches }
          : {}),
      }),
    );
  }
}
@Controller('discovery')
@UseFilters(DiscoveryErrors)
export class DiscoveryController {
  constructor(
    private readonly queue: DiscoveryQueueService,
    private readonly actions: DiscoveryQueueActionsService,
  ) {}
  @Post('runs')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  run(
    @CurrentOwner() owner: string,
    @Req() req: IncomingMessage,
    @Body() body: unknown,
  ) {
    localWrite(req);
    return this.actions.run(owner, body);
  }
  @Get('candidates')
  @Header('Cache-Control', 'no-store')
  async list(@CurrentOwner() owner: string, @Query() query: unknown) {
    const result = await this.queue.list(owner, query);
    return { ...result, items: result.items.map((row) => candidateDto(row)) };
  }
  @Get('candidates/:id')
  @Header('Cache-Control', 'no-store')
  async get(
    @CurrentOwner() owner: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return candidateDto(await this.queue.get(owner, id), true);
  }
  @Patch('candidates/:id/status')
  @Header('Cache-Control', 'no-store')
  async status(
    @CurrentOwner() owner: string,
    @Req() req: IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    localWrite(req);
    return candidateDto(await this.actions.status(owner, id, body), true);
  }
  @Post('candidates/:id/save')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  save(
    @CurrentOwner() owner: string,
    @Req() req: IncomingMessage,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    localWrite(req);
    return this.actions.save(owner, id, body);
  }
}
