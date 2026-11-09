// From apps/api: node --env-file=../../.env.test ../../docs/audits/p8-journey.probe.mjs
// P8_BROWSER=1 keeps the isolated synthetic API open for Chromium acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
const api = new URL('../../apps/api/', import.meta.url),
  require = createRequire(new URL('package.json', api));
require('reflect-metadata');
const { Test } = require('@nestjs/testing'),
  { DataSource } = require('typeorm'),
  { Document, Packer, Paragraph } = require('docx');
const load = (path) => import(new URL(`dist/${path}.js`, api));
const { databaseOptions } = await load('database/database.config'),
  db = new DataSource(databaseOptions('test'));
const { AppModule } = await load('app.module'),
  { FoundationRequestErrors } = await load('tailored-cv/tailored-cv.http');
const { createValidationPipe } = await load('config/validation');
const { canonicalExport } = await load('tailored-cv/tailored-cv-export');
const { LOCAL_OWNER_ID: ownerId } = await load(
  'opportunities/opportunities.service',
);
const { TailoredCvDraft, CvProfileRevision, CvSourceRevision } = await load(
  'tailored-cv/tailored-cv.entity',
);
const { SavedCv } = await load('matching/saved-cv.entity'),
  { Opportunity } = await load('opportunities/opportunity.entity');
const output = new URL('../../artifacts/p8-acceptance/', import.meta.url);
await mkdir(output, { recursive: true });
let app,
  jobId,
  sourceId,
  profileId,
  ownsCv = false;
const report = {
  syntheticOnly: true,
  provider: 'local Ollama qwen3:4b',
  steps: [],
  completed: false,
};
const v = (body) => ({ contractVersion: '1', ...body });
async function call(path, body, method = 'POST') {
  const start = performance.now(),
    response = await fetch(`http://127.0.0.1:3000/api/v1${path}`, {
      method,
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
            : JSON.stringify(body),
      signal: AbortSignal.timeout(210000),
    });
  const isFile =
    response.headers.get('content-type')?.includes('application/pdf') ||
    response.headers.get('content-type')?.includes('wordprocessingml');
  const value = isFile
    ? Buffer.from(await response.arrayBuffer())
    : await response.json();
  report.steps.push({
    path,
    method,
    status: response.status,
    latencyMs: Math.round(performance.now() - start),
    ...(response.ok ? {} : { errorCode: value.errorCode ?? 'unknown' }),
  });
  return { status: response.status, value };
}
async function ok(path, body, method) {
  const r = await call(path, body, method);
  assert.ok(
    [200, 201].includes(r.status),
    `${path}: ${r.status} ${r.value.errorCode ?? 'unknown'}`,
  );
  return r.value;
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
  process.env.API_PORT = '3000';
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  await app.listen(3000, '127.0.0.1');
  const rows = [
    'Name: Synthetic Nguyễn Minh Anh',
    'Email: minh.anh@example.invalid',
    'Employer: Example Studio',
    'Role: Junior developer',
    'Dates: January 2023 - December 2024',
    'Built Java APIs for internal tools.',
    'Assisted a team prototype only; individual production ownership is not claimed.',
    'Education: SQL Server academic coursework only; no professional production experience.',
  ];
  const upload = await Packer.toBuffer(
    new Document({
      sections: [{ children: rows.map((text) => new Paragraph(text)) }],
    }),
  );
  await writeFile(new URL('journey-source.docx', output), upload);
  const form = new FormData();
  form.append('record', '{}');
  form.append(
    'document',
    new Blob([upload], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    'synthetic-journey.docx',
  );
  const cv = await ok('/opportunities/cv/current', form);
  ownsCv = true;
  const job = await ok('/opportunities', {
    title: 'Synthetic Java developer',
    company: 'Example Hiring',
    source: 'Other',
    status: 'SAVED',
    originalLink: '',
    contactNotes: '',
    description:
      'Java APIs required. Database proficiency must not be inferred from academic coursework.',
    skills: 'Java',
    preferredSkills: '',
    experience: '',
    domain: '',
    notes: 'Synthetic acceptance only',
    contactDates: [],
    followUpDate: null,
  });
  jobId = job.id;
  const source = await ok(
    '/tailored-cv/sources',
    v({ expectedSavedCvUpdatedAt: cv.updatedAt }),
  );
  sourceId = source.id;
  const content = await ok(
    `/tailored-cv/sources/${source.id}/content`,
    undefined,
    'GET',
  );
  let profile = await ok(
    '/tailored-cv/profiles',
    v({ sourceRevisionId: source.id, expectedSavedCvUpdatedAt: cv.updatedAt }),
  );
  profileId = profile.profileId;
  profile = await ok(
    `/tailored-cv/profiles/${profileId}/proposal`,
    v({
      expectedRevision: profile.revision,
      expectedSavedCvUpdatedAt: cv.updatedAt,
    }),
  );
  // Explicit synthetic author review: exact evidence and all unresolved passages inspected.
  const doc = structuredClone(profile.document);
  for (const section of doc.sections) {
    section.review = 'confirmed';
    for (const entry of section.entries)
      for (const fact of entry.facts) {
        fact.review = 'confirmed';
        for (const evidence of fact.evidence)
          assert.equal(
            content.text.slice(evidence.start, evidence.end),
            evidence.quote,
          );
      }
  }
  for (const [i, row] of doc.coverage.entries())
    if (row.disposition === 'unresolved') {
      const text = content.text.slice(row.start, row.end);
      if (!text.trim()) {
        row.disposition = 'excluded';
        row.reason =
          'Synthetic author explicitly reviewed whitespace paragraph separator.';
        continue;
      }
      let section = doc.sections.find((s) => s.kind === 'additional');
      if (!section) {
        section = {
          id: 'reviewed-additional',
          kind: 'additional',
          review: 'confirmed',
          entries: [],
        };
        doc.sections.push(section);
      }
      const id = `reviewed-passage-${i}`;
      section.entries.push({
        id: `entry-${i}`,
        facts: [
          {
            id,
            field: 'source_passage',
            value: text,
            origin: 'source',
            review: 'confirmed',
            evidence: [
              {
                sourceRevisionId: source.id,
                start: row.start,
                end: row.end,
                quote: text,
              },
            ],
          },
        ],
      });
      row.disposition = 'mapped';
      row.factIds = [id];
      row.reason = null;
    }
  profile = await ok(
    `/tailored-cv/profiles/${profileId}/revisions`,
    v({ expectedRevision: profile.revision, document: doc }),
  );
  const match = await ok(`/opportunities/${jobId}/match`, {});
  const generation = v({
    profileRevisionId: profile.id,
    expectedProfileRevision: profile.revision,
    expectedJobUpdatedAt: job.updatedAt,
    matchId: match.matchId,
  });
  let draft = await ok(`/tailored-cv/jobs/${jobId}/drafts`, generation);
  const decisions = draft.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .filter((f) => f.proposedWording)
    .map((f) => ({ action: 'reject', factId: f.id }));
  decisions.push(
    ...draft.document.reviewIssues.flatMap((issue, i) =>
      issue.code === 'SEMANTIC_REVIEW_REQUIRED'
        ? []
        : [{ action: 'acknowledge', issueIndex: i }],
    ),
  );
  if (decisions.length)
    draft = await ok(
      `/tailored-cv/drafts/${draft.id}/review`,
      v({ expectedRevision: draft.revision, operations: decisions }),
    );
  draft = await ok(
    `/tailored-cv/drafts/${draft.id}/approve`,
    v({ expectedRevision: draft.revision, reviewedFactIds: [] }),
  );
  const reopened = await ok(
    `/tailored-cv/drafts/${draft.id}`,
    undefined,
    'GET',
  );
  assert.deepEqual(reopened, draft);
  for (const format of ['docx', 'pdf']) {
    const bytes = await ok(
      `/tailored-cv/drafts/${draft.id}/export`,
      v({ expectedRevision: draft.revision, format }),
    );
    await writeFile(new URL(`journey-approved.${format}`, output), bytes);
  }
  await writeFile(
    new URL('journey-approved.canonical.json', output),
    JSON.stringify(canonicalExport(draft.document, draft.revision), null, 2) +
      '\n',
  );
  const regenerated = await ok(`/tailored-cv/jobs/${jobId}/drafts`, generation);
  assert.notEqual(regenerated.id, draft.id);
  assert.deepEqual(
    await ok(`/tailored-cv/drafts/${draft.id}`, undefined, 'GET'),
    draft,
  );
  const first = draft.document.sections.flatMap((s) =>
    s.entries.flatMap((e) => e.facts),
  )[0];
  const edited = await ok(
    `/tailored-cv/drafts/${draft.id}/review`,
    v({
      expectedRevision: draft.revision,
      operations: [
        {
          action: 'edit',
          factId: first.id,
          text: first.acceptedText + ' (reviewed synthetic edit)',
        },
      ],
    }),
  );
  assert.equal(edited.document.review.approval, null);
  const denied = await call(
    `/tailored-cv/drafts/${draft.id}/export`,
    v({ expectedRevision: edited.revision, format: 'pdf' }),
  );
  assert.equal(denied.value.errorCode, 'CV_EXPORT_NOT_APPROVED');
  draft = await ok(
    `/tailored-cv/drafts/${draft.id}/review`,
    v({
      expectedRevision: edited.revision,
      operations: [{ action: 'restore', factId: first.id }],
    }),
  );
  draft = await ok(
    `/tailored-cv/drafts/${draft.id}/approve`,
    v({ expectedRevision: draft.revision, reviewedFactIds: [] }),
  );
  report.completed = true;
  report.jobId = jobId;
  report.draftId = draft.id;
  report.approvedRevision = draft.revision;
  report.regeneratedDraftId = regenerated.id;
  report.profileRevision = profile.revision;
  await writeFile(
    new URL('journey-results.json', output),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report));
  if (process.env.P8_BROWSER === '1') {
    console.log('SYNTHETIC_BROWSER_READY');
    await new Promise((resolve) => {
      process.once('SIGTERM', resolve);
      process.once('SIGINT', resolve);
    });
  }
} catch (error) {
  report.failure = error.message;
  await writeFile(
    new URL('journey-results.json', output),
    JSON.stringify(report, null, 2) + '\n',
  );
  throw error;
} finally {
  if (db.isInitialized) {
    if (jobId) {
      await db.getRepository(TailoredCvDraft).delete({ ownerId, jobId });
      await db.getRepository(Opportunity).delete({ ownerId, id: jobId });
    }
    if (profileId)
      await db.getRepository(CvProfileRevision).delete({ ownerId, profileId });
    if (sourceId)
      await db
        .getRepository(CvSourceRevision)
        .delete({ ownerId, id: sourceId });
    if (ownsCv)
      await db
        .getRepository(SavedCv)
        .delete({ ownerId, fileName: 'synthetic-journey.docx' });
  }
  if (app) await app.close();
  if (db.isInitialized) await db.destroy();
}
