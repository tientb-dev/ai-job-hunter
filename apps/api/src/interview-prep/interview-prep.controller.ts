import {
  Body,
  Catch,
  Controller,
  Get,
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

export function interviewPrepError(error: unknown) {
  if (error instanceof InterviewPrepError)
    return {
      statusCode: error.status,
      errorCode: error.errorCode,
      message: error.message,
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
  constructor(private readonly service: InterviewPrepService) {}
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
}
