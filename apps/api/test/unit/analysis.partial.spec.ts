import { asLocalOwner } from '../support/as-local-owner.js';
import { compileOutputSchema } from '../../src/ai/ai.schema.js';
import type { OutputSchema } from '../../src/ai/ai-provider.js';
import 'reflect-metadata';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AnalysisController } from '../../src/analysis/analysis.controller.js';
import {
  AnalysisService,
  ANALYSIS_TIMING,
  analysisTiming,
} from '../../src/analysis/analysis.service.js';
import { configureAnalysisHttp } from '../../src/analysis/analysis-http.js';
import { ExtractionService } from '../../src/extraction/extraction.service.js';
import { DocumentParser } from '../../src/extraction/document-parser.js';
import { ExtractionOwner } from '../../src/extraction/extraction.owner.js';
import { AiService } from '../../src/ai/ai.service.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { aiConfig } from '../../src/ai/ai.config.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { pdfFixture } from '../support/pdf-fixtures.js';

let app: INestApplication;
let responses: (string | Error)[];
const matching = { match: jest.fn<MatchingService['match']>() };
let generated = 0;
let schemas: OutputSchema[];
const cvText = [
  'Alex Sample',
  'alex@example.test',
  '+1 202 555 0147',
  'Skills: TypeScript',
];
const jdText = 'Job title: Engineer\nSkills required: TypeScript';
const cvOutput = JSON.stringify({
  proposals: [
    {
      field: 'name',
      value: 'Alex Sample',
      segmentId: 'page-1',
      quote: 'Alex Sample',
    },
    {
      field: 'email',
      value: 'alex@example.test',
      segmentId: 'page-2',
      quote: 'alex@example.test',
    },
    {
      field: 'phone',
      value: '+1 999 555 0000',
      segmentId: 'page-3',
      quote: '+1 202 555 0147',
    },
    {
      field: 'skills',
      value: 'TypeScript',
      segmentId: 'page-4',
      quote: 'Skills: TypeScript',
    },
    {
      field: 'skills',
      value: 'Fabricated',
      segmentId: 'page-4',
      quote: 'Not in source',
    },
  ],
});
const jdOutput = JSON.stringify({
  proposals: [
    {
      field: 'title',
      value: 'Engineer',
      segmentId: 'jd-1',
      quote: 'Job title: Engineer',
    },
  ],
});
beforeEach(async () => {
  generated = 0;
  schemas = [];
  matching.match.mockClear();
  responses = [cvOutput, jdOutput];
  // Any accidental real provider fetch fails immediately; Supertest uses HTTP.
  jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Network forbidden'));
  const extraction = new ExtractionService(
    new AiService({
      generate: async (input) => {
        schemas.push(input.schema);
        generated++;
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (response === undefined) throw new Error('Unexpected generation');
        return response;
      },
    }),
    new ExtractionOwner(new DocumentParser()),
  );
  const module = await Test.createTestingModule({
    controllers: [AnalysisController],
    providers: [
      AnalysisService,
      { provide: ANALYSIS_TIMING, useValue: analysisTiming(aiConfig({})) },
      { provide: ExtractionService, useValue: extraction },
      { provide: MatchingService, useValue: matching },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  configureAnalysisHttp(app);
  await app.init();
});
afterEach(async () => {
  await app.close();
  jest.restoreAllMocks();
});
const post = (mode = 'partial') =>
  request(app.getHttpServer())
    .post(`/api/v1/analyses?mode=${mode}`)
    .set('Host', '127.0.0.1:3000')
    .set('Origin', 'http://127.0.0.1:5173')
    .field('jdText', jdText)
    .attach('cv', Buffer.from(pdfFixture(cvText)), {
      filename: 'synthetic.pdf',
      contentType: 'application/pdf',
    });
test('production multipart/parser retains valid peers and rejects unsupported facts, without matching', async () => {
  const response = await post();
  expect(response.status).toBe(200);
  expect(response.body.outcome).toBe('PARTIAL');
  const { cv, jd } = response.body.documents;
  expect(cv.text).toContain('Alex Sample');
  expect(jd.text).toBe(jdText);
  expect(cv.facts).toBeNull();
  expect(cv.partial.fields.name[0].status).toBe('VALID');
  expect(cv.partial.fields.email[0].status).toBe('VALID');
  expect(cv.partial.fields.phone[0]).toMatchObject({
    status: 'NEEDS_REVIEW',
    evidence: null,
  });
  expect(
    cv.partial.fields.skills.map((fact: { status: string }) => fact.status),
  ).toEqual(['VALID', 'NEEDS_REVIEW']);
  expect(jd.partial.fields.title[0].status).toBe('VALID');
  expect(jd.partial.fields.requirements[0].status).toBe('MISSING');
  expect(response.body.result).toBeNull();
  expect(response.body.stages.matching).toBe('NOT_RUN');
  expect(generated).toBe(2);
  expect(matching.match).not.toHaveBeenCalled();
});
test.each([new AiError('TIMEOUT'), '{invalid json', '{}'])(
  'CV provider/decode failure preserves both source documents and allows JD facts',
  async (failure) => {
    responses = [failure, jdOutput];
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.body.documents.cv.text).toContain('Alex Sample');
    expect(response.body.documents.cv.partial.generationError).not.toBeNull();
    expect(response.body.documents.cv.partial.fields.name[0].status).toBe(
      'MISSING',
    );
    expect(response.body.documents.jd.partial.fields.title[0].status).toBe(
      'VALID',
    );
    expect(matching.match).not.toHaveBeenCalled();
  },
);
test('JD timeout preserves independently validated CV fields', async () => {
  responses = [cvOutput, new AiError('TIMEOUT')];
  const response = await post();
  expect(response.body.documents.cv.partial.fields.name[0].status).toBe(
    'VALID',
  );
  expect(response.body.documents.jd.text).toBe(jdText);
  expect(response.body.documents.jd.partial.generationError).toBe('TIMEOUT');
  expect(response.body.result).toBeNull();
  expect(matching.match).not.toHaveBeenCalled();
});
test('all valid partial outputs still never call matching', async () => {
  responses = [
    JSON.stringify({
      proposals: [
        {
          field: 'skills',
          value: 'TypeScript',
          segmentId: 'page-4',
          quote: 'Skills: TypeScript',
        },
      ],
    }),
    JSON.stringify({
      proposals: [
        {
          field: 'requirements',
          value: 'TypeScript',
          segmentId: 'jd-1',
          quote: 'Skills required: TypeScript',
        },
      ],
    }),
  ];
  const response = await post();
  expect(response.body.documents.cv.partial.fields.skills[0].status).toBe(
    'VALID',
  );
  expect(response.body.documents.jd.partial.fields.requirements[0].status).toBe(
    'VALID',
  );
  expect(response.body.stages.matching).toBe('NOT_RUN');
  expect(response.body.result).toBeNull();
  expect(matching.match).not.toHaveBeenCalled();
});
test('accepted parse-only path remains model-free', async () => {
  const response = await post('parse-only');
  expect(response.status).toBe(200);
  expect(response.body.outcome).toBe('PARSED');
  expect(response.body.documents.cv.text).toContain('Alex Sample');
  expect(response.body.documents.cv.partial).toBeUndefined();
  expect(generated).toBe(0);
  expect(matching.match).not.toHaveBeenCalled();
});

test('strict object guidance is sent to the model while malformed peers are rejected independently', async () => {
  const candidates = [
    {
      field: 'skills',
      value: 'TypeScript',
      segmentId: 'page-4',
      quote: 'Skills: TypeScript',
    },
    { field: 'phone', value: '+1 202 555 0147', segmentId: 'page-3' },
    {
      field: 'unknown',
      value: 'TypeScript',
      segmentId: 'page-4',
      quote: 'Skills: TypeScript',
    },
    {
      field: 'name',
      value: 'Alex Sample',
      segmentId: 'page-1',
      quote: 'Alex Sample',
      extra: 'not allowed',
    },
  ];
  responses = [JSON.stringify({ proposals: candidates }), jdOutput];
  const response = await post();
  expect(response.status).toBe(200);
  expect(schemas).toHaveLength(2);
  const checkModelShape = compileOutputSchema(schemas[0]!).validate;
  expect(checkModelShape({ proposals: [candidates[0]] })).toBe(true);
  expect(checkModelShape({ proposals: candidates })).toBe(false);
  const { cv, jd } = response.body.documents;
  expect(cv.partial.fields.skills[0].status).toBe('VALID');
  expect(cv.partial.fields.phone[0].status).toBe('NEEDS_REVIEW');
  expect(cv.partial.fields.name[0].status).toBe('NEEDS_REVIEW');
  expect(cv.partial.rejectedProposals).toEqual([
    { index: 1, reason: 'MALFORMED_PROPOSAL' },
    { index: 2, reason: 'UNSUPPORTED_FIELD' },
    { index: 3, reason: 'MALFORMED_PROPOSAL' },
  ]);
  expect(jd.partial.fields.title[0].status).toBe('VALID');
  expect(cv.text).toContain('Alex Sample');
  expect(jd.text).toBe(jdText);
  expect(response.body.result).toBeNull();
  expect(response.body.stages.matching).toBe('NOT_RUN');
  expect(generated).toBe(2);
  expect(matching.match).not.toHaveBeenCalled();
});

test('CV-only production upload needs no JD and performs no generation or matching', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/analyses?mode=cv-only')
    .set('Host', '127.0.0.1:3000')
    .set('Origin', 'http://127.0.0.1:5173')
    .attach('cv', Buffer.from(pdfFixture(['Skills: TypeScript'])), {
      filename: 'synthetic.pdf',
      contentType: 'application/pdf',
    });
  expect(response.status).toBe(200);
  expect(response.body.outcome).toBe('PARSED');
  expect(response.body.documents.cv.text).toBe('Skills: TypeScript');
  expect(response.body.documents.jd).toBeNull();
  expect(response.body.result).toBeNull();
  expect(generated).toBe(0);
  expect(matching.match).not.toHaveBeenCalled();
});
test('CV-only mode rejects an unexpected JD field rather than silently accepting it', async () => {
  const response = await post('cv-only');
  expect(response.status).toBe(400);
  expect(generated).toBe(0);
});
