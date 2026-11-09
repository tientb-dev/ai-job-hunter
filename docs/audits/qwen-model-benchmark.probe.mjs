import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url)).replace(
  /\/$/,
  '',
);
await import(`${root}/apps/api/node_modules/reflect-metadata/Reflect.js`);
const base = `${root}/apps/api/.test-dist/src`;
const { AiService } = await import(`${base}/ai/ai.service.js`);
const { JobMatchService } = await import(
  `${base}/matching/job-match.service.js`
);
const { MatchingService } = await import(
  `${base}/matching/matching.service.js`
);
const { validateGeneration, outputBudget } = await import(
  `${base}/ai/ollama.context.js`
);
const f = JSON.parse(
  readFileSync(`${root}/docs/audits/fixtures/p67-synthetic-and-match.json`),
).fixture;
const database =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const cases = [
  {
    name: 'and-or',
    cv: f.cv,
    required: f.required,
    preferred: f.preferred,
    expected: ['PARTIAL', 'EVIDENCED'],
  },
  {
    name: 'sql-work',
    cv: 'Skills: SQL Server\nDeveloped enterprise features using SQL Server.\nOptimized data-access logic and MyBatis queries.',
    required: database,
    preferred: 'Rust',
    expected: ['PARTIAL', 'NOT_EVIDENCED'],
  },
  {
    name: 'sql-proficiency',
    cv: 'Independently designed SQL Server database schemas for a production billing application.',
    required: database,
    preferred: 'Rust',
    expected: ['EVIDENCED', 'NOT_EVIDENCED'],
  },
  {
    name: 'sql-keywords',
    cv: 'Skills: SQL Server, Oracle, MySQL',
    required: database,
    preferred: 'Rust',
    expected: ['NOT_EVIDENCED', 'NOT_EVIDENCED'],
  },
];
mkdirSync('/tmp/ai-job-hunter-qwen-benchmark', { recursive: true });
const origin = 'http://127.0.0.1:11434';
async function call(path, body, signal = AbortSignal.timeout(10000)) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (Buffer.byteLength(text) > 1048576) throw Error('response limit');
  return JSON.parse(text);
}
const metadata = {
  version: await call('/api/version'),
  tags: await call('/api/tags'),
  cases,
  settings: {
    num_ctx: 8192,
    temperature: 0,
    think: false,
    timeoutMs: 120000,
    repeats: 2,
  },
  runs: [],
};
function save() {
  writeFileSync(
    '/tmp/ai-job-hunter-qwen-benchmark/results.json',
    JSON.stringify(metadata, null, 2),
  );
}
function gpu() {
  try {
    return Number(
      execFileSync(
        'nvidia-smi',
        ['--query-gpu=memory.used', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', timeout: 2000 },
      ).trim(),
    );
  } catch {
    return null;
  }
}
function memory() {
  const m = readFileSync('/proc/meminfo', 'utf8');
  const val = (k) => Number(m.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1]);
  return (val('MemTotal') - val('MemAvailable')) / 1024;
}
for (const model of ['qwen3:4b', 'qwen3:8b']) {
  // Sequential residency; unload only benchmark models, never touch persisted data.
  for (const other of ['qwen3:4b', 'qwen3:8b'])
    await call('/api/generate', { model: other, keep_alive: 0 });
  for (let rep = 1; rep <= 2; rep++)
    for (const fixture of cases) {
      const run = {
        model,
        rep,
        case: fixture.name,
        calls: [],
        gpuPeakMiB: gpu(),
        systemUsedPeakMiB: memory(),
      };
      metadata.runs.push(run);
      let polling = false;
      const sample = async () => {
        if (polling) return;
        polling = true;
        try {
          run.gpuPeakMiB = Math.max(run.gpuPeakMiB ?? 0, gpu() ?? 0);
          run.systemUsedPeakMiB = Math.max(run.systemUsedPeakMiB, memory());
          const ps = await call('/api/ps');
          run.allocation = ps.models?.filter((m) => m.name === model);
        } catch {
          // Allocation sampling is best-effort; polling failures must not stop the benchmark.
        } finally {
          polling = false;
        }
      };
      const timer = setInterval(sample, 1000);
      const provider = {
        async generate(req) {
          const start = performance.now(),
            signal = AbortSignal.timeout(120000);
          const tags = await call('/api/tags', undefined, signal);
          const tag = tags.models.find((m) => m.name === model);
          if (
            tag.digest !==
            metadata.tags.models.find((m) => m.name === model).digest
          )
            throw Error('digest drift');
          const request = {
            model,
            prompt: req.prompt,
            stream: false,
            think: false,
            truncate: false,
            shift: false,
            format: req.schema,
            keep_alive: '5m',
          };
          const gen = async (n) => {
            const t = performance.now();
            const e = await call(
              '/api/generate',
              {
                ...request,
                options: { num_ctx: 8192, num_predict: n, temperature: 0 },
              },
              signal,
            );
            run.calls.push({
              pass: n === 1 ? 'measurement' : 'generation',
              ms: performance.now() - t,
              promptTokens: e.prompt_eval_count,
              evalTokens: e.eval_count,
              loadMs: e.load_duration / 1e6,
              evalMs: e.eval_duration / 1e6,
              doneReason: e.done_reason,
              raw: e.response,
            });
            return e;
          };
          const check = (e, measurement, limit) =>
            validateGeneration({ ...e, model: 'qwen3:4b' }, measurement, limit);
          const measured = check(await gen(1), true);
          const limit = outputBudget(measured.promptTokens);
          const generated = check(await gen(limit), false, limit);
          if (generated.promptTokens !== measured.promptTokens)
            throw Error('prompt drift');
          const allocation = (
            await call('/api/ps', undefined, signal)
          ).models.find((m) => m.name === model);
          if (
            !allocation ||
            allocation.context_length !== 8192 ||
            allocation.digest !== tag.digest ||
            allocation.runner !== 'llamacpp'
          )
            throw Error('allocation mismatch');
          run.allocation = [allocation];
          run.calls.at(-1).providerMs = performance.now() - start;
          return generated.text;
        },
      };
      const revision = new Date('2026-11-05T00:00:00Z');
      const cv = {
        text: fixture.cv,
        fileName: 'synthetic.pdf',
        updatedAt: revision,
      };
      const job = {
        id: '00000000-0000-4000-8000-000000000123',
        title: 'Synthetic benchmark',
        skills: fixture.required,
        preferredSkills: fixture.preferred,
        experience: '',
        domain: '',
        seniority: '',
        description: fixture.required,
        postText: '',
        jdText: '',
        updatedAt: revision,
      };
      const service = new JobMatchService(
        { findOne: async () => cv, findOneBy: async () => cv },
        {},
        new AiService(provider),
        new MatchingService(),
        { get: async () => job },
      );
      const started = performance.now();
      try {
        let t = performance.now();
        run.match = await service.analyze(job.id);
        run.p6Ms = performance.now() - t;
        t = performance.now();
        run.suggestions = await service.suggest(job.id, {
          matchId: run.match.matchId,
        });
        run.p7Ms = performance.now() - t;
        run.statusPass =
          JSON.stringify(run.match.requirements.map((r) => r.status)) ===
          JSON.stringify(fixture.expected);
        run.success = true;
      } catch (e) {
        run.error = {
          message: e.message,
          code: e.code,
          errorCode: e.errorCode,
        };
        run.success = false;
      } finally {
        run.totalMs = performance.now() - started;
        clearInterval(timer);
        await sample();
        save();
      }
      console.log(
        JSON.stringify({
          model,
          rep,
          case: fixture.name,
          success: run.success,
          error: run.error,
          statusPass: run.statusPass,
          status: run.match?.requirements.map((r) => r.status),
          p6Ms: run.p6Ms,
          p7Ms: run.p7Ms,
          totalMs: run.totalMs,
          gpuPeakMiB: run.gpuPeakMiB,
        }),
      );
    }
  await call('/api/generate', { model, keep_alive: 0 });
}
save();
