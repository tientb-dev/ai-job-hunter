import { describe, expect, test } from '@jest/globals';
import { INTERVIEW_QUESTIONS } from '../../src/interview-prep/interview-prep.questions.js';
import {
  expressPrompt,
  guardSuggestion,
} from '../../src/interview-prep/interview-prep.policy.js';

// Synthetic notes only. The guard is unchanged; the prompt now asks for the
// voice the guard accepts instead of always demanding first person.
const technical = INTERVIEW_QUESTIONS.find((q) => q.kind === 'general')!;
const personal = INTERVIEW_QUESTIONS.find((q) => q.kind === 'personal')!;
const question = 'How would you reduce load on a database?';
const subjectless =
  'Dùng Redis để cache dữ liệu hay đọc, giảm tải cho database.';
const guard = (suggestion: string, notes: string, kind = technical.kind) =>
  guardSuggestion(suggestion, notes, question, { kind, mode: 'express' });

describe('express voice', () => {
  test('non-personal prompt allows first person only when the notes establish it', () => {
    const prompt = expressPrompt(technical, question, subjectless);
    expect(prompt).not.toMatch(/natural spoken English in first person/u);
    expect(prompt).toContain(
      'Use "I"/"we" for the candidate\'s own work ONLY if the notes explicitly say they did or do it',
    );
    expect(prompt).toContain(
      'explain the idea as an approach or recommendation',
    );
    expect(prompt).toContain('never as work already done');
  });

  test('personal prompt keeps first person but never turns an approach into completed work', () => {
    const prompt = expressPrompt(personal, 'Q?', 'nên viết test trước');
    expect(prompt).toContain('Speak in first person as the candidate.');
    expect(prompt).toContain(
      'Describe something as done only if the notes say it was done.',
    );
    expect(prompt).toContain('never as work already done');
  });

  test('subjectless Vietnamese technical notes: the approach voice passes the guard', () => {
    expect(
      guard(
        'A good way is to use Redis to cache data that is read often. This reduces load on the database.',
        subjectless,
      ),
    ).toBeNull();
    expect(
      guard(
        'I would use Redis to cache data that is read often, to reduce load on the database.',
        subjectless,
      ),
    ).toBeNull();
  });

  test('an unsupported personal claim is still withheld', () => {
    expect(
      guard(
        'I use Redis to cache data that is read often. This reduces load on the database.',
        subjectless,
      ),
    ).toBe('CHANGED_FACTS');
  });

  test('explicit first-person experience in the notes keeps first person', () => {
    expect(
      guard(
        'I use Redis to cache data that is read often.',
        'Mình dùng Redis để cache dữ liệu hay đọc.',
      ),
    ).toBeNull();
  });
});
