import { describe, expect, test } from '@jest/globals';
import {
  buildResponse,
  type FeedbackResponse,
} from '../../src/interview-prep/interview-prep.policy.js';
import { findQuestion } from '../../src/interview-prep/interview-prep.questions.js';
import {
  parseCreate,
  parseFeedback,
  parseItem,
  sessionDto,
} from '../../src/interview-prep/interview-sessions.policy.js';

const Q = 'hr-intro-01';
// A real response from the feedback builder, so the validator tracks the actual schema.
const real = (mode: 'express' | 'review'): FeedbackResponse =>
  buildResponse(
    mode,
    findQuestion(Q)!,
    'Tell me about yourself.',
    'I am a backend developer.',
    {
      answersQuestion: 'yes',
      mainIssue: 'Add one concrete example.',
      corrections: [],
      suggestion: 'I am a backend developer who enjoys building reliable APIs.',
      followUpQuestions: ['What do you enjoy most about backend work?'],
      phrases: [
        { text: 'I enjoy building reliable systems', noteVi: 'ghi chú' },
      ],
    },
    null,
  );

describe('parseFeedback', () => {
  test.each(['express', 'review'] as const)(
    'accepts a real %s FeedbackResponse',
    (mode) => {
      const f = real(mode);
      expect(parseFeedback(JSON.parse(JSON.stringify(f)), Q)).toEqual(f);
    },
  );
  test.each<[string, (f: Record<string, unknown>) => void]>([
    ['extra key', (f) => (f.extra = 1)],
    ['missing key', (f) => delete f.phrases],
    ['other question', (f) => (f.questionId = 'hr-goals-01')],
    ['bad mode', (f) => (f.mode = 'chat')],
    ['bad verdict', (f) => (f.answersQuestion = 'maybe')],
    ['long suggestion', (f) => (f.suggestion = 'x'.repeat(901))],
    ['too many follow-ups', (f) => (f.followUpQuestions = ['a', 'b', 'c'])],
    [
      'phrase extra key',
      (f) => (f.phrases = [{ text: 'a', noteVi: 'b', x: 1 }]),
    ],
    [
      'bad withheld',
      (f) => ((f.suggestion = null), (f.suggestionWithheld = 'X')),
    ],
    ['suggestion and withheld', (f) => (f.suggestionWithheld = 'TOO_LONG')],
    ['bad cvCheck', (f) => (f.cvCheck = { status: 'checked' })],
    [
      'notices when unavailable',
      (f) => (f.cvCheck = { status: 'unavailable', notices: ['n'] }),
    ],
  ])('rejects %s', (_, mutate) => {
    const f = JSON.parse(JSON.stringify(real('review'))) as Record<
      string,
      unknown
    >;
    mutate(f);
    expect(() => parseFeedback(f, Q)).toThrow(
      expect.objectContaining({ errorCode: 'INTERVIEW_INVALID_REQUEST' }),
    );
  });
  test('express feedback cannot carry review-only fields', () => {
    const f = { ...real('express'), mainIssue: 'Sneaky.' };
    expect(() => parseFeedback(f, Q)).toThrow();
  });
});

describe('parseItem', () => {
  test('answer without feedback is allowed (feedback optional)', () => {
    expect(
      parseItem(
        { expectedVersion: 1, answer: ' Hello\r\n ', feedback: null },
        Q,
      ),
    ).toEqual({
      expectedVersion: 1,
      item: { questionId: Q, answer: 'Hello', feedback: null, skipped: false },
    });
  });
  test('skip is answer null and requires feedback null', () => {
    expect(
      parseItem({ expectedVersion: 2, answer: null, feedback: null }, Q).item,
    ).toEqual({ questionId: Q, answer: null, feedback: null, skipped: true });
    expect(() =>
      parseItem(
        { expectedVersion: 2, answer: null, feedback: real('express') },
        Q,
      ),
    ).toThrow();
  });
  test.each([
    { expectedVersion: 1, answer: '', feedback: null },
    { expectedVersion: 1, answer: 'x'.repeat(1501), feedback: null },
    { expectedVersion: 1, answer: 'a\u0007b', feedback: null },
    { expectedVersion: 0, answer: 'ok', feedback: null },
    { expectedVersion: 1, answer: 'ok' },
    { expectedVersion: 1, answer: 'ok', feedback: null, audio: 'x' },
  ])('rejects %j', (body) => {
    expect(() => parseItem(body, Q)).toThrow();
  });
});

describe('parseCreate', () => {
  test('accepts curated and job requests within 5–8', () => {
    expect(
      parseCreate({ contractVersion: '1', source: 'curated', count: 5 }),
    ).toEqual({
      source: 'curated',
      count: 5,
    });
    const jobId = '11111111-1111-4111-8111-111111111111';
    const setId = '22222222-2222-4222-8222-222222222222';
    expect(
      parseCreate({
        contractVersion: '1',
        source: 'job',
        count: 8,
        jobId,
        setId,
      }),
    ).toEqual({ source: 'job', count: 8, jobId, setId });
  });
  test.each([
    { contractVersion: '1', source: 'curated', count: 4 },
    { contractVersion: '1', source: 'curated', count: 9 },
    { contractVersion: '1', source: 'curated', count: 5, jobId: 'x' },
    {
      contractVersion: '1',
      source: 'job',
      count: 5,
      jobId: 'nope',
      setId: 'nope',
    },
    { contractVersion: '2', source: 'curated', count: 5 },
  ])('rejects %j', (body) => {
    expect(() => parseCreate(body)).toThrow();
  });
});

test('summary separates skipped from unanswered and counts feedback and verdicts', () => {
  const base = { questionText: 'Q?', feedback: null, skipped: false };
  const dto = sessionDto({
    id: 'id',
    source: 'curated',
    jobId: null,
    status: 'completed',
    currentIndex: 2,
    version: 3,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    items: [
      { ...base, questionId: Q, answer: 'A', feedback: real('review') },
      { ...base, questionId: 'b', answer: null, skipped: true },
      { ...base, questionId: 'c', answer: null },
    ],
  });
  expect(dto.summary).toEqual({
    total: 3,
    answered: 1,
    skipped: 1,
    unanswered: 1,
    withFeedback: 1,
    answersQuestion: { yes: 1, partly: 0, no: 0 },
  });
});
