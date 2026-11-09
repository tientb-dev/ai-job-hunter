import { longSourceCv } from './long-source-structure-fixture.js';
export const skillGroups = [
  [
    'Backend',
    'Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, Express.js, PHP, Laravel',
  ],
  ['Frontend', 'React, Next.js, Vue.js, Nuxt.js, TypeScript, JavaScript'],
  [
    'Leadership & Communication',
    'Team mentoring, communication; contributed with the team',
  ],
  ['Architecture', 'Modular monoliths, API design'],
  ['Databases', 'PostgreSQL; SQL Server (academic coursework only)'],
  ['Cloud & DevOps', 'Docker, CI pipelines'],
  [
    'AI-assisted Development',
    'Local tooling experiments; no production ownership claimed',
  ],
] as const;
export const contactSkillsSource = longSourceCv()
  .replace(
    'Example City | +84 900 000 123 | morgan@example.invalid | https://example.invalid/morgan',
    '\uFFFD Example City \u25A1 +84 900 000 123\n\uE001 morgan@example.invalid \u25AF https://example.invalid/morgan\nUnclear contact fragment: example-handle',
  )
  .replace(
    'Backend: Java, Node.js\nDatabases: PostgreSQL; SQL Server (academic only)\nTools: Git, Docker',
    skillGroups.map(([category, items]) => `${category}: ${items}`).join('\n'),
  );
