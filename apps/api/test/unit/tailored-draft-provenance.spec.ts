import { expect, jest, test } from '@jest/globals';
import { AiService } from '../../src/ai/ai.service.js';
import { reviewedCvText } from '../../src/reviewed-cv/reviewed-cv.text.js';
import { TailoredDraftGenerator } from '../../src/tailored-cv/tailored-draft.generator.js';
import { savedPassageReferences } from '../../src/tailored-cv/tailored-draft.provenance.js';
import { draftInput } from '../support/tailored-draft-fixtures.js';

const campaign = 'Coordinated a school fundraiser.';
const followUp = 'Published the event programme.';
function marketingInput() {
  const input = structuredClone(draftInput('Event planning', false, campaign));
  const scope = input.plan.facts.find(({ id }) => id === 'scope')!;
  scope.value = followUp;
  const row = input.match.assessment.requirements[0]!;
  Object.assign(row, { cvQuote: '', status: 'NOT_EVIDENCED' });
  const component = row.coverage.components[0]!;
  Object.assign(component, { cvQuote: campaign, status: 'PARTIAL' });
  return input;
}

test('attributes an exact selected quote from a legacy assessment and omits ambiguous quotes', () => {
  const input = marketingInput();
  expect(savedPassageReferences(input).get('role-1')).toEqual([
    expect.objectContaining({
      kind: 'selected',
      factIds: ['java'],
      origin: 'source',
    }),
  ]);
  const quote = input.plan.facts.find(({ id }) => id === 'java')!;
  input.plan.facts.push({ ...quote, id: 'other', entryId: 'other-role' });
  expect(savedPassageReferences(input).size).toBe(0);
});

test('a valid offset disambiguates repeated text while an offsetless strength quote needs a unique match', () => {
  const input = marketingInput();
  const fact = input.plan.facts.find(({ id }) => id === 'java')!;
  input.plan.facts.push({ ...fact, id: 'other', entryId: 'other-role' });
  const { text } = reviewedCvText(input.plan.facts);
  const start = text.lastIndexOf(campaign);
  const component =
    input.match.assessment.requirements[0]!.coverage.components[0]!;
  Object.assign(component, {
    strength: {
      quotes: [
        {
          quote: campaign,
          start,
          end: start + campaign.length,
          level: 'APPLIED',
        },
        { quote: campaign, level: 'MENTIONED' },
        { quote: followUp, level: 'APPLIED' },
      ],
    },
  });
  const refs = savedPassageReferences(input);
  expect(refs.get('other-role')).toEqual([
    expect.objectContaining({
      kind: 'strength',
      level: 'APPLIED',
      factIds: ['other'],
    }),
  ]);
  expect(refs.get('role-1')).toEqual([
    expect.objectContaining({
      kind: 'strength',
      level: 'APPLIED',
      factIds: ['scope'],
    }),
  ]);
});

test('keeps multi-fact strength attribution together and drops stale, partial or cross-entry offsets', () => {
  const input = marketingInput();
  const component =
    input.match.assessment.requirements[0]!.coverage.components[0]!;
  const { text } = reviewedCvText(input.plan.facts);
  const quote = campaign + '\n' + followUp;
  const start = text.indexOf(quote);
  const level = 'APPLIED' as const;
  const valid = { quote, start, end: start + quote.length, level };
  const strength = {
    level,
    strength: 75,
    independentUnits: 1,
    listed: false,
    quotes: [
      valid,
      {
        ...valid,
        level: 'MENTIONED' as const,
        start: start + 1,
        end: valid.end + 1,
      },
      { ...valid, level: 'LISTED' as const, end: -1 },
      { ...valid, level: 'APPLIED_PLUS' as const, end: undefined },
    ],
  };
  Object.assign(component, { strength });
  expect(
    savedPassageReferences(input)
      .get('role-1')
      ?.filter(({ kind }) => kind === 'strength'),
  ).toEqual([expect.objectContaining({ factIds: ['java', 'scope'], level })]);
  const scope = input.plan.facts.find(({ id }) => id === 'scope')!;
  scope.entryId = 'another-event';
  const crossQuote = campaign + '\n\n\n' + followUp;
  strength.quotes = [
    { ...valid, quote: crossQuote, end: start + crossQuote.length },
  ];
  expect(
    savedPassageReferences(input)
      .get('role-1')
      ?.map(({ kind }) => kind),
  ).toEqual(['selected']);
});

test('one non-technical prompt keeps all candidates, user-entered provenance and saved uncertainty', async () => {
  const input = marketingInput();
  const component =
    input.match.assessment.requirements[0]!.coverage.components[0]!;
  const fact = input.plan.facts.find(({ id }) => id === 'java')!;
  fact.origin = 'user_entered';
  fact.confirmation = 'field';
  const { text } = reviewedCvText(input.plan.facts);
  const start = text.indexOf(campaign);
  Object.assign(component, {
    cvOrigin: 'user_entered',
    observations: [{ kind: 'experience', cvQuote: campaign }],
    strength: {
      quotes: [
        {
          quote: campaign,
          start,
          end: start + campaign.length,
          level: 'APPLIED',
        },
      ],
    },
  });
  Object.assign(input.match.assessment, {
    conditions: [
      {
        parentId: 'p1',
        kind: 'EXPERIENCE',
        mode: 'SINGLE',
        jdQuote: 'Two years of event planning',
        status: 'UNKNOWN',
        evidence: [
          {
            cvQuote: campaign,
            start,
            end: start + campaign.length,
            cvOrigin: 'user_entered',
          },
          {
            cvQuote: followUp,
            start: text.indexOf(followUp),
            end: text.indexOf(followUp) + followUp.length,
            cvOrigin: 'user_entered',
          },
        ],
      },
    ],
  });
  input.plan.candidates.push(
    ...Array.from({ length: 33 }, (_, i) => ({ ...fact, id: 'event-' + i })),
  );
  const generate = jest.fn(async ({ prompt }: { prompt: string }) => {
    const payload = JSON.parse(prompt.split('\n').at(-1)!);
    expect(payload.requirements[0].status).toBe('NOT_EVIDENCED');
    expect(payload.conditions[0].status).toBe('UNKNOWN');
    const entry = payload.sections[0].entries[0];
    expect(entry.facts.map(({ factId }: { factId: string }) => factId)).toEqual(
      input.plan.candidates.map(({ id }) => id),
    );
    expect(entry.passageReferences).toMatchObject([
      { kind: 'selected', factIds: ['java'], origin: 'user_entered' },
      {
        kind: 'related_context',
        observation: 'experience',
        origin: 'user_entered',
      },
      { kind: 'strength', level: 'APPLIED', origin: 'user_entered' },
      { kind: 'condition_context', factIds: ['java'], origin: 'user_entered' },
    ]);
    return JSON.stringify({
      outcome: 'no_change',
      proposals: [],
      questions: [],
    });
  });
  await new TailoredDraftGenerator(new AiService({ generate })).generate(
    input,
    async () => {},
  );
  expect(generate).toHaveBeenCalledTimes(1);
});
