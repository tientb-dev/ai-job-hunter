# P8.4 Tailored CV review acceptance

P8.4 only. No export, renderer, new dependency, schema migration, commit, push or
PR. Synthetic fixtures only; development data was not accessed. Existing P8.1–P8.3
work, benchmark artifacts and local skills were preserved.

## Implemented behavior

Job Detail → Improve CV now contains a complete structured Tailored CV workspace.
Users can generate a separate draft from the latest reviewed source profile/current
match, load paginated saved drafts, reopen, edit section fields, inspect evidence,
accept/reject and revisit wording decisions, save, restore pinned reviewed wording,
and approve an exact saved revision. Review issues remain separate from CV content;
unselected facts stay visible and other recoverable passages can be explicitly
loaded from the pinned source/profile. No private text enters browser storage/logs.

Version-1 POST `/api/v1/tailored-cv/drafts/:id/review` accepts `expectedRevision`
and strict bounded `operations`: edit (`factId`, `text`), accept/reject/restore
(`factId`), acknowledge (`issueIndex`). POST `/drafts/:id/approve` accepts
`expectedRevision` and the exact `reviewedFactIds` with AI-accepted/manual wording.
Both return the complete newly saved draft, use owner-scoped transactional row
locks and preserve all immutable pins, evidence and P6 assessments. Review saves
clear approval. Approval increments the revision and records that exact resulting
revision. Pending proposals or unacknowledged issues block approval (422); stale
expected revisions return 409. Foreign/missing resources share 404 behavior.

Wording origin (`reviewed_profile`, `user_edited`, `ai_accepted`) is separate from
unchanged profile-fact provenance. Original reviewed text, proposal text and review
issues remain available. Keep original/Restore use the pinned profile value, not
model output or JD claims. User review never means independent verification, and
issue acknowledgement cannot promote a P6 requirement or substantiate a gap.

## Final verification

| Command / check                                                                                                                                                                 | Actual result                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm db:test:up`                                                                                                                                                               | PASS; isolated temporary PostgreSQL on 5433           |
| `pnpm db:test:migrate`                                                                                                                                                          | PASS; nine existing migrations applied to isolated DB |
| `pnpm --filter @ai-job-hunter/api test --testPathPatterns='tailored-draft\|source-profile\|tailored-cv'`                                                                        | PASS; 4 suites, 77 tests                              |
| `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='tailored-draft\|tailored-cv\|source-profile-review'`                                                     | PASS; 3 suites, 34 tests                              |
| `pnpm --filter @ai-job-hunter/web exec vitest run test/tailored-cv-review.test.tsx test/job-improve-cv.test.tsx test/source-cv-review.test.tsx test/unsaved-job-guard.test.tsx` | PASS; 4 files, 25 tests                               |
| API and web `typecheck`                                                                                                                                                         | PASS                                                  |
| API and web `build`                                                                                                                                                             | PASS; web reports a >500 kB bundle warning            |
| Scoped Prettier, ESLint `--max-warnings 0`, whitespace checks                                                                                                                   | PASS; all 17 checkpoint files, zero lint warnings     |

Unit coverage includes explicit/revisited decisions, manual provenance, exact
restoration, approval prerequisites/invalidation, unsupported references, strict
requests and input bounds. PostgreSQL tests cover ownership, local origin guards,
unchanged pins/evidence/assessments, persistence from a new connection, concurrent
saves, stale revisions, historical job snapshots and failure rollback. Existing
P8 generation/source review/retention tests remain in the focused suites.
Frontend tests cover Accept/Keep original/reconsider, edits, Save/Approve/reload,
conflict retention, keyboard activation, focused Stay/Discard navigation, unmount
response suppression, generation timestamps and no persistent browser storage.

An earlier frontend command with `--` unintentionally ran the full web suite:
35 files / 393 tests passed, 2 files / 7 tests skipped, before final scoped edits.
The final focused results above are the acceptance results. An existing P8.3
assertion failed when a random match UUID contained `500`; it now checks accepted
and proposed wording directly, preserving the fabricated-number safety assertion
without searching unrelated identifiers. Initial browser mock setup returned an
invalid Inbox response; it was corrected before the scoped Job Detail smoke.

## Chromium smoke

Playwright MCP drove the real Job Detail/Improve CV components with intercepted
synthetic API responses. All `/api/**` requests were intercepted; no development
API/database or Ollama call was made. PostgreSQL API behavior was independently
covered by the integration suite.

- Desktop **1440×900**: PASS. Open saved draft, inspect all ten section headings,
  keyboard Enter on Accept, acknowledge issue, Save, Approve, reload revision 3,
  edit, switch tabs, attempt navigation, Stay and retain text. Stay received focus.
- Mobile **390×844**: PASS. Retained edit, Save, evidence disclosure and Restore;
  restored source wording exactly. Document width 390 px, matching viewport.
  Representative editing action was 44 px tall and within viewport boundaries.
- **200% CSS zoom at 1440×900**: PASS reflow. Document width 1440 px; Save and
  Approve remained present and the approval action stayed inside the viewport.
- Keyboard Tab reached the source-evidence disclosure with `:focus-visible` and a
  visible browser outline. Decision reconsideration was rechecked after its change.
- No console errors or page exceptions during the final scoped pass.

The guarded test database had zero saved CVs, source revisions, profile revisions,
drafts and jobs after fixture cleanup. Test PostgreSQL and the temporary Vite
server were stopped after verification. No development service was modified.

## Limits and deferred work

Editing targets existing structured fields. Add/restructure source facts through
Source CV Review and generate a separate draft; blank sections are explicit.
No rich-text editor, draft history UI, semantic entailment checker, AI rerun,
DOCX/PDF export or P8.5 work is included. Approval is revisioned current state,
not an append-only audit ledger. Review metadata uses existing document budgets;
oversized saves fail without truncation or replacing the saved draft. Historical
drafts remain editable against their immutable pins and show stale job context.
The complete pre-PR workspace CI gate and migration revert/reapply cycle were not
run: no commit/PR or migration change is part of this checkpoint.

## Exact checkpoint files

- `README.md`
- `docs/architecture.md`
- `docs/audits/p84-tailored-cv-review-acceptance.md`
- `apps/api/src/tailored-cv/tailored-cv.controller.ts`
- `apps/api/src/tailored-cv/tailored-draft.contract.ts`
- `apps/api/src/tailored-cv/tailored-draft.service.ts`
- `apps/api/src/tailored-cv/tailored-draft-review.policy.ts`
- `apps/api/test/unit/tailored-draft-review.spec.ts`
- `apps/api/test/unit/tailored-draft.spec.ts`
- `apps/api/test/integration/tailored-draft.spec.ts`
- `apps/web/src/features/inbox/CvMatchPanel.tsx`
- `apps/web/src/features/inbox/JobEditor.tsx`
- `apps/web/src/features/inbox/UnsavedJobGuard.tsx`
- `apps/web/src/features/inbox/TailoredCvReview.tsx`
- `apps/web/src/features/inbox/tailored-cv.contract.ts`
- `apps/web/test/fixtures/tailored-cv.ts`
- `apps/web/test/tailored-cv-review.test.tsx`
