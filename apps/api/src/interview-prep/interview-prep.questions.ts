export type InterviewTopic = 'hr' | 'technical';
/**
 * general: concept explanation, no personal experience assumed.
 * personal: asks about the user's own experience, never names a technology.
 * hypothetical: "how would you…", explicitly not a claim of experience.
 */
export type QuestionKind = 'general' | 'personal' | 'hypothetical';
export interface InterviewQuestion {
  id: string;
  topic: InterviewTopic;
  category: string;
  kind: QuestionKind;
  /** Natural rewordings of the same question; the client picks one. */
  variants: string[];
  /** Optional talking points, phrased as prompts, never as facts. */
  hints: string[];
  /** CV claim notices only where numbers/tools are professional claims. */
  checkClaims: boolean;
}

// Static, curated and user-agnostic. English source strings with stable IDs so
// a later localization layer can key off `id` without changing the API.
export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = Object.freeze([
  {
    id: 'hr-intro-01',
    topic: 'hr',
    category: 'Self-introduction',
    kind: 'personal',
    variants: [
      'Tell me about yourself.',
      'Can you briefly introduce yourself?',
      'Walk me through your background.',
    ],
    hints: [
      'What do you do now?',
      'What kind of work do you enjoy most?',
      'What are you looking for next?',
    ],
    checkClaims: true,
  },
  {
    id: 'hr-strengths-01',
    topic: 'hr',
    category: 'Strengths',
    kind: 'personal',
    variants: [
      'What is your biggest strength?',
      'What are you particularly good at?',
      'What strengths would you bring to our team?',
    ],
    hints: [
      'Name one strength.',
      'Give one short example of it.',
      'Why does it help your team?',
    ],
    checkClaims: true,
  },
  {
    id: 'hr-weakness-01',
    topic: 'hr',
    category: 'Weaknesses',
    kind: 'personal',
    variants: [
      'What is one of your weaknesses?',
      'What is something you are working to improve?',
      'Tell me about an area where you want to grow.',
    ],
    hints: [
      'Choose a real but manageable weakness.',
      'What are you doing to improve it?',
    ],
    checkClaims: false,
  },
  {
    id: 'hr-change-01',
    topic: 'hr',
    category: 'Changing jobs',
    kind: 'personal',
    variants: [
      'Why are you looking for a new job?',
      'Why do you want to leave your current company?',
      'What made you start looking for a new role?',
    ],
    hints: [
      'Stay positive about your current job.',
      'What do you want more of in your next role?',
    ],
    checkClaims: false,
  },
  {
    id: 'hr-why-company-01',
    topic: 'hr',
    category: 'Why this company or role',
    kind: 'personal',
    variants: [
      'Why do you want to work here?',
      'What interests you about this role?',
      'Why did you apply for this position?',
    ],
    hints: [
      'What about the role matches your experience?',
      'What would you like to learn here?',
    ],
    checkClaims: false,
  },
  {
    id: 'hr-goals-01',
    topic: 'hr',
    category: 'Career goals',
    kind: 'personal',
    variants: [
      'Where do you see yourself in a few years?',
      'What are your career goals?',
      'What would you like to achieve in your next role?',
    ],
    hints: ['One short-term goal.', 'One longer-term direction.'],
    checkClaims: false,
  },
  {
    id: 'hr-availability-01',
    topic: 'hr',
    category: 'Availability and start date',
    kind: 'personal',
    variants: [
      'When would you be able to start?',
      'What is your notice period?',
      'How soon could you join us?',
    ],
    hints: [
      'Your notice period or earliest start date.',
      'Anything that could change it.',
    ],
    checkClaims: false,
  },
  {
    id: 'hr-salary-01',
    topic: 'hr',
    category: 'Salary expectations',
    kind: 'personal',
    variants: [
      'What are your salary expectations?',
      'What salary range are you looking for?',
    ],
    hints: [
      'A range, or that you are open to discussion.',
      'What the range is based on.',
    ],
    checkClaims: false,
  },
  {
    id: 'hr-teamwork-01',
    topic: 'hr',
    category: 'Teamwork and challenges',
    kind: 'personal',
    variants: [
      'How do you handle disagreements in your team?',
      'Tell me about a time you worked through a difficult situation with a teammate.',
      'How do you work with people who have different opinions?',
    ],
    hints: [
      'What was the situation?',
      'What did you do?',
      'What happened in the end?',
    ],
    checkClaims: true,
  },
  {
    id: 'hr-achievement-01',
    topic: 'hr',
    category: 'Achievements',
    kind: 'personal',
    variants: [
      'What is an achievement you are proud of?',
      'What is a result from your work that you are proud of?',
    ],
    hints: [
      'What was the problem?',
      'What did you do yourself?',
      'What was the result, if you know it?',
    ],
    checkClaims: true,
  },
  {
    id: 'hr-learning-01',
    topic: 'hr',
    category: 'Learning',
    kind: 'personal',
    variants: [
      'Tell me about something you learned recently at work.',
      'What have you learned recently in your work?',
    ],
    hints: [
      'What did you learn?',
      'Why did you need to learn it?',
      'How did it help your work?',
    ],
    checkClaims: true,
  },
  {
    id: 'tech-async-01',
    topic: 'technical',
    category: 'Explaining a concept',
    kind: 'general',
    variants: [
      'Can you explain asynchronous messaging in simple terms?',
      'What is a message queue, such as RabbitMQ, and why do teams use one?',
      'How would you explain asynchronous communication between services to a non-technical person?',
    ],
    hints: [
      'What problem does it solve?',
      'A simple everyday comparison.',
      'One downside or risk.',
    ],
    checkClaims: false,
  },
  {
    id: 'tech-caching-01',
    topic: 'technical',
    category: 'Explaining a concept',
    kind: 'general',
    variants: [
      'What is caching, and when is it useful?',
      'Can you explain caching to someone new to backend development?',
    ],
    hints: [
      'What is stored, and where?',
      'Why is it faster?',
      'What can go wrong?',
    ],
    checkClaims: false,
  },
  {
    id: 'tech-api-01',
    topic: 'technical',
    category: 'Explaining a concept',
    kind: 'general',
    variants: ['What makes an API easy for other developers to use?'],
    hints: ['Who uses it?', 'One or two qualities of a good API.'],
    checkClaims: false,
  },
  {
    id: 'tech-api-02',
    topic: 'technical',
    category: 'Explaining a concept',
    kind: 'general',
    variants: ['How would you explain what a REST API is?'],
    hints: ['What is a resource?', 'How do clients ask for or change data?'],
    checkClaims: false,
  },
  {
    id: 'tech-project-01',
    topic: 'technical',
    category: 'Describing a project',
    kind: 'personal',
    variants: [
      'Tell me about a project you worked on recently.',
      'Can you describe a system you have worked on?',
      'What was your role in your most recent project?',
    ],
    hints: [
      'What did the system do?',
      'What was your part?',
      'Which technologies did you use?',
    ],
    checkClaims: true,
  },
  {
    id: 'tech-choice-01',
    topic: 'technical',
    category: 'Explaining a decision',
    kind: 'personal',
    variants: [
      'Tell me about a technical decision you made and why.',
      'Describe a time you chose one approach over another.',
    ],
    hints: [
      'What were the options?',
      'Why did you choose this one?',
      'Would you choose it again?',
    ],
    checkClaims: true,
  },
  {
    id: 'tech-tradeoff-01',
    topic: 'technical',
    category: 'Trade-offs',
    kind: 'hypothetical',
    variants: [
      'How would you decide between a monolith and microservices for a new product?',
    ],
    hints: [
      'One advantage of each option.',
      'One cost or risk of each option.',
      'What would make you choose one?',
    ],
    checkClaims: false,
  },
  {
    id: 'tech-tradeoff-02',
    topic: 'technical',
    category: 'Trade-offs',
    kind: 'hypothetical',
    variants: [
      'What are the trade-offs between synchronous and asynchronous communication between services?',
    ],
    hints: [
      'One advantage of each option.',
      'One cost or risk of each option.',
      'When would you choose each one?',
    ],
    checkClaims: false,
  },
  {
    id: 'tech-debug-01',
    topic: 'technical',
    category: 'Troubleshooting',
    kind: 'personal',
    variants: [
      'How do you approach a production issue you have never seen before?',
      'Tell me how you usually debug a slow API.',
      'Describe how you troubleshoot a problem step by step.',
    ],
    hints: [
      'Your first step.',
      'How you find the cause.',
      'How you confirm the fix.',
    ],
    checkClaims: true,
  },
]);
/**
 * Every ID ever published. Saved answers are keyed by question ID, so an ID must
 * keep ONE meaning forever: never remove it from this list and never reuse it.
 * All variants of a question must ask the same question (reviewed by humans).
 */
export const PUBLISHED_QUESTION_IDS: readonly string[] = Object.freeze([
  'hr-intro-01',
  'hr-strengths-01',
  'hr-weakness-01',
  'hr-change-01',
  'hr-why-company-01',
  'hr-goals-01',
  'hr-availability-01',
  'hr-salary-01',
  'hr-teamwork-01',
  'hr-achievement-01',
  'hr-learning-01',
  'tech-async-01',
  'tech-caching-01',
  'tech-api-01',
  'tech-api-02',
  'tech-project-01',
  'tech-choice-01',
  'tech-tradeoff-01',
  'tech-tradeoff-02',
  'tech-debug-01',
]);
/** Withdrawn IDs. Their saved answers stay in the database but are hidden. */
export const RETIRED_QUESTION_IDS: readonly string[] = Object.freeze([]);

export function findQuestion(id: unknown): InterviewQuestion | undefined {
  return typeof id === 'string'
    ? INTERVIEW_QUESTIONS.find((q) => q.id === id)
    : undefined;
}
