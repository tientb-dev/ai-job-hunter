import 'reflect-metadata';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TranscriptionService } from '../../src/interview-prep/transcription.service.js';
import { fakeStt, wav } from '../support/fake-stt.js';
import { JD_QUESTION_ID } from '../../src/interview-prep/job-questions.js';
import { JobQuestionsService } from '../../src/interview-prep/job-questions.service.js';
import { AiService } from '../../src/ai/ai.service.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { TailoredDraftService } from '../../src/tailored-cv/tailored-draft.service.js';
import { FoundationLocalGuard } from '../../src/tailored-cv/tailored-cv.http.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { InterviewPrepController } from '../../src/interview-prep/interview-prep.controller.js';
import { InterviewPrepService } from '../../src/interview-prep/interview-prep.service.js';
import {
  INTERVIEW_QUESTIONS,
  findQuestion,
} from '../../src/interview-prep/interview-prep.questions.js';
import {
  EXPRESS_SCHEMA,
  REVIEW_SCHEMA,
  buildResponse,
  cvNotices,
  guardCorrections,
  guardPhrases,
  guardSuggestion,
  changesMeaning,
  keepTechnicalNote,
  languageIssue,
  newNumbers,
  numberValues,
  parseFeedbackRequest,
} from '../../src/interview-prep/interview-prep.policy.js';
import { compileOutputSchema } from '../../src/ai/ai.schema.js';
import {
  InterviewAnswersService,
  MAX_REFERENCE_ANSWER,
  parseSaveBody,
  parseVersion,
} from '../../src/interview-prep/interview-answers.service.js';
import {
  PUBLISHED_QUESTION_IDS,
  RETIRED_QUESTION_IDS,
} from '../../src/interview-prep/interview-prep.questions.js';
import { InterviewPrepError } from '../../src/interview-prep/interview-prep.policy.js';

const q = (id: string) => findQuestion(id)!;
const CV = [
  'Backend engineer with 6 years of experience.',
  'Node.js, NestJS, PostgreSQL, Redis',
  'Technical lead for a team of 4 engineers.',
  'Reduced report time from 40 seconds to 5 seconds.',
];
const output = (overrides: Record<string, unknown> = {}) => ({
  answersQuestion: 'yes',
  mainIssue: 'Use the past tense for finished actions.',
  corrections: [],
  suggestion: 'I am good at solving problems.',
  followUpQuestions: ['What was the result?'],
  phrases: [
    {
      text: 'One of my strengths is...',
      noteVi: 'Một điểm mạnh của tôi là...',
    },
  ],
  technicalNote: '',
  ...overrides,
});

describe('question bank', () => {
  test('has stable unique ids, both topics, variants and no personal tech assumptions', () => {
    const ids = INTERVIEW_QUESTIONS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      INTERVIEW_QUESTIONS.filter((x) => x.topic === 'hr').length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      INTERVIEW_QUESTIONS.filter((x) => x.topic === 'technical').length,
    ).toBeGreaterThanOrEqual(5);
    for (const x of INTERVIEW_QUESTIONS) {
      // PR14 split some questions to one wording each: one ID = one meaning.
      expect(x.variants.length).toBeGreaterThanOrEqual(1);
      // "Why did you use RabbitMQ?" would assume experience the user may not have.
      if (x.kind === 'personal')
        for (const v of x.variants)
          expect(v).not.toMatch(/RabbitMQ|Kafka|Redis|Java\b/u);
    }
  });
  test('model schemas are accepted by the shared AI schema compiler', () => {
    expect(() => compileOutputSchema(EXPRESS_SCHEMA)).not.toThrow();
    expect(() => compileOutputSchema(REVIEW_SCHEMA)).not.toThrow();
  });
});

describe('request validation', () => {
  const ok = {
    questionId: 'hr-strengths-01',
    mode: 'express',
    answer: 'Mình giỏi phân tích, likes debugging.',
  };
  test('accepts Vietnamese, English and mixed input', () => {
    expect(parseFeedbackRequest(ok).answer).toBe(ok.answer);
    expect(
      parseFeedbackRequest({
        ...ok,
        mode: 'review',
        answer: 'I am good at debugging.',
      }).mode,
    ).toBe('review');
  });
  test.each([
    ['unknown question', { ...ok, questionId: 'hr-nope' }],
    ['bad mode', { ...ok, mode: 'translate' }],
    ['empty', { ...ok, answer: '   ' }],
    ['oversized', { ...ok, answer: 'a'.repeat(1501) }],
    ['control characters', { ...ok, answer: 'hi\u0000' }],
    ['extra keys', { ...ok, ownerId: 'x' }],
    ['non-object', 'text'],
  ])('rejects %s', (_name, body) => {
    expect(() => parseFeedbackRequest(body)).toThrow(
      expect.objectContaining({ errorCode: 'INTERVIEW_INVALID_REQUEST' }),
    );
  });
});

describe('number handling', () => {
  test('normalizes digits, English and Vietnamese number words', () => {
    expect([...numberValues('thirty percent')]).toEqual([30]);
    expect([...numberValues('30%')]).toEqual([30]);
    expect(numberValues('one million dollars').has(1e6)).toBe(true);
    expect(numberValues('1,000,000 users').has(1e6)).toBe(true);
    expect(numberValues('ba mươi phần trăm').has(30)).toBe(true);
    expect(numberValues('10 triệu').has(1e7)).toBe(true);
    expect(numberValues('a team of six people').has(6)).toBe(true);
  });
  test('equivalent expressions are not new numbers; changed ones are', () => {
    expect(
      newNumbers('It was thirty percent faster.', 'nhanh hơn 30%'),
    ).toEqual([]);
    expect(newNumbers('My team had six people.', 'team 6 người')).toEqual([]);
    expect(newNumbers('One of my strengths', 'Mình giỏi')).toEqual([]); // "one" is everywhere
    expect(
      newNumbers('about 2500 to 300.000 VND', '2500 đến 3000 USD'),
    ).toEqual([300]);
  });
});

describe('suggestion guard', () => {
  test('keeps a faithful Vietnamese-to-English suggestion', () => {
    const notes =
      'Mình giỏi phân tích vấn đề, thường tìm nguyên nhân trước khi đưa giải pháp.';
    expect(
      guardSuggestion(
        'I am good at analysing problems. I find the cause before a solution.',
        notes,
        'Q?',
        { kind: 'personal', mode: 'express' },
      ),
    ).toBeNull();
  });
  test('withholds added numeric achievements', () => {
    expect(
      guardSuggestion(
        'I made the API 70% faster.',
        'Mình làm API nhanh hơn.',
        'Q?',
      ),
    ).toBe('CHANGED_FACTS');
  });
  test('withholds added technologies but allows ones named in the question', () => {
    expect(
      guardSuggestion(
        'I used Kafka for events.',
        'Mình gửi event giữa service.',
        'Q?',
      ),
    ).toBe('CHANGED_FACTS');
    expect(
      guardSuggestion(
        'A queue like RabbitMQ stores messages.',
        'hàng đợi lưu message',
        'What is RabbitMQ?',
      ),
    ).toBeNull();
  });
  test('withholds personal experience invented for a concept question', () => {
    expect(
      guardSuggestion(
        'I use RabbitMQ to send messages.',
        'RabbitMQ gửi message',
        'What is RabbitMQ?',
        { kind: 'general' },
      ),
    ).toBe('CHANGED_FACTS');
    expect(
      guardSuggestion(
        'I use RabbitMQ to send messages.',
        'Mình dùng RabbitMQ gửi message',
        'What is RabbitMQ?',
        { kind: 'general' },
      ),
    ).toBeNull();
    // Regression: diacritics must not make a Vietnamese letter look like the pronoun "I".
    expect(
      guardSuggestion('I use a queue.', 'hệ thống gửi đi xử lý', 'Q?', {
        kind: 'general',
      }),
    ).toBe('CHANGED_FACTS');
  });
  test('withholds garbled, too long, empty and padded review suggestions', () => {
    expect(
      guardSuggestion("I've led a team of . I work hard.", 'x', 'Q?'),
    ).toBe('UNCLEAR');
    expect(guardSuggestion('Sentence. '.repeat(8), 'x', 'Q?')).toBe('TOO_LONG');
    expect(guardSuggestion('', 'x', 'Q?')).toBe('NOT_ENOUGH_DETAIL');
    expect(
      guardSuggestion(
        'I check logs. This is common. Have good logs.',
        'I check the log.',
        'Q?',
        { mode: 'review' },
      ),
    ).toBe('CHANGED_FACTS');
  });
});

describe('corrections and phrases', () => {
  test('keeps only corrections quoted from the answer and drops no-ops', () => {
    const answer = 'I has lead a team.  It take six months.';
    expect(
      guardCorrections(
        [
          { original: 'I has lead', better: 'I have led' },
          { original: 'It take six months', better: 'It took six months' },
          { original: 'I managed ten teams', better: 'I managed teams' },
          { original: 'a team', better: 'a team' },
        ],
        answer,
      ),
    ).toEqual([
      { original: 'I has lead', better: 'I have led' },
      { original: 'It take six months', better: 'It took six months' },
    ]);
  });
  test('drops phrases containing numbers, tools or long claims', () => {
    expect(
      guardPhrases([
        { text: 'In my current role, I...', noteVi: 'Ở vị trí hiện tại...' },
        { text: 'I improved performance by 40%...', noteVi: '' },
        { text: 'We used Kafka to...', noteVi: '' },
        { text: 'word '.repeat(20), noteVi: '' },
      ]),
    ).toEqual([
      { text: 'In my current role, I...', noteVi: 'Ở vị trí hiện tại...' },
    ]);
  });
  test('concept questions drop experience-claim starters unless the user spoke in first person', () => {
    const phrases = [
      { text: 'I use message queues to send messages...', noteVi: '' },
      { text: 'A message queue lets services...', noteVi: '' },
    ];
    expect(
      guardPhrases(phrases, {
        kind: 'general',
        userText: 'message queue giúp service gửi message',
      }).map((p) => p.text),
    ).toEqual(['A message queue lets services...']);
    expect(
      guardPhrases(phrases, {
        kind: 'general',
        userText: 'Mình dùng message queue',
      }),
    ).toHaveLength(2);
    expect(
      guardPhrases(phrases, { kind: 'personal', userText: 'x' }),
    ).toHaveLength(2);
  });
});

describe('CV notices', () => {
  test('neutral wording for metrics and tools absent from the reviewed CV', () => {
    const result = cvNotices(
      q('hr-achievement-01'),
      'I improved the API by 70% and used Kafka. My team had 4 engineers.',
      CV,
    );
    expect(result.status).toBe('checked');
    expect(result.notices).toHaveLength(2);
    for (const n of result.notices) {
      expect(n).toMatch(
        /isn't in your reviewed CV\. That doesn't mean it's wrong/u,
      );
      expect(n).not.toMatch(/invent|false|lie|fake/iu);
    }
    expect(result.notices.join(' ')).toMatch(/70%/u);
    expect(result.notices.join(' ')).toMatch(/Kafka/u);
  });
  test('Vietnamese metric units are detected', () => {
    const r = cvNotices(
      q('hr-achievement-01'),
      'Mình giúp tiết kiệm 2 tỷ đồng, phục vụ 50000 người dùng, team 4 người.',
      CV,
    );
    expect(r.notices.join(' ')).toMatch(/2 tỷ/u);
    expect(r.notices.join(' ')).toMatch(/50000 người dùng/u);
    expect(r.notices.join(' ')).not.toMatch(/4 người/u); // the CV supports a team of 4
  });
  test('ordinary numbers are not treated as fabricated achievements', () => {
    expect(
      cvNotices(q('hr-salary-01'), '2500 to 3000 USD per month', CV),
    ).toEqual({ status: 'not_applicable', notices: [] });
    expect(
      cvNotices(
        q('hr-availability-01'),
        'I can start in 30 days, from March 2027.',
        CV,
      ).notices,
    ).toEqual([]);
    expect(
      cvNotices(
        q('hr-intro-01'),
        'I graduated in 2018 and have worked for 6 years.',
        CV,
      ).notices,
    ).toEqual([]);
  });
  test('no reviewed CV means the check is reported unavailable, not passed', () => {
    expect(
      cvNotices(q('hr-achievement-01'), 'I saved 1 million dollars.', null),
    ).toEqual({ status: 'unavailable', notices: [] });
  });
});

describe('response assembly', () => {
  test('off-topic review hides the rewrite but keeps refocusing help', () => {
    const r = buildResponse(
      'review',
      q('hr-salary-01'),
      'What are your salary expectations?',
      'I know Node.js.',
      output({ answersQuestion: 'no', suggestion: 'I expect 3000 USD.' }),
      CV,
    );
    expect(r.suggestion).toBeNull();
    expect(r.suggestionWithheld).toBe('OFF_TOPIC');
    expect(r.mainIssue).toBeTruthy();
    expect(r.followUpQuestions).toEqual(['What was the result?']);
  });
  test('express mode never returns review-only fields and HR never shows a technical note', () => {
    const r = buildResponse(
      'express',
      q('hr-strengths-01'),
      'Q?',
      'Mình giỏi giải quyết vấn đề',
      output({
        technicalNote: 'x',
        answersQuestion: 'no',
        corrections: [{ original: 'Mình', better: 'I' }],
      }),
      null,
    );
    expect(r).toMatchObject({
      answersQuestion: null,
      mainIssue: null,
      corrections: [],
      technicalNote: null,
      suggestion: 'I am good at solving problems.',
    });
    expect(r.cvCheck.status).toBe('unavailable');
  });
  test('technical note is kept separately for technical questions', () => {
    const r = buildResponse(
      'express',
      q('tech-async-01'),
      'Q?',
      'RabbitMQ là database',
      output({
        suggestion: 'RabbitMQ is a database.',
        technicalNote: 'RabbitMQ is a message broker, not a database.',
      }),
      CV,
    );
    expect(r.technicalNote).toMatch(/message broker/u);
    expect(r.suggestion).toBe('RabbitMQ is a database.'); // faithful to the user, corrected separately
  });
});

// ------------------------------------------------------------------ HTTP
const generateStructured =
  jest.fn<(r: { prompt: string }) => Promise<unknown>>();
const reviewedFacts = jest.fn<(owner: string) => Promise<string[] | null>>();
const dbQuery = jest.fn<(sql: string, params: unknown[]) => Promise<unknown>>();
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const answersService = {
  list: jest.fn<(owner: string) => Promise<unknown[]>>(),
  save: jest.fn<
    (owner: string, id: unknown, body: unknown) => Promise<unknown>
  >(),
  remove: jest.fn<(owner: string, id: unknown, v: unknown) => Promise<void>>(),
};
let app: INestApplication;
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [InterviewPrepController],
    providers: [
      InterviewPrepService,
      FoundationLocalGuard,
      { provide: AiService, useValue: { generateStructured } },
      { provide: TailoredDraftService, useValue: { reviewedFacts } },
      { provide: InterviewAnswersService, useValue: answersService },
      // Curated IDs must never reach the database (asserted below).
      { provide: DataSource, useValue: { query: dbQuery } },
      { provide: JobQuestionsService, useValue: {} },
      TranscriptionService,
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
beforeEach(() => {
  generateStructured.mockReset();
  reviewedFacts.mockReset();
  reviewedFacts.mockResolvedValue(CV);
});
afterAll(async () => {
  await app?.close();
});
const post = (body: unknown) =>
  request(app.getHttpServer())
    .post('/api/v1/interview-prep/feedback')
    .set(origin)
    .send(body as object);
const body = {
  questionId: 'hr-strengths-01',
  mode: 'express',
  answer: 'Mình giỏi phân tích vấn đề.',
};

describe('HTTP', () => {
  test('GET questions returns the static bank without internal fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/interview-prep/questions')
      .expect(200);
    expect(res.body.questions).toHaveLength(INTERVIEW_QUESTIONS.length);
    expect(res.body.questions[0]).not.toHaveProperty('checkClaims');
  });
  test('feedback uses the owner-scoped CV accessor and the mode-specific prompt', async () => {
    generateStructured.mockResolvedValue(
      output({ suggestion: 'I am good at analysing problems.' }),
    );
    const res = await post(body).expect(200);
    expect(reviewedFacts).toHaveBeenCalledWith(LOCAL_OWNER_ID);
    expect(generateStructured.mock.calls[0]![0].prompt).toMatch(
      /say THEIR OWN ideas/u,
    );
    // CV facts are never sent to the model.
    expect(generateStructured.mock.calls[0]![0].prompt).not.toMatch(
      /Technical lead for a team/u,
    );
    expect(res.body).toMatchObject({
      mode: 'express',
      suggestion: 'I am good at analysing problems.',
      cvCheck: { status: 'checked' },
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  test('works without a reviewed CV and when the CV read fails', async () => {
    generateStructured.mockResolvedValue(output());
    reviewedFacts.mockResolvedValueOnce(null);
    expect((await post(body).expect(200)).body.cvCheck.status).toBe(
      'unavailable',
    );
    reviewedFacts.mockRejectedValueOnce(new Error('db down'));
    expect((await post(body).expect(200)).body.cvCheck.status).toBe(
      'unavailable',
    );
  });
  test.each([
    ['TIMEOUT', 504, 'INTERVIEW_TIMEOUT'],
    ['SCHEMA_VALIDATION_FAILURE', 502, 'INTERVIEW_INVALID_OUTPUT'],
    ['INVALID_JSON', 502, 'INTERVIEW_INVALID_OUTPUT'],
    ['CONNECTION_FAILURE', 503, 'INTERVIEW_AI_UNAVAILABLE'],
    ['CONTEXT_UNVERIFIED', 503, 'INTERVIEW_AI_UNAVAILABLE'],
  ] as const)(
    'maps AI %s to %s without internals',
    async (code, status, errorCode) => {
      generateStructured.mockRejectedValue(new AiError(code));
      const res = await post(body).expect(status);
      expect(res.body).toEqual({
        statusCode: status,
        errorCode,
        message: expect.any(String),
      });
      // An actionable hint ("Check that Ollama is running") is fine; internals are not.
      expect(JSON.stringify(res.body)).not.toMatch(
        /stack|AiError|CONNECTION_FAILURE|CONTEXT_UNVERIFIED|127\.0\.0\.1/u,
      );
    },
  );
  test('invalid requests never reach the model', async () => {
    const res = await post({ ...body, questionId: 'nope' }).expect(400);
    expect(res.body.errorCode).toBe('INTERVIEW_INVALID_REQUEST');
    expect(generateStructured).not.toHaveBeenCalled();
  });
  test('a second request while one is running is BUSY, then the lock is released', async () => {
    let release!: (v: unknown) => void;
    generateStructured.mockReturnValueOnce(new Promise((r) => (release = r)));
    const first = post(body).then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    expect((await post(body).expect(409)).body.errorCode).toBe(
      'INTERVIEW_BUSY',
    );
    release(output());
    expect((await first).status).toBe(200);
    generateStructured.mockResolvedValue(output());
    await post(body).expect(200);
  });
  test('non-local origins are refused', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/interview-prep/feedback')
      .set({ Host: '127.0.0.1:3000', Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    expect(res.body.errorCode).toBe('INTERVIEW_LOCAL_ONLY');
  });
});

describe('meaning preservation (technical contrasts and negation)', () => {
  const Q = 'Can you explain asynchronous messaging in simple terms?';
  test('withholds a rewrite that swaps a technical claim, even toward the correct one', () => {
    const user =
      'RabbitMQ is a database and it uses synchronous communication.';
    expect(
      changesMeaning(
        'RabbitMQ is a message broker that uses asynchronous communication.',
        user,
        Q,
      ),
    ).toBe(true);
    expect(
      changesMeaning(
        'RabbitMQ is a database, and it uses synchronous communication.',
        user,
        Q,
      ),
    ).toBe(false);
    expect(
      guardSuggestion(
        'RabbitMQ is a message broker.',
        'RabbitMQ is a database.',
        Q,
        { mode: 'review' },
      ),
    ).toBe('CHANGED_MEANING');
  });
  test('Vietnamese: "đồng bộ" is synchronous, "bất đồng bộ" is asynchronous', () => {
    expect(
      changesMeaning(
        'Services send messages synchronously.',
        'các service gửi message đồng bộ',
        Q,
      ),
    ).toBe(false);
    expect(
      changesMeaning(
        'Messages are sent at different times.',
        'các service gửi message đồng bộ',
        Q,
      ),
    ).toBe(true);
    expect(
      changesMeaning(
        'Messages are sent asynchronously.',
        'gửi message bất đồng bộ',
        Q,
      ),
    ).toBe(false);
    expect(
      changesMeaning('RabbitMQ is a database.', 'RabbitMQ là cơ sở dữ liệu', Q),
    ).toBe(false);
  });
  test.each([
    [
      'blocking',
      'A non-blocking call stops the thread.',
      'A blocking call stops the thread.',
    ],
    [
      'producer/consumer',
      'The consumer sends messages.',
      'The producer sends messages.',
    ],
    [
      'publish/subscribe',
      'Services subscribe to events.',
      'Services publish events.',
    ],
    [
      'delivery',
      'At-least-once delivery may duplicate messages.',
      'Exactly-once delivery may duplicate messages.',
    ],
    [
      'cache/persistent',
      'Redis is a cache here.',
      'Redis is persistent storage here.',
    ],
  ])('detects an explicit %s swap', (_name, user, rewrite) => {
    expect(changesMeaning(rewrite, user, Q)).toBe(true);
    expect(changesMeaning(user, user, Q)).toBe(false);
  });
  test('allows paraphrase on the same side and terms taken from the question', () => {
    expect(
      changesMeaning(
        'The sender does not wait for a reply.',
        'người gửi không cần chờ trả lời',
        Q,
      ),
    ).toBe(false);
    expect(
      changesMeaning(
        'Asynchronous messaging lets services work separately.',
        'giúp các service độc lập',
        Q,
      ),
    ).toBe(false);
  });
  test('negation must be preserved; curly apostrophes count', () => {
    expect(
      changesMeaning(
        'Messages are lost when the consumer is down.',
        'Messages are not lost when the consumer is down.',
        Q,
      ),
    ).toBe(true);
    expect(
      changesMeaning(
        'The first app doesn’t wait.',
        'the first service does not need to wait',
        Q,
      ),
    ).toBe(false);
    expect(changesMeaning('Messages are not lost.', 'tin nhắn bị mất', Q)).toBe(
      true,
    );
  });
  test('corrections that change a technical claim or are garbled are dropped', () => {
    const answer =
      'RabbitMQ is a database and it uses synchronous communication. It send message to the queue.';
    expect(
      guardCorrections(
        [
          {
            original: 'RabbitMQ is a database',
            better: 'RabbitMQ is a message broker',
          },
          {
            original: 'it uses synchronous communication',
            better: 'it uses asynchronous communication',
          },
          { original: 'It send message', better: 'It sends a message' },
          { original: 'to the queue', better: 'to the: queue' },
        ],
        answer,
      ),
    ).toEqual([{ original: 'It send message', better: 'It sends a message' }]);
  });
  test('garbled phrases are dropped', () => {
    expect(
      guardPhrases([
        { text: 'When a producer sends a a message...', noteVi: '' },
      ]),
    ).toEqual([]);
  });
});

describe('technical learning hints', () => {
  test('kept when the note addresses a contrast side the user did not state', () => {
    expect(
      keepTechnicalNote(
        'Usually, RabbitMQ is a message broker, not a database.',
        'RabbitMQ là cơ sở dữ liệu',
      ),
    ).toBe(true);
    expect(
      keepTechnicalNote(
        'Usually, messaging is asynchronous, not synchronous.',
        'it uses synchronous communication',
      ),
    ).toBe(true);
    // Stricter rule: a hint that only states the other side (no explicit
    // "not <what you said>") is dropped — a missed hint beats a generic one.
    expect(
      keepTechnicalNote(
        'Usually, messaging is asynchronous.',
        'it uses synchronous communication',
      ),
    ).toBe(false);
  });
  test('kept for a possible swap where the user named both sides', () => {
    expect(
      keepTechnicalNote(
        'Usually, the producer sends and the consumer reads.',
        'The consumer sends and the producer reads.',
      ),
    ).toBe(true);
  });
  test('dropped for generic definitions, restatements and unrelated details', () => {
    expect(
      keepTechnicalNote(
        'In general, asynchronous messaging means not waiting.',
        'With asynchronous messaging the sender does not wait.',
      ),
    ).toBe(false);
    expect(
      keepTechnicalNote(
        'In general, messages are sent between apps, not services.',
        'A message broker passes messages between services.',
      ),
    ).toBe(false);
    expect(
      keepTechnicalNote(
        'In general, Kafka is used for events.',
        'Mình dùng Kafka gửi event',
      ),
    ).toBe(false);
    expect(keepTechnicalNote('', 'database')).toBe(false);
  });
  test('the response keeps the faithful rewrite and shows the hint separately', () => {
    const r = buildResponse(
      'express',
      q('tech-async-01'),
      'Q?',
      'RabbitMQ là cơ sở dữ liệu',
      output({
        suggestion: 'RabbitMQ is a database.',
        technicalNote: 'Usually, RabbitMQ is a message broker, not a database.',
      }),
      CV,
    );
    expect(r.suggestion).toBe('RabbitMQ is a database.');
    expect(r.technicalNote).toMatch(/message broker/u);
  });
});

describe('question wording variant', () => {
  const ok = { questionId: 'hr-learning-01', mode: 'review', answer: 'x' };
  test('uses the displayed wording and defaults to the first', () => {
    expect(parseFeedbackRequest({ ...ok, variant: 1 }).questionText).toBe(
      'What have you learned recently in your work?',
    );
    expect(parseFeedbackRequest(ok).questionText).toMatch(
      /learned recently at work/u,
    );
    // After the PR14 split, the sync/async wording lives under its own ID.
    expect(() =>
      parseFeedbackRequest({
        ...ok,
        questionId: 'tech-tradeoff-01',
        variant: 1,
      }),
    ).toThrow(
      expect.objectContaining({ errorCode: 'INTERVIEW_INVALID_REQUEST' }),
    );
    expect(
      parseFeedbackRequest({ ...ok, questionId: 'tech-tradeoff-02' })
        .questionText,
    ).toMatch(/synchronous and asynchronous/u);
  });
  test.each([-1, 9, 1.5, '1'])('rejects variant %p', (variant) => {
    expect(() => parseFeedbackRequest({ ...ok, variant })).toThrow(
      expect.objectContaining({ errorCode: 'INTERVIEW_INVALID_REQUEST' }),
    );
  });
});

describe('omissions and persistence wording (live regression findings)', () => {
  const Q = 'Can you explain asynchronous messaging in simple terms?';
  test('a correction must not turn "long time" into "temporarily"', () => {
    expect(
      guardCorrections(
        [
          {
            original: 'it keep the data for long time',
            better: 'it stores messages temporarily',
          },
        ],
        'RabbitMQ is a database and it keep the data for long time.',
      ),
    ).toEqual([]);
    expect(
      changesMeaning(
        'It stores data for a long time.',
        'lưu dữ liệu lâu dài',
        Q,
      ),
    ).toBe(false);
  });
  test('dropping a stated claim or tool withholds the rewrite', () => {
    const user =
      'RabbitMQ is a message broker. A service sends a message to a queue and another service reads it later.';
    expect(
      guardSuggestion(
        'One app sends a message. Another app reads it later.',
        user,
        Q,
        { mode: 'review' },
      ),
    ).toBe('CHANGED_MEANING');
    expect(
      guardSuggestion(
        'RabbitMQ is a message broker. One service sends a message to a queue, and another reads it later.',
        user,
        Q,
        { mode: 'review' },
      ),
    ).toBeNull();
  });
});

describe('English main issue stays about language', () => {
  test('drops technical grading, keeps language advice', () => {
    expect(
      languageIssue(
        "Candidate confused RabbitMQ with a database and used 'synchronous' incorrectly",
      ),
    ).toBeNull();
    expect(languageIssue('Use the past tense for finished actions.')).toBe(
      'Use the past tense for finished actions.',
    );
    expect(
      languageIssue(
        'Say "a message queue", not "message queue", the first time.',
      ),
    ).toBe('Say "a message queue", not "message queue", the first time.');
    expect(languageIssue('')).toBeNull();
  });
});

describe('second live regression findings', () => {
  const Q = 'Can you explain asynchronous messaging in simple terms?';
  test('a producer/consumer role swap with both words present is withheld', () => {
    const user =
      'The consumer sends messages to the queue and the producer reads them from the queue.';
    expect(
      changesMeaning(
        'The producer sends messages to a queue. The consumer then reads them.',
        user,
        Q,
      ),
    ).toBe(true);
    expect(
      changesMeaning(
        'The consumer sends messages to a queue, and the producer reads them.',
        user,
        Q,
      ),
    ).toBe(false);
  });
  test('"exactly one time" is exactly-once; a correction may not change the guarantee or drop a tool', () => {
    const answer =
      'At-least-once delivery means every message is delivered exactly one time and never duplicated. With RabbitMQ the sender does not wait.';
    expect(
      guardCorrections(
        [
          {
            original:
              'every message is delivered exactly one time and never duplicated',
            better: 'every message is delivered at least once, not duplicated',
          },
          { original: 'With RabbitMQ', better: 'In messaging systems' },
        ],
        answer,
      ),
    ).toEqual([]);
  });
  test('a learning hint must negate what the user said, not just define the other side', () => {
    expect(
      keepTechnicalNote(
        'In general, async means the sender does not wait, which is different from synchronous messaging.',
        'A queue lets a service send work without waiting.',
      ),
    ).toBe(false);
    expect(
      keepTechnicalNote(
        'Usually, message queues handle asynchronous communication, not synchronous.',
        'gửi message đồng bộ',
      ),
    ).toBe(true);
  });
});

describe('PR14 catalog integrity', () => {
  test('every catalog ID is published, none retired, and no published ID silently vanished', () => {
    const ids = INTERVIEW_QUESTIONS.map((x) => x.id);
    expect(new Set(PUBLISHED_QUESTION_IDS).size).toBe(
      PUBLISHED_QUESTION_IDS.length,
    );
    for (const id of ids) expect(PUBLISHED_QUESTION_IDS).toContain(id);
    for (const id of ids) expect(RETIRED_QUESTION_IDS).not.toContain(id);
    for (const id of PUBLISHED_QUESTION_IDS)
      expect(ids.includes(id) || RETIRED_QUESTION_IDS.includes(id)).toBe(true);
    for (const x of INTERVIEW_QUESTIONS)
      expect(x.variants.length).toBeGreaterThanOrEqual(1);
  });
  test('split IDs keep their original meaning and the new IDs carry the moved questions', () => {
    const text = (id: string) => findQuestion(id)!.variants.join(' | ');
    expect(text('hr-achievement-01')).toMatch(/proud of/u);
    expect(text('hr-achievement-01')).not.toMatch(/learned/u);
    expect(findQuestion('hr-learning-01')!.variants).toEqual([
      'Tell me about something you learned recently at work.',
      'What have you learned recently in your work?',
    ]);
    expect(text('tech-api-01')).toMatch(/easy for other developers/u);
    expect(text('tech-api-01')).not.toMatch(/REST/u);
    expect(text('tech-api-02')).toMatch(/REST API/u);
    expect(text('tech-tradeoff-01')).toMatch(/monolith and microservices/u);
    expect(text('tech-tradeoff-01')).not.toMatch(/synchronous/u);
    expect(text('tech-tradeoff-02')).toMatch(/synchronous and asynchronous/u);
    expect(findQuestion('tech-api-02')).toMatchObject({
      kind: 'general',
      checkClaims: false,
    });
    expect(findQuestion('tech-tradeoff-02')).toMatchObject({
      kind: 'hypothetical',
      checkClaims: false,
    });
    expect(findQuestion('hr-learning-01')).toMatchObject({
      kind: 'personal',
      checkClaims: true,
    });
  });
});

describe('reference answer validation', () => {
  const body = (answer: unknown, expectedVersion: unknown = null) => ({
    answer,
    expectedVersion,
  });
  test('trims, normalizes newlines and counts Unicode code points', () => {
    expect(parseSaveBody(body('  Hello\r\nworld\t ')).answer).toBe(
      'Hello\nworld',
    );
    expect(
      parseSaveBody(body('a'.repeat(MAX_REFERENCE_ANSWER))).answer,
    ).toHaveLength(2000);
    // 2000 emoji = 2000 code points but 4000 UTF-16 units: allowed, like Postgres char_length.
    expect([...parseSaveBody(body('😀'.repeat(2000))).answer]).toHaveLength(
      2000,
    );
    expect(parseSaveBody(body('Tôi là kỹ sư backend.')).answer).toBe(
      'Tôi là kỹ sư backend.',
    );
  });
  test.each([
    ['empty', body('   ')],
    ['2001 code points', body('a'.repeat(2001))],
    ['2001 emoji', body('😀'.repeat(2001))],
    ['NUL-like control', body('hi\u0007there')],
    ['DEL', body('hi\u007f')],
    ['non-string', body(42)],
    ['extra key', { ...body('ok'), ownerId: 'x' }],
    ['missing expectedVersion', { answer: 'ok' }],
    ['version 0', body('ok', 0)],
    ['version float', body('ok', 1.5)],
    ['version string', body('ok', '2')],
  ])('rejects %s', (_n, value) => {
    expect(() => parseSaveBody(value)).toThrow(
      expect.objectContaining({ errorCode: 'INTERVIEW_INVALID_REQUEST' }),
    );
  });
  test('tab and newline are allowed', () => {
    expect(parseSaveBody(body('a\tb\nc')).answer).toBe('a\tb\nc');
  });
  test('query versions are strict positive integers', () => {
    expect(parseVersion('3')).toBe(3);
    for (const v of ['0', '-1', '1.5', 'x', '', undefined, '01'])
      expect(() => parseVersion(v)).toThrow(
        expect.objectContaining({ errorCode: 'INTERVIEW_INVALID_REQUEST' }),
      );
  });
});

describe('answer routes', () => {
  const saved = {
    questionId: 'hr-intro-01',
    answer: 'I am a backend developer.',
    version: 2,
    updatedAt: '2026-11-11T00:00:00.000Z',
  };
  beforeEach(() => {
    answersService.list.mockReset();
    answersService.save.mockReset();
    answersService.remove.mockReset();
  });
  test('list is a guarded POST read returning the contract shape', async () => {
    answersService.list.mockResolvedValue([saved]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/interview-prep/answers/list')
      .set(origin)
      .send({ contractVersion: '1' })
      .expect(200);
    expect(res.body).toEqual({ contractVersion: '1', answers: [saved] });
    expect(answersService.list).toHaveBeenCalledWith(LOCAL_OWNER_ID);
    expect(res.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .post('/api/v1/interview-prep/answers/list')
      .set(origin)
      .send({ other: 1 })
      .expect(400);
  });
  test('save and delete pass the local owner; 409 carries the current answer', async () => {
    answersService.save.mockRejectedValue(
      new InterviewPrepError('INTERVIEW_ANSWER_CONFLICT', undefined, saved),
    );
    const res = await request(app.getHttpServer())
      .put('/api/v1/interview-prep/answers/hr-intro-01')
      .set(origin)
      .send({ answer: 'x', expectedVersion: 1 })
      .expect(409);
    expect(res.body).toEqual({
      statusCode: 409,
      errorCode: 'INTERVIEW_ANSWER_CONFLICT',
      message: expect.any(String),
      current: saved,
    });
    expect(answersService.save).toHaveBeenCalledWith(
      LOCAL_OWNER_ID,
      'hr-intro-01',
      { answer: 'x', expectedVersion: 1 },
    );
    answersService.remove.mockRejectedValue(
      new InterviewPrepError('INTERVIEW_ANSWER_CONFLICT', undefined, null),
    );
    const del = await request(app.getHttpServer())
      .delete('/api/v1/interview-prep/answers/hr-intro-01?expectedVersion=2')
      .set(origin)
      .expect(409);
    expect(del.body.current).toBeNull();
    answersService.remove.mockResolvedValue(undefined);
    await request(app.getHttpServer())
      .delete('/api/v1/interview-prep/answers/hr-intro-01?expectedVersion=2')
      .set(origin)
      .expect(204);
    expect(answersService.remove).toHaveBeenLastCalledWith(
      LOCAL_OWNER_ID,
      'hr-intro-01',
      '2',
    );
  });
  test('every answer route refuses non-local origins', async () => {
    const evil = { Host: '127.0.0.1:3000', Origin: 'https://evil.example' };
    await request(app.getHttpServer())
      .post('/api/v1/interview-prep/answers/list')
      .set(evil)
      .send({ contractVersion: '1' })
      .expect(403);
    await request(app.getHttpServer())
      .put('/api/v1/interview-prep/answers/hr-intro-01')
      .set(evil)
      .send({ answer: 'x', expectedVersion: null })
      .expect(403);
    await request(app.getHttpServer())
      .delete('/api/v1/interview-prep/answers/hr-intro-01?expectedVersion=1')
      .set(evil)
      .expect(403);
    expect(answersService.save).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------- PR15 generated question IDs
describe('PR15 generated question IDs', () => {
  const uuid = '3f2b8c1e-7a4d-4e2b-9c1a-5d6e7f8a9b0c';
  const generated = {
    id: `jd-${uuid}`,
    topic: 'technical' as const,
    category: 'Technical skill',
    kind: 'general' as const,
    variants: ['How does PostgreSQL handle concurrent writes?'],
    hints: [],
    checkClaims: false,
  };
  test('accepts only "jd-" plus a lowercase, well-formed UUID', () => {
    expect(JD_QUESTION_ID.test(`jd-${uuid}`)).toBe(true);
    for (const bad of [
      uuid,
      `jd-${uuid.toUpperCase()}`,
      `jd-${uuid}x`,
      ` jd-${uuid}`,
      'jd-3f2b8c1e-7a4d-0e2b-9c1a-5d6e7f8a9b0c', // version 0
      'jd-3f2b8c1e-7a4d-4e2b-7c1a-5d6e7f8a9b0c', // bad variant
      'jd-3f2b8c1e7a4d4e2b9c1a5d6e7f8a9b0c',
      'jd-',
    ])
      expect(JD_QUESTION_ID.test(bad)).toBe(false);
  });
  test('no curated question ID can collide with a generated ID', () => {
    expect(
      [
        ...INTERVIEW_QUESTIONS.map((q) => q.id),
        ...PUBLISHED_QUESTION_IDS,
      ].filter((id) => id.startsWith('jd-')),
    ).toEqual([]);
  });
  test('parseFeedbackRequest uses a resolved question only for its own ID', () => {
    const ok = { questionId: generated.id, mode: 'express', answer: 'Notes.' };
    expect(parseFeedbackRequest(ok, generated)).toMatchObject({
      question: generated,
      questionText: generated.variants[0],
    });
    expect(() => parseFeedbackRequest(ok)).toThrow(InterviewPrepError);
    expect(() =>
      parseFeedbackRequest(
        { ...ok, questionId: `jd-${uuid.replace('3f', '4f')}` },
        generated,
      ),
    ).toThrow(InterviewPrepError);
    // A curated ID ignores any resolved value.
    expect(
      parseFeedbackRequest({ ...ok, questionId: 'hr-strengths-01' }, generated)
        .question.id,
    ).toBe('hr-strengths-01');
  });
  test('HTTP: curated feedback never queries the database; malformed jd- IDs are 400 without a query', async () => {
    dbQuery.mockReset();
    generateStructured.mockResolvedValue({
      suggestion: '',
      followUpQuestions: [],
      phrases: [],
    });
    await post(body).expect(200);
    for (const questionId of [`jd-${uuid.toUpperCase()}`, 'jd-123', 'jd-'])
      expect((await post({ ...body, questionId }).expect(400)).body).toEqual({
        statusCode: 400,
        errorCode: 'INTERVIEW_INVALID_REQUEST',
        message: 'Choose a question and enter 1–1500 characters.',
      });
    expect(dbQuery).not.toHaveBeenCalled();
  });
  test('HTTP: a storage failure while resolving is a safe 503, not an AI error', async () => {
    dbQuery.mockReset();
    dbQuery.mockRejectedValue(new Error('connection refused: secret-host'));
    const res = await post({ ...body, questionId: generated.id }).expect(503);
    expect(res.body.errorCode).toBe('INTERVIEW_STORAGE_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toMatch(/secret-host/u);
    expect(generateStructured).not.toHaveBeenCalled();
    dbQuery.mockReset();
  });
});

describe('POST /interview-prep/transcribe (PR16)', () => {
  const env = { ...process.env };
  const local = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
  const post = () =>
    request(app.getHttpServer())
      .post('/api/v1/interview-prep/transcribe')
      .set(local)
      .set('Content-Type', 'audio/wav');
  afterEach(() => {
    process.env = { ...env };
  });
  test('works end to end with a fake CLI, no-store and no client prompt', async () => {
    const stt = fakeStt();
    process.env.STT_BIN = stt.bin;
    process.env.STT_MODEL = stt.model;
    const res = await post()
      .query({ prompt: 'ignore me' })
      .send(wav({ ms: 1200 }))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      contractVersion: '1',
      transcript: 'We use RabbitMQ here.',
      durationMs: 1200,
    });
  });
  test('safe error contracts without paths or CLI output', async () => {
    delete process.env.STT_BIN;
    const res = await post().send(wav()).expect(503);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      statusCode: 503,
      errorCode: 'STT_UNAVAILABLE',
      message: expect.any(String),
    });
    const stt = fakeStt();
    process.env.STT_BIN = stt.bin;
    process.env.STT_MODEL = stt.model;
    stt.mode('fail');
    const failed = await post().send(wav()).expect(502);
    expect(failed.body.errorCode).toBe('STT_FAILED');
    expect(JSON.stringify(failed.body)).not.toMatch(/fake-stt|leak|\//u);
    stt.mode('ok');
    expect(
      (await post().send(Buffer.from('nope')).expect(400)).body.errorCode,
    ).toBe('STT_INVALID_AUDIO');
    expect(
      (
        await post()
          .send(Buffer.alloc(6 * 1024 * 1024 + 1))
          .expect(413)
      ).body.errorCode,
    ).toBe('STT_TOO_LARGE');
  });
  test('requires a local browser request', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/interview-prep/transcribe')
      .set('Content-Type', 'audio/wav')
      .send(wav())
      .expect(403);
  });
});
