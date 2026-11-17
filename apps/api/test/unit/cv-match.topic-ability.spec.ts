import { describe, expect, test } from '@jest/globals';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';

// Synthetic reviewed-CV text shaped like reviewedCvText output.
const requirement =
  'Java development: Working knowledge of Java Core and OOP, with the ability to maintain, debug, and enhance existing applications';
const lead =
  'Led the development of core enterprise features using Java Spring Boot, MyBatis, JavaScript/Thymeleaf, and SQL Server.';
const migrated =
  'Migrated legacy application functionality from OutSystems to Java 8 / Spring Boot and Vue.js.';
const cv = `SKILLS\nBackend: Java, Spring Boot, Hibernate, MyBatis\n\n\nWORK EXPERIENCE\nTechnical Team Lead\n${lead}\n\n\nSoftware Developer\n${migrated}`;

describe('topic heading with trailing ability clause', () => {
  test('production Java requirement decomposes into AND, not UNKNOWN', () => {
    const group = requirementGroup(requirement, 'skill');
    expect(group.mode).toBe('AND');
    expect(group.context).toBe('knowledge');
    expect(group.components.map((c) => c.label)).toEqual([
      'Java Core',
      'OOP',
      'ability to maintain, debug, and enhance existing applications',
    ]);
    // Component quotes stay literal spans of the original JD text.
    for (const c of group.components)
      expect(requirement.includes(c.jdQuote)).toBe(true);
  });

  test('Java work evidence is PARTIAL; OOP and actions earn no credit', () => {
    const result = evaluateCoverage(
      requirementGroup(requirement, 'skill'),
      [lead, migrated, 'Backend: Java, Spring Boot, Hibernate, MyBatis'],
      cv,
      true,
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.credit).toBeCloseTo(1 / 3);
    expect(result.components.map((c) => c.status)).toEqual([
      'EVIDENCED',
      'NOT_EVIDENCED',
      'NOT_EVIDENCED',
    ]);
  });

  test('one action ("debugged") does not satisfy maintain, debug and enhance', () => {
    const debug = 'Debugged production incidents in Java services.';
    const result = evaluateCoverage(
      requirementGroup(requirement, 'skill'),
      [debug],
      `WORK EXPERIENCE\nDeveloper\n${debug}`,
      true,
    );
    expect(result.components[2]!.status).toBe('NOT_EVIDENCED');
  });

  test.each([
    'Java development: Working knowledge of Java or Kotlin, with the ability to debug applications',
    'Java development: Working knowledge of Java including Spring, with the ability to debug applications',
    'Working knowledge of Java Core and OOP with the ability to debug applications',
    'Java development: Java Core and OOP, with the ability to maintain, debug, and enhance existing applications',
    'Ability to maintain, debug, and enhance existing Java applications and OOP code',
  ])('ambiguous ability wording stays UNKNOWN or unsplit: %s', (text) => {
    const group = requirementGroup(text, 'skill');
    expect(group.mode).toBe('UNKNOWN');
  });
});
