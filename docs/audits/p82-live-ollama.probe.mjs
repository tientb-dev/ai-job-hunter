// From apps/api: node --env-file=../../.env.test ../../docs/audits/p82-live-ollama.probe.mjs
// Uses real OllamaProvider, an ephemeral API port, and ONLY the guarded test database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';
const require = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
);
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const api = new URL('../../apps/api/', import.meta.url);
const load = (path) => import(new URL(`dist/${path}.js`, api));
const { databaseOptions } = await load('database/database.config');
const options = databaseOptions('test'); // Refuse development/production BEFORE connecting.
const { DatabaseModule } = await load('database/database.module');
const { TailoredCvModule } = await load('tailored-cv/tailored-cv.module');
const { CvSourceRevision, CvProfileRevision } = await load(
  'tailored-cv/tailored-cv.entity',
);
const { SavedCv } = await load('matching/saved-cv.entity');
const { LOCAL_OWNER_ID: ownerId } = await load(
  'opportunities/opportunities.service',
);
const { FoundationRequestErrors } = await load('tailored-cv/tailored-cv.http');
const { profileDocument } = await load('tailored-cv/tailored-cv.contract');
const { aiConfig, AI_CONFIG } = await load('ai/ai.config');
const { OLLAMA_CONTEXT_PROFILE } = await load('ai/ollama.context');
const inputsUrl = new URL(
  'fixtures/p82-live-ollama-inputs.json',
  import.meta.url,
);
const resultsUrl = new URL(
  'fixtures/p82-live-ollama-results.json',
  import.meta.url,
);
const fixtures = JSON.parse(await readFile(inputsUrl, 'utf8'));
const config = aiConfig();
assert.equal(config.model, 'qwen3:4b');
const hash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
const codeHashes = {};
for (const file of [
  'tailored-cv/source-profile-proposal',
  'tailored-cv/tailored-cv.service',
  'tailored-cv/tailored-cv.contract',
  'ai/ollama.provider',
  'ai/ollama.context',
  'ai/ai.service',
]) {
  const source = new URL(`src/${file}.ts`, api),
    compiled = new URL(`dist/${file}.js`, api);
  assert.ok(
    (await stat(compiled)).mtimeMs >= (await stat(source)).mtimeMs,
    `Stale compiled API: ${file}`,
  );
  codeHashes[file] = {
    source: hash(await readFile(source, 'utf8')),
    compiled: hash(await readFile(compiled, 'utf8')),
  };
}
const report = {
  contractVersion: '1',
  startedAt: new Date().toISOString(),
  model: OLLAMA_CONTEXT_PROFILE,
  timeoutMs: config.timeoutMs,
  database: {
    target: 'test',
    host: options.host,
    port: options.port,
    name: options.database,
  },
  codeHashes,
  inputsHash: hash(await readFile(inputsUrl, 'utf8')),
  sourcePreparation:
    'Synthetic parsed text seeded in isolated saved_cvs; source capture and proposal use real P8 APIs. Bootstrap provenance is unknown; original bytes are not invented.',
  fixtures: [],
  failureContainment: null,
  completed: false,
};
const db = new DataSource(options);
let app, failureApp, ownedCvFile;
const createdProfiles = [],
  createdSources = [],
  immutable = new Map();
async function start(overrideConfig) {
  let builder = Test.createTestingModule({
    imports: [DatabaseModule, TailoredCvModule],
  });
  if (overrideConfig)
    builder = builder.overrideProvider(AI_CONFIG).useValue(overrideConfig);
  const module = await builder.compile();
  const instance = module.createNestApplication({ logger: false });
  instance.setGlobalPrefix('api/v1');
  instance.useGlobalFilters(
    new FoundationRequestErrors(instance.getHttpAdapter()),
  );
  await instance.listen(0, '127.0.0.1');
  return instance;
}
async function request(instance, path, body) {
  const port = instance.getHttpServer().address().port;
  process.env.API_PORT = String(port);
  const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      ...(body instanceof FormData || body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify({ contractVersion: '1', ...body }),
    signal: AbortSignal.timeout(config.timeoutMs + 15000),
  });
  return {
    status: response.status,
    body: await response.json(),
    noStore: response.headers.get('cache-control') === 'no-store',
  };
}
async function ok(instance, path, body) {
  const response = await request(instance, path, body);
  assert.ok(
    [200, 201].includes(response.status),
    `API ${path}: status ${response.status}, code ${response.body.errorCode ?? 'none'}`,
  );
  assert.ok(response.noStore);
  return response.body;
}
const profileRows = () =>
  db.getRepository(CvProfileRevision).find({
    where: { ownerId },
    select: {
      id: true,
      profileId: true,
      revision: true,
      sourceRevisionId: true,
      document: true,
    },
    order: { id: 'ASC' },
  });
async function verifyHistory() {
  for (const [id, expected] of immutable) {
    const row = await db.getRepository(CvProfileRevision).findOneOrFail({
      where: { id, ownerId },
      select: { document: true, sourceRevisionId: true, revision: true },
    });
    assert.equal(hash(row), expected, 'Previously persisted profile changed');
  }
  for (const saved of createdSources) {
    const row = await db.getRepository(CvSourceRevision).findOneOrFail({
      where: { id: saved.id, ownerId },
      select: { text: true, textHash: true },
    });
    assert.equal(row.textHash, saved.hash);
    assert.equal(hash(row.text), saved.hash);
  }
}
async function remember(profile) {
  const row = await db.getRepository(CvProfileRevision).findOneOrFail({
    where: { id: profile.id, ownerId },
    select: { document: true, sourceRevisionId: true, revision: true },
  });
  immutable.set(profile.id, hash(row));
}
try {
  await db.initialize();
  await db.runMigrations();
  for (const table of [
    'saved_cvs',
    'cv_source_revisions',
    'cv_profile_revisions',
    'tailored_cv_drafts',
    'opportunities',
  ]) {
    const [count] = await db.query(
      `SELECT count(*)::int AS count FROM ai_job_hunter.${table}`,
    );
    assert.equal(count.count, 0, `Refusing occupied test database: ${table}`);
  }
  app = await start();
  for (const fixture of fixtures) {
    const fileName = `synthetic-p82-live-${fixture.id}.txt`;
    await db.getRepository(SavedCv).upsert(
      {
        ownerId,
        fileName,
        text: fixture.blocks.join('\n\n') + '\n\n',
        sourceMetadata: null,
      },
      ['ownerId'],
    );
    ownedCvFile = fileName;
    const saved = await ok(app, '/opportunities/cv/current');
    const source = await ok(app, '/tailored-cv/sources', {
      expectedSavedCvUpdatedAt: saved.updatedAt,
    });
    createdSources.push({ id: source.id, hash: source.textHash });
    const content = await ok(app, `/tailored-cv/sources/${source.id}/content`);
    assert.equal(content.text, fixture.blocks.join('\n\n') + '\n\n');
    assert.equal(hash(content.text), source.textHash);
    const initial = await ok(app, '/tailored-cv/profiles', {
      sourceRevisionId: source.id,
      expectedSavedCvUpdatedAt: saved.updatedAt,
    });
    createdProfiles.push(initial.profileId);
    await remember(initial);
    const began = performance.now();
    const response = await request(
      app,
      `/tailored-cv/profiles/${initial.profileId}/proposal`,
      {
        expectedRevision: initial.revision,
        expectedSavedCvUpdatedAt: saved.updatedAt,
      },
    );
    const latencyMs = Math.round(performance.now() - began);
    const latest = await ok(app, `/tailored-cv/sources/${source.id}/profile`);
    assert.equal(latest.sourceRevisionId, source.id);
    const persisted = await db.getRepository(CvProfileRevision).findOneOrFail({
      where: { ownerId, id: latest.id },
      select: { document: true, sourceRevisionId: true, revision: true },
    });
    assert.deepEqual(persisted.document, latest.document);
    assert.equal(persisted.sourceRevisionId, source.id);
    profileDocument(persisted.document, source.id, content.text);
    const facts = persisted.document.sections.flatMap((section) =>
      section.entries.flatMap((entry) =>
        entry.facts.map((fact) => ({
          section: section.kind,
          entryId: entry.id,
          ...fact,
        })),
      ),
    );
    const coverage = persisted.document.coverage.map((row) => ({
      ...row,
      text: content.text.slice(row.start, row.end),
    }));
    assert.equal(coverage.map((row) => row.text).join(''), content.text);
    assert.ok(
      coverage.every((row) =>
        ['mapped', 'unresolved'].includes(row.disposition),
      ),
    );
    for (const fact of facts) {
      assert.equal(fact.origin, 'source');
      assert.notEqual(fact.review, 'confirmed');
      assert.equal(fact.evidence.length, 1);
      const evidence = fact.evidence[0];
      assert.equal(evidence.sourceRevisionId, source.id);
      assert.equal(
        evidence.quote,
        content.text.slice(evidence.start, evidence.end),
      );
      assert.equal(fact.value, evidence.quote);
    }
    const clarificationChecks = (fixture.clarificationTerms ?? []).map(
      (term) => {
        const mapped = facts.filter((fact) => fact.value.includes(term));
        const unresolved = coverage.some(
          (row) => row.disposition === 'unresolved' && row.text.includes(term),
        );
        return {
          term,
          mappedFacts: mapped.length,
          unresolved,
          safe:
            unresolved ||
            (mapped.length > 0 &&
              mapped.every((fact) => fact.review === 'needs_clarification')),
        };
      },
    );
    const injectionChecks = (fixture.injectionTerms ?? []).map((term) => ({
      term,
      unresolved: coverage.some(
        (row) => row.disposition === 'unresolved' && row.text.includes(term),
      ),
      mapped: facts.some((fact) => fact.value.includes(term)),
    }));
    const certificationChecks = facts
      .filter(
        (fact) =>
          fact.field === 'certification' &&
          fact.value.includes('no professional certification claimed'),
      )
      .map((fact) => ({
        id: fact.id,
        requiresClarification: fact.review === 'needs_clarification',
      }));
    const entry = {
      id: fixture.id,
      sourceId: source.id,
      sourceHash: source.textHash,
      profileId: initial.profileId,
      initialRevisionId: initial.id,
      proposalRevisionId: latest.id,
      revision: latest.revision,
      status: response.status,
      errorCode: response.body.errorCode ?? null,
      latencyMs,
      result: response.status === 201 ? 'PASS' : 'FAIL',
      sourceUnits: content.text.length,
      factCount: facts.length,
      clarificationCount: facts.filter(
        (fact) => fact.review === 'needs_clarification',
      ).length,
      coverageCounts: {
        mapped: coverage.filter((row) => row.disposition === 'mapped').length,
        unresolved: coverage.filter((row) => row.disposition === 'unresolved')
          .length,
      },
      checks: {
        exactEvidence: true,
        noGeneratedWording: true,
        noAutomaticConfirmation: true,
        completeCoverage: true,
        pinnedSource: true,
      },
      clarificationChecks,
      injectionChecks,
      certificationChecks,
      facts,
      coverage,
    };
    if (
      !clarificationChecks.every((check) => check.safe) ||
      !injectionChecks.every((check) => check.unresolved && !check.mapped) ||
      !certificationChecks.every((check) => check.requiresClarification)
    )
      entry.result = 'FAIL';
    if (response.status !== 201) {
      assert.equal(latest.id, initial.id);
      assert.equal(latest.revision, 1);
      assert.deepEqual(latest.document, initial.document);
      entry.failurePreservedInitial = true;
    } else await remember(latest);
    await verifyHistory();
    report.fixtures.push(entry);
    await writeFile(resultsUrl, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({
        fixture: entry.id,
        result: entry.result,
        status: entry.status,
        errorCode: entry.errorCode,
        latencyMs,
        facts: entry.factCount,
        clarification: entry.clarificationCount,
        coverage: entry.coverageCounts,
      }),
    );
  }
  const current = await ok(app, '/opportunities/cv/current'),
    last = createdSources.at(-1);
  const initial = await ok(app, '/tailored-cv/profiles', {
    sourceRevisionId: last.id,
    expectedSavedCvUpdatedAt: current.updatedAt,
  });
  createdProfiles.push(initial.profileId);
  await remember(initial);
  const previousFingerprint = hash(await profileRows());
  // Real transport failure in a second isolated API; do not stop the shared Ollama daemon.
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const closedPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await app.close();
  app = null;
  failureApp = await start(
    aiConfig({
      ...process.env,
      OLLAMA_BASE_URL: `http://127.0.0.1:${closedPort}`,
    }),
  );
  const began = performance.now();
  const failure = await request(
    failureApp,
    `/tailored-cv/profiles/${initial.profileId}/proposal`,
    { expectedRevision: 1, expectedSavedCvUpdatedAt: current.updatedAt },
  );
  const failureLatencyMs = Math.round(performance.now() - began);
  assert.equal(failure.status, 503);
  assert.equal(failure.body.errorCode, 'CV_PROFILE_UNAVAILABLE');
  assert.equal(hash(await profileRows()), previousFingerprint);
  await verifyHistory();
  report.failureContainment = {
    result: 'PASS',
    status: failure.status,
    errorCode: failure.body.errorCode,
    latencyMs: failureLatencyMs,
    allPreviousProfilesUnchanged: true,
    failedProfileRevision: 1,
    pinnedSourcesUnchanged: true,
    method:
      'Real OllamaProvider against an isolated closed loopback port; shared daemon untouched.',
  };
  console.log(
    JSON.stringify({ failureContainment: report.failureContainment }),
  );
  report.completed = true;
} catch (error) {
  report.harnessFailure = {
    name: error?.name ?? 'Error',
    message:
      error?.code === 'ERR_ASSERTION'
        ? error.message
        : 'Acceptance harness failed; no raw driver/provider payload retained.',
  };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await app?.close();
  await failureApp?.close();
  if (db.isInitialized) {
    for (const profileId of createdProfiles)
      await db.getRepository(CvProfileRevision).delete({ ownerId, profileId });
    for (const source of createdSources)
      await db
        .getRepository(CvSourceRevision)
        .delete({ ownerId, id: source.id });
    if (ownedCvFile)
      await db
        .getRepository(SavedCv)
        .delete({ ownerId, fileName: ownedCvFile });
    await db.destroy();
  }
  await writeFile(resultsUrl, JSON.stringify(report, null, 2) + '\n');
}
if (
  !report.completed ||
  report.fixtures.some((fixture) => fixture.result !== 'PASS')
)
  process.exitCode = 1;
console.log(
  JSON.stringify({
    completed: report.completed,
    fixtures: report.fixtures.map(({ id, result, latencyMs }) => ({
      id,
      result,
      latencyMs,
    })),
    harnessFailure: report.harnessFailure ?? null,
  }),
);
