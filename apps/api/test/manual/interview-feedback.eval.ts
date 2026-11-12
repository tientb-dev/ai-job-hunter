/**
 * PR23 optional live evaluator for interview feedback (local Ollama only).
 *   pnpm eval:feedback [--model qwen3:8b] [--out results.json]
 * Calls local Ollama directly with the provider's request shape (think off,
 * schema-constrained, temperature 0), because AiService is pinned to the
 * qwen3:4b profile. Results are indicative, not a benchmark: one run per case.
 * Before/after: run on a worktree of main and on the branch, then diff --out files.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  EXPRESS_SCHEMA,
  REVIEW_SCHEMA,
  expressPrompt,
  reviewPrompt,
} from '../../src/interview-prep/interview-prep.policy.js';
import {
  FEEDBACK_CASES,
  feedbackFor,
  guardChecks,
  qualityChecks,
} from '../support/interview-feedback.cases.js';

if (process.env.CI) throw new Error('Local invocation required');
const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'qwen3:8b' },
    out: { type: 'string' },
  },
});
const model = values.model!;
const results = [];
let unexpected = 0;
for (const c of FEEDBACK_CASES) {
  const review = c.mode === 'review';
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: review
        ? reviewPrompt(c.question, c.questionText, c.answer)
        : expressPrompt(c.question, c.questionText, c.answer),
      stream: false,
      think: false,
      format: review ? REVIEW_SCHEMA : EXPRESS_SCHEMA,
      options: { num_ctx: 8192, num_predict: 2048, temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const raw = JSON.parse(
    ((await response.json()) as { response: string }).response,
  ) as Record<string, unknown>;
  const r = feedbackFor(c, raw);
  const guard = guardChecks(c, r);
  const quality = qualityChecks(c, r);
  const failed = [...guard, ...quality].filter((x) => !x.ok);
  const known = c.known?.[model];
  // KNOWN:PASS means the limitation did not reproduce this run, not that it is fixed.
  const status = !failed.length
    ? known
      ? 'KNOWN:PASS'
      : 'PASS'
    : known
      ? 'KNOWN'
      : 'FAIL';
  if (status === 'FAIL') unexpected++;
  console.log(
    `${status.padEnd(11)} ${c.id.padEnd(26)} verdict=${r.answersQuestion ?? '-'} ` +
      `mainIssue=${r.mainIssue === null ? (raw.mainIssue ? 'dropped' : 'none') : 'kept'} ` +
      `suggestion=${r.suggestion === null ? `withheld:${r.suggestionWithheld}` : 'kept'}` +
      (failed.length
        ? `\n            failed: ${failed.map((x) => `${x.name}${x.detail ? ` [${x.detail}]` : ''}`).join('; ')}`
        : '') +
      (known ? `\n            known: ${known}` : ''),
  );
  results.push({ id: c.id, raw, response: r, guard, quality, status });
}
if (values.out)
  writeFileSync(
    values.out,
    JSON.stringify(
      { model, recordedAt: new Date().toISOString(), results },
      null,
      2,
    ),
  );
console.log(
  `\n${model}: ${results.length} cases, ${unexpected} unexpected failure(s). Invented-fact detection is heuristic (numbers and known tech terms only).`,
);
if (unexpected) process.exitCode = 1;
