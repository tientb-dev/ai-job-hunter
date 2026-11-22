// Manual Tailored CV prompt benchmark against the configured AI provider.
// Synthetic CVs and JDs only; never run in CI. One request per run.
//   pnpm eval:tailored --dataset techlead --runs 2 --out results.json
// Datasets: see DATASETS below. Prints proposals, confirmation notes, the
// generator's decision counts, latency and token usage.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { aiConfig } from '../../src/ai/ai.config.js';
import { AiService } from '../../src/ai/ai.service.js';
import { OpenAiProvider } from '../../src/ai/openai.provider.js';
import { GeminiProvider } from '../../src/ai/gemini.provider.js';
import { OllamaProvider } from '../../src/ai/ollama.provider.js';
import type { AiProvider } from '../../src/ai/ai-provider.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import {
  canonicalRequirements,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import { MatchContexts } from '../../src/matching/match-context.js';
import type { ProfileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
import type { DraftInput } from '../../src/tailored-cv/tailored-draft.contract.js';
import {
  assembleDraft,
  draftHash,
  framed,
  lowValue,
  reviewedPlan,
  weakened,
} from '../../src/tailored-cv/tailored-draft.policy.js';
import { TailoredDraftGenerator } from '../../src/tailored-cv/tailored-draft.generator.js';

if (process.env.CI) throw new Error('Manual evaluation; refused under CI.');
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const runs = Math.min(Number(args.get('runs') ?? 1), 3); // hard cap per invocation
const out = args.get('out');

type Kind = ProfileDocument['sections'][number]['kind'];
// [section, entry, id, field, text]
type Row = [Kind, string, string, string, string];
interface Dataset {
  locale: 'en' | 'vi';
  rows: Row[];
  job: Partial<Opportunity>;
}
const role = (
  entry: string,
  employer: string,
  title: string,
  dates: string,
  bullets: string[],
): Row[] => [
  ['experience', entry, `${entry}-employer`, 'employer', `${employer}\n`],
  ['experience', entry, `${entry}-role`, 'role', `${title}\n`],
  ['experience', entry, `${entry}-dates`, 'dates', `${dates}\n`],
  ...bullets.map((text, i): Row => [
    'experience',
    entry,
    `${entry}-${'abcdefgh'[i]}`,
    'description',
    `- ${text}\n`,
  ]),
];
const javaJd: Partial<Opportunity> = {
  title: 'Senior Java Developer',
  company: 'Example Bank',
  skills: 'Java, Spring Boot, Hibernate/JPA, REST APIs, PostgreSQL, Git',
  preferredSkills: 'Microservices, Kafka, Docker, AWS',
  experience: '5+ years of software development, 3+ years with Java',
  domain: 'Banking',
  seniority: 'Senior',
  description:
    'We are looking for a Senior Java Developer to build core banking services.\n' +
    'Responsibilities:\n- Design and implement REST APIs and backend services with Java and Spring Boot.\n' +
    '- Own data access with Hibernate/JPA and PostgreSQL.\n- Guide other developers through code reviews and technical decisions.\n' +
    '- Improve reliability and performance of production services.\n' +
    'Requirements:\n- 5+ years of software development, including 3+ years with Java and Spring Boot.\n' +
    '- Strong knowledge of collections, concurrency and the JVM.\n- Experience with Hibernate/JPA and relational databases.\n' +
    'Nice to have: microservices, Kafka, Docker, AWS.\n',
};
const DATASETS: Record<string, Dataset> = {
  // 1 + 3: multi-technology Technical Lead, verified "Led the development".
  techlead: {
    locale: 'en',
    job: javaJd,
    rows: [
      ['contact', 'c', 'name', 'name', 'Taylor Example\n'],
      [
        'summary',
        's',
        'summary',
        'summary',
        'Senior Full-Stack Engineer and Technical Lead with 6+ years of experience building business applications across logistics, healthcare and retail clients. Leads a team of 5 developers and owns technical design and delivery. Completed a Scrum Master course in 2025.\n',
      ],
      [
        'skills',
        'k',
        'skills',
        'skill',
        'Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, Express.js, PHP, Laravel, React, Vue.js, PostgreSQL, SQL Server, MySQL, Docker, Git\n',
      ],
      ...role(
        'r1',
        'Example ERP Solutions',
        'Technical Lead',
        'Jun 2023 - Present',
        [
          'Led the development of core billing features using Java Spring Boot, MyBatis, JSP, and SQL Server.',
          'Led a team of 5 developers, running sprint planning and code reviews.',
          'Designed the REST API layer used by the warehouse and accounting modules.',
          'Introduced Docker-based local environments for the team.',
        ],
      ),
      ...role(
        'r2',
        'Example Learning',
        'Full-Stack Developer',
        'Jan 2021 - May 2023',
        [
          'Built course management APIs with Node.js and NestJS, and admin pages with Vue.js.',
          'Implemented reporting queries in PostgreSQL for school administrators.',
        ],
      ),
      ...role('r3', 'Example Shop', 'Web Developer', 'Jan 2019 - Dec 2020', [
        'Developed e-commerce features with PHP and Laravel, and a React storefront.',
      ]),
    ],
  },
  // 2: skills already ordered for a Java JD; no Skills suggestion expected.
  ordered: {
    locale: 'en',
    job: javaJd,
    rows: [
      ['contact', 'c', 'name', 'name', 'Jordan Example\n'],
      [
        'summary',
        's',
        'summary',
        'summary',
        'Java backend developer with 5 years of experience building REST APIs with Spring Boot, Hibernate and PostgreSQL for banking and insurance products.\n',
      ],
      [
        'skills',
        'k',
        'skills',
        'skill',
        'Java, Spring Boot, Hibernate/JPA, REST APIs, PostgreSQL, Docker, Git, JavaScript\n',
      ],
      ...role(
        'r1',
        'Example Insurance',
        'Java Developer',
        'Mar 2021 - Present',
        [
          'Built policy management REST APIs with Java, Spring Boot and Hibernate on PostgreSQL.',
          'Reviewed pull requests and helped two new developers onboard to the codebase.',
        ],
      ),
    ],
  },
  // 4: 6 years in total, Java only for the last 3.
  senior: {
    locale: 'en',
    job: {
      title: 'Senior Java Engineer',
      company: 'Example Freight',
      skills: 'Java, Spring Boot, PostgreSQL, Docker, team leadership',
      preferredSkills: 'Kafka, AWS',
      experience: '5+ years of Java',
      domain: 'Logistics',
      seniority: 'Senior',
      description:
        'Senior Java Engineer to lead a team of 4 developers building logistics APIs.\n' +
        'Requirements:\n- 5+ years of professional Java experience.\n- Experience leading or mentoring engineers.\n' +
        '- Spring Boot, PostgreSQL and Docker.\nNice to have: Kafka, AWS.\n',
    },
    rows: [
      ['contact', 'c', 'name', 'name', 'Sam Example\n'],
      [
        'summary',
        's',
        'summary',
        'summary',
        'Software developer with 6 years of experience in web development. Has used Java for the last 3 years.\n',
      ],
      [
        'skills',
        'k',
        'skills',
        'skill',
        'PHP, Laravel, JavaScript, Java, Spring Boot, PostgreSQL, Docker\n',
      ],
      ...role(
        'r1',
        'Example Logistics',
        'Software Developer',
        'Jan 2023 - Present',
        [
          'Built shipment tracking APIs with Java and Spring Boot.',
          'Reviewed pull requests from other developers on the team.',
          'Moved the order database from MySQL to PostgreSQL with a colleague.',
        ],
      ),
      ...role('r2', 'Example Agency', 'Web Developer', 'Jan 2020 - Dec 2022', [
        'Built client websites with PHP and Laravel.',
      ]),
    ],
  },
  // 5: JD technologies (Kafka, Kubernetes, AWS) absent from the CV.
  payments: {
    locale: 'en',
    job: {
      title: 'Mid-level Java Backend Engineer',
      company: 'Example Payments',
      skills:
        'Java, Spring Boot, REST APIs, SQL (PostgreSQL or MySQL), unit testing, Docker',
      preferredSkills: 'Kafka, Kubernetes, AWS',
      experience: '3+ years of backend development',
      domain: 'Payments / fintech',
      seniority: 'Mid-level',
      description:
        'We are hiring a Java backend engineer for our payments platform.\nResponsibilities:\n- Design and build REST APIs for payment and settlement services using Java and Spring Boot.\n' +
        '- Write efficient SQL and own the data model for settlement reporting.\n- Keep services reliable in production: monitoring, incident response and on-call.\n' +
        'Requirements:\n- 3+ years of backend development with Java and Spring Boot.\n- Strong SQL with PostgreSQL or MySQL.\n- Experience with Docker.\nNice to have:\n- Kafka, Kubernetes and AWS.\n',
    },
    rows: [
      ['contact', 'c', 'name', 'name', 'Alex Example\n'],
      [
        'summary',
        's',
        'summary',
        'summary',
        'Software engineer with 4 years of experience building web applications. Hard-working team player who likes learning new technologies.\n',
      ],
      [
        'skills',
        'k',
        'skills',
        'skill',
        'JavaScript, React, Java, Spring Boot, MySQL, Git, Docker, HTML, CSS, REST APIs, JUnit\n',
      ],
      ...role(
        'r1',
        'Example Fintech Co',
        'Backend Developer',
        'Mar 2022 - Present',
        [
          'Worked on the payment reconciliation service.',
          'Developed REST APIs with Spring Boot that are used by the finance team to match bank transfers with invoices.',
          'Wrote SQL queries and stored procedures in MySQL for monthly settlement reports.',
          'Fixed production bugs and took part in the on-call rotation.',
        ],
      ),
      ...role(
        'r2',
        'Example Retail Ltd',
        'Junior Full-Stack Developer',
        'Jun 2020 - Feb 2022',
        ['Built internal admin pages with React and a Node.js backend.'],
      ),
    ],
  },
  // 6: quantified achievements that must survive.
  metrics: {
    locale: 'en',
    job: javaJd,
    rows: [
      ['contact', 'c', 'name', 'name', 'Robin Example\n'],
      [
        'summary',
        's',
        'summary',
        'summary',
        'Backend engineer with 5 years of experience, 4 of them with Java and Spring Boot.\n',
      ],
      [
        'skills',
        'k',
        'skills',
        'skill',
        'Java, Spring Boot, Hibernate, PostgreSQL, Redis, Docker, Python\n',
      ],
      ...role(
        'r1',
        'Example Telecom',
        'Backend Engineer',
        'Feb 2021 - Present',
        [
          'Reduced p95 latency of the billing API from 800 ms to 200 ms by adding Redis caching and fixing N+1 Hibernate queries.',
          'Cut monthly AWS cost by 30% by right-sizing services.',
          'Worked on many different things in the billing team, such as APIs, databases and some deployments.',
        ],
      ),
    ],
  },
  // 7: thin evidence; aggressive rewriting should be restrained.
  thin: {
    locale: 'en',
    job: javaJd,
    rows: [
      ['contact', 'c', 'name', 'name', 'Casey Example\n'],
      ['summary', 's', 'summary', 'summary', 'Developer.\n'],
      ['skills', 'k', 'skills', 'skill', 'Java, SQL\n'],
      ...role('r1', 'Example Co', 'Developer', '2023 - Present', [
        'Worked on backend tasks.',
      ]),
    ],
  },
  // 8: Vietnamese CV and JD.
  vi: {
    locale: 'vi',
    job: {
      title: 'Lập trình viên Java (Senior)',
      company: 'Ví dụ Fintech',
      skills: 'Java, Spring Boot, REST API, PostgreSQL, Docker',
      preferredSkills: 'Kafka, Kubernetes',
      experience: 'Từ 4 năm kinh nghiệm phát triển backend',
      domain: 'Tài chính',
      seniority: 'Senior',
      description:
        'Phát triển và vận hành các dịch vụ thanh toán bằng Java và Spring Boot.\nYêu cầu:\n- Từ 4 năm kinh nghiệm backend, thành thạo Java và Spring Boot.\n- Kinh nghiệm thiết kế REST API và làm việc với PostgreSQL.\n- Có khả năng hướng dẫn thành viên mới.\nƯu tiên: Kafka, Kubernetes.\n',
    },
    rows: [
      ['contact', 'c', 'name', 'name', 'Nguyễn Ví Dụ\n'],
      [
        'summary',
        's',
        'summary',
        'summary',
        'Lập trình viên với 5 năm kinh nghiệm phát triển phần mềm, trong đó 3 năm làm backend với Java và Spring Boot. Chăm chỉ, ham học hỏi.\n',
      ],
      [
        'skills',
        'k',
        'skills',
        'skill',
        'PHP, JavaScript, Java, Spring Boot, MySQL, PostgreSQL, Docker, Git\n',
      ],
      ...role(
        'r1',
        'Công ty Ví Dụ Pay',
        'Lập trình viên Backend',
        '03/2023 - nay',
        [
          'Phát triển các API thanh toán bằng Java và Spring Boot, dùng PostgreSQL.',
          'Hướng dẫn 2 thành viên mới làm quen với hệ thống thanh toán.',
          'Tham gia xử lý sự cố khi hệ thống gặp lỗi.',
        ],
      ),
      ...role(
        'r2',
        'Công ty Ví Dụ Web',
        'Lập trình viên PHP',
        '01/2021 - 02/2023',
        ['Xây dựng website bán hàng bằng PHP và MySQL.'],
      ),
    ],
  },
};
// Java backend (paraphrase of a public TopCV posting) and full-stack datasets.
// The CV mirrors a typical multi-stack lead CV; every name and fact is invented.
const leadCv: Row[] = [
  ['contact', 'c', 'name', 'name', 'Minh Example\n'],
  [
    'summary',
    's',
    'summary',
    'summary',
    'Senior Full-Stack Engineer and Technical Lead with 6+ years of experience building business applications across logistics, healthcare and retail clients. Experienced in leading Agile teams of up to 6 developers and delivering software from technical design to production. Completed a Scrum Master course in 2025.\n',
  ],
  [
    'skills',
    'k1',
    'k-lead',
    'skill',
    'Leadership: Technical Leadership, Agile/Scrum, Code Review, Mentoring\n',
  ],
  [
    'skills',
    'k2',
    'k-backend',
    'skill',
    'Backend: Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, PHP, Laravel\n',
  ],
  [
    'skills',
    'k3',
    'k-frontend',
    'skill',
    'Frontend: React, Next.js, Vue.js, TypeScript\n',
  ],
  [
    'skills',
    'k4',
    'k-arch',
    'skill',
    'Architecture: Microservices, REST APIs, Asynchronous Messaging, RabbitMQ\n',
  ],
  [
    'skills',
    'k5',
    'k-db',
    'skill',
    'Databases: PostgreSQL, MySQL, SQL Server, Oracle\n',
  ],
  [
    'skills',
    'k6',
    'k-ops',
    'skill',
    'Cloud & DevOps: AWS, Azure, Docker, Jenkins, GitLab CI/CD\n',
  ],
  ...role(
    'r1',
    'Example Software',
    'Technical Team Lead',
    'Apr 2024 - Present',
    [
      'Led a 5-member team delivering warehouse modules used by 300+ staff with NestJS, React and PostgreSQL.',
      'Led the design of a event-driven service architecture, defining service boundaries and asynchronous communication with RabbitMQ.',
      'Optimized Jenkins pipelines for container builds and tests with parallel test stages.',
    ],
  ),
  ...role(
    'r2',
    'Example Software',
    'Technical Team Lead',
    'Jan 2022 - Mar 2024',
    [
      'Led the development of core billing features using Java Spring Boot, MyBatis, JSP, and SQL Server.',
      'Tuned MyBatis queries and data access for month-end reporting jobs.',
      'Introduced code-review checklists and pairing sessions to onboard new developers.',
    ],
  ),
  ...role(
    'r3',
    'Example Software',
    'Full-Stack Developer',
    'Jan 2021 - Dec 2021',
    ['Developed clinic booking features with Laravel, React and MySQL.'],
  ),
  ...role(
    'r4',
    'Example Software',
    'Software Developer',
    'Jul 2019 - Dec 2020',
    ['Rewrote a legacy order tool in Spring Boot and Vue.js.'],
  ),
];
DATASETS['java-backend'] = {
  locale: 'vi',
  rows: leadCv,
  job: {
    title: 'Lập trình viên Java (từ 3 năm kinh nghiệm)',
    company: 'Ví dụ Doanh nghiệp',
    skills:
      'Java, Spring Boot, Spring MVC, JPA/Hibernate, RESTful API, Microservices, SQL, Redis, JWT, OAuth2, Git',
    preferredSkills:
      'Kafka, RabbitMQ, Docker, Kubernetes, CI/CD, Cloud, Golang, React/Vue/Angular',
    experience: 'Từ 3 năm phát triển backend Java',
    domain: 'Hệ thống doanh nghiệp',
    seniority: 'Middle',
    description:
      'Phát triển hệ thống phần mềm cho khách hàng doanh nghiệp.\nTrách nhiệm:\n- Xây dựng REST API và dịch vụ nghiệp vụ bằng Spring Boot.\n- Tham gia thiết kế và phát triển hệ thống theo kiến trúc microservices.\n- Làm việc với cơ sở dữ liệu, Redis và tích hợp hệ thống bên ngoài.\n- Phối hợp với BA, QA để hoàn thành yêu cầu; xử lý lỗi, tối ưu hiệu năng, giữ chất lượng mã.\n- Sử dụng công cụ AI hỗ trợ lập trình để tăng năng suất.\n' +
      'Yêu cầu:\n- Từ 3 năm kinh nghiệm phát triển backend Java.\n- Thành thạo Java, Spring Boot, Spring MVC, JPA/Hibernate, RESTful API.\n- Có kinh nghiệm thực tế với microservices.\n- SQL và một CSDL quan hệ (MySQL, PostgreSQL, Oracle hoặc SQL Server); Redis.\n- Xác thực và phân quyền (JWT, OAuth2); Git; viết mã sạch.\n' +
      'Ưu tiên: Kafka/RabbitMQ, Docker, Kubernetes, CI/CD, cloud, Golang, React/Vue/Angular.\n',
  },
};
DATASETS.fullstack = {
  locale: 'en',
  rows: leadCv,
  job: {
    title: 'Senior Full-Stack Engineer',
    company: 'Example Commerce',
    skills: 'TypeScript, React, Node.js, NestJS, PostgreSQL, REST APIs, Docker',
    preferredSkills: 'Next.js, AWS, CI/CD',
    experience: '5+ years of full-stack development',
    domain: 'E-commerce',
    seniority: 'Senior',
    description:
      'Build and own customer-facing e-commerce features end to end.\nResponsibilities:\n- Develop React/Next.js frontends and Node.js/NestJS services.\n- Design REST APIs and PostgreSQL data models.\n- Improve CI/CD and deployment with Docker on AWS.\n- Mentor engineers and review code.\nRequirements:\n- 5+ years of full-stack development with TypeScript, React and Node.js.\n- PostgreSQL, REST APIs, Docker.\nNice to have: Next.js, AWS, CI/CD.\n',
  },
};
const name = args.get('dataset') ?? 'techlead';
const dataset = DATASETS[name];
if (!dataset) throw new Error(`Unknown dataset ${name}`);

const time = '2026-01-01T00:00:00.000Z';
const source = '00000000-0000-4000-8000-0000000000e1';
const document: ProfileDocument = {
  contractVersion: '1',
  sections: [],
  coverage: [],
};
let text = '';
for (const [kind, entryId, id, field, value] of dataset.rows) {
  let section = document.sections.find((s) => s.kind === kind);
  if (!section) {
    section = { id: `section-${kind}`, kind, review: 'confirmed', entries: [] };
    document.sections.push(section);
  }
  let entry = section.entries.find((e) => e.id === entryId);
  if (!entry) section.entries.push((entry = { id: entryId, facts: [] }));
  const start = text.length;
  text += value;
  entry.facts.push({
    id,
    field,
    value,
    origin: 'source',
    review: 'pending',
    evidence: [
      { sourceRevisionId: source, start, end: text.length, quote: value },
    ],
  });
  document.coverage.push({
    start,
    end: text.length,
    disposition: 'mapped',
    factIds: [id],
    reason: null,
  });
}
const job = Object.assign(new Opportunity(), {
  id: '00000000-0000-4000-8000-0000000000e2',
  ownerId: '00000000-0000-4000-8000-0000000000e3',
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  postText: '',
  jdText: '',
  discovery: null,
  updatedAt: new Date(time),
  ...dataset.job,
});
const facts = document.sections.flatMap((s) =>
  s.entries.flatMap((e) => e.facts),
);
const canonical = canonicalRequirements(job);
// Deterministic stand-in for CV Match evidence selection: best word overlap.
const words = (s: string) =>
  new Set(s.toLocaleLowerCase().match(/[\p{L}][\p{L}+#.]{2,}/gu) ?? []);
const assessment = scoreCvMatch(
  canonical.map((row) => {
    const want = words(row.requirement);
    const best = facts
      .filter(
        (f) =>
          !['name', 'email', 'dates', 'employer', 'role'].includes(f.field),
      )
      .map((f) => ({
        f,
        score: [...words(f.value)].filter((w) => want.has(w)).length,
      }))
      .sort((a, b) => b.score - a.score)[0];
    return {
      ...row,
      cvQuote: best && best.score ? best.f.value.trim().split('\n')[0]! : '',
    };
  }),
  text,
  job.skills,
  canonical,
);
const match = new MatchContexts().create(
  job.ownerId,
  job.id,
  { cvUpdatedAt: time, jobUpdatedAt: time },
  assessment,
);
const snapshot = {
  title: job.title,
  company: job.company,
  skills: job.skills,
  preferredSkills: job.preferredSkills,
  experience: job.experience,
  domain: job.domain,
  seniority: job.seniority,
  description: job.description,
  postText: '',
  jdText: '',
  hasDiscovery: false,
  discoveryRequirements: null,
};
const input = {
  plan: reviewedPlan(document),
  match,
  job: snapshot,
  locale: dataset.locale,
  pins: {
    sourceRevisionId: source,
    sourceHash: draftHash(text),
    profileRevisionId: '00000000-0000-4000-8000-0000000000e4',
    profileId: '00000000-0000-4000-8000-0000000000e5',
    profileRevision: 2,
    profileHash: draftHash(document),
    jobId: job.id,
    jobUpdatedAt: time,
    jobHash: draftHash(snapshot),
    matchId: match.matchId,
  },
} as DraftInput;

// Per-candidate diagnostics with the production checks: which raw proposals
// are shown, need confirmation, or are hidden, and why. No AI call.
interface RawProposal {
  factId: string;
  entryId: string;
  text: string;
  requirementIds: string[];
  explanation: string;
  confirmationAssertion: string | null;
}
function diagnose(raw: RawProposal[]) {
  const doc = assembleDraft(input, [
    {
      selectedFactIds: raw.map((p) => p.factId),
      proposals: raw,
      questions: [],
    } as never,
  ]);
  const jobText = [
    snapshot.title,
    snapshot.skills,
    snapshot.preferredSkills,
    snapshot.experience,
    snapshot.domain,
    snapshot.description,
  ].join('\n');
  const drafted = new Map(
    doc.sections.flatMap((s) =>
      s.entries.flatMap((e) => e.facts.map((f) => [f.id, f] as const)),
    ),
  );
  return raw.map((p) => {
    const fact = input.plan.facts.find((f) => f.id === p.factId)!;
    const text = framed(fact.value, p.text);
    const wording = drafted.get(p.factId)?.proposedWording;
    const lost = weakened(fact.value, text, fact.field);
    const reason = wording
      ? wording.requiresConfirmation
        ? `confirm: ${wording.confirmationAssertion}`
        : 'shown'
      : text.trim().replace(/\s+/gu, ' ') ===
          fact.value.trim().replace(/\s+/gu, ' ')
        ? 'hidden: identical to original'
        : lost.length
          ? `hidden: weakens ${lost.join(', ')}`
          : lowValue(fact.field, fact.value, text, jobText, snapshot.skills)
            ? 'hidden: low value'
            : 'hidden: section cap';
    return {
      section: fact.sectionKind,
      field: fact.field,
      outcome: reason.split(':')[0]!,
      reason,
      original: fact.value.trim(),
      proposed: p.text.trim(),
      explanation: p.explanation,
      explanationWords: p.explanation.split(/\s+/u).length,
    };
  });
}
function sectionCounts(rows: ReturnType<typeof diagnose>) {
  const table: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const t = (table[row.section] ??= {
      candidates: 0,
      shown: 0,
      confirm: 0,
      hidden: 0,
    });
    t.candidates!++;
    t[row.outcome] = (t[row.outcome] ?? 0) + 1;
  }
  return table;
}
const replay = args.get('replay');
if (replay) {
  const saved = JSON.parse(readFileSync(replay, 'utf8')) as {
    results: { run: number; call?: { raw?: RawProposal[] } }[];
  };
  const runsOut = saved.results
    .filter((r) => r.call?.raw)
    .map((r) => {
      const rows = diagnose(r.call!.raw!);
      return { run: r.run, sections: sectionCounts(rows), rows };
    });
  console.log(JSON.stringify({ dataset: name, replay: runsOut }, null, 2));
  process.exit(0);
}
const config = aiConfig();
const provider: AiProvider =
  config.provider === 'openai'
    ? new OpenAiProvider(config)
    : config.provider === 'gemini'
      ? new GeminiProvider(config)
      : new OllamaProvider(config);
// Hosted usage limits need the app database; this script is capped instead.
const ai = new AiService(provider, null, config);
const calls: {
  latencyMs: number;
  usage?: Record<string, number>;
  promptBytes: number;
  /** The model's proposals before the deterministic checks hide any. */
  raw?: unknown;
}[] = [];
const meter = {
  generatePartialStructured(
    request: {
      prompt: string;
      partial: { onProviderTiming?: (t: unknown) => void };
    },
    envelope: object,
  ) {
    const began = performance.now();
    const call: (typeof calls)[number] = {
      latencyMs: 0,
      promptBytes: Buffer.byteLength(request.prompt),
    };
    calls.push(call);
    const onTiming = request.partial.onProviderTiming;
    return ai
      .generatePartialStructured(
        {
          ...request,
          partial: {
            ...request.partial,
            onProviderTiming: (t: unknown) => {
              call.usage = (t as { usage?: Record<string, number> }).usage;
              onTiming?.(t);
            },
          },
        } as never,
        envelope as never,
      )
      .then((output) => {
        call.raw = (output as { proposals?: unknown }).proposals;
        return output;
      })
      .finally(() => (call.latencyMs = Math.round(performance.now() - began)));
  },
};
const generator = new TailoredDraftGenerator(meter as unknown as AiService);
const results = [];
for (let run = 0; run < runs; run++) {
  try {
    const { document: draft, decisions } = await generator.generate(
      input,
      async () => {},
    );
    const proposals = draft.sections.flatMap((s) =>
      s.entries.flatMap((e) =>
        e.facts
          .filter((f) => f.proposedWording)
          .map((f) => ({
            section: s.kind,
            factId: f.id,
            original: f.acceptedText.trim(),
            suggested: f.proposedWording!.text.trim(),
            explanation: f.proposedWording!.explanation,
            confirmation: f.proposedWording!.confirmationAssertion ?? null,
          })),
      ),
    );
    const questions = draft.sections.flatMap((s) =>
      s.entries.flatMap((e) =>
        e.facts
          .filter((f) => f.clarification)
          .map((f) => ({ factId: f.id, question: f.clarification!.question })),
      ),
    );
    const diagnostics = diagnose((calls[run]?.raw ?? []) as RawProposal[]);
    results.push({
      run,
      ok: true,
      call: calls[run],
      sections: sectionCounts(diagnostics),
      diagnostics,
      decisions,
      proposals,
      questions,
    });
  } catch (error) {
    results.push({
      run,
      ok: false,
      call: calls[run],
      error:
        (error as { errorCode?: string; code?: string }).errorCode ??
        (error as Error).name,
    });
  }
}
const report = {
  dataset: name,
  provider: config.provider,
  model: config.model,
  results,
};
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
