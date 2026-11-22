import type { DraftFact } from '../../src/tailored-cv/tailored-draft.contract.js';
import { ReviewedCvService } from '../../src/reviewed-cv/reviewed-cv.service.js';
import { LOCAL_OWNER_ID } from '../../src/opportunities/opportunities.service.js';
import { asLocalOwner } from '../support/as-local-owner.js';
import { SavedCvSourceService } from '../../src/matching/saved-cv-source.service.js';
import { OpportunitiesService } from '../../src/opportunities/opportunities.service.js';
import { TailoredDraftGenerator } from '../../src/tailored-cv/tailored-draft.generator.js';
import { AI_CONFIG, OPENAI_MODEL, aiConfig } from '../../src/ai/ai.config.js';
import { AiService } from '../../src/ai/ai.service.js';
import { OpenAiProvider } from '../../src/ai/openai.provider.js';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { DatabaseModule } from '../../src/database/database.module.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { TailoredCvModule } from '../../src/tailored-cv/tailored-cv.module.js';
import { TailoredCvService } from '../../src/tailored-cv/tailored-cv.service.js';
import { TailoredDraftService } from '../../src/tailored-cv/tailored-draft.service.js';
import { FoundationRequestErrors } from '../../src/tailored-cv/tailored-cv.http.js';
import {
  CvSourceRevision,
  CvProfileRevision,
  TailoredCvDraft,
} from '../../src/tailored-cv/tailored-cv.entity.js';
import { SavedCv } from '../../src/matching/saved-cv.entity.js';
import { JobMatchService } from '../../src/matching/job-match.service.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import {
  AI_PROVIDER,
  type GenerationRequest,
} from '../../src/ai/ai-provider.js';
import { AiError } from '../../src/ai/ai.errors.js';
import {
  draftFixture,
  draftOwner as owner,
} from '../support/tailored-draft-fixtures.js';
let app: INestApplication, db: DataSource;
let profiles: TailoredCvService,
  drafts: TailoredDraftService,
  matches: JobMatchService;
const origin = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:5173' };
const base = '/api/v1/tailored-cv';
const v = { contractVersion: '1' };
const createdProfiles: string[] = [],
  createdSources: string[] = [],
  jobs: string[] = [];
const filename = `synthetic-p83-${randomUUID()}.txt`;
let ownsCv = false;
let mode:
  | 'valid'
  | 'enrichment'
  | 'unsafe'
  | 'invalid'
  | 'reference'
  | 'timeout'
  | 'stale-job'
  | 'stale-profile'
  | 'stale-cv'
  | 'stale-match'
  | 'wait' = 'valid';
let draftCalls = 0;
let started: (() => void) | undefined;
let release: (() => void) | undefined;
let current: {
  job: Opportunity;
  profile: Awaited<ReturnType<TailoredCvService['createProfile']>>;
  body: Record<string, unknown>;
  document: ReturnType<typeof draftFixture>['document'];
};
async function generate(req: GenerationRequest): Promise<string> {
  const data = JSON.parse(req.prompt.split('\n').at(-1)!) as {
    cv?: string;
    passages?: { id: string; kind: string | null; hint?: string }[];
    canonicalRequirements?: {
      parentId: string;
      requirement: string;
      priority: string;
      category: string;
      jdQuote: string;
    }[];
    sections?: {
      entries: {
        entryId: string;
        facts: { factId: string; original: string }[];
      }[];
    }[];
    requirements?: { requirementId: string }[];
  };
  if (data.passages)
    return JSON.stringify({
      fields: data.passages.map((p) => ({
        id: p.id,
        kind: p.kind ?? 'contact',
        field: p.hint ?? 'description',
      })),
    });
  if (data.canonicalRequirements) {
    const schema = req.schema as {
      properties: {
        requirements: {
          items: { properties: { cvQuote: { enum: string[] } } };
        };
      };
    };
    const choices =
      schema.properties.requirements.items.properties.cvQuote.enum;
    return JSON.stringify({
      requirements: data.canonicalRequirements.map((row) => ({
        parentId: row.parentId,
        requirement: row.requirement,
        priority: row.priority,
        category: row.category,
        jdQuote: row.jdQuote,
        cvQuote:
          choices.find((q) => q === 'Built Java APIs for internal tools.') ??
          choices.find((q) => q.includes('Built Java APIs')) ??
          '',
      })),
    });
  }
  draftCalls++;
  if (mode === 'timeout') throw new AiError('TIMEOUT');
  if (mode === 'invalid') return '{invalid private output';
  if (mode === 'reference')
    return JSON.stringify({
      outcome: 'opportunities',
      questions: [],
      proposals: [
        {
          factId: 'foreign-fact',
          entryId: 'foreign-entry',
          text: 'Example rewrite',
          requirementIds: [],
          explanation: 'Example reason',
          confirmationAssertion: null,
        },
      ],
    });
  if (mode === 'wait') {
    started?.();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  if (mode === 'stale-job')
    await db.getRepository(Opportunity).update(
      { ownerId: owner, id: current.job.id },
      {
        title: 'Synthetic changed job',
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    );
  if (mode === 'stale-profile')
    await profiles.appendProfile(owner, current.profile.profileId, {
      ...v,
      expectedRevision: 2,
      document: current.document,
    });
  if (mode === 'stale-cv')
    await db.getRepository(SavedCv).update(
      { ownerId: owner },
      {
        text: 'Synthetic replacement CV',
        updatedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    );
  if (mode === 'stale-match')
    await matches.analyze(LOCAL_OWNER_ID, current.job.id);
  const facts = data.sections!.flatMap((section) =>
    section.entries.flatMap((entry) =>
      entry.facts.map((fact) => ({ ...fact, entryId: entry.entryId })),
    ),
  );
  return JSON.stringify({
    outcome: 'opportunities',
    questions:
      mode === 'enrichment'
        ? facts
            .filter((fact) => fact.factId === 'java')
            .map((fact) => ({
              factId: fact.factId,
              entryId: fact.entryId,
              requirementIds: [data.requirements![0]!.requirementId],
              question: 'Who used these tools, and at what scale?',
              explanation: 'The scope would help explain the experience.',
            }))
        : [],
    proposals: facts
      .filter((f) => f.factId === 'java' || f.factId === 'stack')
      .slice(0, 2)
      .map((f) => ({
        factId: f.factId,
        entryId: f.entryId,
        explanation: 'Surfaces skills relevant to this job.',
        confirmationAssertion:
          mode === 'unsafe' ? 'Led 500 production Kubernetes systems.' : null,
        text:
          mode === 'unsafe'
            ? 'Led 500 production Kubernetes systems.'
            : f.factId === 'stack'
              ? '• Python\n• Java\n• SQL'
              : 'Developed Java interfaces for internal tooling.',
        requirementIds: [data.requirements![0]!.requirementId],
      })),
  });
}
beforeAll(async () => {
  db = new DataSource(databaseOptions('test'));
  await db.initialize();
  await db.runMigrations();
  expect(
    await db.getRepository(SavedCv).findOneBy({ ownerId: owner }),
  ).toBeNull();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, TailoredCvModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({ generate })
    .compile();
  app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new FoundationRequestErrors(app.getHttpAdapter()));
  await app.init();
  profiles = app.get(TailoredCvService);
  drafts = app.get(TailoredDraftService);
  matches = app.get(JobMatchService);
});
afterAll(async () => {
  await app?.close();
  if (db?.isInitialized) {
    for (const jobId of jobs)
      await db.getRepository(TailoredCvDraft).delete({ ownerId: owner, jobId });
    for (const profileId of createdProfiles)
      await db
        .getRepository(CvProfileRevision)
        .delete({ ownerId: owner, profileId });
    for (const id of createdSources)
      await db.getRepository(CvSourceRevision).delete({ ownerId: owner, id });
    for (const id of jobs)
      await db.getRepository(Opportunity).delete({ ownerId: owner, id });
    if (ownsCv)
      await db
        .getRepository(SavedCv)
        .delete({ ownerId: owner, fileName: filename });
    await db.destroy();
  }
});
async function ready(multipleBatches = false) {
  mode = 'valid';
  // The mock can format this documented list without changing its items.
  const fixture = draftFixture(
    false,
    undefined,
    undefined,
    'Python, Java, SQL\n',
  );
  if (multipleBatches) {
    const entry = fixture.document.sections.find(
      (s) => s.kind === 'experience',
    )!.entries[0]!;
    for (let index = 0; index < 4; index++)
      entry.facts.push({
        id: `extra-${index}`,
        field: 'description',
        value: `Synthetic reviewed note ${index}`,
        origin: 'user_entered',
        review: 'confirmed',
        evidence: [],
      });
  }
  // A fresh CV version per scenario, as a re-upload used to give.
  const fresh = { text: fixture.text, updatedAt: new Date() };
  if (
    !(await db.getRepository(SavedCv).update({ ownerId: owner }, fresh))
      .affected
  )
    await db.getRepository(SavedCv).insert({
      ownerId: owner,
      name: filename,
      isDefault: true,
      fileName: filename,
      sourceMetadata: null,
      ...fresh,
    });
  ownsCv = true;
  const cv = await db
    .getRepository(SavedCv)
    .findOneByOrFail({ ownerId: owner });
  const source = await profiles.capture(owner, {
    ...v,
    expectedSavedCvUpdatedAt: cv.updatedAt.toISOString(),
  });
  createdSources.push(source.id);
  for (const section of fixture.document.sections)
    for (const entry of section.entries)
      for (const fact of entry.facts)
        for (const ref of fact.evidence) ref.sourceRevisionId = source.id;
  const initial = await profiles.createProfile(owner, {
    ...v,
    sourceRevisionId: source.id,
    expectedSavedCvUpdatedAt: cv.updatedAt.toISOString(),
  });
  createdProfiles.push(initial.profileId);
  const profile = await profiles.appendProfile(owner, initial.profileId, {
    ...v,
    expectedRevision: 1,
    document: fixture.document,
  });
  const saved = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .send({
      title: 'Synthetic draft job',
      company: 'Example',
      source: 'Other',
      status: 'SAVED',
      originalLink: '',
      contactNotes: '',
      description: 'Java required',
      skills: 'Java',
      preferredSkills: '',
      experience: '',
      domain: '',
      notes: 'Synthetic tracker notes',
      contactDates: [],
      followUpDate: null,
    })
    .expect(201);
  const job = saved.body as Opportunity;
  jobs.push(job.id);
  const match = await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${job.id}/match`)
    .set(origin)
    .send({})
    .expect(200);
  const body = {
    ...v,
    profileRevisionId: profile.id,
    expectedProfileRevision: profile.revision,
    expectedJobUpdatedAt: job.updatedAt,
    matchId: match.body.matchId,
  };
  current = { job, profile, body, document: fixture.document };
  return current;
}
const post = () =>
  request(app.getHttpServer())
    .post(`${base}/jobs/${current.job.id}/drafts`)
    .set(origin)
    .send(current.body);
test('durably generates a complete source-default draft, lists metadata and retrieves pinned content after restart', async () => {
  const state = await ready();
  current.body.locale = 'en';
  await request(app.getHttpServer())
    .post(`${base}/jobs/${current.job.id}/drafts`)
    .set(origin)
    .send({ ...current.body, locale: 'fr' })
    .expect(400);
  const originalJob = await db
    .getRepository(Opportunity)
    .findOneByOrFail({ id: state.job.id });
  const result = await post().expect(201);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.body.generationMetadata.locale).toBe('en');
  expect(result.body.document.pins.profileRevisionId).toBe(state.profile.id);
  expect(result.body.document.sections).toHaveLength(10);
  const facts = result.body.document.sections.flatMap(
    (s: {
      entries: {
        facts: {
          acceptedText: string;
          proposedWording: { status: string } | null;
        }[];
      }[];
    }) => s.entries.flatMap((e) => e.facts),
  );
  expect(facts.map((f: { acceptedText: string }) => f.acceptedText)).toEqual(
    state.document.sections.flatMap((s) =>
      s.entries.flatMap((e) => e.facts.map((f) => f.value)),
    ),
  );
  expect(
    facts.some(
      (f: { proposedWording: { status: string } | null }) =>
        f.proposedWording?.status === 'pending',
    ),
  ).toBe(true);
  const list = await request(app.getHttpServer())
    .get(`${base}/jobs/${state.job.id}/drafts`)
    .set(origin)
    .expect(200);
  expect(list.body.items).toHaveLength(1);
  expect(list.body.items[0].document).toBeUndefined();
  expect(list.body.items[0].generationMetadata).toBeUndefined();
  const freshDb = new DataSource(databaseOptions('test'));
  await freshDb.initialize();
  try {
    expect(
      (
        await freshDb.getRepository(TailoredCvDraft).findOne({
          where: { id: result.body.id },
          select: { document: true },
        })
      )?.document,
    ).toEqual(result.body.document);
  } finally {
    await freshDb.destroy();
  }
  const freshModule = await Test.createTestingModule({
    imports: [DatabaseModule, TailoredCvModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({
      generate: async () => {
        throw new Error('Read must not infer');
      },
    })
    .compile();
  const freshApp = freshModule.createNestApplication();
  asLocalOwner(freshApp);
  freshApp.setGlobalPrefix('api/v1');
  await freshApp.init();
  try {
    await request(freshApp.getHttpServer())
      .get(`${base}/drafts/${result.body.id}`)
      .set(origin)
      .expect(200)
      .expect((r) => expect(r.body.document).toEqual(result.body.document));
  } finally {
    await freshApp.close();
  }
  expect(
    await db.getRepository(Opportunity).findOneByOrFail({ id: state.job.id }),
  ).toEqual(originalJob);
  await expect(
    profiles.saveDraft(owner, result.body.id, 1, state.document),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_SAVE_CONFLICT' });
});
test('local policy, strict envelopes, owner isolation and incomplete profile checks run before inference', async () => {
  await ready();
  await request(app.getHttpServer())
    .get(`${base}/jobs/${current.job.id}/drafts`)
    .expect(403);
  await request(app.getHttpServer())
    .post(`${base}/jobs/${current.job.id}/drafts`)
    .set(origin)
    .send({ ...current.body, ownerId: randomUUID() })
    .expect(400);
  await expect(
    drafts.generate(randomUUID(), current.job.id, current.body),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_PROFILE_NOT_FOUND' });
  await expect(
    drafts.list(randomUUID(), current.job.id, {}),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_JOB_NOT_FOUND' });
  await expect(drafts.get(randomUUID(), randomUUID())).rejects.toMatchObject({
    errorCode: 'CV_DRAFT_NOT_FOUND',
  });
  await request(app.getHttpServer())
    .get(`${base}/jobs/${current.job.id}/drafts?unexpected=value`)
    .set(origin)
    .expect(400);
  const incomplete = structuredClone(current.document);
  incomplete.sections[0]!.review = 'pending';
  const latest = await profiles.appendProfile(
    owner,
    current.profile.profileId,
    { ...v, expectedRevision: 2, document: incomplete },
  );
  await request(app.getHttpServer())
    .post(`${base}/jobs/${current.job.id}/drafts`)
    .set(origin)
    .send({
      ...current.body,
      profileRevisionId: latest.id,
      expectedProfileRevision: 3,
    })
    .expect(422)
    .expect((r) =>
      expect(r.body.errorCode).toBe('CV_DRAFT_PROFILE_INCOMPLETE'),
    );
});
test.each(['invalid', 'reference', 'timeout'] as const)(
  '%s failure never inserts or overwrites an existing draft',
  async (failure) => {
    await ready(failure === 'timeout');
    const saved = await post().expect(201);
    const before = structuredClone(saved.body.document);
    const beforeFailure = draftCalls;
    mode = failure;
    const failed = await post();
    expect(failed.status).toBe(failure === 'timeout' ? 504 : 502);
    if (failure === 'timeout') expect(draftCalls - beforeFailure).toBe(1);
    expect(failed.body.errorCode).toBe(
      failure === 'timeout'
        ? 'CV_DRAFT_TIMEOUT'
        : failure === 'reference'
          ? 'CV_DRAFT_UNSUPPORTED_REFERENCE'
          : 'CV_DRAFT_INVALID_OUTPUT',
    );
    expect(JSON.stringify(failed.body)).not.toContain('private');
    expect(
      await db
        .getRepository(TailoredCvDraft)
        .countBy({ ownerId: owner, jobId: current.job.id }),
    ).toBe(1);
    expect((await drafts.get(owner, saved.body.id)).document).toEqual(before);
  },
);
test('mocked OpenAI abstention goes straight to approval and refusal preserves the approved draft', async () => {
  await ready();
  const config = aiConfig({
    AI_PROVIDER: 'openai',
    AI_API_KEY: 'synthetic-openai-project-key',
  });
  const openAiDrafts = new TailoredDraftService(
    db,
    app.get(SavedCvSourceService),
    app.get(OpportunitiesService),
    matches,
    new TailoredDraftGenerator(new AiService(new OpenAiProvider(config))),
    config,
    app.get(ReviewedCvService),
  );
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: '{"outcome":"no_change","proposals":[],"questions":[]}',
            },
          ],
        },
      ],
    }),
  );
  try {
    const saved = await openAiDrafts.generate(
      owner,
      current.job.id,
      current.body,
    );
    expect(saved.generationMetadata).toMatchObject({
      provider: 'openai',
      model: OPENAI_MODEL,
      modelDigest: null,
    });
    expect(
      Object.values(saved.document.review!.factReviews).every(
        (fact) =>
          fact.proposal === 'none' && fact.wording === 'reviewed_profile',
      ),
    ).toBe(true);
    const approved = await request(app.getHttpServer())
      .post(`${base}/drafts/${saved.id}/approve`)
      .set(origin)
      .send({ ...v, expectedRevision: saved.revision, reviewedFactIds: [] })
      .expect(201);
    expect(approved.body.document.review.approval.revision).toBe(
      saved.revision + 1,
    );
    fetch.mockResolvedValueOnce(
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
              { type: 'refusal', refusal: 'synthetic private refusal' },
            ],
          },
        ],
      }),
    );
    await expect(
      openAiDrafts.generate(owner, current.job.id, current.body),
    ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_INVALID_OUTPUT' });
    expect(
      await db.getRepository(TailoredCvDraft).countBy({
        ownerId: owner,
        jobId: current.job.id,
      }),
    ).toBe(1);
    expect((await drafts.get(owner, saved.id)).document).toEqual(
      approved.body.document,
    );
  } finally {
    fetch.mockRestore();
  }
});

test('flagged AI wording stays visible and cannot be accepted without a user-authored decision', async () => {
  await ready();
  mode = 'unsafe';
  const response = await post().expect(201);
  const facts = response.body.document.sections.flatMap(
    (section: { entries: { facts: DraftFact[] }[] }) =>
      section.entries.flatMap((entry) => entry.facts),
  ) as DraftFact[];
  const flagged = facts.find(
    (fact) => fact.proposedWording?.requiresConfirmation,
  )!;
  expect(flagged.proposedWording?.text).toContain(
    'Led 500 production Kubernetes',
  );
  expect(flagged.acceptedText).not.toContain('Led 500 production Kubernetes');
  expect(flagged.proposedWording?.confirmationAssertion).toBe(
    'Led 500 production Kubernetes systems.',
  );
  expect(flagged.clarification).toBeUndefined();
  expect(response.body.generationMetadata.locale).toBe('vi');
});
test.each(['stale-job', 'stale-profile', 'stale-cv', 'stale-match'] as const)(
  '%s during inference rolls back without a draft',
  async (failure) => {
    await ready();
    mode = failure;
    const response = await post().expect(409);
    expect(response.body.errorCode).toBe(
      failure === 'stale-job'
        ? 'CV_DRAFT_STALE_JOB'
        : failure === 'stale-profile'
          ? 'CV_DRAFT_STALE_PROFILE'
          : 'CV_DRAFT_STALE_MATCH',
    );
    expect(
      await db
        .getRepository(TailoredCvDraft)
        .countBy({ ownerId: owner, jobId: current.job.id }),
    ).toBe(0);
  },
);
test('concurrent generation is rejected across service instances and locks release after completion', async () => {
  await ready();
  mode = 'wait';
  let signal!: () => void;
  const began = new Promise<void>((resolve) => {
    signal = resolve;
  });
  started = signal;
  const first = post().then((response) => response);
  await began;
  const competing = new TailoredDraftService(
    db,
    app.get(SavedCvSourceService),
    app.get(OpportunitiesService),
    matches,
    app.get(TailoredDraftGenerator),
    app.get(AI_CONFIG),
    app.get(ReviewedCvService),
  );
  await expect(
    drafts.generate(owner, current.job.id, current.body),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_BUSY' });
  await expect(
    competing.generate(owner, current.job.id, current.body),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_BUSY' });
  mode = 'valid';
  release!();
  const response = await first;
  expect(response.status).toBe(201);
  await post().expect(201);
});

test('job ownership and draft retrieval cannot cross owners', async () => {
  await ready();
  const saved = await post().expect(201);
  await expect(drafts.get(randomUUID(), saved.body.id)).rejects.toMatchObject({
    errorCode: 'CV_DRAFT_NOT_FOUND',
  });
  const original = await db
    .getRepository(Opportunity)
    .findOneByOrFail({ ownerId: owner, id: current.job.id });
  const otherOwner = randomUUID();
  const foreign = await db
    .getRepository(Opportunity)
    .save({ ...original, id: randomUUID(), ownerId: otherOwner });
  try {
    await expect(
      drafts.generate(owner, foreign.id, {
        ...current.body,
        expectedJobUpdatedAt: foreign.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_JOB_NOT_FOUND' });
  } finally {
    await db
      .getRepository(Opportunity)
      .delete({ id: foreign.id, ownerId: otherOwner });
  }
});
test('metadata pagination returns every draft once without exposing document content', async () => {
  await ready();
  const saved = await post().expect(201);
  await db.getRepository(TailoredCvDraft).insert(
    Array.from({ length: 21 }, () => ({
      id: randomUUID(),
      ownerId: owner,
      jobId: current.job.id,
      profileRevisionId: current.profile.id,
      jobUpdatedAt: new Date(saved.body.jobUpdatedAt),
      revision: 1,
      document: saved.body.document,
      generationMetadata: saved.body.generationMetadata,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    })),
  );
  const first = await drafts.list(owner, current.job.id, {});
  expect(first.items).toHaveLength(20);
  expect(first.nextCursor).not.toBeNull();
  const second = await drafts.list(owner, current.job.id, {
    before: first.nextCursor,
  });
  expect(second.items).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  expect(
    new Set([...first.items, ...second.items].map((row) => row.id)).size,
  ).toBe(22);
  expect(JSON.stringify(first)).not.toContain('acceptedText');
  expect(JSON.stringify(first)).not.toContain('quinn@example');
});
test('expected profile/job revisions and opaque match identity reject stale inputs before generation', async () => {
  await ready();
  for (const [change, errorCode] of [
    [{ expectedProfileRevision: 1 }, 'CV_DRAFT_STALE_PROFILE'],
    [
      { expectedJobUpdatedAt: '2020-01-01T00:00:00.000Z' },
      'CV_DRAFT_STALE_JOB',
    ],
    [{ matchId: randomUUID() }, 'CV_DRAFT_STALE_MATCH'],
  ] as const) {
    await request(app.getHttpServer())
      .post(`${base}/jobs/${current.job.id}/drafts`)
      .set(origin)
      .send({ ...current.body, ...change })
      .expect(409)
      .expect((r) => expect(r.body.errorCode).toBe(errorCode));
  }
  // A match pinned to another review revision never feeds a draft.
  await db.query(
    'UPDATE ai_job_hunter.cv_matches SET "profileRevisionId"=$1 WHERE "jobId"=$2',
    [randomUUID(), current.job.id],
  );
  await request(app.getHttpServer())
    .post(`${base}/jobs/${current.job.id}/drafts`)
    .set(origin)
    .send(current.body)
    .expect(409)
    .expect((r) => expect(r.body.errorCode).toBe('CV_DRAFT_STALE_MATCH'));
  expect(
    await db.getRepository(TailoredCvDraft).countBy({ jobId: current.job.id }),
  ).toBe(0);
});

test('P8.4 review persists decisions, provenance, exact approval revision and invalidation across service instances', async () => {
  await ready();
  const generated = await post().expect(201);
  const id = generated.body.id as string;
  const document = generated.body
    .document as import('../../src/tailored-cv/tailored-draft.contract.js').TailoredDraftDocument;
  const facts = document.sections.flatMap((s) =>
    s.entries.flatMap((e) => e.facts),
  );
  const target = facts[0]!;
  const operations = [
    ...facts
      .filter((f) => f.proposedWording)
      .map((f) => ({ action: 'reject', factId: f.id })),
    ...document.reviewIssues.flatMap((issue, i) =>
      issue.code === 'SEMANTIC_REVIEW_REQUIRED'
        ? []
        : [{ action: 'acknowledge', issueIndex: i }],
    ),
    { action: 'edit', factId: target.id, text: 'Synthetic manual wording' },
  ];
  const edited = await request(app.getHttpServer())
    .post(`${base}/drafts/${id}/review`)
    .set(origin)
    .send({ ...v, expectedRevision: 1, operations })
    .expect(201);
  expect(edited.body.revision).toBe(2);
  expect(edited.body.document.pins).toEqual(document.pins);
  expect(edited.body.document.requirements).toEqual(document.requirements);
  expect(edited.body.document.review.factReviews[target.id].wording).toBe(
    'user_edited',
  );
  await request(app.getHttpServer())
    .post(`${base}/drafts/${id}/approve`)
    .set(origin)
    .send({ ...v, expectedRevision: 2, reviewedFactIds: [] })
    .expect(422);
  const approved = await request(app.getHttpServer())
    .post(`${base}/drafts/${id}/approve`)
    .set(origin)
    .send({ ...v, expectedRevision: 2, reviewedFactIds: [target.id] })
    .expect(201);
  expect(approved.body.document.review.approval.revision).toBe(3);
  expect(
    (await drafts.get(owner, id)).document.review!.approval!.revision,
  ).toBe(3);
  await request(app.getHttpServer())
    .post(`${base}/drafts/${id}/review`)
    .set(origin)
    .send({
      ...v,
      expectedRevision: 2,
      operations: [{ action: 'restore', factId: target.id }],
    })
    .expect(409);
  const restored = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 3,
    operations: [{ action: 'restore', factId: target.id }],
  });
  expect(restored.revision).toBe(4);
  expect(restored.document.review!.approval).toBeNull();
  expect(
    restored.document.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === target.id),
  ).toEqual(target);
  await expect(
    drafts.review(randomUUID(), id, {
      ...v,
      expectedRevision: 4,
      operations: [{ action: 'edit', factId: target.id, text: 'foreign' }],
    }),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_NOT_FOUND' });
  const writes = await Promise.allSettled(
    [1, 2].map((n) =>
      drafts.review(owner, id, {
        ...v,
        expectedRevision: 4,
        operations: [
          { action: 'edit', factId: target.id, text: `Concurrent ${n}` },
        ],
      }),
    ),
  );
  expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(writes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect((await drafts.get(owner, id)).revision).toBe(5);
});

test('P8.4 mutations enforce local origins and strict input bounds without changing saved revisions', async () => {
  await ready();
  const generated = await post().expect(201);
  const id = generated.body.id as string;
  const fact = generated.body.document.sections.flatMap(
    (s: { entries: { facts: { id: string }[] }[] }) =>
      s.entries.flatMap((e) => e.facts),
  )[0]!;
  const path = `${base}/drafts/${id}/review`;
  await request(app.getHttpServer())
    .post(path)
    .set({ Host: 'evil.example', Origin: 'http://evil.example' })
    .send({
      ...v,
      expectedRevision: 1,
      operations: [{ action: 'edit', factId: fact.id, text: 'changed' }],
    })
    .expect(403);
  for (const operations of [
    [{ action: 'edit', factId: fact.id, text: 'x'.repeat(4001) }],
    [{ action: 'edit', factId: 'foreign', text: 'changed' }],
    [
      {
        action: 'edit',
        factId: fact.id,
        text: 'changed',
        provenance: { origin: 'source' },
      },
    ],
  ]) {
    await request(app.getHttpServer())
      .post(path)
      .set(origin)
      .send({ ...v, expectedRevision: 1, operations })
      .expect(400);
  }
  expect((await drafts.get(owner, id)).revision).toBe(1);
  expect((await drafts.get(owner, id)).document.pins).toEqual(
    generated.body.document.pins,
  );
});

test('P8.4 saved review survives a new database connection and later job/source context without rebasing pins', async () => {
  await ready();
  const generated = await post().expect(201);
  const id = generated.body.id as string;
  const facts = generated.body.document.sections.flatMap(
    (s: { entries: { facts: { id: string; proposedWording: unknown }[] }[] }) =>
      s.entries.flatMap((e) => e.facts),
  );
  const reviewed = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 1,
    operations: [
      {
        action: 'edit',
        factId: facts[0]!.id,
        text: 'Synthetic historical review',
      },
    ],
  });
  await db.getRepository(Opportunity).update(
    { ownerId: owner, id: current.job.id },
    {
      title: 'Later synthetic job',
      updatedAt: new Date('2030-01-01T00:00:00.000Z'),
    },
  );
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const row = await fresh.getRepository(TailoredCvDraft).findOneOrFail({
      where: { ownerId: owner, id },
      select: { revision: true, document: true },
    });
    expect(row.revision).toBe(2);
    expect(row.document).toEqual(reviewed.document);
    expect(reviewed.document.pins).toEqual(generated.body.document.pins);
    expect(reviewed.document.requirements).toEqual(
      generated.body.document.requirements,
    );
  } finally {
    await fresh.destroy();
  }
  await drafts.review(owner, id, {
    ...v,
    expectedRevision: 2,
    operations: [{ action: 'restore', factId: facts[0]!.id }],
  });
  expect((await drafts.get(owner, id)).document.pins).toEqual(
    generated.body.document.pins,
  );
});

test('P8.4 proposal decisions can be revisited without relabeling evidence or changing P6 assessments', async () => {
  await ready();
  const generated = await post().expect(201);
  const id = generated.body.id as string;
  const original = generated.body.document.sections
    .flatMap(
      (s: {
        entries: {
          facts: {
            id: string;
            acceptedText: string;
            proposedWording: { text: string } | null;
            provenance: unknown;
          }[];
        }[];
      }) => s.entries.flatMap((e) => e.facts),
    )
    .find((f: { proposedWording: unknown }) => f.proposedWording)!;
  const accepted = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 1,
    operations: [{ action: 'accept', factId: original.id }],
  });
  const fact = accepted.document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.id === original.id)!;
  expect(fact.acceptedText).toBe(original.proposedWording!.text);
  expect(fact.provenance).toEqual(original.provenance);
  expect(accepted.document.review!.factReviews[original.id]!.wording).toBe(
    'ai_accepted',
  );
  const rejected = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 2,
    operations: [{ action: 'reject', factId: original.id }],
  });
  expect(
    rejected.document.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === original.id)!.acceptedText,
  ).toBe(original.acceptedText);
  expect(rejected.document.review!.factReviews[original.id]!.proposal).toBe(
    'rejected',
  );
  expect(rejected.document.requirements).toEqual(
    generated.body.document.requirements,
  );
  expect((await drafts.get(owner, id)).document).toEqual(rejected.document);
});

test('the PDF template is saved per draft without changing content, revision or approval', async () => {
  await ready();
  const first = await post().expect(201);
  const second = await post().expect(201);
  const id = first.body.id as string;
  const other = second.body.id as string;
  const doc = first.body
    .document as import('../../src/tailored-cv/tailored-draft.contract.js').TailoredDraftDocument;
  // Drafts without a saved choice read as Classic.
  expect(first.body.exportTemplate).toBe('classic');
  expect((await drafts.get(owner, id)).exportTemplate).toBe('classic');
  const facts = doc.sections.flatMap((s) => s.entries.flatMap((e) => e.facts));
  const reviewed = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 1,
    operations: [
      ...facts
        .filter((f) => f.proposedWording)
        .map((f) => ({ action: 'reject', factId: f.id })),
      ...doc.reviewIssues.flatMap((issue, i) =>
        issue.code === 'SEMANTIC_REVIEW_REQUIRED'
          ? []
          : [{ action: 'acknowledge', issueIndex: i }],
      ),
    ],
  });
  const approved = await drafts.review(
    owner,
    id,
    { ...v, expectedRevision: reviewed.revision, reviewedFactIds: [] },
    true,
  );
  const put = (draft: string, body: object) =>
    request(app.getHttpServer())
      .put(`${base}/drafts/${draft}/template`)
      .set(origin)
      .send(body);
  await put(id, { ...v, template: 'modern' })
    .expect(200)
    .expect(({ body }) =>
      expect(body).toEqual({ ...v, id, exportTemplate: 'modern' }),
    );
  // Reload: only the template changed; content, revision, approval, updatedAt kept.
  const after = await drafts.get(owner, id);
  expect(after).toEqual({ ...approved, exportTemplate: 'modern' });
  // Each draft keeps its own choice.
  expect((await drafts.get(owner, other)).exportTemplate).toBe('classic');
  for (const body of [
    { ...v, template: 'fancy' },
    { ...v, template: null },
    { ...v },
    { template: 'modern' },
    { ...v, template: 'modern', extra: true },
  ])
    await put(id, body).expect(400);
  await put(randomUUID(), { ...v, template: 'modern' }).expect(404);
  await expect(
    drafts.setTemplate(randomUUID(), id, { ...v, template: 'compact' }),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_NOT_FOUND' });
  await request(app.getHttpServer())
    .put(`${base}/drafts/${id}/template`)
    .set({ Host: 'evil.example', Origin: 'http://evil.example' })
    .send({ ...v, template: 'compact' })
    .expect(403);
  expect((await drafts.get(owner, id)).exportTemplate).toBe('modern');
  // Export without a template uses the saved one; an explicit one still wins.
  const pdf = async (extra: object, format = 'pdf') =>
    (
      await request(app.getHttpServer())
        .post(`${base}/drafts/${id}/export`)
        .set(origin)
        .send({ ...v, expectedRevision: approved.revision, format, ...extra })
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200)
    ).body as Buffer;
  const stable = (b: Buffer) =>
    b
      .toString('latin1')
      .replace(/\/CreationDate[^\n]*/u, '')
      .replace(/\/ID \[[^\]]*\]/u, '');
  const saved = stable(await pdf({}));
  expect(saved).toBe(stable(await pdf({ template: 'modern' })));
  expect(saved).not.toBe(stable(await pdf({ template: 'classic' })));
  // DOCX ignores the PDF template.
  expect((await pdf({}, 'docx')).subarray(0, 2).toString()).toBe('PK');
  expect(await drafts.get(owner, id)).toEqual(after);
});

test('P8 export requires owner, exact approved revision; downloads both formats without modifying drafts and rejects later edits', async () => {
  await ready();
  const generated = await post().expect(201);
  const id = generated.body.id as string;
  const doc = generated.body
    .document as import('../../src/tailored-cv/tailored-draft.contract.js').TailoredDraftDocument;
  const facts = doc.sections.flatMap((s) => s.entries.flatMap((e) => e.facts));
  const path = `${base}/drafts/${id}/export`;
  await request(app.getHttpServer())
    .post(path)
    .set(origin)
    .send({ ...v, expectedRevision: 1, format: 'pdf' })
    .expect(409);
  const reviewed = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 1,
    operations: [
      ...facts
        .filter((f) => f.proposedWording)
        .map((f) => ({ action: 'reject', factId: f.id })),
      ...doc.reviewIssues.flatMap((issue, i) =>
        issue.code === 'SEMANTIC_REVIEW_REQUIRED'
          ? []
          : [{ action: 'acknowledge', issueIndex: i }],
      ),
    ],
  });
  const approved = await drafts.review(
    owner,
    id,
    { ...v, expectedRevision: reviewed.revision, reviewedFactIds: [] },
    true,
  );
  for (const format of ['pdf', 'docx']) {
    const r = await request(app.getHttpServer())
      .post(path)
      .set(origin)
      .send({ ...v, expectedRevision: approved.revision, format })
      .expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-disposition']).toBe(
      `attachment; filename="tailored-cv-${id.slice(0, 8)}-r${approved.revision}.${format}"`,
    );
    expect(r.headers['content-type']).toBe(
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(Number(r.headers['content-length'])).toBeGreaterThan(1000);
  }
  const { TailoredCvExportService } =
    await import('../../src/tailored-cv/tailored-cv-export.js');
  await expect(
    app.get(TailoredCvExportService).export(randomUUID(), id, {
      ...v,
      expectedRevision: approved.revision,
      format: 'pdf',
    }),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_NOT_FOUND' });
  await request(app.getHttpServer())
    .post(path)
    .set({ Host: 'evil.example', Origin: 'http://evil.example' })
    .send({ ...v, expectedRevision: approved.revision, format: 'pdf' })
    .expect(403);
  await request(app.getHttpServer())
    .post(path)
    .set(origin)
    .send({ ...v, expectedRevision: approved.revision, format: 'html' })
    .expect(400);
  expect(await drafts.get(owner, id)).toEqual(approved);
  await drafts.review(owner, id, {
    ...v,
    expectedRevision: approved.revision,
    operations: [
      {
        action: 'edit',
        factId: facts[0]!.id,
        text: 'Synthetic user edit after approval',
      },
    ],
  });
  await request(app.getHttpServer())
    .post(path)
    .set(origin)
    .send({ ...v, expectedRevision: approved.revision, format: 'pdf' })
    .expect(409);
  await request(app.getHttpServer())
    .post(path)
    .set(origin)
    .send({ ...v, expectedRevision: approved.revision + 1, format: 'pdf' })
    .expect(409)
    .expect((r) => expect(r.body.errorCode).toBe('CV_EXPORT_NOT_APPROVED'));
});

test('private browser POST reads preserve strict Origin checks and reject unexpected bodies', async () => {
  await ready();
  const generated = await post().expect(201);
  const r = await request(app.getHttpServer())
    .post(`${base}/jobs/${current.job.id}/drafts/list`)
    .set(origin)
    .send({ ...v, before: null })
    .expect(200);
  expect(r.body.items[0].id).toBe(generated.body.id);
  await request(app.getHttpServer())
    .post(`${base}/drafts/${generated.body.id}`)
    .set(origin)
    .send(v)
    .expect(200)
    .expect((r) => expect(r.body.document).toEqual(generated.body.document));
  await request(app.getHttpServer())
    .post(`${base}/drafts/${generated.body.id}`)
    .set({ Host: origin.Host })
    .send(v)
    .expect(403);
  await request(app.getHttpServer())
    .get(`${base}/drafts/${generated.body.id}`)
    .set({ Host: origin.Host })
    .expect(403);
  await request(app.getHttpServer())
    .post(`${base}/drafts/${generated.body.id}`)
    .set(origin)
    .send({ ...v, unexpected: true })
    .expect(400);
  await request(app.getHttpServer())
    .post(`${base}/sources/${current.profile.sourceRevisionId}/profile`)
    .set(origin)
    .send(v)
    .expect(200)
    .expect((r) => expect(r.body.id).toBe(current.profile.id));
});

test('source reconstruction rebuild leaves approved draft and pinned historical profile untouched', async () => {
  await ready();
  const generated = await post().expect(201);
  const doc = generated.body
    .document as import('../../src/tailored-cv/tailored-draft.contract.js').TailoredDraftDocument;
  const facts = doc.sections.flatMap((s) => s.entries.flatMap((e) => e.facts));
  const reviewed = await drafts.review(owner, generated.body.id, {
    ...v,
    expectedRevision: 1,
    operations: [
      ...facts
        .filter((f) => f.proposedWording)
        .map((f) => ({ action: 'reject', factId: f.id })),
      ...doc.reviewIssues.flatMap((issue, i) =>
        issue.code === 'SEMANTIC_REVIEW_REQUIRED'
          ? []
          : [{ action: 'acknowledge', issueIndex: i }],
      ),
    ],
  });
  const approved = await drafts.review(
    owner,
    reviewed.id,
    { ...v, expectedRevision: reviewed.revision, reviewedFactIds: [] },
    true,
  );
  const old = await profiles.getProfile(owner, current.profile.id);
  const rebuilt = await profiles.propose(
    owner,
    current.profile.profileId,
    {
      ...v,
      expectedRevision: current.profile.revision,
      expectedSavedCvUpdatedAt: (
        await db.getRepository(SavedCv).findOneByOrFail({ ownerId: owner })
      ).updatedAt.toISOString(),
    },
    true,
  );
  expect(rebuilt.document.reconstruction!.previousRevisionId).toBe(old.id);
  expect(await profiles.getProfile(owner, old.id)).toEqual(old);
  expect(await drafts.get(owner, approved.id)).toEqual(approved);
  await expect(
    drafts.generate(owner, current.job.id, current.body),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_STALE_PROFILE' });
  await expect(
    drafts.generate(owner, current.job.id, {
      ...current.body,
      profileRevisionId: rebuilt.id,
      expectedProfileRevision: rebuilt.revision,
    }),
  ).rejects.toMatchObject({ errorCode: 'CV_DRAFT_PROFILE_INCOMPLETE' });
});

test('P8 readiness reuses authoritative pins, rejects replaced/mismatched context and preserves reviewed profile and drafts', async () => {
  const state = await ready(),
    cv = await matches.cv(LOCAL_OWNER_ID);
  const body = {
    ...v,
    expectedJobUpdatedAt: state.body.expectedJobUpdatedAt,
    expectedSavedCvUpdatedAt: cv!.updatedAt.toISOString(),
    matchId: state.body.matchId,
  };
  const route = `${base}/jobs/${state.job.id}/drafts/readiness`;
  const check = (value: object) =>
    request(app.getHttpServer()).post(route).set(origin).send(value);
  const result = await check(body).expect(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(result.body.ready).toBe(true);
  expect(result.body.pins).toMatchObject({
    profileRevisionId: state.profile.id,
    expectedProfileRevision: state.profile.revision,
    matchId: state.body.matchId,
  });
  expect(result.body.currentProfileRevisionId).toBe(state.profile.id);
  expect(result.body.matchValidForMs).toBeGreaterThan(0);
  expect(result.body.matchValidForMs).toBeLessThanOrEqual(900000);
  expect(JSON.stringify(result.body)).not.toContain('Built Java APIs');
  await post().expect(201);
  const before = await db
    .getRepository(TailoredCvDraft)
    .countBy({ ownerId: owner, jobId: state.job.id });
  await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${state.job.id}/match`)
    .set(origin)
    .send({})
    .expect(200);
  expect((await check(body).expect(200)).body).toMatchObject({
    ready: false,
    reason: 'CV_DRAFT_STALE_MATCH',
    pins: null,
  });
  // Blocked answers still name the current reviewed profile once it is known.
  expect(
    (await check({ ...body, matchId: null }).expect(200)).body,
  ).toMatchObject({
    reason: 'CV_DRAFT_MATCH_REQUIRED',
    currentProfileRevisionId: state.profile.id,
  });
  expect(
    (
      await check({
        ...body,
        expectedJobUpdatedAt: '2020-01-01T00:00:00.000Z',
      }).expect(200)
    ).body.reason,
  ).toBe('CV_DRAFT_STALE_JOB');
  expect(
    (
      await check({
        ...body,
        expectedJobUpdatedAt: '2020-01-01T00:00:00.000Z',
      }).expect(200)
    ).body.currentProfileRevisionId,
  ).toBeNull();
  expect(
    (await drafts.readiness(randomUUID(), state.job.id, body)).reason,
  ).toBe('CV_DRAFT_JOB_NOT_FOUND');
  await request(app.getHttpServer())
    .post(route)
    .set({ Host: 'attacker.invalid', Origin: 'https://attacker.invalid' })
    .send(body)
    .expect(403);
  await check({ ...body, extra: true }).expect(400);
  expect((await profiles.getProfile(owner, state.profile.id)).document).toEqual(
    state.document,
  );
  expect(
    await db
      .getRepository(TailoredCvDraft)
      .countBy({ ownerId: owner, jobId: state.job.id }),
  ).toBe(before);
});
test('reviewedFacts is read-only, owner-scoped and excludes contact details', async () => {
  await ready();
  const facts = await drafts.reviewedFacts(owner);
  expect(facts).not.toBeNull();
  expect(facts!.join('\n')).toMatch(/Java/u);
  expect(facts!.join('\n')).not.toMatch(/example\.invalid|Synthetic Quinn/u);
  expect(await drafts.reviewedFacts(randomUUID())).toBeNull();
});

test('reviewedFacts for a job uses the CV selected for that job, not the default', async () => {
  await ready();
  const jobId = current.job.id;
  const [{ id: other }] = await db.query(
    `INSERT INTO ai_job_hunter.saved_cvs ("ownerId", name, "fileName", text)
      VALUES ($1, 'Unreviewed CV', $2, 'Synthetic unreviewed CV text.') RETURNING id`,
    [owner, filename],
  );
  try {
    expect(await drafts.reviewedFacts(owner, jobId)).not.toBeNull();
    await matches.selectJobCv(owner, jobId, { cvId: other });
    // The job's CV has no review yet; the default's review is not borrowed.
    expect(await drafts.reviewedFacts(owner, jobId)).toBeNull();
    expect(await drafts.reviewedFacts(owner)).not.toBeNull();
  } finally {
    await db.query(
      'UPDATE ai_job_hunter.opportunities SET "cvId" = NULL WHERE id = $1',
      [jobId],
    );
    await db.query('DELETE FROM ai_job_hunter.saved_cvs WHERE id = $1', [
      other,
    ]);
  }
});

test('a draft made before a matching-policy change stays viewable, reviewable and exportable; a new draft needs a current match', async () => {
  await ready();
  const currentMatch = await matches.currentMatch(owner, current.job.id);
  expect(currentMatch.status).toBe('VALID');
  const generated = await post().expect(201);
  const id = generated.body.id as string;
  const doc = generated.body
    .document as import('../../src/tailored-cv/tailored-draft.contract.js').TailoredDraftDocument;
  // Simulate a saved match from the previous policy version.
  await db.query(
    'UPDATE ai_job_hunter.cv_matches SET "policyVersion"=$1 WHERE "jobId"=$2',
    ['guidance-p1/v13', current.job.id],
  );
  expect((await matches.currentMatch(owner, current.job.id)).status).toBe(
    'EXPIRED',
  );
  expect((await drafts.get(owner, id)).document).toEqual(doc);
  const reviewed = await drafts.review(owner, id, {
    ...v,
    expectedRevision: 1,
    operations: [
      ...doc.sections
        .flatMap((s) => s.entries.flatMap((e) => e.facts))
        .filter((f) => f.proposedWording)
        .map((f) => ({ action: 'reject', factId: f.id })),
      ...doc.reviewIssues.flatMap((issue, i) =>
        issue.code === 'SEMANTIC_REVIEW_REQUIRED'
          ? []
          : [{ action: 'acknowledge', issueIndex: i }],
      ),
    ],
  });
  const approved = await drafts.review(
    owner,
    id,
    { ...v, expectedRevision: reviewed.revision, reviewedFactIds: [] },
    true,
  );
  await request(app.getHttpServer())
    .post(`${base}/drafts/${id}/export`)
    .set(origin)
    .send({ ...v, expectedRevision: approved.revision, format: 'pdf' })
    .expect(200);
  const blocked = await post().expect(409);
  expect(blocked.body.errorCode).toBe('CV_DRAFT_STALE_MATCH');
});

test('draft confirmations and selected source diffs preserve revision and export boundaries without inference', async () => {
  const prepared = await ready(true);
  mode = 'enrichment';
  const beforeGeneration = draftCalls;
  const generated = await post().expect(201);
  expect(draftCalls - beforeGeneration).toBe(1);
  const callsAfterGeneration = draftCalls;
  const id = generated.body.id as string;
  const originalDraft = await drafts.get(owner, id);
  const factOf = (snapshot: typeof originalDraft) =>
    snapshot.document.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .find((f) => f.id === 'java')!;
  const original = factOf(originalDraft);
  expect(original.clarification?.question).toBe(
    'Who used these tools, and at what scale?',
  );
  const answer = 'The tools supported 120 internal users';
  const addition = answer + '.';
  const review = (expectedRevision: number, operations: unknown[]) =>
    drafts.review(owner, id, { ...v, expectedRevision, operations });
  const approve = (expectedRevision: number, reviewedFactIds: string[]) =>
    drafts.review(owner, id, { ...v, expectedRevision, reviewedFactIds }, true);
  await expect(
    review(1, [{ action: 'use_answer', factId: original.id }]),
  ).rejects.toThrow();
  const confirmed = await review(1, [
    ...originalDraft.document.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .filter((f) => f.proposedWording)
      .map((f) => ({ action: 'reject', factId: f.id })),
    { action: 'confirm_answer', factId: original.id, text: answer },
  ]);
  expect(factOf(confirmed).acceptedText).toBe(original.acceptedText);
  expect(factOf(confirmed).clarification).toMatchObject({
    status: 'confirmed',
    answer,
  });
  const confirmedOnly = await approve(2, []);
  const { canonicalExport } =
    await import('../../src/tailored-cv/tailored-cv-export.js');
  expect(
    JSON.stringify(canonicalExport(confirmedOnly.document, 3)),
  ).not.toContain(answer);
  const included = await review(3, [
    { action: 'use_answer', factId: original.id },
  ]);
  expect(included.document.review?.approval).toBeNull();
  expect(factOf(included).provenance).toEqual(original.provenance);
  const approved = await approve(4, [original.id]);
  const exportText = JSON.stringify(canonicalExport(approved.document, 5));
  expect(exportText).toContain(answer);

  const path = `${base}/drafts/${id}/source-update`;
  const preview = () =>
    request(app.getHttpServer())
      .post(`${path}/preview`)
      .set(origin)
      .send({ ...v, expectedDraftRevision: 5 })
      .expect(200);
  const apply = (expectedProfileRevision: number) =>
    request(app.getHttpServer())
      .post(path)
      .set(origin)
      .send({
        ...v,
        expectedDraftRevision: 5,
        expectedProfileRevision,
        factIds: [original.id],
      });
  const firstDiff = await preview();
  expect(firstDiff.body).toEqual({
    profileRevision: 2,
    changes: [
      {
        factId: original.id,
        before: original.acceptedText,
        after: factOf(approved).acceptedText,
      },
    ],
  });
  expect(
    (await profiles.latestForSource(owner, prepared.profile.sourceRevisionId))
      ?.revision,
  ).toBe(2);
  await profiles.appendProfile(owner, prepared.profile.profileId, {
    ...v,
    expectedRevision: 2,
    document: prepared.document,
  });
  await apply(2).expect(409);
  const secondDiff = await preview();
  expect(secondDiff.body.profileRevision).toBe(3);
  await apply(3).expect(200);
  const updated = await profiles.latestForSource(
    owner,
    prepared.profile.sourceRevisionId,
  );
  expect(updated?.revision).toBe(4);
  const sections = structuredClone(updated!.document.sections);
  const entry = sections.find((s) => s.kind === 'experience')!.entries[0]!;
  expect(entry.facts.pop()).toMatchObject({
    value: addition,
    field: 'description',
    origin: 'user_entered',
    review: 'confirmed',
    evidence: [],
  });
  expect(sections).toEqual(prepared.document.sections);
  expect(await drafts.get(owner, id)).toEqual(approved);
  expect((await matches.currentMatch(owner, prepared.job.id)).status).toBe(
    'STALE_CV',
  );
  for (const format of ['pdf', 'docx']) {
    await request(app.getHttpServer())
      .post(`${base}/drafts/${id}/export`)
      .set(origin)
      .send({ ...v, expectedRevision: 5, format })
      .expect(200);
  }
  expect(draftCalls).toBe(callsAfterGeneration);
});
