/**
 * PR23 shared synthetic interview-feedback cases. Used by the offline guard
 * spec (CI, deterministic) and the optional live Ollama evaluator (local only).
 * All questions and answers are synthetic; never add real CV or answer text.
 */
import {
  buildResponse,
  languageIssue,
  newNumbers,
  newTech,
} from '../../src/interview-prep/interview-prep.policy.js';
import {
  findQuestion,
  type InterviewQuestion,
} from '../../src/interview-prep/interview-prep.questions.js';
import type { PracticeMode } from '../../src/interview-prep/interview-prep.policy.js';

type Verdict = 'yes' | 'partly' | 'no';
export interface FeedbackCase {
  id: string;
  mode: PracticeMode;
  question: InterviewQuestion;
  questionText: string;
  answer: string;
  /** Live model-quality expectations (not guaranteed by code). */
  expect: {
    verdict?: Verdict[];
    offTopic?: boolean;
    /** Lowercase text that must appear in some correction's "better". */
    correction?: string;
  };
  /**
   * Documented limitations per model (observed in a real run): any failure in
   * this case is reported as KNOWN for that model and never fails the run.
   */
  known?: Record<string, string>;
}

const tech = (
  over: Partial<InterviewQuestion> & Pick<InterviewQuestion, 'kind'>,
): InterviewQuestion => ({
  id: 'jd-00000000-0000-4000-8000-000000000000',
  topic: 'technical',
  category: 'Technical',
  variants: [],
  hints: [],
  checkClaims: false,
  ...over,
});
const strength = findQuestion('hr-strengths-01')!;

export const FEEDBACK_CASES: FeedbackCase[] = [
  {
    id: 'kafka-short-focus',
    mode: 'review',
    question: tech({
      kind: 'hypothetical',
      why: 'Checks how you diagnose consumer lag and keep processing reliable, because the role owns a high-volume event pipeline.',
    }),
    questionText: 'How would you handle a slow consumer in Kafka?',
    answer: 'We add more consumers to the consumer group so it is faster.',
    expect: { verdict: ['partly', 'yes'] },
  },
  {
    id: 'idempotency-short-grammar',
    mode: 'review',
    question: tech({ kind: 'hypothetical' }),
    questionText: 'How do you make an API idempotent?',
    answer: 'I use a idempotency key in header.',
    expect: { verdict: ['partly', 'yes'], correction: 'an idempotency' },
    known: {
      'qwen3:4b':
        'Garbled suggestion ("I use an idemp: I use an…") passes the GARBLED guard (PR23 baseline).',
    },
  },
  {
    id: 'jwt-very-short',
    mode: 'review',
    question: tech({ kind: 'hypothetical' }),
    questionText: 'How would you secure a REST API?',
    answer: 'I use JWT token.',
    expect: { verdict: ['partly', 'yes'] },
    known: {
      'qwen3:8b':
        'Intermittent verdict "no" (PR22 run); "partly" in 3/3 PR23 runs, but the kept suggestion pads the answer with an invented claim ("properly signed and validated").',
    },
  },
  {
    id: 'java-personal-grammar',
    mode: 'review',
    question: tech({ kind: 'personal', checkClaims: true }),
    questionText:
      'Have you used Java to implement a feature that required handling high concurrency?',
    answer:
      'Yes, I used Java with a thread pool in a payment service. It work fast and stable.',
    expect: { verdict: ['partly', 'yes'], correction: 'worked' },
    known: {
      'qwen3:4b':
        'Content advice "You need to specify…" passes languageIssue (PR23 baseline).',
    },
  },
  {
    id: 'offtopic-hobby',
    mode: 'review',
    question: tech({ kind: 'hypothetical' }),
    questionText: 'How would you secure a REST API?',
    answer: 'I like playing football on weekends with my friends.',
    expect: { verdict: ['no'], offTopic: true },
    known: {
      'qwen3:4b':
        'Off-topic mainIssue ("The answer is not about…") is not English advice but passes languageIssue (PR23 baseline).',
    },
  },
  {
    id: 'offtopic-salary',
    mode: 'review',
    question: tech({ kind: 'general' }),
    questionText: 'What is the difference between a process and a thread?',
    answer: 'My salary expectation is around 2000 USD per month.',
    expect: { verdict: ['no'], offTopic: true },
  },
  {
    id: 'good-complete',
    mode: 'review',
    question: tech({ kind: 'hypothetical' }),
    questionText: 'How would you secure a REST API?',
    answer:
      'I would use HTTPS for every request and require a JWT access token. I would check permissions on the server for each endpoint, and I would add rate limiting to stop abuse.',
    expect: { verdict: ['yes'] },
  },
  {
    id: 'wrong-tech-claim',
    mode: 'review',
    question: tech({ kind: 'general' }),
    questionText: 'What is RabbitMQ used for?',
    answer: 'RabbitMQ is a database. We store user data in it.',
    expect: { verdict: ['partly', 'yes'] },
    known: {
      'qwen3:4b':
        'Technical grading "You said RabbitMQ is a database, but it\'s a message broker" passes languageIssue (PR23 baseline).',
    },
  },
  {
    id: 'vi-express-strength',
    mode: 'express',
    question: strength,
    questionText: strength.variants[0]!,
    answer: 'Điểm mạnh của tôi là học nhanh. Tôi tự học React trong 2 tuần.',
    expect: {},
  },
  {
    id: 'vi-express-kafka',
    mode: 'express',
    question: tech({ kind: 'hypothetical' }),
    questionText: 'How would you handle a slow consumer in Kafka?',
    answer:
      'Tôi sẽ kiểm tra consumer lag trước, sau đó tăng số partition và consumer.',
    expect: {},
  },
];

export const feedbackFor = (c: FeedbackCase, raw: Record<string, unknown>) =>
  buildResponse(c.mode, c.question, c.questionText, c.answer, raw, null);
type Response = ReturnType<typeof feedbackFor>;

export interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}
/**
 * Guard checks: must hold for ANY model output, because code enforces them.
 * Invented facts are heuristic only: numbers and known tech terms, not
 * qualitative claims.
 */
export function guardChecks(c: FeedbackCase, r: Response): CheckResult[] {
  const source = `${c.answer}\n${c.questionText}`;
  const invented = r.suggestion
    ? [
        ...newNumbers(r.suggestion, c.answer).map(String),
        ...newTech(r.suggestion, source),
      ]
    : [];
  return [
    {
      name: 'mainIssue English-only',
      ok: r.mainIssue === null || languageIssue(r.mainIssue) === r.mainIssue,
      detail: r.mainIssue ?? undefined,
    },
    {
      name: 'no invented facts (heuristic)',
      ok: !invented.length,
      detail: invented.join(', ') || undefined,
    },
    {
      name: '"no" verdict withholds suggestion',
      ok:
        r.answersQuestion !== 'no' ||
        (r.suggestion === null && r.suggestionWithheld === 'OFF_TOPIC'),
    },
  ];
}
const FIRST_PERSON = /\b(?:i|we|my|our)\b/iu;
const words = (s: string) => s.split(/\s+/u).filter(Boolean).length;
// Independent of languageIssue (which the guard already applies), so leaks show.
const NOT_ENGLISH_ADVICE =
  /\b(?:specify|explain|you said\b.*\bbut|is not about|isn't about|you didn't answer)\b/iu;
const GARBLED_FRAGMENT = /\p{L}{2,}: \p{L}/u;
const SECOND_PERSON_START = /^\s*you\b/iu;
/** Quality checks: model behaviour; reported by the live evaluator only. */
export function qualityChecks(c: FeedbackCase, r: Response): CheckResult[] {
  const out: CheckResult[] = [];
  if (c.expect.verdict)
    out.push({
      name: 'verdict',
      ok: c.mode === 'express' || c.expect.verdict.includes(r.answersQuestion!),
      detail: `${r.answersQuestion} (expected ${c.expect.verdict.join('/')})`,
    });
  if (c.expect.offTopic)
    out.push({
      name: 'off-topic withheld',
      ok: r.suggestionWithheld === 'OFF_TOPIC',
    });
  if (c.expect.correction)
    out.push({
      name: 'expected correction',
      ok: r.corrections.some((x) =>
        x.better.toLowerCase().includes(c.expect.correction!),
      ),
    });
  if (r.mainIssue)
    out.push({
      name: 'mainIssue English-only (heuristic)',
      ok: !NOT_ENGLISH_ADVICE.test(r.mainIssue),
      detail: r.mainIssue,
    });
  if (r.suggestion && c.mode === 'review')
    out.push({
      name: 'suggestion not padded (heuristic)',
      ok: words(r.suggestion) <= words(c.answer) * 1.5 + 6,
      detail: `${words(r.suggestion)} vs ${words(c.answer)} words`,
    });
  if (r.suggestion)
    out.push({
      name: 'suggestion not garbled (heuristic)',
      ok: !GARBLED_FRAGMENT.test(r.suggestion),
    });
  if (r.suggestion)
    out.push({
      name: 'first-person suggestion',
      ok:
        FIRST_PERSON.test(r.suggestion) &&
        !SECOND_PERSON_START.test(r.suggestion),
    });
  return out;
}
