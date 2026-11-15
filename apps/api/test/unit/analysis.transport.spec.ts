import { asLocalOwner } from '../support/as-local-owner.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnalysisController } from '../../src/analysis/analysis.controller.js';
import {
  AnalysisService,
  ANALYSIS_TIMING,
  analysisTiming,
} from '../../src/analysis/analysis.service.js';
import { ExtractionService } from '../../src/extraction/extraction.service.js';
import { MatchingService } from '../../src/matching/matching.service.js';
import { aiConfig } from '../../src/ai/ai.config.js';
import { AnalysisError } from '../../src/analysis/analysis.errors.js';
import {
  configureAnalysisHttp,
  REJECT_CLOSE_MS,
} from '../../src/analysis/analysis-http.js';
import {
  UPLOAD_LIMITS,
  readAnalysisUpload,
  checkUploadHeaders,
} from '../../src/analysis/analysis-upload.js';
import {
  ANALYSIS_HTTP_STATUS,
  analysisError,
} from '../../src/analysis/analysis.errors.js';
import { AiError } from '../../src/ai/ai.errors.js';
import { ExtractionError } from '../../src/extraction/extraction.errors.js';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';

let app: INestApplication;
let port: number;
const host = '127.0.0.1:3000';
const origin = 'http://127.0.0.1:5173';
const boundary = 'synthetic-boundary';
const docx =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const file = (
  bytes: Buffer = Buffer.from('%PDF-synthetic'),
  type = 'application/pdf',
  name = 'cv',
  filename = 'synthetic.pdf',
) =>
  Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    bytes,
    Buffer.from('\r\n'),
  ]);
const field = (value = 'Synthetic JD', name = 'jdText', extra = '') =>
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n${extra}\r\n${value}\r\n`,
  );
const body = (parts: Buffer[]) =>
  Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
const post = (data: Buffer) =>
  request(app.getHttpServer())
    .post('/api/v1/analyses')
    .set('Host', host)
    .set('Origin', origin)
    .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
    .send(data);
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [AnalysisController],
    providers: [
      AnalysisService,
      MatchingService,
      { provide: ANALYSIS_TIMING, useValue: analysisTiming(aiConfig({})) },
      {
        provide: ExtractionService,
        useValue: {
          coordinateShutdown: () => {},
          extractCv: async () => {
            throw new AnalysisError('ANALYSIS_UNAVAILABLE');
          },
        },
      },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  asLocalOwner(app);
  configureAnalysisHttp(app);
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
});
afterAll(async () => {
  await app?.close();
});
test.each([false, true])(
  'valid metadata in either part order, reversed=%s',
  async (reverse) => {
    for (const [mime, filename] of [
      ['application/pdf', 'synthetic.pdf'],
      [docx, 'synthetic.docx'],
    ]) {
      const parts = [
        file(Buffer.from('synthetic bytes'), mime, 'cv', filename),
        field(),
      ];
      const response = await post(body(reverse ? parts.reverse() : parts))
        .set('X-Request-Id', 'PRIVATE')
        .expect(503)
        .expect('Cache-Control', 'no-store');
      expect(response.body).toMatchObject({
        contractVersion: '1',
        outcome: 'INCOMPLETE',
        result: null,
        stages: {
          upload: 'SUCCEEDED',
          cv: 'FAILED',
          jd: 'NOT_RUN',
          matching: 'NOT_RUN',
        },
        error: {
          stage: 'CV',
          code: 'ANALYSIS_UNAVAILABLE',
          diagnostic: null,
        },
      });
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(JSON.stringify(response.body)).not.toContain('PRIVATE');
    }
  },
);
test.each(
  [
    [],
    [file()],
    [field()],
    [file(), file(), field()],
    [file(), field(), field()],
    [file(), field('x', 'extra')],
    [file(), field('x', 'jdText[]')],
    [file(undefined, 'application/pdf', 'cv[]'), field()],
    [field('x', 'cv'), field()],
    [file(), file(Buffer.from('x'), 'text/plain', 'jdText', 'jd.txt')],
    [file(), field('x', 'jdText', 'Content-Type: application/json\r\n')],
  ].map((parts) => ({ parts })),
)('rejects invalid part structure %#', async ({ parts }) => {
  const response = await post(body(parts))
    .expect(400)
    .expect('Cache-Control', 'no-store');
  expect(response.body.error.code).toBe('INVALID_REQUEST');
});
test.each([
  ['application/octet-stream', 'synthetic.pdf'],
  ['application/pdf', 'synthetic.docx'],
  ['text/plain', 'synthetic.pdf'],
  ['application/pdf', '../private.pdf'],
])('rejects invalid metadata %s %s', async (mime, filename) => {
  const response = await post(
    body([file(Buffer.from('x'), mime, 'cv', filename), field()]),
  );
  expect([400, 415]).toContain(response.status);
  expect(JSON.stringify(response.body)).not.toContain(filename);
});
test('empty file and blank text reject', async () => {
  await post(body([file(Buffer.alloc(0)), field()])).expect(400);
  await post(body([file(), field(' \r\n\t')])).expect(422);
});
test('file limit is inclusive; one byte over rejects', async () => {
  await post(
    body([file(Buffer.alloc(UPLOAD_LIMITS.fileBytes, 65)), field()]),
  ).expect(503);
  const result = await post(
    body([file(Buffer.alloc(UPLOAD_LIMITS.fileBytes + 1, 65)), field()]),
  ).expect(413);
  expect(result.body.error.code).toBe('DOCUMENT_TOO_LARGE');
});
test('UTF-16 unit limits preserve supplementary characters', async () => {
  await post(body([file(), field('😀'.repeat(6000))])).expect(503);
  await post(body([file(), field('😀'.repeat(6000) + 'x')])).expect(413);
  await post(body([file(), field('x'.repeat(12000))])).expect(503);
  await post(body([file(), field('x'.repeat(12001))])).expect(413);
});
test('byte field limit rejects without silent truncation', async () => {
  for (const length of [49152, 49153])
    await post(body([file(), field('x'.repeat(length))])).expect(413);
  // The 12,000-unit ceiling is tighter for valid UTF-8: neither byte-limit
  // sample can be accepted, but both must fail rather than silently truncate.
});
test.each([
  '',
  'multipart/form-data',
  `multipart/form-data; boundary=${'x'.repeat(71)}`,
  'multipart/form-data; boundary="bad\tboundary"',
  'multipart/form-data; boundary=one; boundary=two',
])('rejects malformed boundary %#', async (type) => {
  const response = await post(body([file(), field()])).set(
    'Content-Type',
    type,
  );
  expect([400, 415]).toContain(response.status);
});
test('wrong boundary, incomplete body and oversized part headers reject', async () => {
  await post(Buffer.from('--wrong--\r\n')).expect(400);
  await post(file()).expect(400);
  await post(
    body([file(), field('x', 'jdText', `X-Test: ${'x'.repeat(17000)}\r\n`)]),
  ).expect(400);
});
test('content encoding and JSON reject before body parsing', async () => {
  await post(body([file(), field()]))
    .set('Content-Encoding', 'gzip')
    .expect(415);
  await request(app.getHttpServer())
    .post('/api/v1/analyses')
    .set('Host', host)
    .set('Origin', origin)
    .set('Content-Type', 'application/json')
    .send('{PRIVATE invalid json')
    .expect(415);
});
test.each([
  undefined,
  'null',
  'http://evil.invalid',
  'http://127.0.0.1:5173.evil.invalid',
  'http://127.0.0.1:5173/',
  'http://localhost:5173',
])('denies origin %# before parsing', async (value) => {
  const req = request(app.getHttpServer())
    .post('/api/v1/analyses')
    .set('Host', host)
    .set('Content-Type', 'application/json');
  if (value !== undefined) req.set('Origin', value);
  const result = await req
    .send('PRIVATE')
    .expect(403)
    .expect('Cache-Control', 'no-store');
  expect(JSON.stringify(result.body)).not.toContain('PRIVATE');
});
test.each([
  'evil.invalid',
  '127.0.0.1',
  'localhost:3000',
  '127.0.0.1:3000.evil.invalid',
])('denies host %s', async (value) => {
  await post(body([file(), field()]))
    .set('Host', value)
    .expect(403);
});
test('API origin and Vite proxy host are allowed; forwarded headers confer no trust', async () => {
  await post(body([file(), field()]))
    .set('Origin', 'http://127.0.0.1:3000')
    .expect(503);
  await post(body([file(), field()]))
    .set('Host', '127.0.0.1:5173')
    .expect(503);
  await post(body([file(), field()]))
    .set('Host', 'evil.invalid')
    .set('X-Forwarded-Host', host)
    .set('X-Forwarded-Origin', origin)
    .expect(403);
});
function streamed(
  data: Buffer,
  headers: Record<string, string> = {},
  chunked = true,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/analyses',
        method: 'POST',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            body: JSON.parse(Buffer.concat(chunks).toString()) as Record<
              string,
              unknown
            >,
          }),
        );
      },
    );
    req.on('error', reject);
    if (chunked) {
      for (let offset = 0; offset < data.length; offset += 8192)
        req.write(data.subarray(offset, offset + 8192));
      req.end();
    } else req.end(data);
  });
}
test('chunked requests without Content-Length accept both part orders', async () => {
  for (const parts of [
    [file(), field()],
    [field(), file()],
  ])
    expect((await streamed(body(parts))).status).toBe(503);
});
test('total body byte limit accepts exact boundary and rejects one more without Content-Length', async () => {
  const normal = body([file(), field()]);
  const exact = Buffer.concat([
    normal,
    Buffer.alloc(UPLOAD_LIMITS.totalBytes - normal.length, 32),
  ]);
  expect((await streamed(exact)).status).toBe(503);
  expect(
    (await streamed(Buffer.concat([exact, Buffer.from(' ')]))).status,
  ).toBe(413);
});
function raw(headers: string, tail = '', timeout = 1500): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let output = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Socket did not close within bound'));
    }, timeout);
    socket.on('connect', () =>
      socket.write(
        `POST /api/v1/analyses HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\n${headers}\r\n${tail}`,
      ),
    );
    socket.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}
test('oversized Content-Length rejects before body; socket closes without draining', async () => {
  const output = await raw(
    `Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${UPLOAD_LIMITS.totalBytes + 1}\r\n`,
  );
  expect(output).toContain('413');
  expect(output).toContain('REQUEST_TOO_LARGE');
});
test('foreign origin and malformed transport headers close bounded connections', async () => {
  const output = await raw(
    `Origin: http://evil.invalid\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 999999\r\n`,
  );
  expect(output).toContain('403');
  const duplicate = await raw('Content-Length: 10\r\nContent-Length: 20\r\n');
  expect(duplicate).toContain('400');
  const both = await raw(
    'Content-Length: 10\r\nTransfer-Encoding: chunked\r\n',
  );
  expect(both).toContain('400');
});
test('declared short length cannot hide an incomplete multipart body', async () => {
  const output = await raw(
    `Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 2\r\n`,
    'xx',
  );
  expect(output).toContain('400');
});
function syntheticRequest(dataLength?: number): IncomingMessage {
  const stream = new PassThrough() as unknown as IncomingMessage;
  Object.assign(stream, {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      ...(dataLength === undefined
        ? {}
        : { 'content-length': String(dataLength) }),
    },
    rawHeaders: ['Content-Type', `multipart/form-data; boundary=${boundary}`],
  });
  return stream;
}
test('adapter preserves exact JD text and drops its listeners after completion', async () => {
  const text = ' \r\nSynthetic 😀\t\n';
  const data = body([field(text), file()]);
  const req = syntheticRequest(data.length);
  const pending = readAnalysisUpload(req);
  (req as unknown as PassThrough).end(data);
  expect((await pending).jdText).toBe(text);
  for (const event of ['data', 'end', 'aborted', 'error'])
    expect(req.listenerCount(event)).toBe(0);
});
test('misleading length is rejected by adapter and releases resources', async () => {
  const data = body([file(), field()]);
  const req = syntheticRequest(data.length + 1);
  const pending = readAnalysisUpload(req);
  (req as unknown as PassThrough).end(data);
  await expect(pending).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(req.listenerCount('data')).toBe(0);
});
test('transport-only stalled upload watchdog clears resources', async () => {
  jest.useFakeTimers();
  try {
    const req = syntheticRequest();
    const pending = expect(readAnalysisUpload(req, 10)).rejects.toMatchObject({
      code: 'UPLOAD_TIMEOUT',
    });
    await jest.advanceTimersByTimeAsync(10);
    await pending;
    expect(req.listenerCount('data')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
test('truncated connection settles parser and removes request listeners', async () => {
  const req = syntheticRequest();
  const pending = expect(readAnalysisUpload(req)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  req.emit('aborted');
  await pending;
  expect(req.listenerCount('data')).toBe(0);
  expect(req.listenerCount('aborted')).toBe(0);
});
test('header checks are bounded even without Node HTTP parser', () => {
  const req = syntheticRequest();
  req.rawHeaders.push('X-Test', 'x'.repeat(17000));
  expect(() => checkUploadHeaders(req)).toThrow('INVALID_REQUEST');
  expect(REJECT_CLOSE_MS).toBeLessThan(1000);
});
test('error mapper retains only fixed codes and diagnostics', () => {
  const error = new ExtractionError('INVALID_EVIDENCE', {
    stage: 'EVIDENCE',
    rule: 'QUOTE_AMBIGUOUS',
    field: 'cv.skills[].name',
    quote: 'PRIVATE',
  });
  expect(analysisError(error, 'CV')).toEqual({
    stage: 'CV',
    code: 'INVALID_EVIDENCE',
    diagnostic: {
      stage: 'EVIDENCE',
      rule: 'QUOTE_AMBIGUOUS',
      field: 'cv.skills[].name',
    },
  });
  expect(analysisError(new AiError('SCHEMA_VALIDATION_FAILURE'), 'JD')).toEqual(
    {
      stage: 'JD',
      code: 'SCHEMA_VALIDATION_FAILURE',
      diagnostic: {
        stage: 'AI_SCHEMA',
        rule: 'SCHEMA_MISMATCH',
        field: 'output',
      },
    },
  );
  expect(analysisError(new Error('PRIVATE'))).toEqual({
    stage: 'REQUEST',
    code: 'ANALYSIS_FAILED',
    diagnostic: null,
  });
  expect(
    analysisError({
      code: 'INVALID_OUTPUT',
      diagnostic: {
        stage: 'OUTPUT',
        rule: 'SCHEMA_MISMATCH',
        field: 'PRIVATE',
      },
    }).diagnostic,
  ).toBeNull();
  expect(
    analysisError({
      get code() {
        throw new Error('PRIVATE');
      },
    }).code,
  ).toBe('ANALYSIS_FAILED');
});
test.each(Object.entries(ANALYSIS_HTTP_STATUS))(
  'maps %s to HTTP %s',
  (code, status) => {
    expect(ANALYSIS_HTTP_STATUS[analysisError({ code }).code]).toBe(status);
  },
);

test('UTF-8 wire validation rejects malformed bytes and alternate charsets', async () => {
  const valid = body([file(), field('SENTINEL')]);
  const at = valid.indexOf('SENTINEL');
  const invalid = Buffer.concat([
    valid.subarray(0, at),
    Buffer.from([0xc3, 0x28]),
    valid.subarray(at + 8),
  ]);
  await post(invalid).expect(400);
  await post(
    body([
      file(),
      field(
        'Synthetic',
        'jdText',
        'Content-Type: text/plain; charset=iso-8859-1\r\n',
      ),
    ]),
  ).expect(400);
  await post(
    body([
      file(),
      field('😀', 'jdText', 'Content-Type: text/plain; charset="utf-8"\r\n'),
    ]),
  ).expect(503);
  await post(body([file(), field('replacement character: �')])).expect(503);
});
test('adapter preserves BOM, Unicode and CRLF with one-byte chunk boundaries', async () => {
  const text = '\ufeff 😀\r\nSynthetic';
  const data = body([file(Buffer.from([0xff, 0xfe, 0x00])), field(text)]);
  const req = syntheticRequest();
  const pending = readAnalysisUpload(req);
  for (const byte of data)
    (req as unknown as PassThrough).write(Buffer.from([byte]));
  (req as unknown as PassThrough).end();
  expect((await pending).jdText).toBe(text);
});
test('many rejected requests leave server usable and never log private messages', async () => {
  const spies = [
    jest.spyOn(console, 'log'),
    jest.spyOn(console, 'warn'),
    jest.spyOn(console, 'error'),
  ];
  try {
    for (let i = 0; i < 10; i++)
      await post(body([file(), field('PRIVATE', 'unexpected')])).expect(400);
    await post(body([file(), field()])).expect(503);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
});

test.each([
  'malformed-utf8',
  'quoted-extension',
  'preamble',
  'nested-name',
  'duplicate-parameter',
  'folded-header',
])('UTF-8 bypass %s rejects in whole and split chunks', async (variant) => {
  const disposition =
    variant === 'quoted-extension'
      ? 'name="jdText"; x="; filename=f"'
      : variant === 'nested-name'
        ? 'name="jdText[x]"'
        : variant === 'duplicate-parameter'
          ? 'name="jdText"; name="cv"'
          : 'name="jdText"';
  const part = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; ${disposition}${variant === 'folded-header' ? '\r\n filename=f' : ''}\r\n\r\n`,
    ),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('\r\n'),
  ]);
  const data = Buffer.concat([
    variant === 'preamble'
      ? Buffer.from(`junk--${boundary}--\r\n`)
      : Buffer.alloc(0),
    body([file(), part]),
  ]);
  await post(data).expect(400).expect('Cache-Control', 'no-store');
  for (const size of [1, 2, 7, data.length]) {
    const req = syntheticRequest();
    const pending = expect(readAnalysisUpload(req)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const stream = req as unknown as PassThrough;
    for (let i = 0; i < data.length; i += size)
      stream.write(data.subarray(i, i + size));
    stream.end();
    await pending;
    expect(req.listenerCount('data')).toBe(0);
  }
});
test('quoted supported parameters preserve exact valid UTF-8 across all split positions', async () => {
  const text = ' \ufeffé😀\r\n\ufffd\t';
  const part = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="jdText"\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${text}\r\n`,
  );
  const data = body([
    part,
    file(
      Buffer.from([255, 254, 0]),
      'application/pdf',
      'cv',
      'synthetic;name.pdf',
    ),
  ]);
  for (let at = 1; at < data.length; at++) {
    const req = syntheticRequest();
    const pending = readAnalysisUpload(req);
    const stream = req as unknown as PassThrough;
    stream.write(data.subarray(0, at));
    stream.end(data.subarray(at));
    const output = await pending;
    expect(output.jdText).toBe(text);
    expect(Buffer.from(output.jdText)).toEqual(Buffer.from(text));
  }
});

test('non-ASCII boundary suffix cannot be mistaken for a closing delimiter', async () => {
  const bytes = Buffer.concat([
    Buffer.from(`binary\r\n--${boundary}`),
    Buffer.from([0xad, 0xad]),
    Buffer.from('binary'),
  ]);
  const data = body([file(bytes), field()]);
  await post(data).expect(400);
  const req = syntheticRequest();
  const pending = expect(readAnalysisUpload(req)).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
  });
  for (const byte of data)
    (req as unknown as PassThrough).write(Buffer.from([byte]));
  (req as unknown as PassThrough).end();
  await pending;
});
