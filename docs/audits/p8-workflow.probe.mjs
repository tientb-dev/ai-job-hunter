// From apps/api after build, test compilation and test migrations:
// P8_WORKFLOW_BROWSER=1 node --env-file=../../.env.test ../../docs/audits/p8-workflow.probe.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const api = new URL('../../apps/api/', import.meta.url),
  require = createRequire(new URL('package.json', api));
require('reflect-metadata');
const { Test } = require('@nestjs/testing'),
  { DataSource } = require('typeorm');
const express = createRequire(
  require.resolve('@nestjs/platform-express/package.json'),
)('express');
const load = (p) => import(new URL(`dist/${p}.js`, api));
const { databaseOptions } = await load('database/database.config'),
  { AppModule } = await load('app.module');
const { aiConfig } = await load('ai/ai.config');
assert.equal(aiConfig().model, 'qwen3:4b');
const { FoundationRequestErrors } = await load('tailored-cv/tailored-cv.http');
const { LOCAL_OWNER_ID: ownerId } = await load(
  'opportunities/opportunities.service',
);
const { SavedCv } = await load('matching/saved-cv.entity'),
  { Opportunity } = await load('opportunities/opportunity.entity');
const { CvSourceRevision, CvProfileRevision, TailoredCvDraft } = await load(
  'tailored-cv/tailored-cv.entity',
);
const { sourcePassages, assembleProposal } = await load(
  'tailored-cv/source-profile-proposal',
);
const { workflowSource: text } = await import(
  new URL('.test-dist/test/support/p8-workflow-fixture.js', api)
);
const output = new URL('../../artifacts/p8-workflow/', import.meta.url);
await mkdir(output, { recursive: true });
const db = new DataSource(databaseOptions('test'));
let app,
  source,
  profileId,
  jobId,
  ownsCv = false,
  old;
const report = {
  syntheticOnly: true,
  model: 'qwen3:4b',
  browser: null,
  aiCalls: [],
  historyPreserved: false,
  persistedDraft: false,
  acceptedWordingGrounded: false,
};
async function call(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:3001/api/v1${path}`, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:3001',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${result.errorCode ?? 'request failed'}`,
  );
  return result;
}
try {
  await db.initialize();
  for (const table of [
    'saved_cvs',
    'cv_source_revisions',
    'cv_profile_revisions',
    'tailored_cv_drafts',
    'opportunities',
  ]) {
    const [r] = await db.query(
      `SELECT count(*)::int AS n FROM ai_job_hunter.${table}`,
    );
    assert.equal(r.n, 0, 'Refusing occupied test database');
  }
  process.env.API_PORT = '3001';
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  app.use(
    '/assets',
    express.static(fileURLToPath(new URL('../web/dist/assets/', api))),
  );
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/'))
      res.sendFile(fileURLToPath(new URL('../web/dist/index.html', api)));
    else next();
  });
  await app.listen(3001, '127.0.0.1');
  const { OllamaProvider } = await load('ai/ollama.provider'),
    provider = app.get(OllamaProvider),
    generate = provider.generate.bind(provider);
  provider.generate = async (request) => {
    const start = performance.now();
    try {
      const result = await generate(request);
      report.aiCalls.push({
        phase: request.prompt.startsWith('Prioritize') ? 'draft' : 'match',
        latencyMs: Math.round(performance.now() - start),
        ok: true,
      });
      return result;
    } catch (error) {
      report.aiCalls.push({
        phase: 'local-ai',
        latencyMs: Math.round(performance.now() - start),
        ok: false,
        errorCode: error.code ?? 'UNKNOWN',
      });
      throw error;
    }
  };
  await db.getRepository(SavedCv).insert({
    ownerId,
    fileName: 'synthetic-workflow.txt',
    text,
    sourceMetadata: null,
  });
  ownsCv = true;
  const current = await call('/opportunities/cv/current', undefined, 'GET');
  source = await call('/tailored-cv/sources', {
    contractVersion: '1',
    expectedSavedCvUpdatedAt: current.updatedAt,
  });
  const initial = await call('/tailored-cv/profiles', {
    contractVersion: '1',
    sourceRevisionId: source.id,
    expectedSavedCvUpdatedAt: current.updatedAt,
  });
  profileId = initial.profileId;
  const document = assembleProposal(source.id, text, {
    fields: sourcePassages(text)
      .filter((p) => !p.heading)
      .map((p) => ({
        id: p.id,
        kind: p.kind ?? 'contact',
        field: p.hint ?? (p.kind === 'summary' ? 'summary' : 'description'),
      })),
  });
  assert.equal(document.sections.length, 6);
  assert.ok(document.sections.every((s) => s.review === 'pending'));
  assert.ok(document.coverage.every((c) => c.disposition === 'mapped'));
  old = await db.getRepository(CvProfileRevision).save({
    id: randomUUID(),
    ownerId,
    profileId,
    sourceRevisionId: source.id,
    revision: 2,
    document,
  });
  const job = await call('/opportunities', {
    title: 'Synthetic Java Developer',
    company: 'Example Hiring',
    source: 'Other',
    status: 'SAVED',
    originalLink: '',
    contactNotes: '',
    description: 'Java required.',
    skills: 'Java',
    preferredSkills: '',
    experience: '',
    domain: '',
    notes: 'Synthetic acceptance only',
    contactDates: [],
    followUpDate: null,
  });
  jobId = job.id;
  report.browser = {
    url: `http://127.0.0.1:3001/jobs/${jobId}`,
    jobId,
    profileId,
    previousRevisionId: old.id,
    sourceRevisionId: source.id,
  };
  await writeFile(
    new URL('live-results.json', output),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report.browser));
  if (process.env.P8_WORKFLOW_BROWSER !== '1')
    throw Error(
      'Run the browser acceptance test against this isolated fixture.',
    );
  console.log('SYNTHETIC_WORKFLOW_BROWSER_READY');
  await new Promise((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
} finally {
  if (db.isInitialized) {
    try {
      if (old) {
        const previous = await db
          .getRepository(CvProfileRevision)
          .findOneOrFail({
            where: { ownerId, id: old.id },
            select: { document: true },
          });
        assert.deepEqual(previous.document, old.document);
        report.historyPreserved = true;
        const saved = await db.getRepository(TailoredCvDraft).find({
          where: { ownerId, jobId },
          select: {
            id: true,
            profileRevisionId: true,
            revision: true,
            document: true,
          },
        });
        report.persistedDraft = saved.length > 0;
        report.draftIds = saved.map((d) => d.id);
        report.acceptedWordingGrounded =
          saved.length > 0 &&
          saved.every(
            (d) =>
              d.document.kind === 'tailored_cv' &&
              d.document.sections.every((s) =>
                s.entries.every((e) =>
                  e.facts.every((f) => text.includes(f.acceptedText)),
                ),
              ),
          );
      }
    } finally {
      await writeFile(
        new URL('live-results.json', output),
        JSON.stringify(report, null, 2) + '\n',
      );
      if (jobId)
        await db.getRepository(TailoredCvDraft).delete({ ownerId, jobId });
      if (jobId)
        await db.getRepository(Opportunity).delete({ ownerId, id: jobId });
      if (profileId)
        await db
          .getRepository(CvProfileRevision)
          .delete({ ownerId, profileId });
      if (source)
        await db
          .getRepository(CvSourceRevision)
          .delete({ ownerId, id: source.id });
      if (ownsCv)
        await db
          .getRepository(SavedCv)
          .delete({ ownerId, fileName: 'synthetic-workflow.txt' });
    }
  }
  if (app) await app.close();
  if (db.isInitialized) await db.destroy();
}
