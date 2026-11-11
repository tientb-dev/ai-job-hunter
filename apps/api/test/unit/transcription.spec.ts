import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { findQuestion } from '../../src/interview-prep/interview-prep.questions.js';
import {
  TranscriptionService,
  cleanTranscript,
  vocabularyHint,
} from '../../src/interview-prep/transcription.service.js';
import {
  STT_MAX_BYTES,
  wavDurationMs,
} from '../../src/interview-prep/transcription.wav.js';
import { fakeStt, wav } from '../support/fake-stt.js';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { errorCode?: string }).errorCode;
  }
  return 'OK';
};
const reqOf = (body: Buffer, type = 'audio/wav') =>
  Object.assign(Readable.from([body]), {
    headers: { 'content-type': type, 'content-length': String(body.length) },
  }) as unknown as IncomingMessage;

describe('wavDurationMs', () => {
  test('accepts 16 kHz mono 16-bit PCM and measures the sample count', () => {
    expect(wavDurationMs(wav({ ms: 1500 }))).toBe(1500);
    const list = Buffer.alloc(14); // 5-byte chunk + 1 pad byte
    list.write('LIST', 0, 'latin1');
    list.writeUInt32LE(5, 4);
    expect(wavDurationMs(wav({ ms: 800, before: list }))).toBe(800);
  });
  test.each([
    ['rate', { rate: 44_100 }],
    ['stereo', { channels: 2 }],
    ['8-bit', { bits: 8 }],
    ['float', { format: 3 }],
    ['too short', { ms: 400 }],
  ])('rejects %s', (_name, opts) => {
    expect(code(() => wavDurationMs(wav(opts)))).toBe('STT_INVALID_AUDIO');
  });
  test('rejects over three minutes as too large', () => {
    expect(code(() => wavDurationMs(wav({ ms: 180_100 })))).toBe(
      'STT_TOO_LARGE',
    );
  });
  test('rejects malformed headers and chunk boundaries', () => {
    const ok = wav();
    const mutate = (fn: (b: Buffer) => void) => {
      const b = Buffer.from(ok);
      fn(b);
      return b;
    };
    for (const bad of [
      Buffer.alloc(0),
      ok.subarray(0, 30), // truncated
      mutate((b) => b.write('RIFX', 0, 'latin1')),
      mutate((b) => b.write('AVI ', 8, 'latin1')),
      mutate((b) => b.writeUInt32LE(b.readUInt32LE(4) + 2, 4)), // RIFF size
      mutate((b) => b.writeUInt32LE(0xffffff, 40)), // data size past end
      mutate((b) => b.write('junk', 12, 'latin1')), // no fmt chunk
      Buffer.concat([ok, Buffer.alloc(3)]), // trailing bytes
    ])
      expect(code(() => wavDurationMs(bad))).toBe('STT_INVALID_AUDIO');
  });
});

describe('vocabularyHint', () => {
  test('keeps technical terms only, bounded and sanitized', () => {
    const q = {
      ...findQuestion('hr-intro-01')!,
      variants: [
        'How does PostgreSQL MVCC work with Node.js and C#? Explain; <script> "quotes"',
      ],
      hints: Array.from({ length: 40 }, (_, i) => `Mention Tool${i}X`),
    };
    const hint = vocabularyHint(q);
    expect(hint.startsWith('PostgreSQL, MVCC, Node.js, C#')).toBe(true);
    expect(hint).not.toMatch(/How|script|quotes|[<>"]/u);
    expect(hint.length).toBeLessThanOrEqual(160);
    expect(hint.split(', ').length).toBeLessThanOrEqual(12);
    expect(vocabularyHint(undefined)).toBe('');
  });
  test('drops whisper non-speech markers', () => {
    expect(cleanTranscript(' Hi [BLANK_AUDIO] (music)  there\n')).toBe(
      'Hi there',
    );
  });
});

describe('TranscriptionService with a fake whisper-cli', () => {
  const env = { ...process.env };
  let stt: ReturnType<typeof fakeStt>;
  let service: TranscriptionService;
  let temp: string;
  const rows: unknown[] = [];
  const db = { query: async () => rows } as unknown as DataSource;
  const go = (
    body = wav(),
    q?: unknown,
    signal = new AbortController().signal,
  ) => service.transcribe('owner', reqOf(body), q, signal);
  const fails = async (p: Promise<unknown>) =>
    p.then(
      () => 'OK',
      (e: { errorCode?: string }) => e.errorCode,
    );
  const leftovers = () =>
    readdirSync(temp).filter((d) => d.startsWith('ajh-stt-'));

  beforeEach(() => {
    stt = fakeStt();
    temp = mkdtempSync(join(tmpdir(), 'stt-tmp-'));
    process.env.TMPDIR = temp;
    process.env.STT_BIN = stt.bin;
    process.env.STT_MODEL = stt.model;
    service = new TranscriptionService(db);
    rows.length = 0;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  test('transcribes valid WAV with CPU-only, shell-free arguments and cleans up', async () => {
    await expect(go(wav({ ms: 2000 }))).resolves.toEqual({
      contractVersion: '1',
      transcript: 'We use RabbitMQ here.',
      durationMs: 2000,
    });
    const run = JSON.parse(readFileSync(stt.run, 'utf8'));
    expect(run.args).toEqual(expect.arrayContaining(['-ng', '-nt', '-np']));
    expect(run.args).not.toContain('--prompt');
    expect(run.env).toEqual(['PATH']);
    expect(leftovers()).toEqual([]);
  });

  test('passes a vocabulary hint only for a resolved question', async () => {
    const out = await go(wav(), 'tech-async-01');
    expect(out.transcript).toContain('PROMPT=Technical terms: RabbitMQ.');
    expect(await fails(go(wav(), 'not-a-question'))).toBe(
      'INTERVIEW_INVALID_REQUEST',
    );
    // Other owner's / missing jd question: owner-scoped query returns no row.
    expect(
      await fails(go(wav(), 'jd-3f1c1a52-6d0e-4a7b-9c1d-2e3f4a5b6c7d')),
    ).toBe('INTERVIEW_INVALID_REQUEST');
    expect(await fails(go(wav(), ['hr-intro-01']))).toBe(
      'INTERVIEW_INVALID_REQUEST',
    );
  });

  test('unset configuration uses ~/whisper.cpp; explicit paths win', async () => {
    const home = mkdtempSync(join(tmpdir(), 'stt-home-'));
    process.env.HOME = home;
    delete process.env.STT_BIN;
    process.env.STT_MODEL = '';
    // Not installed at the default location: unavailable, typing still works.
    expect(await fails(go())).toBe('STT_UNAVAILABLE');
    mkdirSync(join(home, 'whisper.cpp', 'build', 'bin'), { recursive: true });
    mkdirSync(join(home, 'whisper.cpp', 'models'));
    symlinkSync(
      stt.bin,
      join(home, 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
    );
    symlinkSync(
      stt.model,
      join(home, 'whisper.cpp', 'models', 'ggml-base.en.bin'),
    );
    await expect(go(wav())).resolves.toMatchObject({ contractVersion: '1' });
    // An explicit override is used as-is, even when the default exists.
    process.env.STT_BIN = join(stt.dir, 'missing');
    expect(await fails(go())).toBe('STT_UNAVAILABLE');
    rmSync(home, { recursive: true, force: true });
  });

  test('missing or relative configuration is unavailable', async () => {
    process.env.HOME = temp; // no ~/whisper.cpp here
    delete process.env.STT_BIN;
    expect(await fails(go())).toBe('STT_UNAVAILABLE');
    process.env.STT_BIN = 'whisper-cli';
    expect(await fails(go())).toBe('STT_UNAVAILABLE');
    process.env.STT_BIN = join(stt.dir, 'missing');
    expect(await fails(go())).toBe('STT_UNAVAILABLE');
  });

  test('rejects wrong content type and oversized bodies without buffering them', async () => {
    expect(
      await fails(
        service.transcribe(
          'o',
          reqOf(wav(), 'audio/webm'),
          undefined,
          new AbortController().signal,
        ),
      ),
    ).toBe('STT_INVALID_AUDIO');
    const big = Buffer.alloc(STT_MAX_BYTES + 1);
    expect(await fails(go(big))).toBe('STT_TOO_LARGE');
    const undeclared = Object.assign(Readable.from([big]), {
      headers: { 'content-type': 'audio/wav' },
    }) as unknown as IncomingMessage;
    expect(
      await fails(
        service.transcribe(
          'o',
          undeclared,
          undefined,
          new AbortController().signal,
        ),
      ),
    ).toBe('STT_TOO_LARGE');
  });

  test('process failure and flooding output map to STT_FAILED without leaks', async () => {
    stt.mode('fail');
    const error = await go().catch((e: Error) => e);
    expect((error as { errorCode?: string }).errorCode).toBe('STT_FAILED');
    expect((error as Error).message).not.toMatch(/path|leak|secret/u);
    stt.mode('flood');
    expect(await fails(go())).toBe('STT_FAILED');
    expect(leftovers()).toEqual([]);
  });

  test('timeout kills the process and releases the slot', async () => {
    stt.mode('hang');
    service.timeoutMs = 300;
    expect(await fails(go())).toBe('STT_TIMEOUT');
    const { pid } = JSON.parse(readFileSync(stt.run, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(leftovers()).toEqual([]);
    stt.mode('ok');
    expect(await fails(go())).toBe('OK');
  });

  test('busy while running; cancellation kills the process and frees the slot', async () => {
    stt.mode('hang');
    const abort = new AbortController();
    const first = fails(go(wav(), undefined, abort.signal));
    await new Promise((r) => setTimeout(r, 300));
    expect(await fails(go())).toBe('STT_BUSY');
    abort.abort();
    expect(await first).toBe('STT_FAILED');
    const { pid } = JSON.parse(readFileSync(stt.run, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(leftovers()).toEqual([]);
    stt.mode('ok');
    expect(await fails(go())).toBe('OK');
  });
});
