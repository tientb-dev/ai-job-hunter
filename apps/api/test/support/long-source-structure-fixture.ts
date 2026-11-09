// Synthetic only: varied local project headings deliberately stress section scope.
export function longSourceCv(employers = 3): string {
  return (
    [
      'SYNTHETIC MORGAN TRAN',
      'BACKEND / FULL STACK SOFTWARE DEVELOPMENT',
      'Example City | +84 900 000 123 | morgan@example.invalid | https://example.invalid/morgan',
      'PROFESSIONAL SUMMARY',
      'Software development supporting internal systems and team delivery.',
      'SQL Server was used in university coursework only; no professional proficiency claimed.',
      'WORK EXPERIENCE',
      ...Array.from({ length: employers }, (_, i) =>
        [
          `Employer: Example Company ${i + 1}`,
          `Role: ${i === 0 ? 'Backend Developer' : 'Software Engineer'}`,
          `Dates: ${2018 + i * 2}–${2019 + i * 2}`,
          'Projects',
          ...Array.from({ length: 3 }, (_, j) =>
            [
              `Project: Internal service ${i + 1}.${j + 1}`,
              'Technology Stack',
              'Java, PostgreSQL, Git; team prototype only.',
              'Responsibilities:',
              `• Contributed ${j + 2} integration checks with the team; no sole ownership claimed.`,
              '• Documented internal interfaces and assisted release testing.',
            ].join('\n'),
          ),
          '',
        ].join('\n'),
      ),
      'TECHNICAL SKILLS',
      'Backend: Java, Node.js',
      'Databases: PostgreSQL; SQL Server (academic only)',
      'Tools: Git, Docker',
      'EDUCATION',
      'Institution: Example University',
      'Qualification: BSc studies in progress',
      'Dates: 2016–2018',
    ].join('\n') + '\n'
  );
}
