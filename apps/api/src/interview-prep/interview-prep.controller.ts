import {
  Body,
  Catch,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  Res,
  Header,
  HttpCode,
  HttpException,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CurrentOwner } from '../auth/current-owner.js';
import { FoundationLocalGuard } from '../tailored-cv/tailored-cv.http.js';
import { InterviewPrepError } from './interview-prep.policy.js';
import { InterviewPrepService } from './interview-prep.service.js';
import { InterviewAnswersService } from './interview-answers.service.js';
import { InterviewSessionsService } from './interview-sessions.service.js';
import { JobQuestionsService } from './job-questions.service.js';
import { TranscriptionService } from './transcription.service.js';

export function interviewPrepError(error: unknown) {
  if (error instanceof InterviewPrepError)
    return {
      statusCode: error.status,
      errorCode: error.errorCode,
      message: error.message,
      ...(error.current !== undefined ? { current: error.current } : {}),
    };
  if (error instanceof HttpException && error.getStatus() === 403)
    return {
      statusCode: 403,
      errorCode: 'INTERVIEW_LOCAL_ONLY',
      message: 'Local browser requests only.',
    };
  if (error instanceof HttpException && error.getStatus() < 500)
    return {
      statusCode: error.getStatus(),
      errorCode: 'INTERVIEW_INVALID_REQUEST',
      message: new InterviewPrepError('INTERVIEW_INVALID_REQUEST').message,
    };
  // Never expose internal error details.
  return {
    statusCode: 503,
    errorCode: 'INTERVIEW_AI_UNAVAILABLE',
    message: new InterviewPrepError('INTERVIEW_AI_UNAVAILABLE').message,
  };
}
@Catch()
export class InterviewPrepErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const safe = interviewPrepError(error);
    response.statusCode = safe.statusCode;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(safe));
  }
}

@Controller('interview-prep')
@UseFilters(InterviewPrepErrors)
export class InterviewPrepController {
  constructor(
    private readonly service: InterviewPrepService,
    private readonly answers: InterviewAnswersService,
    private readonly jobQuestions: JobQuestionsService,
    private readonly stt: TranscriptionService,
    private readonly sessions: InterviewSessionsService,
  ) {}
  // Static, non-personal content: plain same-origin GET like other public reads.
  @Get('questions')
  questions() {
    return this.service.questions();
  }
  // Sends user text to the local model and reads reviewed CV facts: strict local policy.
  @Post('feedback')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  feedback(@CurrentOwner() owner: string, @Body() body: unknown) {
    return this.service.feedback(owner, body);
  }
  // Saved reference answers are personal data: strict local policy on every route.
  // Browsers omit Origin on same-origin GETs, so the read is a POST (tailored-cv convention).
  @Post('answers/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  async listAnswers(@CurrentOwner() owner: string, @Body() body: unknown) {
    if (
      !body ||
      typeof body !== 'object' ||
      Object.keys(body).join(',') !== 'contractVersion' ||
      (body as { contractVersion?: unknown }).contractVersion !== '1'
    )
      throw new InterviewPrepError(
        'INTERVIEW_INVALID_REQUEST',
        'Unsupported saved-answers request.',
      );
    return {
      contractVersion: '1' as const,
      answers: await this.answers.list(owner),
    };
  }
  @Put('answers/:questionId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  saveAnswer(
    @CurrentOwner() owner: string,
    @Param('questionId') questionId: string,
    @Body() body: unknown,
  ) {
    return this.answers.save(owner, questionId, body);
  }
  @Delete('answers/:questionId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  async removeAnswer(
    @CurrentOwner() owner: string,
    @Param('questionId') questionId: string,
    @Query('expectedVersion') expectedVersion: unknown,
  ) {
    await this.answers.remove(owner, questionId, expectedVersion);
  }
  // PR15: JD-generated question sets read job data: strict local policy, POST reads.
  @Post('jobs/:jobId/sets/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  listJobSets(
    @CurrentOwner() owner: string,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobQuestions.list(owner, jobId, body);
  }
  @Post('jobs/:jobId/sets')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  generateJobSet(
    @CurrentOwner() owner: string,
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobQuestions.generate(owner, jobId, body);
  }
  // PR16: raw 16 kHz mono PCM WAV body, never stored. Optional ?questionId=
  // only selects an owner-scoped vocabulary hint; no client prompt text.
  @Post('transcribe')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  transcribe(
    @CurrentOwner() owner: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
    @Query('questionId') questionId: unknown,
  ) {
    const abort = new AbortController();
    // Client gone before we answered: kill the CLI process.
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    return this.stt.transcribe(owner, req, questionId, abort.signal);
  }
  // PR17: mock interview sessions hold answer text and feedback (personal data):
  // strict local policy on every route, POST reads, owner-scoped in the service.
  @Post('sessions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  createSession(@CurrentOwner() owner: string, @Body() body: unknown) {
    return this.sessions.create(owner, body);
  }
  @Post('sessions/active')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  async activeSession(@CurrentOwner() owner: string, @Body() body: unknown) {
    return {
      contractVersion: '1' as const,
      session: await this.sessions.active(owner, body),
    };
  }
  @Post('sessions/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  listSessions(@CurrentOwner() owner: string, @Body() body: unknown) {
    return this.sessions.list(owner, body);
  }
  @Post('sessions/:sessionId/read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  readSession(
    @CurrentOwner() owner: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    return this.sessions.get(owner, sessionId, body);
  }
  @Put('sessions/:sessionId/items/:index')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  saveSessionItem(
    @CurrentOwner() owner: string,
    @Param('sessionId') sessionId: string,
    @Param('index') index: string,
    @Body() body: unknown,
  ) {
    return this.sessions.saveItem(owner, sessionId, index, body);
  }
  @Post('sessions/:sessionId/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  completeSession(
    @CurrentOwner() owner: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ) {
    return this.sessions.complete(owner, sessionId, body);
  }
  // Discard (active) and delete (completed) are the same removal.
  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  async removeSession(
    @CurrentOwner() owner: string,
    @Param('sessionId') sessionId: string,
    @Query('expectedVersion') expectedVersion: unknown,
  ) {
    await this.sessions.remove(owner, sessionId, expectedVersion);
  }
}
