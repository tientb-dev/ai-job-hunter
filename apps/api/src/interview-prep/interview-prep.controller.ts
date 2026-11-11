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
  Header,
  HttpCode,
  HttpException,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { LOCAL_OWNER_ID } from '../opportunities/opportunities.service.js';
import { FoundationLocalGuard } from '../tailored-cv/tailored-cv.http.js';
import { InterviewPrepError } from './interview-prep.policy.js';
import { InterviewPrepService } from './interview-prep.service.js';
import { InterviewAnswersService } from './interview-answers.service.js';
import { JobQuestionsService } from './job-questions.service.js';

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
  feedback(@Body() body: unknown) {
    return this.service.feedback(LOCAL_OWNER_ID, body);
  }
  // Saved reference answers are personal data: strict local policy on every route.
  // Browsers omit Origin on same-origin GETs, so the read is a POST (tailored-cv convention).
  @Post('answers/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  async listAnswers(@Body() body: unknown) {
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
      answers: await this.answers.list(LOCAL_OWNER_ID),
    };
  }
  @Put('answers/:questionId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  saveAnswer(@Param('questionId') questionId: string, @Body() body: unknown) {
    return this.answers.save(LOCAL_OWNER_ID, questionId, body);
  }
  @Delete('answers/:questionId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  async removeAnswer(
    @Param('questionId') questionId: string,
    @Query('expectedVersion') expectedVersion: unknown,
  ) {
    await this.answers.remove(LOCAL_OWNER_ID, questionId, expectedVersion);
  }
  // PR15: JD-generated question sets read job data: strict local policy, POST reads.
  @Post('jobs/:jobId/sets/list')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  listJobSets(
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobQuestions.list(LOCAL_OWNER_ID, jobId, body);
  }
  @Post('jobs/:jobId/sets')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(FoundationLocalGuard)
  generateJobSet(
    @Param('jobId', new ParseUUIDPipe()) jobId: string,
    @Body() body: unknown,
  ) {
    return this.jobQuestions.generate(LOCAL_OWNER_ID, jobId, body);
  }
}
