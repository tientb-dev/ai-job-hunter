import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import {
  FEEDBACK_CASES,
  feedbackFor,
  guardChecks,
} from '../support/interview-feedback.cases.js';

// PR23 offline correctness: genuine recorded model outputs replayed through the
// real response builder. Deterministic, no model. Live quality is separate
// (pnpm eval:feedback, local only).
interface Recorded {
  runs: {
    model: string;
    outputs: { id: string; raw: Record<string, unknown>; response: unknown }[];
  }[];
}
const recorded = JSON.parse(
  readFileSync('test/support/interview-feedback.recorded.json', 'utf8'),
) as Recorded;
const byId = new Map(FEEDBACK_CASES.map((c) => [c.id, c]));

describe('interview feedback regression suite (recorded outputs)', () => {
  test('every recorded output belongs to a shared case, and every case is recorded', () => {
    for (const run of recorded.runs)
      expect(run.outputs.map((o) => o.id).sort()).toEqual(
        [...byId.keys()].sort(),
      );
  });
  const rows = recorded.runs.flatMap((run) =>
    run.outputs.map((o) => [run.model, o.id, o] as const),
  );
  test.each(rows)('%s %s: guards hold', (_model, id, o) => {
    const response = feedbackFor(byId.get(id)!, o.raw);
    for (const check of guardChecks(byId.get(id)!, response))
      expect({ check: check.name, ok: check.ok }).toEqual({
        check: check.name,
        ok: true,
      });
  });
  // An intentional guard change shows up here; regenerate the fixture with
  // `pnpm eval:feedback --out` and review the diff.
  test.each(rows)('%s %s: response is unchanged', (_model, id, o) => {
    expect(feedbackFor(byId.get(id)!, o.raw)).toEqual(o.response);
  });
  test('recorded content advice and off-topic main issues are dropped', () => {
    const run = recorded.runs.find((r) => r.model === 'qwen3:8b')!;
    for (const id of ['kafka-short-focus', 'offtopic-hobby']) {
      const o = run.outputs.find((x) => x.id === id)!;
      expect(o.raw.mainIssue).toBeTruthy();
      expect(feedbackFor(byId.get(id)!, o.raw).mainIssue).toBeNull();
    }
  });
});
