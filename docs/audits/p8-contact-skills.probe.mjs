// Synthetic only. From apps/api after build, test compilation and test migrations:
// P8_CONTACT_BROWSER=1 node --env-file=../../.env.test ../../docs/audits/p8-contact-skills.probe.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
const { FoundationRequestErrors } = await load('tailored-cv/tailored-cv.http'),
  { SourceProfileProposalService } = await load(
    'tailored-cv/source-profile-proposal',
  );
const { LOCAL_OWNER_ID: ownerId } = await load(
  'opportunities/opportunities.service',
);
const { SavedCv } = await load('matching/saved-cv.entity'),
  { Opportunity } = await load('opportunities/opportunity.entity');
const { CvSourceRevision, CvProfileRevision } = await load(
  'tailored-cv/tailored-cv.entity',
);
const { contactSkillsSource: text, skillGroups } = await import(
  new URL('.test-dist/test/support/contact-skills-fixture.js', api)
);
const output = new URL('../../artifacts/p8-contact-skills/', import.meta.url);
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
  proposal: null,
  browser: null,
  historyPreserved: false,
};
const v = (body) => ({ contractVersion: '1', ...body });
async function call(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:3001/api/v1${path}`, {
    method,
    headers: {
      Origin: 'http://127.0.0.1:3001',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
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
  const proposals = app.get(SourceProfileProposalService),
    generate = proposals.generate.bind(proposals);
  proposals.generate = async (...args) => {
    const start = performance.now(),
      document = await generate(...args);
    const facts = document.sections.flatMap((s) =>
      s.entries.flatMap((e) => e.facts),
    );
    for (const f of facts) {
      assert.equal(f.origin, 'source');
      assert.notEqual(f.review, 'confirmed');
      for (const e of f.evidence) {
        assert.equal(e.quote, text.slice(e.start, e.end));
        assert.ok(e.quote.includes(f.value));
      }
    }
    assert.equal(
      document.coverage.map((c) => text.slice(c.start, c.end)).join(''),
      text,
    );
    for (const [category, items] of skillGroups) {
      const entry = document.sections
        .find((s) => s.kind === 'skills')
        .entries.find((e) =>
          e.facts.some(
            (f) => f.field === 'skill_category' && f.value.startsWith(category),
          ),
        );
      assert.ok(entry);
      assert.ok(
        entry.facts.some(
          (f) => f.field === 'skill' && f.value.trim() === items,
        ),
      );
    }
    assert.equal(
      document.sections.find((s) => s.kind === 'experience').entries.length,
      3,
    );
    assert.equal(
      facts.find((f) => f.field === 'location').value,
      'Example City',
    );
    assert.equal(
      facts.find((f) => f.field === 'phone').value,
      '+84 900 000 123',
    );
    assert.ok(
      !facts.some((f) => /[\uFFFD\u25A1\u25AF\uE000-\uF8FF]/u.test(f.value)),
    );
    report.proposal = {
      latencyMs: Math.round(performance.now() - start),
      facts: facts.length,
      skillGroups: skillGroups.length,
      experienceRecords: 3,
      unresolved: document.coverage.filter(
        (c) => c.disposition === 'unresolved',
      ).length,
      exactEvidence: true,
      completeCoverage: true,
    };
    await writeFile(
      new URL('after-profile.json', output),
      JSON.stringify(document, null, 2) + '\n',
    );
    await writeFile(
      new URL('live-results.json', output),
      JSON.stringify(report, null, 2) + '\n',
    );
    return document;
  };
  await db.getRepository(SavedCv).insert({
    ownerId,
    fileName: 'synthetic-contact-skills.txt',
    text,
    sourceMetadata: null,
  });
  ownsCv = true;
  const current = await call('/opportunities/cv/current', undefined, 'GET');
  source = await call(
    '/tailored-cv/sources',
    v({ expectedSavedCvUpdatedAt: current.updatedAt }),
  );
  const initial = await call(
    '/tailored-cv/profiles',
    v({
      sourceRevisionId: source.id,
      expectedSavedCvUpdatedAt: current.updatedAt,
    }),
  );
  profileId = initial.profileId;
  // Seed the actual synthetic before-fix document as immutable historical revisions.
  const snapshot = JSON.parse(
    await readFile(new URL('before-profile.json', output), 'utf8'),
  );
  for (const s of snapshot.sections)
    for (const e of s.entries)
      for (const f of e.facts)
        for (const ref of f.evidence) ref.sourceRevisionId = source.id;
  const { profileDocument } = await load('tailored-cv/tailored-cv.contract');
  profileDocument(snapshot, source.id, text);
  const repo = db.getRepository(CvProfileRevision);
  await repo.save(
    repo.create({
      id: randomUUID(),
      ownerId,
      profileId,
      sourceRevisionId: source.id,
      revision: 2,
      document: snapshot,
    }),
  );
  old = await repo.save(
    repo.create({
      id: randomUUID(),
      ownerId,
      profileId,
      sourceRevisionId: source.id,
      revision: 3,
      document: snapshot,
    }),
  );
  const job = await call('/opportunities', {
    title: 'Synthetic contact and skills acceptance',
    company: 'Example Hiring',
    source: 'Other',
    status: 'SAVED',
    originalLink: '',
    contactNotes: '',
    description:
      'Java APIs and team contribution; SQL Server coursework is academic only.',
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
    profileId,
    previousRevisionId: old.id,
    sourceRevisionId: source.id,
  };
  await writeFile(
    new URL('live-results.json', output),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report.browser));
  if (process.env.P8_CONTACT_BROWSER === '1') {
    console.log('SYNTHETIC_CONTACT_BROWSER_READY');
    await new Promise((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
  } else
    await call(
      `/tailored-cv/profiles/${profileId}/rebuild`,
      v({ expectedRevision: 3, expectedSavedCvUpdatedAt: current.updatedAt }),
    );
} finally {
  if (db.isInitialized) {
    if (old) {
      const previous = await db.getRepository(CvProfileRevision).findOneOrFail({
        where: { ownerId, id: old.id },
        select: { document: true },
      });
      assert.deepEqual(previous.document, old.document);
      report.historyPreserved = true;
      const latest = await db.getRepository(CvProfileRevision).findOne({
        where: { ownerId, profileId },
        order: { revision: 'DESC' },
        select: { document: true, revision: true },
      });
      await writeFile(
        new URL('saved-review.json', output),
        JSON.stringify(latest, null, 2) + '\n',
      );
    }
    await writeFile(
      new URL('live-results.json', output),
      JSON.stringify(report, null, 2) + '\n',
    );
    if (jobId)
      await db.getRepository(Opportunity).delete({ ownerId, id: jobId });
    if (profileId)
      await db.getRepository(CvProfileRevision).delete({ ownerId, profileId });
    if (source)
      await db
        .getRepository(CvSourceRevision)
        .delete({ ownerId, id: source.id });
    if (ownsCv)
      await db
        .getRepository(SavedCv)
        .delete({ ownerId, fileName: 'synthetic-contact-skills.txt' });
  }
  if (app) await app.close();
  if (db.isInitialized) await db.destroy();
}
