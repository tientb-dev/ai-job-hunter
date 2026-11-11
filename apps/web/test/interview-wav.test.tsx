import { afterEach, expect, test, vi } from 'vitest';
import { WavError, encodeWav, toWav } from '../src/features/interview-prep/wav';

afterEach(() => vi.unstubAllGlobals());

async function header(blob: Blob) {
  const v = new DataView(await blob.arrayBuffer());
  const tag = (at: number) =>
    String.fromCharCode(...new Uint8Array(v.buffer, at, 4));
  return {
    riff: tag(0),
    riffSize: v.getUint32(4, true),
    wave: tag(8),
    fmt: tag(12),
    format: v.getUint16(20, true),
    channels: v.getUint16(22, true),
    rate: v.getUint32(24, true),
    byteRate: v.getUint32(28, true),
    align: v.getUint16(32, true),
    bits: v.getUint16(34, true),
    data: tag(36),
    dataSize: v.getUint32(40, true),
    length: v.byteLength,
    first: v.getInt16(44, true),
    second: v.getInt16(46, true),
  };
}

test('encodeWav writes 16 kHz mono 16-bit PCM with a consistent header and clamps samples', async () => {
  const blob = encodeWav(new Float32Array([2, -2, 0]));
  expect(blob.type).toBe('audio/wav');
  expect(await header(blob)).toEqual({
    riff: 'RIFF',
    riffSize: 36 + 6,
    wave: 'WAVE',
    fmt: 'fmt ',
    format: 1,
    channels: 1,
    rate: 16_000,
    byteRate: 32_000,
    align: 2,
    bits: 16,
    data: 'data',
    dataSize: 6,
    length: 50,
    first: 32767,
    second: -32768,
  });
});

function stubAudio(o: { duration?: number; decode?: 'fail'; render?: 'fail' }) {
  const close = vi.fn(async () => {});
  const offlineArgs: number[][] = [];
  class Live {
    decodeAudioData = vi.fn(async () => {
      if (o.decode) throw new DOMException('bad', 'EncodingError');
      return { duration: o.duration ?? 1.5, numberOfChannels: 2 };
    });
    close = close;
  }
  class Offline {
    destination = {};
    constructor(...args: number[]) {
      offlineArgs.push(args);
    }
    createBufferSource() {
      return { buffer: null, connect() {}, start() {} };
    }
    async startRendering() {
      if (o.render) throw new Error('render');
      const length = offlineArgs.at(-1)![1]!;
      return { getChannelData: () => new Float32Array(length).fill(0.25) };
    }
  }
  vi.stubGlobal('AudioContext', Live);
  vi.stubGlobal('OfflineAudioContext', Offline);
  return { close, offlineArgs };
}
const take = () =>
  new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'OK',
    (e: unknown) => (e instanceof WavError ? e.code : 'OTHER'),
  );

test('toWav renders mono 16 kHz with the real sample count and closes the AudioContext', async () => {
  const { close, offlineArgs } = stubAudio({ duration: 1.5 });
  const h = await header(await toWav(take()));
  expect(offlineArgs).toEqual([[1, 24_000, 16_000]]);
  expect(h).toMatchObject({ channels: 1, rate: 16_000, bits: 16 });
  expect(h.dataSize / 2).toBe(24_000);
  expect(h.first).toBe(8191); // 0.25 × 32767, truncated by setInt16
  expect(close).toHaveBeenCalledTimes(1);
});

test('toWav failures: unsupported browser, empty, decode, render, too short and too long', async () => {
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('webkitAudioContext', undefined);
  expect(await code(toWav(take()))).toBe('UNSUPPORTED');
  stubAudio({});
  expect(await code(toWav(new Blob([])))).toBe('EMPTY');
  const failed = stubAudio({ decode: 'fail' });
  expect(await code(toWav(take()))).toBe('DECODE');
  expect(failed.close).toHaveBeenCalledTimes(1);
  stubAudio({ render: 'fail' });
  expect(await code(toWav(take()))).toBe('DECODE');
  stubAudio({ duration: 0.2 });
  expect(await code(toWav(take()))).toBe('EMPTY');
  stubAudio({ duration: 181 });
  expect(await code(toWav(take()))).toBe('TOO_LONG');
});

test('toWav uses prefixed WebKit audio contexts when unprefixed ones are missing', async () => {
  stubAudio({});
  const live = globalThis.AudioContext;
  const offline = globalThis.OfflineAudioContext;
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('OfflineAudioContext', undefined);
  vi.stubGlobal('webkitAudioContext', live);
  vi.stubGlobal('webkitOfflineAudioContext', offline);
  expect(await code(toWav(take()))).toBe('OK');
});
