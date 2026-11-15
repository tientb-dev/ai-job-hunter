import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  request as httpRequest,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { setImmediate as tick } from 'node:timers/promises';
import { AnalysisController } from '../../src/analysis/analysis.controller.js';
import {
  AnalysisService,
  ANALYSIS_TIMING,
  analysisTiming,
} from '../../src/analysis/analysis.service.js';
import { configureAnalysisHttp } from '../../src/analysis/analysis-http.js';
import { ExtractionService } from '../../src/extraction/extraction.service.js';
import { ExtractionOwner } from '../../src/extraction/extraction.owner.js';
import { AiService } from '../../src/ai/ai.service.js';
import { aiConfig } from '../../src/ai/ai.config.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { ExtractionError } from '../../src/extraction/extraction.errors.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import {
  validateCvOutput,
  validateJdOutput,
} from '../../src/extraction/extraction.validation.js';
import type {
  CvExtractionResult,
  JdExtractionResult,
} from '../../src/extraction/extraction.types.js';
import {
  emptyCv,
  emptyJd,
  quotedFact,
  syntheticSource,
  unknownFact,
} from '../support/extraction-fixtures.js';
import { currentPdfParserDiagnosticRequestId } from '../../src/extraction/pdf-parser.diagnostics.js';
import {
  configureAiGenerationDiagnostics,
  emitFinalLengthDiagnostic,
} from '../../src/ai/ai-generation.diagnostics.js';
import type { FinalLengthDiagnosticRecord } from '../../src/ai/ai-generation.diagnostics.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixtures(withSkill = true, withRequirement = true) {
  const cvSource = syntheticSource('TypeScript');
  const jdSource = syntheticSource('TypeScript', 'text');
  const cv: CvExtractionResult = {
    schemaVersion: '1',
    kind: 'cv',
    source: cvSource,
    data: validateCvOutput(
      {
        ...emptyCv(),
        skills: withSkill
          ? [{ name: quotedFact('TypeScript'), experienceText: unknownFact() }]
          : [],
      },
      cvSource,
    ),
    warnings: [{ code: 'EXTRACTION_COMPLETENESS_NOT_VERIFIED' }],
  };
  const jd: JdExtractionResult = {
    schemaVersion: '1',
    kind: 'jd',
    source: jdSource,
    data: validateJdOutput(
      {
        ...emptyJd(),
        requirements: withRequirement
          ? [{ text: quotedFact('TypeScript'), priority: unknownFact() }]
          : [],
      },
      jdSource,
    ),
    warnings: [{ code: 'EXTRACTION_COMPLETENESS_NOT_VERIFIED' }],
  };
  return { cv, jd };
}
let app: INestApplication;
let service: AnalysisService;
let matching: MatchingService;
let port: number;
let values = fixtures();
let cvWork: () => Promise<CvExtractionResult>;
let jdWork: () => Promise<JdExtractionResult>;
let cvEntered: ReturnType<typeof deferred<void>>;
let jdEntered: ReturnType<typeof deferred<void>>;
let shutdownBarrier: () => Promise<void>;
let order: string[];
let cvDiagnosticRequestId: string | null;
const host = '127.0.0.1:3000';
const origin = 'http://127.0.0.1:5173';
const boundary = 'lifecycle';
const payload = () =>
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="cv"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\nsynthetic\r\n--${boundary}\r\nContent-Disposition: form-data; name="jdText"\r\n\r\nSynthetic JD\r\n--${boundary}--\r\n`,
  );
const post = () =>
  request(app.getHttpServer())
    .post('/api/v1/analyses')
    .set('Host', host)
    .set('Origin', origin);
const start = () =>
  post()
    .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
    .send(payload())
    .then((response) => response);
function streaming() {
  const req = httpRequest({
    host: '127.0.0.1',
    port,
    path: '/api/v1/analyses',
    method: 'POST',
    headers: {
      Host: host,
      Origin: origin,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  const response = new Promise<{
    status: number;
    body: Record<string, unknown>;
  }>((resolve) => {
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode!,
          body: JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >,
        }),
      );
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
  });
  return { req, response };
}
beforeEach(async () => {
  values = fixtures();
  order = [];
  cvDiagnosticRequestId = null;
  cvEntered = deferred<void>();
  jdEntered = deferred<void>();
  cvWork = async () => values.cv;
  jdWork = async () => values.jd;
  const module = await Test.createTestingModule({
    controllers: [AnalysisController],
    providers: [
      AnalysisService,
      MatchingService,
      { provide: ANALYSIS_TIMING, useValue: analysisTiming(aiConfig({})) },
      {
        provide: ExtractionService,
        useValue: {
          coordinateShutdown: (barrier: () => Promise<void>) => {
            shutdownBarrier = barrier;
          },
          extractCv: async () => {
            order.push('cv');
            cvDiagnosticRequestId = currentPdfParserDiagnosticRequestId();
            cvEntered.resolve();
            return cvWork();
          },
          extractJd: async () => {
            order.push('jd');
            jdEntered.resolve();
            return jdWork();
          },
          onModuleDestroy: async () => {
            await shutdownBarrier();
            order.push('extraction-closed');
          },
        },
      },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  asLocalOwner(app);
  service = app.get(AnalysisService);
  matching = app.get(MatchingService);
  configureAnalysisHttp(app);
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
});
afterEach(async () => {
  jest.useRealTimers();
  await app.close();
  jest.restoreAllMocks();
  configureAiGenerationDiagnostics(false, '127.0.0.1', () => {});
});

test.each(['pdf', 'docx'])(
  'successful %s preserves the real matching result and exact execution order',
  async (format) => {
    const spy = jest.spyOn(matching, 'match');
    const expected = new MatchingService().match(values);
    const response = await post()
      .field('jdText', 'Synthetic JD')
      .attach('cv', Buffer.from('synthetic'), {
        filename: `synthetic.${format}`,
        contentType:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .expect(200);
    expect(order).toEqual(['cv', 'jd']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      contractVersion: '1',
      outcome: 'COMPLETED',
      error: null,
      stages: {
        upload: 'SUCCEEDED',
        cv: 'SUCCEEDED',
        jd: 'SUCCEEDED',
        matching: 'SUCCEEDED',
      },
      result: expected,
    });
    expect(response.body.result).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(response.body).not.toHaveProperty('source');
    expect(JSON.stringify(response.body)).not.toContain('synthetic.pdf');
    expect(cvDiagnosticRequestId).toBe(response.body.requestId);
  },
);
test('completed API result preserves the PDF recovery warning', async () => {
  values = {
    ...values,
    cv: {
      ...values.cv,
      warnings: [...values.cv.warnings, { code: 'PDF_RECOVERY_USED' as const }],
    },
  };
  const response = await start();
  expect(response.status).toBe(200);
  expect(response.body.result.extractionWarnings).toContainEqual({
    document: 'cv',
    warning: { code: 'PDF_RECOVERY_USED' },
  });
});
test.each([
  [false, false],
  [false, true],
  [true, false],
] as const)(
  'insufficient validated inputs block matching (%s,%s)',
  async (skill, requirement) => {
    values = fixtures(skill, requirement);
    const spy = jest.spyOn(matching, 'match');
    const response = await start();
    expect(response.status).toBe(422);
    expect(response.body.result).toBeNull();
    expect(response.body.error.code).toBe('INSUFFICIENT_MATCHING_INPUT');
    expect(response.body.documents.cv.facts).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  },
);
test.each(['cv', 'jd'] as const)(
  '%s rejection skips later stages and preserves sanitized diagnostics',
  async (stage) => {
    const fail = async () => {
      throw new ExtractionError('INVALID_EVIDENCE', {
        stage: 'EVIDENCE',
        rule: 'QUOTE_AMBIGUOUS',
        field: 'cv.skills[].name',
      });
    };
    if (stage === 'cv') cvWork = fail;
    else jdWork = fail;
    const spy = jest.spyOn(matching, 'match');
    const response = await start();
    expect(response.status).toBe(422);
    expect(response.body.result).toBeNull();
    expect(response.body.error).toEqual({
      stage: stage.toUpperCase(),
      code: 'INVALID_EVIDENCE',
      diagnostic: {
        stage: 'EVIDENCE',
        rule: 'QUOTE_AMBIGUOUS',
        field: 'cv.skills[].name',
      },
    });
    expect(response.body.stages[stage]).toBe('REJECTED');
    expect(spy).not.toHaveBeenCalled();
    expect(order).toEqual(stage === 'cv' ? ['cv'] : ['cv', 'jd']);
    expect(
      (
        await post()
          .field('jdText', 'x')
          .attach('cv', Buffer.from('x'), 'synthetic.pdf')
      ).status,
    ).toBe(422);
  },
);
test.each(['cv', 'jd'] as const)(
  '%s output-length diagnostics retain request correlation outside the API response',
  async (stage) => {
    const records: FinalLengthDiagnosticRecord[] = [];
    configureAiGenerationDiagnostics(true, '127.0.0.1', (record) =>
      records.push(record),
    );
    const fail = async () => {
      emitFinalLengthDiagnostic({
        promptTokens: 4000,
        evalCount: 2048,
        outputTokenLimit: 2048,
        jsonSyntax: 'INVALID',
      });
      throw new AiError('OUTPUT_LIMIT_EXCEEDED');
    };
    if (stage === 'cv') cvWork = fail;
    else jdWork = fail;
    const response = await start();
    expect(response.status).toBe(422);
    expect(response.body.error).toEqual({
      stage: stage.toUpperCase(),
      code: 'OUTPUT_LIMIT_EXCEEDED',
      diagnostic: null,
    });
    expect(records).toEqual([
      {
        requestId: response.body.requestId,
        extractionKind: stage.toUpperCase(),
        reason: 'FINAL_LENGTH',
        promptTokens: 4000,
        evalCount: 2048,
        outputTokenLimit: 2048,
        jsonSyntax: 'INVALID',
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('promptTokens');
  },
);
test.each([
  new AiError('SCHEMA_VALIDATION_FAILURE'),
  new AiError('TIMEOUT'),
  new Error('PRIVATE exception'),
])('safe outer mapping and no logs for %s', async (error) => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  cvWork = async () => {
    throw error;
  };
  const response = await start();
  expect(response.status).toBe(
    error instanceof AiError ? (error.code === 'TIMEOUT' ? 504 : 422) : 500,
  );
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  expect(log).not.toHaveBeenCalled();
});
test('busy is rejected before body arrival; ownership includes delayed extraction cleanup', async () => {
  const work = deferred<CvExtractionResult>();
  cvWork = () => work.promise;
  const first = start();
  await cvEntered.promise;
  const second = streaming();
  second.req.flushHeaders();
  expect((await second.response).status).toBe(429);
  expect(order).toEqual(['cv']);
  work.resolve(values.cv);
  expect((await first).status).toBe(200);
  expect((await start()).status).toBe(200);
});
test.each(['cv', 'jd'] as const)(
  'disconnect during %s discards late results and holds admission',
  async (stage) => {
    const work = deferred<CvExtractionResult | JdExtractionResult>();
    if (stage === 'cv')
      cvWork = () => work.promise as Promise<CvExtractionResult>;
    else jdWork = () => work.promise as Promise<JdExtractionResult>;
    const client = streaming();
    client.req.end(payload());
    await (stage === 'cv' ? cvEntered : jdEntered).promise;
    client.req.destroy();
    await client.response;
    await tick();
    const busy = await start();
    expect(busy.status).toBe(429);
    work.resolve(stage === 'cv' ? values.cv : values.jd);
    await tick();
    await tick();
    expect(order).toEqual(stage === 'cv' ? ['cv'] : ['cv', 'jd']);
    expect((await start()).status).toBe(200);
  },
);
async function beginUpload() {
  const admitted = deferred<void>();
  const original = service.admit.bind(service);
  const spy = jest
    .spyOn(service, 'admit')
    .mockImplementationOnce((req, res) => {
      original(req, res);
      admitted.resolve();
    });
  const client = streaming();
  client.req.write(`--${boundary}\r\n`);
  await admitted.promise;
  spy.mockRestore();
  return client;
}
test('upload disconnect releases transport and admission', async () => {
  const client = await beginUpload();
  expect((await start()).status).toBe(429);
  client.req.destroy();
  await client.response;
  await tick();
  await tick();
  expect((await start()).status).toBe(200);
});
const fakeClock = () =>
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
  });
test('upload deadline is 30 seconds from admission and frees the slot', async () => {
  fakeClock();
  const client = await beginUpload();
  expect((await start()).status).toBe(429);
  await jest.advanceTimersByTimeAsync(30000);
  const response = await client.response;
  expect(response.status).toBe(408);
  expect(response.body).toMatchObject({
    error: { code: 'UPLOAD_TIMEOUT' },
    result: null,
    stages: { upload: 'TIMED_OUT', cv: 'NOT_RUN' },
  });
  expect((await start()).status).toBe(200);
});
test.each(['cv', 'jd'] as const)(
  'analysis deadline during %s sends once but retains admission until cleanup',
  async (stage) => {
    fakeClock();
    const work = deferred<CvExtractionResult | JdExtractionResult>();
    if (stage === 'cv')
      cvWork = () => work.promise as Promise<CvExtractionResult>;
    else jdWork = () => work.promise as Promise<JdExtractionResult>;
    const first = start();
    await (stage === 'cv' ? cvEntered : jdEntered).promise;
    await jest.advanceTimersByTimeAsync(
      analysisTiming(aiConfig({})).analysisMs,
    );
    const response = await first;
    expect(response.status).toBe(504);
    expect(response.body.error).toMatchObject({
      code: 'ANALYSIS_TIMEOUT',
      stage: stage.toUpperCase(),
    });
    expect(response.body.stages[stage]).toBe('TIMED_OUT');
    expect((await start()).status).toBe(429);
    work.resolve(stage === 'cv' ? values.cv : values.jd);
    await tick();
    await tick();
    expect(order).toEqual(stage === 'cv' ? ['cv'] : ['cv', 'jd']);
    expect((await start()).status).toBe(200);
  },
);
test.each(['cv', 'jd'] as const)(
  'shutdown during %s is idempotent, waits for cleanup and blocks stages',
  async (stage) => {
    const work = deferred<CvExtractionResult | JdExtractionResult>();
    if (stage === 'cv')
      cvWork = () => work.promise as Promise<CvExtractionResult>;
    else jdWork = () => work.promise as Promise<JdExtractionResult>;
    const first = start();
    await (stage === 'cv' ? cvEntered : jdEntered).promise;
    let finished = false;
    const closing = app.close().then(() => {
      finished = true;
    });
    expect((await first).status).toBe(503);
    expect(finished).toBe(false);
    expect(service.shutdown()).toBe(service.shutdown());
    expect((await start()).status).toBe(503);
    expect(order).not.toContain('extraction-closed');
    work.resolve(stage === 'cv' ? values.cv : values.jd);
    await closing;
    expect(order).toEqual(
      stage === 'cv'
        ? ['cv', 'extraction-closed']
        : ['cv', 'jd', 'extraction-closed'],
    );
  },
);
test('shutdown stops active upload and closes admission', async () => {
  const client = await beginUpload();
  expect((await start()).status).toBe(429);
  await service.shutdown();
  expect((await client.response).status).toBe(503);
  expect((await start()).status).toBe(503);
  expect(order).toEqual([]);
});
test('deadline derives from validated provider configuration, with two calls and bounded overhead', () => {
  expect(analysisTiming(aiConfig({}))).toEqual({
    uploadMs: 30000,
    analysisMs: 286000,
  });
  expect(
    analysisTiming(aiConfig({ AI_REQUEST_TIMEOUT_MS: '300000' })).analysisMs,
  ).toBe(646000);
  expect(() => analysisTiming({ ...aiConfig({}), timeoutMs: NaN })).toThrow();
});
test('real ExtractionService invokes explicit shutdown barrier before closing parser', async () => {
  const gate = deferred<void>();
  const close = jest.fn(async () => {});
  const extraction = new ExtractionService(
    {} as AiService,
    new ExtractionOwner({
      parse: async () => {
        throw new Error('unused');
      },
      waitForIdle: async () => {},
      close,
    }),
  );
  const barrier = jest.fn(() => gate.promise);
  extraction.coordinateShutdown(barrier);
  const first = extraction.onModuleDestroy();
  expect(extraction.onModuleDestroy()).toBe(first);
  expect(barrier).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  gate.resolve();
  await first;
  expect(close).toHaveBeenCalledTimes(1);
});

test('failure discovered before delayed cleanup cannot release admission early', async () => {
  const cleanup = deferred<void>();
  cvWork = async () => {
    try {
      throw new ExtractionError('INVALID_OUTPUT');
    } finally {
      await cleanup.promise;
    }
  };
  const first = start();
  await cvEntered.promise;
  expect((await start()).status).toBe(429);
  cleanup.resolve();
  const response = await first;
  expect(response.status).toBe(422);
  expect(response.body.error).toMatchObject({
    stage: 'CV',
    code: 'INVALID_OUTPUT',
  });
  expect(order).toEqual(['cv']);
  cvWork = async () => values.cv;
  expect((await start()).status).toBe(200);
});
test('unexpected matching exception is sanitized and releases ownership', async () => {
  const spy = jest.spyOn(matching, 'match').mockImplementationOnce(() => {
    throw new Error('PRIVATE matching payload');
  });
  const response = await start();
  expect(response.status).toBe(500);
  expect(response.body).toMatchObject({
    outcome: 'INCOMPLETE',
    result: null,
    error: { code: 'ANALYSIS_FAILED', stage: 'MATCHING' },
    stages: { cv: 'SUCCEEDED', jd: 'SUCCEEDED', matching: 'FAILED' },
  });
  expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
  spy.mockRestore();
  expect((await start()).status).toBe(200);
});
test('settled analyses and rejections leave no ownership timers', async () => {
  fakeClock();
  expect((await start()).status).toBe(200);
  await tick();
  expect(jest.getTimerCount()).toBe(0);
  cvWork = async () => {
    throw new ExtractionError('INVALID_EVIDENCE');
  };
  expect((await start()).status).toBe(422);
  await tick();
  await tick();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['cv', 'jd'] as const)(
  'destroyed response during %s stops the next stage before close delivery',
  async (stage) => {
    let response!: ServerResponse;
    let closeDelivered = false;
    const original = service.admit.bind(service);
    const admission = jest
      .spyOn(service, 'admit')
      .mockImplementationOnce((req, res) => {
        original(req, res);
        expect(req).toBeInstanceOf(IncomingMessage);
        expect(res).toBeInstanceOf(ServerResponse);
        response = res;
        res.once('close', () => {
          closeDelivered = true;
        });
      });
    const match = jest.spyOn(matching, 'match');
    const destroy = () => {
      response.destroy();
      expect(response.destroyed).toBe(true);
      expect(closeDelivered).toBe(false);
    };
    if (stage === 'cv')
      cvWork = async () => {
        destroy();
        return values.cv;
      };
    else
      jdWork = async () => {
        destroy();
        return values.jd;
      };
    const client = streaming();
    client.req.end(payload());
    await client.response;
    await tick();
    expect(order).toEqual(stage === 'cv' ? ['cv'] : ['cv', 'jd']);
    expect(match).not.toHaveBeenCalled();
    admission.mockRestore();
    cvWork = async () => values.cv;
    jdWork = async () => values.jd;
    expect((await start()).status).toBe(200);
  },
);
test.each(['cv', 'jd'] as const)(
  'destruction during %s retains ownership through delayed cleanup',
  async (stage) => {
    let response!: ServerResponse;
    const original = service.admit.bind(service);
    const admission = jest
      .spyOn(service, 'admit')
      .mockImplementationOnce((req, res) => {
        original(req, res);
        response = res;
      });
    const cleanup = deferred<void>();
    const destroyed = deferred<void>();
    const abandon = async () => {
      response.destroy();
      destroyed.resolve();
      await cleanup.promise;
    };
    if (stage === 'cv')
      cvWork = async () => {
        await abandon();
        return values.cv;
      };
    else
      jdWork = async () => {
        await abandon();
        return values.jd;
      };
    const client = streaming();
    client.req.end(payload());
    await destroyed.promise;
    expect((await start()).status).toBe(429);
    cleanup.resolve();
    await client.response;
    await tick();
    await tick();
    expect(order).toEqual(stage === 'cv' ? ['cv'] : ['cv', 'jd']);
    admission.mockRestore();
    cvWork = async () => values.cv;
    jdWork = async () => values.jd;
    expect((await start()).status).toBe(200);
  },
);

test.each(['mode=unknown', 'mode=parse-only&mode=parse-only', 'other=value'])(
  'invalid query %s is rejected before extraction',
  async (query) => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/analyses?${query}`)
      .set('Host', host)
      .set('Origin', origin)
      .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
      .send(payload());
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
    expect(order).toEqual([]);
  },
);
