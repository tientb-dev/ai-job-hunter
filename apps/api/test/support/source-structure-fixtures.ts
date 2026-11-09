import { sourcePassages } from '../../src/tailored-cv/source-profile-proposal.js';
export const structureSource = `Synthetic Avery Chen
Senior Software Engineer
Email: avery@example.invalid
Professional Summary
Builds reliable Java APIs and supports
team testing. Academic SQL Server coursework only.

Experience
Employer: Example Alpha
Role: Software Developer
Dates: January 2021 - December 2023
Contributions:
• Improved internal API tests with the
team, without individual ownership claims.
• Documented 12 internal endpoints.

Employer: Example Beta
Role: Junior Engineer
Dates: 2024–present
• Assisted a team prototype using
 Java; no individual production ownership claimed.

Technical Skills
Backend: Java, SQL Server (academic coursework only)
Tools:
Git, Docker
Education
Institution: Example University
Qualification: BSc studies in progress
Dates: 2020–present
Projects
Project: University SQL lab
Used SQL Server for academic exercises only.
`;
export function structureChoices(source: string) {
  return {
    fields: sourcePassages(source)
      .filter((p) => !p.heading)
      .map((p) => ({
        id: p.id,
        kind: p.kind ?? 'contact',
        field:
          p.hint ??
          (p.kind === 'summary'
            ? 'summary'
            : p.kind === 'skills'
              ? 'skill'
              : p.kind === null
                ? 'name'
                : 'description'),
      })),
  };
}
