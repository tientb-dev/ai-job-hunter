import { InterviewPrepError } from './interview-prep.policy.js';

export const STT_SAMPLE_RATE = 16_000;
export const STT_MIN_MS = 500;
export const STT_MAX_MS = 3 * 60 * 1000;
/** 3 min of 16 kHz mono 16-bit PCM is 5.76 MB; leave room for headers. */
export const STT_MAX_BYTES = 6 * 1024 * 1024;

/**
 * Walks RIFF chunks (no fixed 44-byte header assumption) and accepts only
 * PCM 16-bit mono 16 kHz with exactly one fmt chunk before one data chunk.
 * Returns the real duration computed from the sample count.
 */
export function wavDurationMs(buf: Buffer): number {
  const invalid = () => new InterviewPrepError('STT_INVALID_AUDIO');
  if (
    buf.length < 12 ||
    buf.toString('latin1', 0, 4) !== 'RIFF' ||
    buf.toString('latin1', 8, 12) !== 'WAVE' ||
    buf.readUInt32LE(4) + 8 !== buf.length
  )
    throw invalid();
  let fmt = false;
  let samples: number | undefined;
  let off = 12;
  while (off < buf.length) {
    if (off + 8 > buf.length) throw invalid();
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (body + size > buf.length) throw invalid();
    if (id === 'fmt ') {
      if (fmt || samples !== undefined || size < 16) throw invalid();
      if (
        buf.readUInt16LE(body) !== 1 || // PCM
        buf.readUInt16LE(body + 2) !== 1 || // mono
        buf.readUInt32LE(body + 4) !== STT_SAMPLE_RATE ||
        buf.readUInt32LE(body + 8) !== STT_SAMPLE_RATE * 2 || // byte rate
        buf.readUInt16LE(body + 12) !== 2 || // block align
        buf.readUInt16LE(body + 14) !== 16
      )
        throw invalid();
      fmt = true;
    } else if (id === 'data') {
      if (!fmt || samples !== undefined || size % 2) throw invalid();
      samples = size / 2;
    }
    off = body + size + (size & 1); // RIFF chunks are word-aligned
  }
  if (off !== buf.length || samples === undefined) throw invalid();
  const ms = Math.round((samples * 1000) / STT_SAMPLE_RATE);
  if (ms < STT_MIN_MS) throw invalid();
  if (ms > STT_MAX_MS) throw new InterviewPrepError('STT_TOO_LARGE');
  return ms;
}
