import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Synthetic WAV builder; defaults to valid 16 kHz mono 16-bit PCM. */
export function wav(
  o: {
    ms?: number;
    rate?: number;
    channels?: number;
    bits?: number;
    format?: number;
    before?: Buffer; // extra chunk(s) inserted before fmt
  } = {},
): Buffer {
  const { ms = 1000, rate = 16_000, channels = 1, bits = 16 } = o;
  const block = channels * (bits / 8);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'latin1');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(o.format ?? 1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * block, 16);
  fmt.writeUInt16LE(block, 20);
  fmt.writeUInt16LE(bits, 22);
  const dataSize = Math.round((rate * ms) / 1000) * block;
  const data = Buffer.alloc(8 + dataSize);
  data.write('data', 0, 'latin1');
  data.writeUInt32LE(dataSize, 4);
  const body = Buffer.concat([o.before ?? Buffer.alloc(0), fmt, data]);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WAVE', 8, 'latin1');
  return Buffer.concat([head, body]);
}

const SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const model = a[a.indexOf('-m') + 1];
const mode = fs.readFileSync(model, 'utf8').trim();
fs.writeFileSync(model + '.run', JSON.stringify({ args: a, pid: process.pid, env: Object.keys(process.env) }));
const prompt = a.includes('--prompt') ? a[a.indexOf('--prompt') + 1] : '';
if (mode === 'fail') { process.stderr.write('secret /path/leak'); process.exit(3); }
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'flood') process.stdout.write('x'.repeat(200000));
else process.stdout.write(' We use RabbitMQ [BLANK_AUDIO] here.\\n' + (prompt ? 'PROMPT=' + prompt : ''));
`;

/** Fake whisper-cli; behaviour comes from the model file's contents. */
export function fakeStt() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-stt-'));
  const bin = join(dir, 'whisper-cli');
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);
  const model = join(dir, 'model.bin');
  const mode = (m: 'ok' | 'fail' | 'hang' | 'flood') => writeFileSync(model, m);
  mode('ok');
  return { dir, bin, model, mode, run: join(dir, 'model.bin.run') };
}
