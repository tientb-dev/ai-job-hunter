export const WAV_RATE = 16_000;
export const WAV_MIN_MS = 500;
export const WAV_MAX_MS = 3 * 60 * 1000;

export type WavErrorCode = 'UNSUPPORTED' | 'DECODE' | 'EMPTY' | 'TOO_LONG';
export class WavError extends Error {
  constructor(readonly code: WavErrorCode) {
    super(code);
  }
}

/** RIFF/WAVE, PCM 16-bit, mono, 16 kHz, 44-byte header. Samples are clamped. */
export function encodeWav(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WAV_RATE, true);
  view.setUint32(28, WAV_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => {
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  });
  return new Blob([view.buffer], { type: 'audio/wav' });
}

type Ctx = typeof AudioContext;
type OfflineCtx = typeof OfflineAudioContext;
const audioApis = () => {
  const w = globalThis as unknown as {
    AudioContext?: Ctx;
    webkitAudioContext?: Ctx;
    OfflineAudioContext?: OfflineCtx;
    webkitOfflineAudioContext?: OfflineCtx;
  };
  const Live = w.AudioContext ?? w.webkitAudioContext;
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  return Live && Offline ? { Live, Offline } : null;
};

/**
 * Any MediaRecorder output the browser can decode (WebM/Opus, Ogg, MP4/AAC)
 * → 16 kHz mono PCM WAV. The offline render mixes channels down and resamples.
 */
export async function toWav(recording: Blob): Promise<Blob> {
  const apis = audioApis();
  if (!apis) throw new WavError('UNSUPPORTED');
  if (!recording.size) throw new WavError('EMPTY');
  let decoded: AudioBuffer;
  let live: AudioContext | undefined;
  try {
    live = new apis.Live();
    decoded = await live.decodeAudioData(await recording.arrayBuffer());
  } catch {
    throw new WavError('DECODE');
  } finally {
    await live?.close().catch(() => {});
  }
  const ms = decoded.duration * 1000;
  if (ms < WAV_MIN_MS) throw new WavError('EMPTY');
  if (ms > WAV_MAX_MS) throw new WavError('TOO_LONG');
  let rendered: AudioBuffer;
  try {
    const offline = new apis.Offline(
      1,
      Math.ceil(decoded.duration * WAV_RATE),
      WAV_RATE,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    rendered = await offline.startRendering();
  } catch {
    throw new WavError('DECODE');
  }
  return encodeWav(rendered.getChannelData(0));
}
