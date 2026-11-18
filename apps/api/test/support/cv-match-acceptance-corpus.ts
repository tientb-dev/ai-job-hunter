// Synthetic reviewed-CV and JD fixtures for the CV Match acceptance corpus.
// No real person, employer or private CV text. Reused by unit and web tests.
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

export const REQ = {
  javaCoreOop:
    'Strong knowledge of Java Core and OOP, with the ability to maintain, debug, and enhance existing applications',
  sqlVi:
    'Có kinh nghiệm viết câu truy vấn SQL, phân tích dữ liệu và xử lý logic nghiệp vụ',
  gitVi: 'Có kinh nghiệm sử dụng Git, SVN hoặc các công cụ quản lý mã nguồn',
  javaSpringYears: '3+ years of experience with Java and Spring Boot',
  javaSpringVi: 'Có kinh nghiệm lập trình Java và Spring Boot',
  git: 'Experience with Git',
  dockerOrK8s: 'Experience with Docker or Kubernetes',
  cloudIncluding:
    'Experience with cloud platforms, including AWS, GCP or Azure',
} as const;

export function job(
  skills: readonly string[],
  preferredSkills: readonly string[] = [],
  id = 'synthetic-job',
): Opportunity {
  return {
    id,
    title: 'Synthetic Java Developer',
    company: 'Synthetic Co',
    skills: skills.join('\n'),
    preferredSkills: preferredSkills.join('\n'),
    experience: '',
    domain: '',
    seniority: '',
    description: '',
    postText: '',
    jdText: '',
    updatedAt: new Date('2026-11-01T00:00:00Z'),
  } as unknown as Opportunity;
}

/** Scenario A (EN Java backend) and B (VI Java developer) JDs. */
export const JD_JAVA_EN = job(
  [REQ.javaCoreOop, REQ.javaSpringYears, REQ.git],
  [REQ.dockerOrK8s],
);
export const JD_JAVA_VI = job([REQ.sqlVi, REQ.gitVi, REQ.javaSpringVi]);

/** Relevant Java candidate whose CV wording is incomplete. */
export const CV_JAVA_INCOMPLETE = [
  'Summary: 5 years of experience with Java and Spring Boot.',
  'WORK EXPERIENCE',
  'Backend Developer, Synthetic Bank (2019 - 2024)',
  '- Developed Java Spring Boot microservices for payment processing.',
  '- Maintained and debugged existing Java services in production.',
  '- Implemented business logic for loan approval workflows.',
  '- Configured GitLab CI/CD pipelines and GitHub Actions for deployment.',
  'Skills: Java, Spring Boot, SQL Server, Docker',
].join('\n');

/** Same candidate after clarifying SQL, Git and OOP in the CV. */
export const CV_JAVA_CLARIFIED = [
  CV_JAVA_INCOMPLETE,
  '- Wrote and optimized complex SQL queries for monthly reporting.',
  '- Analyzed transaction data to find failed payment patterns.',
  '- Used Git for feature branching and code reviews.',
  '- Applied object-oriented design to the loan rules engine.',
].join('\n');

/** Genuinely mismatched candidate (marketing). */
export const CV_MARKETING = [
  'EXPERIENCE',
  'Marketing Executive, Synthetic Retail (2020 - 2024)',
  '- Planned social media campaigns and increased reach by 40%.',
  '- Managed paid advertising budgets for seasonal launches.',
  'Skills: SEO, Google Analytics, Canva',
].join('\n');

/** Skills section only: names without demonstrated work. */
export const CV_SKILLS_ONLY = [
  'SKILLS',
  'Skills: Java, Spring Boot, Git, SQL, Docker',
].join('\n');

/** JD where most rows cannot be safely interpreted. */
export const JD_LOW_EVALUABILITY = job(
  [
    'Proficiency in multiple programming languages such as Java, Python',
    "Bachelor's Degree in Computer Science or (2 years of relevant experience and equivalent practical experience)",
    'Experience building and either maintaining or operating distributed systems',
  ],
  [REQ.dockerOrK8s],
);
