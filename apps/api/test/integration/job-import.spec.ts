import { asLocalOwner } from '../support/as-local-owner.js';
import {
  docxInput,
  docxEntries,
  paragraph,
  opcGrowthPadding,
} from '../support/docx-fixtures.js';
import 'reflect-metadata';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AI_PROVIDER } from '../../src/ai/ai-provider.js';
import type { GenerationRequest } from '../../src/ai/ai-provider.js';
import { databaseOptions } from '../../src/database/database.config.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { OpportunitiesModule } from '../../src/opportunities/opportunities.module.js';
import { IMPORT_FIELDS } from '../../src/opportunities/job-import.contract.js';
import type { ImportField } from '../../src/opportunities/job-import.contract.js';
import { pdfFixture } from '../support/pdf-fixtures.js';
let database: DataSource;
let app: INestApplication;
const ids: string[] = [];
const origin = { Origin: 'http://127.0.0.1:5173', Host: '127.0.0.1:3000' };
const base = {
  title: '',
  company: '',
  source: 'Facebook',
  status: 'SAVED',
  originalLink: '',
  contactNotes: '',
  description: '',
  notes: '',
  contactDates: [],
  followUpDate: null,
};
const network = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
  throw new Error('Network forbidden in synthetic tests');
});
const generate = jest.fn(async (req: GenerationRequest) => {
  const { post, jd } = JSON.parse(req.prompt.split('\n').at(-1)!) as {
    post: string;
    jd: string;
  };
  if (post.includes('FAIL_AI') || jd.includes('FAIL_AI'))
    throw new Error('PRIVATE PROVIDER DETAIL');
  const candidates = [];
  for (const [source, text] of Object.entries({ post, jd }))
    for (const line of text.split('\n'))
      for (const field of IMPORT_FIELDS) {
        const prefix = `${field}: `;
        if (line.startsWith(prefix))
          candidates.push({
            field,
            value: line.slice(prefix.length),
            source,
            quote: line,
          });
      }
  return JSON.stringify({ candidates });
});
beforeAll(async () => {
  database = new DataSource(databaseOptions('test'));
  await database.initialize();
  await database.runMigrations();
  const module = await Test.createTestingModule({
    imports: [DatabaseModule, OpportunitiesModule],
  })
    .overrideProvider(AI_PROVIDER)
    .useValue({ generate })
    .compile();
  app = module.createNestApplication();
  asLocalOwner(app);
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app?.close();
  if (database?.isInitialized) {
    for (const id of ids)
      await database.query(
        'DELETE FROM ai_job_hunter.opportunities WHERE id=$1',
        [id],
      );
    await database.destroy();
  }
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});
async function preview(post: string, bytes?: Buffer) {
  const req = request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', JSON.stringify({ postText: post }));
  if (bytes)
    req.attach('document', bytes, {
      filename: 'synthetic-jd.pdf',
      contentType: 'application/pdf',
    });
  const response = await req.expect(200);
  return response.body as {
    fields: ImportField[];
    description: string;
    jdText: string;
    error: string | null;
  };
}
function reviewedInput(
  post: string,
  result: Awaited<ReturnType<typeof preview>>,
) {
  return {
    ...base,
    ...Object.fromEntries(result.fields.map((f) => [f.field, f.value])),
    postText: post,
    description: result.description,
    importReview: result.fields,
  };
}
async function save(input: unknown, bytes?: Buffer) {
  const req = request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .field('record', JSON.stringify(input));
  if (bytes)
    req.attach('document', bytes, {
      filename: 'synthetic-jd.pdf',
      contentType: 'application/pdf',
    });
  const response = await req.expect(201);
  ids.push(response.body.id as string);
  return response.body;
}
test('paste-only extracts, allows unknown company and persists exact post after refetch', async () => {
  const post =
    'title: Synthetic post engineer\nlocation: Example City\nsalary: 50,000 synthetic units\n';
  const result = await preview(post);
  expect(result.error).toBeNull();
  expect(result.fields.find((f) => f.field === 'company')?.status).toBe(
    'MISSING',
  );
  const row = await save(reviewedInput(post, result));
  expect(row.company).toBe('');
  const fresh = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${row.id}`)
    .expect(200);
  expect(fresh.body.postText).toBe(post);
  expect(fresh.body.location).toBe('Example City');
  expect(fresh.body.source).toBe('Facebook');
});
test('JD-only extracts and preserves downloadable original bytes without exposing bytes in JSON', async () => {
  const bytes = Buffer.from(
    pdfFixture([
      'title: Synthetic JD engineer',
      'company: Example Employer',
      'skills: SQL',
    ]),
  );
  const result = await preview('', bytes);
  expect(result.fields.find((f) => f.field === 'company')?.value).toBe(
    'Example Employer',
  );
  const row = await save(reviewedInput('', result), bytes);
  expect(row.documentName).toBe('synthetic-jd.pdf');
  expect(row.documentBytes).toBeUndefined();
  expect(row.jdText).toContain('company: Example Employer');
  const download = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${row.id}/document`)
    .expect(200);
  expect(download.body).toEqual(bytes);
  expect(download.headers['content-disposition']).toContain('attachment');
  const existing = await request(app.getHttpServer())
    .post(`/api/v1/opportunities/${row.id}/extract`)
    .set(origin)
    .field('record', JSON.stringify({ postText: '' }))
    .expect(200);
  expect(existing.body.fields).toEqual(result.fields);
});
test('post plus JD merges company only in JD and tracker edits preserve the attachment', async () => {
  const post =
    'title: Synthetic combined engineer\nagency: Example Agency\ncontactNotes: recruiter@example.com';
  const bytes = Buffer.from(
    pdfFixture(['company: Example Employer', 'location: Example City']),
  );
  const result = await preview(post, bytes);
  const editable = reviewedInput(post, result);
  expect(editable.company).toBe('Example Employer');
  const row = await save(editable, bytes);
  expect(row.description).toContain(post);
  expect(row.description).toContain('company: Example Employer');
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${row.id}`)
    .set(origin)
    .send({
      ...base,
      title: editable.title,
      company: editable.company,
      status: 'OFFER',
      contactDates: ['2026-10-30'],
      followUpDate: '2026-11-02',
    })
    .expect(200);
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [saved] = await fresh.query(
      'SELECT company, status, agency, "postText", "documentBytes", "followUpDate"::text FROM ai_job_hunter.opportunities WHERE id=$1',
      [row.id],
    );
    expect(saved.company).toBe('Example Employer');
    expect(saved.status).toBe('OFFER');
    expect(saved.agency).toBe('Example Agency');
    expect(saved.postText).toBe(post);
    expect(saved.documentBytes).toEqual(bytes);
    expect(saved.followUpDate).toBe('2026-11-02');
  } finally {
    await fresh.destroy();
  }
});
test('conflicting company blocks saving until reviewed', async () => {
  const post = 'title: Synthetic conflict engineer\ncompany: Example A';
  const bytes = Buffer.from(pdfFixture(['company: Example B']));
  const result = await preview(post, bytes);
  expect(result.fields.find((f) => f.field === 'company')).toMatchObject({
    value: '',
    status: 'CONFLICT',
    reviewed: false,
  });
  const editable = reviewedInput(post, result);
  await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .field('record', JSON.stringify(editable))
    .attach('document', bytes, {
      filename: 'synthetic-jd.pdf',
      contentType: 'application/pdf',
    })
    .expect(400);
  const row = await save(
    {
      ...editable,
      company: 'Example B',
      importReview: result.fields.map((f) => ({
        ...f,
        reviewed: f.field === 'company',
      })),
    },
    bytes,
  );
  expect(row.company).toBe('Example B');
});
test('AI failure permits manual save without inference retries', async () => {
  const post = 'FAIL_AI synthetic recruitment post';
  const result = await preview(post);
  expect(result.error).toMatch(/Enter fields manually/);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
  const count = generate.mock.calls.length;
  const row = await save({
    ...base,
    title: 'Synthetic manual fallback',
    postText: post,
  });
  expect(row.postText).toBe(post);
  expect(generate.mock.calls.length).toBe(count);
});
test('rejects non-local, unsupported and oversized input before generation', async () => {
  const count = generate.mock.calls.length;
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set({ ...origin, Origin: 'https://example.com' })
    .field('record', '{"postText":"synthetic"}')
    .expect(403);
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', '{"postText":"synthetic"}')
    .attach('document', Buffer.from('synthetic'), {
      filename: 'bad.doc',
      contentType: 'application/msword',
    })
    .expect(400);
  await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', JSON.stringify({ postText: 'x'.repeat(12001) }))
    .expect(400);
  expect(generate.mock.calls.length).toBe(count);
});

test('DOCX-only extracts and saves the original document', async () => {
  const doc = docxInput(
    docxEntries({
      body:
        paragraph('title: Synthetic DOCX engineer') +
        paragraph('company: DOCX Employer'),
    }),
  );
  const bytes = Buffer.from(doc.bytes);
  const response = await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', '{"postText":""}')
    .attach('document', bytes, {
      filename: doc.fileName,
      contentType: doc.mediaType,
    })
    .expect(200);
  const editable = reviewedInput('', response.body);
  expect(editable.company).toBe('DOCX Employer');
  const saved = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .field('record', JSON.stringify(editable))
    .attach('document', bytes, {
      filename: doc.fileName,
      contentType: doc.mediaType,
    })
    .expect(201);
  ids.push(saved.body.id as string);
  const download = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${saved.body.id}/document`)
    .expect(200);
  expect(download.body).toEqual(bytes);
});
test('JD-only AI failure still allows manual save and retains the original document', async () => {
  const bytes = Buffer.from(pdfFixture(['FAIL_AI synthetic job description']));
  const result = await preview('', bytes);
  expect(result.error).toMatch(/Enter fields manually/);
  const count = generate.mock.calls.length;
  const row = await save(
    { ...base, title: 'Synthetic JD manual fallback' },
    bytes,
  );
  expect(row.jdText).toContain('FAIL_AI');
  expect(generate.mock.calls.length).toBe(count);
});

test('accepts localhost browser requests and retains explicit origin rejection', async () => {
  const result = await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set({ Origin: 'http://localhost:5173', Host: 'localhost:5173' })
    .field(
      'record',
      JSON.stringify({ postText: 'title: Synthetic localhost job' }),
    )
    .expect(200);
  expect(result.body.error).toBeNull();
  expect(
    result.body.fields.find((field: ImportField) => field.field === 'title')
      ?.value,
  ).toBe('Synthetic localhost job');
  for (const rejected of [
    'http://localhost:9999',
    'http://192.168.1.2:5173',
    'null',
  ])
    await request(app.getHttpServer())
      .post('/api/v1/opportunities/extract')
      .set({ Origin: rejected, Host: 'localhost:5173' })
      .field('record', '{"postText":"synthetic"}')
      .expect(403);
});

test('classifies DOCX failures after multipart upload and never calls AI for a failed parse', async () => {
  const count = generate.mock.calls.length;
  const cases = [
    { bytes: Buffer.from('SYNTHETIC_CORRUPT_DOCX'), reason: 'ZIP_INVALID' },
    {
      bytes: Buffer.from(docxInput(docxEntries().slice(1)).bytes),
      reason: 'PACKAGE_INVALID',
    },
    {
      bytes: Buffer.from(
        docxInput(docxEntries().map((entry) => ({ ...entry, flags: 0x808 })))
          .bytes,
      ),
      reason: 'ZIP_UNSUPPORTED_PROFILE',
    },
  ];
  for (const fixture of cases) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/opportunities/extract')
      .set(origin)
      .field(
        'record',
        JSON.stringify({ postText: 'Synthetic post retained on failure' }),
      )
      .attach('document', fixture.bytes, {
        filename: 'synthetic.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .expect(400);
    expect(response.body).toMatchObject({
      errorCode: 'PARSING_FAILED',
      parserReason: fixture.reason,
    });
    expect(response.body.message).toMatch(/paste the JD text/);
    expect(response.body.message).not.toContain('SYNTHETIC_CORRUPT_DOCX');
  }
  expect(generate.mock.calls.length).toBe(count);
});
test('raw parse-only DOCX endpoint shares actionable errors and never invokes AI', async () => {
  const count = generate.mock.calls.length;
  const mime =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const bytes = Buffer.from(
    docxInput(docxEntries({ body: paragraph('Synthetic HR job description') }))
      .bytes,
  );
  const good = await request(app.getHttpServer())
    .post('/api/v1/opportunities/parse-document')
    .set(origin)
    .set('Content-Type', mime)
    .send(bytes)
    .expect(200);
  expect(good.body.text).toContain('Synthetic HR job description');
  const bad = await request(app.getHttpServer())
    .post('/api/v1/opportunities/parse-document')
    .set(origin)
    .set('Content-Type', mime)
    .send(Buffer.from('SYNTHETIC_CORRUPT_DOCX'))
    .expect(400);
  expect(bad.body.parserReason).toBe('ZIP_INVALID');
  expect(generate.mock.calls.length).toBe(count);
});

test('Office growth-padding DOCX parses and continues through structured import with a fake provider', async () => {
  const mime =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const entries = docxEntries({
    body:
      paragraph('title: Synthetic Office JD') +
      paragraph('company: Example Office Employer'),
  }).map((entry, index) => ({
    ...entry,
    deflate: true,
    flags: 6,
    ...(index < 2
      ? { localExtra: opcGrowthPadding(index === 0 ? 512 : 256) }
      : {}),
  }));
  const bytes = Buffer.from(docxInput(entries).bytes);
  const parsed = await request(app.getHttpServer())
    .post('/api/v1/opportunities/parse-document')
    .set(origin)
    .set('Content-Type', mime)
    .send(bytes)
    .expect(200);
  expect(parsed.body.text).toContain('Synthetic Office JD');
  const result = await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field(
      'record',
      JSON.stringify({ postText: 'agency: Synthetic Office Agency' }),
    )
    .attach('document', bytes, {
      filename: 'synthetic-office.docx',
      contentType: mime,
    })
    .expect(200);
  expect(result.body.error).toBeNull();
  expect(
    result.body.fields.find((f: ImportField) => f.field === 'company')?.value,
  ).toBe('Example Office Employer');
  expect(
    result.body.fields.find((f: ImportField) => f.field === 'agency')?.value,
  ).toBe('Synthetic Office Agency');
});

test('Vietnamese ground truth travels from empty structured generation through API, reviewed save, database and legacy edit', async () => {
  const { recruiterPost, jobDescription, expectedImport } =
    await import('../support/smart-import.synthetic.js');
  const doc = docxInput(
    docxEntries({ body: jobDescription.split('\n').map(paragraph).join('') }),
  );
  const bytes = Buffer.from(doc.bytes);
  const response = await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', JSON.stringify({ postText: recruiterPost }))
    .attach('document', bytes, {
      filename: 'synthetic-vietnamese-jd.docx',
      contentType: doc.mediaType,
    })
    .expect(200);
  expect(response.body.error).toBeNull();
  const output = Object.fromEntries(
    (response.body.fields as ImportField[]).map((f) => [f.field, f.value]),
  );
  expect(output).toMatchObject(expectedImport);
  const editable = {
    ...base,
    ...output,
    title: '[Synthetic] ' + output.title,
    postText: recruiterPost,
    importReview: response.body.fields,
    description: response.body.description,
    notes: 'Synthetic review edit',
    experience: 'Minimum 4 years (manual correction)',
    preferredSkills: 'Backend Java\nVoicebot\nManual preference',
    domain: 'Insurance (reviewed)',
    status: 'INTERVIEW',
    contactDates: ['2026-10-30'],
    followUpDate: '2026-11-02',
  };
  const created = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .field('record', JSON.stringify(editable))
    .attach('document', bytes, {
      filename: 'synthetic-vietnamese-jd.docx',
      contentType: doc.mediaType,
    })
    .expect(201);
  ids.push(created.body.id as string);
  const id = created.body.id as string;
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [row] = await fresh.query(
      'SELECT experience,"preferredSkills",domain,status,notes,"contactDates","followUpDate"::text FROM ai_job_hunter.opportunities WHERE id=$1',
      [id],
    );
    expect(row).toEqual({
      experience: editable.experience,
      preferredSkills: editable.preferredSkills,
      domain: editable.domain,
      status: 'INTERVIEW',
      notes: editable.notes,
      contactDates: editable.contactDates,
      followUpDate: editable.followUpDate,
    });
  } finally {
    await fresh.destroy();
  }
  const reloaded = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(reloaded.body).toMatchObject({
    experience: editable.experience,
    preferredSkills: editable.preferredSkills,
    domain: editable.domain,
    company: 'Tinh Vân',
    workMode: 'Onsite',
    location: 'Quận 7, TP.HCM',
  });
  const legacyEdit = {
    ...base,
    title: editable.title,
    company: output.company,
    status: 'OFFER',
    notes: 'Legacy tracker update',
    contactDates: editable.contactDates,
    followUpDate: editable.followUpDate,
  };
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${id}`)
    .set(origin)
    .send(legacyEdit)
    .expect(200);
  const preserved = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${id}`)
    .expect(200);
  expect(preserved.body).toMatchObject({
    experience: editable.experience,
    preferredSkills: editable.preferredSkills,
    domain: editable.domain,
    postText: recruiterPost,
    status: 'OFFER',
    contactDates: editable.contactDates,
    followUpDate: editable.followUpDate,
  });
});
test('manual Website-source jobs use the same optional canonical fields without extraction', async () => {
  const count = generate.mock.calls.length;
  const row = await save({
    ...base,
    title: 'Synthetic manual website opportunity',
    source: 'Website',
    experience: '5 years',
    preferredSkills: 'Rust',
    domain: 'Logistics',
  });
  expect(row).toMatchObject({
    experience: '5 years',
    preferredSkills: 'Rust',
    domain: 'Logistics',
  });
  expect(generate.mock.calls.length).toBe(count);
});

test('email-only model contact plus explicit Zalo survives preview, persistence and manual detail edits', async () => {
  const post =
    'title: Synthetic contact preservation\ncontactNotes: recruiter@example.com\nZalo: 0900 123 456';
  const result = await preview(post);
  const contact = result.fields.find((f) => f.field === 'contactNotes')!;
  expect(contact).toMatchObject({
    status: 'SUPPORTED',
    value: 'recruiter@example.com\nZalo: 0900 123 456',
  });
  const editable = reviewedInput(post, result);
  const row = await save(editable);
  const fresh = new DataSource(databaseOptions('test'));
  await fresh.initialize();
  try {
    const [stored] = await fresh.query(
      'SELECT "contactNotes" FROM ai_job_hunter.opportunities WHERE id=$1',
      [row.id],
    );
    expect(stored.contactNotes).toBe(contact.value);
  } finally {
    await fresh.destroy();
  }
  const detail = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${row.id}`)
    .expect(200);
  expect(detail.body.contactNotes).toBe(contact.value);
  const manual =
    'Manual recruiter contact\nrecruiter@example.com\nZalo: 0900 123 456';
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${row.id}`)
    .set(origin)
    .send({ ...editable, contactNotes: manual })
    .expect(200);
  const reloaded = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${row.id}`)
    .expect(200);
  expect(reloaded.body.contactNotes).toBe(manual);
});

test('post contacts survive while model-proposed JD letterhead contacts are excluded and source JD remains intact', async () => {
  const post =
    'Job title: Synthetic contact classification\nEmail: recruiter@example.com\nZalo: 0900 123 456';
  const header =
    'EXAMPLE COMPANY\nPhone: 028 1234 5678\nFax: 028 1234 5679\nHotline: 1800 123456\nEmail: office@example.com';
  const document = docxInput(
    docxEntries({ body: header.split('\n').map(paragraph).join('') }),
  );
  generate.mockResolvedValueOnce(
    JSON.stringify({
      candidates: [
        {
          field: 'contactNotes',
          value: '028 1234 5678',
          source: 'jd',
          quote: 'Phone: 028 1234 5678',
        },
        {
          field: 'contactNotes',
          value: 'office@example.com',
          source: 'jd',
          quote: 'Email: office@example.com',
        },
      ],
    }),
  );
  const response = await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', JSON.stringify({ postText: post }))
    .attach('document', Buffer.from(document.bytes), {
      filename: document.fileName,
      contentType: document.mediaType,
    })
    .expect(200);
  const contact = (response.body.fields as ImportField[]).find(
    (f) => f.field === 'contactNotes',
  )!;
  expect(contact.value).toBe('recruiter@example.com\nZalo: 0900 123 456');
  expect(contact.candidates.every((c) => c.source === 'post')).toBe(true);
  expect(response.body.jdText).toContain('Fax: 028 1234 5679');
  expect(response.body.description).toContain('Phone: 028 1234 5678');
  const editable = reviewedInput(post, response.body);
  const saved = await request(app.getHttpServer())
    .post('/api/v1/opportunities')
    .set(origin)
    .field('record', JSON.stringify(editable))
    .attach('document', Buffer.from(document.bytes), {
      filename: document.fileName,
      contentType: document.mediaType,
    })
    .expect(201);
  ids.push(saved.body.id as string);
  const manual = contact.value + '\nManual saved contact: 0900 555 444';
  await request(app.getHttpServer())
    .put(`/api/v1/opportunities/${saved.body.id}`)
    .set(origin)
    .send({ ...editable, contactNotes: manual })
    .expect(200);
  const read = await request(app.getHttpServer())
    .get(`/api/v1/opportunities/${saved.body.id}`)
    .expect(200);
  expect(read.body.contactNotes).toBe(manual);
  expect(read.body.jdText).toContain('Phone: 028 1234 5678');
  expect(read.body.jdText).toContain('Fax: 028 1234 5679');
});
test('an explicitly scoped JD application phone is included instead of the office phone', async () => {
  const jd =
    'Job title: Synthetic HR application\nPhone: 028 1234 5678\nApplication instructions\nPhone: 0900 987 654\nEmail: hr@example.com';
  const document = docxInput(
    docxEntries({ body: jd.split('\n').map(paragraph).join('') }),
  );
  const response = await request(app.getHttpServer())
    .post('/api/v1/opportunities/extract')
    .set(origin)
    .field('record', '{"postText":""}')
    .attach('document', Buffer.from(document.bytes), {
      filename: document.fileName,
      contentType: document.mediaType,
    })
    .expect(200);
  const contact = (response.body.fields as ImportField[]).find(
    (f) => f.field === 'contactNotes',
  )!;
  expect(contact.value).toContain('0900 987 654');
  expect(contact.value).toContain('hr@example.com');
  expect(contact.value).not.toContain('028 1234 5678');
  expect(response.body.jdText).toContain('028 1234 5678');
});
