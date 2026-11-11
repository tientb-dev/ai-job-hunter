import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JD_QUESTION_ID, resolveQuestion } from './job-questions.js';
import { AiService } from '../ai/ai.service.js';
import { AiError } from '../ai/ai.errors.js';
import { TailoredDraftService } from '../tailored-cv/tailored-draft.service.js';
import { INTERVIEW_QUESTIONS } from './interview-prep.questions.js';
import {
  EXPRESS_SCHEMA,
  InterviewPrepError,
  REVIEW_SCHEMA,
  buildResponse,
  expressPrompt,
  parseFeedbackRequest,
  reviewPrompt,
} from './interview-prep.policy.js';

const INVALID_OUTPUT = new Set([
  'INVALID_JSON',
  'SCHEMA_VALIDATION_FAILURE',
  'MALFORMED_RESPONSE',
  'OUTPUT_LIMIT_EXCEEDED',
  'RESPONSE_TOO_LARGE',
]);

@Injectable()
export class InterviewPrepService {
  // One local generation at a time, like other AI features on the single GPU.
  private active = false;
  constructor(
    private readonly ai: AiService,
    private readonly cv: TailoredDraftService,
    private readonly db: DataSource,
  ) {}

  /** Runs other local-AI work under the same one-at-a-time rule as feedback. */
  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.active) throw new InterviewPrepError('INTERVIEW_BUSY');
    this.active = true;
    try {
      return await work();
    } finally {
      this.active = false;
    }
  }

  // Database access only for an exact "jd-<uuid>"; curated IDs never reach it.
  private async generated(ownerId: string, body: unknown) {
    const id = (body as { questionId?: unknown } | null)?.questionId;
    if (typeof id !== 'string' || !JD_QUESTION_ID.test(id)) return undefined;
    try {
      return await resolveQuestion(this.db, ownerId, id);
    } catch {
      throw new InterviewPrepError('INTERVIEW_STORAGE_UNAVAILABLE');
    }
  }

  questions() {
    return {
      contractVersion: '1' as const,
      questions: INTERVIEW_QUESTIONS.map(
        ({ id, topic, category, kind, variants, hints }) => ({
          id,
          topic,
          category,
          kind,
          variants,
          hints,
        }),
      ),
    };
  }

  async feedback(ownerId: string, body: unknown) {
    const { question, mode, answer, questionText } = parseFeedbackRequest(
      body,
      await this.generated(ownerId, body),
    );
    if (this.active) throw new InterviewPrepError('INTERVIEW_BUSY');
    this.active = true;
    try {
      // Fact check is optional context; a read failure must not block practice.
      const facts = await this.cv.reviewedFacts(ownerId).catch(() => null);
      const text = questionText;
      const output = (await this.ai.generateStructured(
        mode === 'express'
          ? {
              prompt: expressPrompt(question, text, answer),
              schema: EXPRESS_SCHEMA,
            }
          : {
              prompt: reviewPrompt(question, text, answer),
              schema: REVIEW_SCHEMA,
            },
      )) as Record<string, unknown>;
      return buildResponse(mode, question, text, answer, output, facts);
    } catch (error) {
      if (error instanceof InterviewPrepError) throw error;
      if (error instanceof AiError) {
        if (error.code === 'TIMEOUT')
          throw new InterviewPrepError('INTERVIEW_TIMEOUT');
        if (INVALID_OUTPUT.has(error.code))
          throw new InterviewPrepError('INTERVIEW_INVALID_OUTPUT');
      }
      throw new InterviewPrepError('INTERVIEW_AI_UNAVAILABLE');
    } finally {
      this.active = false;
    }
  }
}
