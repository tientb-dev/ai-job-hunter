import { validateOpportunity } from '../../src/opportunities/opportunity.validation.js';
import { expect, jest, test } from '@jest/globals';
import { JobImportService } from '../../src/opportunities/job-import.service.js';
import { AiService } from '../../src/ai/ai.service.js';
import {
  mergeCandidates,
  validateImportReview,
  IMPORT_SCHEMA,
} from '../../src/opportunities/job-import.contract.js';
import { sourceCandidates } from '../../src/opportunities/job-import.evidence.js';
import {
  recruiterPost,
  jobDescription,
  expectedImport,
} from '../support/smart-import.synthetic.js';
const values = (fields: ReturnType<typeof mergeCandidates>['fields']) =>
  Object.fromEntries(fields.map((f) => [f.field, f.value]));
test('recovers all explicit ground-truth fields from both sources with supported normalization', () => {
  const result = mergeCandidates(
    { candidates: sourceCandidates(recruiterPost, jobDescription) },
    recruiterPost,
    jobDescription,
  );
  expect(values(result.fields)).toMatchObject(expectedImport);
  expect(result.fields.some((f) => f.status === 'CONFLICT')).toBe(false);
  expect(result.rejected).toBe(0);
  expect(values(result.fields).salary).not.toContain('month');
  expect(values(result.fields).agency).toBe('');
  expect(
    validateImportReview(result.fields, recruiterPost, jobDescription),
  ).toEqual(result.fields);
});
test('improves valid empty model results and includes all fields in model instructions/schema', async () => {
  const generate = jest.fn(async () => JSON.stringify({ candidates: [] }));
  const service = new JobImportService(new AiService({ generate }));
  const response = await service.extract({
    record: { postText: recruiterPost },
  });
  expect(response.error).toBeNull();
  expect(values(response.fields)).toMatchObject({
    title: 'AI Developer',
    experience: 'Minimum 3 years',
    domain: 'Insurance',
    preferredSkills: 'Backend Java',
    location: 'Quận 7, TP.HCM',
  });
  expect(JSON.stringify(IMPORT_SCHEMA)).toContain('preferredSkills');
  expect(generate).toHaveBeenCalledTimes(1);
});
test('whitespace/case normalization preserves actual source quotes; unsupported values still reject', () => {
  const source = 'Title: AI   Developer\nWork mode: onsite';
  const result = mergeCandidates(
    {
      candidates: [
        {
          field: 'title',
          value: 'AI Developer',
          source: 'post',
          quote: 'title: AI Developer',
        },
        {
          field: 'workMode',
          value: 'Onsite',
          source: 'post',
          quote: 'Work mode: onsite',
        },
        {
          field: 'company',
          value: 'Invented Client',
          source: 'post',
          quote: 'Title: AI Developer',
        },
      ],
    },
    source,
    '',
  );
  expect(values(result.fields)).toMatchObject({
    title: 'AI Developer',
    workMode: 'Onsite',
    company: '',
  });
  expect(
    result.fields.find((f) => f.field === 'title')?.candidates[0]?.quote,
  ).toBe('Title: AI   Developer');
  expect(result.rejected).toBe(1);
});
test('preferred proposals cannot become required skills, and conflicts remain unresolved', () => {
  const post =
    'Ưu tiên làm BE Java\nLàm việc remote tại quận 1, HCM.\nTừ 5 năm KN\nLương 30M-35M net';
  const candidates = [
    ...sourceCandidates(post, jobDescription),
    {
      field: 'skills',
      value: 'BE Java',
      source: 'post',
      quote: 'Ưu tiên làm BE Java',
    },
  ];
  const result = mergeCandidates({ candidates }, post, jobDescription);
  const output = values(result.fields);
  expect(output.skills).not.toContain('Java');
  expect(output.preferredSkills).toContain('Backend Java');
  for (const field of ['location', 'workMode', 'experience', 'salary'])
    expect(result.fields.find((f) => f.field === field)).toMatchObject({
      value: '',
      status: 'CONFLICT',
    });
  expect(() =>
    validateImportReview(result.fields, post, jobDescription),
  ).toThrow(/conflicting/);
});
test('missing, negated and unrelated details do not create job facts', () => {
  const post =
    'AI Developer\nKhông yêu cầu tối thiểu 3 năm kinh nghiệm\nKhông bắt buộc Python\nLàm việc quận 7';
  const output = values(
    mergeCandidates({ candidates: sourceCandidates(post, '') }, post, '')
      .fields,
  );
  expect(output).toMatchObject({
    company: '',
    domain: '',
    salary: '',
    experience: '',
    skills: '',
    workMode: '',
    location: 'Quận 7',
  });
});

test('old 11-field reviews remain editable without rewriting historical values', () => {
  const post = 'title: Synthetic legacy engineer\nlocation: HCM';
  const legacy = mergeCandidates(
    {
      candidates: [
        {
          field: 'title',
          value: 'Synthetic legacy engineer',
          source: 'post',
          quote: 'title: Synthetic legacy engineer',
        },
        {
          field: 'location',
          value: 'HCM',
          source: 'post',
          quote: 'location: HCM',
        },
      ],
    },
    post,
    '',
    false,
  ).fields.filter(
    (f) => !['experience', 'preferredSkills', 'domain'].includes(f.field),
  );
  expect(legacy).toHaveLength(11);
  expect(validateImportReview(legacy, post, '')).toEqual(legacy);
});

test('preferred wording elsewhere in a multi-line quote cannot reclassify a required skill', () => {
  const quote = 'Thành thạo Python\nƯu tiên kinh nghiệm Voicebot';
  const result = mergeCandidates(
    {
      candidates: [
        { field: 'skills', value: 'Python', source: 'jd', quote },
        { field: 'skills', value: 'Voicebot', source: 'jd', quote },
      ],
    },
    '',
    quote,
  );
  expect(values(result.fields)).toMatchObject({
    skills: 'Python',
    preferredSkills: 'Voicebot',
  });
});

test('vague company references and explicit unknown placeholders stay empty', () => {
  const post = 'công ty mình\nDomain: unknown';
  const result = mergeCandidates(
    {
      candidates: [
        {
          field: 'company',
          value: 'công ty mình',
          source: 'post',
          quote: 'công ty mình',
        },
        {
          field: 'domain',
          value: 'unknown',
          source: 'post',
          quote: 'Domain: unknown',
        },
      ],
    },
    post,
    '',
  );
  expect(values(result.fields)).toMatchObject({ company: '', domain: '' });
  expect(result.rejected).toBe(2);
});

test('unknown location components are retained and cannot be silently merged into HCM', () => {
  const post = 'Quận 7, Paris',
    jd = 'HCM';
  const result = mergeCandidates(
    {
      candidates: [
        { field: 'location', value: post, source: 'post', quote: post },
        { field: 'location', value: jd, source: 'jd', quote: jd },
      ],
    },
    post,
    jd,
  );
  expect(result.fields.find((f) => f.field === 'location')).toMatchObject({
    status: 'CONFLICT',
    value: '',
  });
});

test('a model quote omitting the preference cue still cannot promote preferred Java to required', () => {
  const post = 'Ưu tiên làm BE Java';
  const result = mergeCandidates(
    {
      candidates: [
        { field: 'skills', value: 'BE Java', source: 'post', quote: 'BE Java' },
      ],
    },
    post,
    '',
  );
  expect(values(result.fields)).toMatchObject({
    skills: '',
    preferredSkills: 'Backend Java',
  });
  expect(
    result.fields.find((f) => f.field === 'preferredSkills')?.candidates[0]
      ?.quote,
  ).toBe(post);
});

test('email-only model output still preserves explicit Zalo and phone source evidence', async () => {
  const post =
    'Email: [synthetic.recruiter@example.com](mailto:synthetic.recruiter@example.com)\nZalo: 0900 123 456';
  const service = new JobImportService(
    new AiService({
      generate: async () =>
        JSON.stringify({
          candidates: [
            {
              field: 'contactNotes',
              value: 'synthetic.recruiter@example.com',
              source: 'post',
              quote:
                'Email: [synthetic.recruiter@example.com](mailto:synthetic.recruiter@example.com)',
            },
          ],
        }),
    }),
  );
  const result = await service.extract({ record: { postText: post } });
  const contact = result.fields.find((f) => f.field === 'contactNotes')!;
  expect(result.error).toBeNull();
  expect(contact.status).toBe('SUPPORTED');
  expect(contact.value).toContain('synthetic.recruiter@example.com');
  expect(contact.value).toContain('Zalo: 0900 123 456');
  expect(contact.candidates.some((c) => c.quote === 'Zalo: 0900 123 456')).toBe(
    true,
  );
});
test('complementary contact methods merge rather than conflict, without duplicates or invented numbers', () => {
  const post =
    'Email: recruiter@example.com\nZalo: 0900 123 456\nPhone: +84 900 654 321';
  const result = mergeCandidates(
    { candidates: sourceCandidates(post, '') },
    post,
    '',
  );
  const contact = result.fields.find((f) => f.field === 'contactNotes')!;
  expect(contact.status).toBe('SUPPORTED');
  expect(contact.value).toBe(
    'recruiter@example.com\nZalo: 0900 123 456\nPhone: +84 900 654 321',
  );
  expect(validateImportReview(result.fields, post, '')).toEqual(result.fields);
  const emailOnly =
    'Email: recruiter@example.com\nZalo: not provided\nSalary: 23000000';
  const single = mergeCandidates(
    { candidates: sourceCandidates(emailOnly, '') },
    emailOnly,
    '',
  ).fields.find((f) => f.field === 'contactNotes')!;
  expect(single.value).toBe('recruiter@example.com');
});

test('complete model contact text stays complete and old reviewed contact conflicts can still save', () => {
  const post = 'Email: recruiter@example.com\nZalo: 0900 123 456';
  const result = mergeCandidates(
    {
      candidates: [
        { field: 'contactNotes', value: post, source: 'post', quote: post },
        ...sourceCandidates(post, ''),
      ],
    },
    post,
    '',
  );
  const contact = result.fields.find((f) => f.field === 'contactNotes')!;
  expect(contact.value.match(/recruiter@example.com/g)).toHaveLength(1);
  expect(contact.value.match(/0900 123 456/g)).toHaveLength(1);
  const old = mergeCandidates(
    { candidates: sourceCandidates(post, '') },
    post,
    '',
  ).fields.map((f) =>
    f.field === 'contactNotes'
      ? { ...f, status: 'CONFLICT' as const, value: '', reviewed: true }
      : f,
  );
  expect(
    validateImportReview(old, post, '').find((f) => f.field === 'contactNotes'),
  ).toMatchObject({ status: 'SUPPORTED', reviewed: true });
  expect(() =>
    validateImportReview(
      old.map((f) =>
        f.field === 'contactNotes' ? { ...f, reviewed: false } : f,
      ),
      post,
      '',
    ),
  ).toThrow();
});

test('JD office phone, fax and general email recovery is not recruiter contact', () => {
  const post = 'Email: recruiter@example.com\nZalo: 0900 123 456';
  const jd =
    'EXAMPLE COMPANY\nPhone: 028 1234 5678\nFax: 028 1234 5679\nHotline: 1800 123456\nEmail: office@example.com';
  const candidates = sourceCandidates(post, jd);
  const contact = mergeCandidates({ candidates }, post, jd).fields.find(
    (f) => f.field === 'contactNotes',
  )!;
  expect(contact.value).toBe('recruiter@example.com\nZalo: 0900 123 456');
});

test('a model JD letterhead proposal is filtered using source context, not trusted as recruiter attribution', async () => {
  const { recruiterContactCandidates } =
    await import('../../src/opportunities/job-import.evidence.js');
  const jd =
    'EXAMPLE COMPANY\nPhone: 028 1234 5678\nFax: 028 1234 5679\nEmail: office@example.com\nApplication instructions\nPhone: 0900 987 654\nEmail: hr@example.com\nBENEFITS\nHotline: 1800 123456';
  const raw = [
    {
      field: 'contactNotes' as const,
      value: jd,
      quote: jd,
      source: 'jd' as const,
    },
    {
      field: 'contactNotes' as const,
      value: '028 1234 5678',
      quote: 'Phone: 028 1234 5678',
      source: 'jd' as const,
    },
  ];
  const result = mergeCandidates(
    {
      candidates: [
        ...recruiterContactCandidates(raw, jd),
        ...sourceCandidates('', jd),
      ],
    },
    '',
    jd,
  );
  const contact = result.fields.find((f) => f.field === 'contactNotes')!;
  expect(contact.value).toContain('0900 987 654');
  expect(contact.value).toContain('hr@example.com');
  expect(contact.value).not.toMatch(/028 1234|office@example|1800/);
  expect(
    contact.candidates.some((c) =>
      c.quote.includes('Application instructions'),
    ),
  ).toBe(true);
});
test('explicit JD HR application phone remains eligible', () => {
  const jd =
    'Office phone: 028 1234 5678\nHR phone for applications: 0900 987 654';
  const result = mergeCandidates(
    { candidates: sourceCandidates('', jd) },
    '',
    jd,
  );
  expect(result.fields.find((f) => f.field === 'contactNotes')?.value).toBe(
    'phone for applications: 0900 987 654',
  );
});

test('saved and manually edited contacts are not retrospectively filtered', () => {
  const jd = 'Office phone: 028 1234 5678';
  const saved = mergeCandidates(
    {
      candidates: [
        { field: 'contactNotes', value: jd, source: 'jd', quote: jd },
      ],
    },
    '',
    jd,
  ).fields;
  expect(
    validateImportReview(saved, '', jd).find((f) => f.field === 'contactNotes')
      ?.value,
  ).toBe(jd);
});
test('a company name containing HR cannot qualify its letterhead phone as an HR application contact', () => {
  const jd = 'EXAMPLE HR COMPANY\nPhone: 028 1234 5678';
  const result = mergeCandidates(
    { candidates: sourceCandidates('', jd) },
    '',
    jd,
  );
  expect(result.fields.find((f) => f.field === 'contactNotes')?.value).toBe('');
});

test('mixed HR and office contact clauses cannot authorize the office number', async () => {
  const { recruiterContactCandidates } =
    await import('../../src/opportunities/job-import.evidence.js');
  const jd =
    'HR contact: Phone: 0900 987 654, Office phone: 028 1234 5678\tFax: 028 1234 5679';
  const result = mergeCandidates(
    {
      candidates: recruiterContactCandidates(
        [
          { field: 'contactNotes', value: jd, quote: jd, source: 'jd' },
          ...sourceCandidates('', jd),
        ],
        jd,
      ),
    },
    '',
    jd,
  );
  const value = result.fields.find((f) => f.field === 'contactNotes')!.value;
  expect(value).toContain('0900 987 654');
  expect(value).not.toContain('028 1234');
});

test('informal zl in a recruiter post survives email-only model output and excludes JD office contacts', async () => {
  const post =
    'Gửi CV về mail: [recruiter@example.com](mailto:recruiter@example.com)\nHoặc ib zl 0900 123 456 mình gửi JD ạ';
  const jd = 'EXAMPLE COMPANY\nPhone: 028 1234 5678\nFax: 028 1234 5679';
  const service = new JobImportService(
    new AiService({
      generate: async () =>
        JSON.stringify({
          candidates: [
            {
              field: 'contactNotes',
              value: 'recruiter@example.com',
              source: 'post',
              quote:
                'Gửi CV về mail: [recruiter@example.com](mailto:recruiter@example.com)',
            },
            {
              field: 'contactNotes',
              value: '028 1234 5678',
              source: 'jd',
              quote: 'Phone: 028 1234 5678',
            },
          ],
        }),
    }),
  );
  jest.spyOn(service, 'parse').mockResolvedValue({
    source: {
      format: 'docx',
      text: jd,
      segments: [{ id: 'synthetic-jd', start: 0, end: jd.length, page: null }],
    },
    pageCount: null,
    warnings: [{ code: 'IMAGE_CONTENT_NOT_INTERPRETED' }],
  });
  const response = await service.extract({
    record: { postText: post },
    document: {
      bytes: Buffer.from('synthetic fixture'),
      fileName: 'synthetic.docx',
      mediaType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  });
  const contact = response.fields.find(
    (field) => field.field === 'contactNotes',
  )!;
  expect(response.error).toBeNull();
  expect(contact.value).toBe('recruiter@example.com\nZalo: 0900 123 456');
  expect(contact.candidates.every((c) => c.source === 'post')).toBe(true);
  expect(
    contact.candidates.some(
      (c) => c.quote === 'Hoặc ib zl 0900 123 456 mình gửi JD ạ',
    ),
  ).toBe(true);
  expect(response.jdText).toBe(jd);
  expect(validateImportReview(response.fields, post, jd)).toEqual(
    response.fields,
  );
});

test('informal zl does not invent unlabeled contacts and old saved contact text remains valid', () => {
  const post = 'ib zl 0900 123 456';
  const result = mergeCandidates(
    { candidates: sourceCandidates(post, '') },
    post,
    '',
  );
  const old = result.fields.map((f) =>
    f.field === 'contactNotes' ? { ...f, value: 'zl 0900 123 456' } : f,
  );
  expect(
    validateImportReview(old, post, '').find((f) => f.field === 'contactNotes')
      ?.value,
  ).toBe('Zalo: 0900 123 456');
  const manual = 'Manual contact unchanged: zl 0900 123 456';
  // Review normalization never changes the editable contactNotes value on save.
  const editable = {
    title: 'Synthetic',
    company: '',
    source: 'Other',
    status: 'SAVED',
    originalLink: '',
    contactNotes: manual,
    description: '',
    notes: '',
    contactDates: [],
    followUpDate: null,
    postText: post,
    importReview: old,
  };
  expect(validateOpportunity(editable).contactNotes).toBe(manual);
  expect(
    mergeCandidates(
      { candidates: sourceCandidates('ib 0900 123 456', '') },
      'ib 0900 123 456',
      '',
    ).fields.find((f) => f.field === 'contactNotes')?.value,
  ).toBe('');
});
test('a blank line after a Vietnamese requirement list yields no empty candidate and saves', () => {
  const post = [
    'Chuyên viên Digital Marketing — Công ty Thử Nghiệm Z (synthetic)',
    'Địa điểm: Hồ Chí Minh',
    '',
    'Yêu cầu:',
    '- Tối thiểu 3 năm kinh nghiệm chạy quảng cáo Facebook Ads và Google Ads.',
    '- Thành thạo Google Analytics.',
    '',
    'Quyền lợi: lương cạnh tranh.',
  ].join('\n');
  const result = mergeCandidates(
    {
      candidates: [
        {
          field: 'skills',
          value: 'Thành thạo Google Analytics',
          source: 'post',
          quote: '- Thành thạo Google Analytics.',
        },
      ],
    },
    post,
    '',
  );
  const candidates = result.fields.flatMap((f) => f.candidates);
  expect(candidates.some((c) => !c.value.trim() || !c.quote.trim())).toBe(
    false,
  );
  expect(() => validateImportReview(result.fields, post, '')).not.toThrow();
});
