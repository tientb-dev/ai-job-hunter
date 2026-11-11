import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { availableParallelism, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InterviewPrepError } from './interview-prep.policy.js';
import type { InterviewQuestion } from './interview-prep.questions.js';
import { resolveQuestion } from './job-questions.js';
import { STT_MAX_BYTES, wavDurationMs } from './transcription.wav.js';

const MAX_STDOUT = 64 * 1024;
const MAX_TERMS = 12;
const MAX_HINT_CHARS = 160;
const STOP = new Set(['I', 'A', 'The', 'How', 'What', 'Why', 'When']);

/**
 * Short technical-vocabulary hint from the question's own wording and hints
 * only — never the JD, CV, saved answers or client text. Terms are reduced to
 * [A-Za-z0-9+#.-] so nothing else can reach the whisper prompt.
 */
export function vocabularyHint(q: InterviewQuestion | undefined): string {
  if (!q) return '';
  const terms = new Set<string>();
  for (const text of [...q.variants, ...q.hints])
    for (const sentence of text.split(/[.?!:;]\s+/u)) {
      const words = sentence.match(/[A-Za-z][A-Za-z0-9+#.-]*/gu) ?? [];
      words.forEach((raw, i) => {
        const w = raw.replace(/[.-]+$/u, '');
        const technical =
          /[A-Z]/u.test(w.slice(1)) || /[0-9+#.]/u.test(w.slice(1));
        const proper = i > 0 && /^[A-Z]/u.test(w) && !STOP.has(w);
        if (w.length > 1 && (technical || proper)) terms.add(w);
      });
    }
  let hint = '';
  for (const term of [...terms].slice(0, MAX_TERMS)) {
    const next = hint ? `${hint}, ${term}` : term;
    if (next.length > MAX_HINT_CHARS) break;
    hint = next;
  }
  return hint;
}

@Injectable()
export class TranscriptionService {
  /** Hard per-transcription limits; fields so tests can shorten them. */
  timeoutMs = 60_000;
  uploadTimeoutMs = 15_000;
  // One CPU transcription per API instance.
  private active = false;
  constructor(private readonly db: DataSource) {}

  async transcribe(
    ownerId: string,
    req: IncomingMessage,
    questionId: unknown,
    signal: AbortSignal,
  ) {
    const config = await this.config();
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    if (type.toLowerCase() !== 'audio/wav')
      throw new InterviewPrepError('STT_INVALID_AUDIO');
    const audio = await this.readBody(req);
    const durationMs = wavDurationMs(audio);
    const hint = vocabularyHint(await this.question(ownerId, questionId));
    if (this.active) throw new InterviewPrepError('STT_BUSY');
    this.active = true;
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(tmpdir(), 'ajh-stt-'));
      const file = join(dir, 'answer.wav');
      await writeFile(file, audio, { mode: 0o600 });
      const transcript = await this.run(config, file, hint, signal);
      return { contractVersion: '1' as const, transcript, durationMs };
    } catch (error) {
      if (error instanceof InterviewPrepError) throw error;
      throw new InterviewPrepError('STT_FAILED');
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
      this.active = false;
    }
  }

  /** Optional config, checked per request so the app always starts. */
  private async config() {
    const bin = process.env.STT_BIN?.trim();
    const model = process.env.STT_MODEL?.trim();
    const unavailable = new InterviewPrepError('STT_UNAVAILABLE');
    if (!bin || !model || !isAbsolute(bin) || !isAbsolute(model))
      throw unavailable;
    try {
      await access(bin, constants.X_OK);
      await access(model, constants.R_OK);
    } catch {
      throw unavailable;
    }
    return { bin, model };
  }

  private async question(ownerId: string, id: unknown) {
    if (id === undefined) return undefined;
    const invalid = new InterviewPrepError(
      'INTERVIEW_INVALID_REQUEST',
      'Unknown practice question.',
    );
    if (typeof id !== 'string' || id.length > 64) throw invalid;
    let q: InterviewQuestion | undefined;
    try {
      // Owner-scoped: another owner's jd-<uuid> resolves to nothing.
      q = await resolveQuestion(this.db, ownerId, id);
    } catch {
      throw new InterviewPrepError('INTERVIEW_STORAGE_UNAVAILABLE');
    }
    if (!q) throw invalid;
    return q;
  }

  /** Buffers at most STT_MAX_BYTES; excess bytes are drained, never kept. */
  private readBody(req: IncomingMessage): Promise<Buffer> {
    const declared = Number(req.headers['content-length']);
    if (declared > STT_MAX_BYTES) {
      req.resume();
      return Promise.reject(new InterviewPrepError('STT_TOO_LARGE'));
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => {
        done(new InterviewPrepError('STT_TIMEOUT'));
        req.destroy();
      }, this.uploadTimeoutMs);
      const done = (error?: InterviewPrepError) => {
        clearTimeout(timer);
        req.off('data', onData).off('end', onEnd).off('error', onError);
        req.off('aborted', onError);
        if (error) {
          req.resume();
          reject(error);
        } else resolve(Buffer.concat(chunks, size));
      };
      const onData = (chunk: Buffer) => {
        size += chunk.length;
        if (size > STT_MAX_BYTES)
          return done(new InterviewPrepError('STT_TOO_LARGE'));
        chunks.push(chunk);
      };
      const onEnd = () => done();
      const onError = () => done(new InterviewPrepError('STT_INVALID_AUDIO'));
      req.on('data', onData).on('end', onEnd).on('error', onError);
      req.on('aborted', onError);
    });
  }

  private run(
    config: { bin: string; model: string },
    file: string,
    hint: string,
    signal: AbortSignal,
  ): Promise<string> {
    const threads = String(
      Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2))),
    );
    const args = ['-m', config.model, '-f', file, '-l', 'en'];
    args.push('-t', threads, '-ng', '-nt', '-np');
    if (hint) args.push('--prompt', `Technical terms: ${hint}.`);
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new InterviewPrepError('STT_FAILED'));
      // No shell; minimal env; stderr ignored so CLI diagnostics never leak.
      const child = spawn(config.bin, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { PATH: process.env.PATH ?? '' },
      });
      let out = '';
      let failure: InterviewPrepError | undefined;
      const stop = (code: 'STT_TIMEOUT' | 'STT_FAILED') => {
        failure ??= new InterviewPrepError(code);
        child.kill('SIGKILL');
      };
      const timer = setTimeout(() => stop('STT_TIMEOUT'), this.timeoutMs);
      const onAbort = () => stop('STT_FAILED');
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        out += chunk;
        if (out.length > MAX_STDOUT) stop('STT_FAILED');
      });
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (failure || !ok)
          reject(failure ?? new InterviewPrepError('STT_FAILED'));
        else resolve(cleanTranscript(out));
      };
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
    });
  }
}

/** Drops whisper's non-speech markers such as [BLANK_AUDIO] or (music). */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
