# P8 generation workflow acceptance

Synthetic-only diagnosis and acceptance. No private CV/JD or development data was
accessed. Diagnostic artifacts contain booleans, reason codes, timings and opaque
revision IDs only. This report identifies a reproduced application defect; it
does not assume that the private user's browser clock was wrong.

## Root cause and before-fix reproduction

A before-fix frontend regression reproduced all visible prerequisites: a saved
CV, six confirmed source sections, zero details needing attention, zero unresolved
passages, a newly completed matching analysis, and enabled Continue. Generate
remained disabled with the browser clock 16 minutes ahead of the API timestamp.
The regression was run before changing behavior and initially asserted the
incorrect disabled state. It now asserts generation is enabled independently of
P7 rejection. The live final browser journey repeats the clock-skew condition
with actual local qwen3:4b and a real persisted draft.

The precise defective path was in `CvMatchPanel.tsx`:

```tsx
matchId={!contextRejected && result?.matchId ? result.matchId : undefined}
```

P8 therefore treated P7's rejection as absence of a matching analysis. The same
`contextRejected` state was controlled by:

- `analyze()` during a new matching request and after success;
- P7 stale/mismatched suggestions through `onInvalidContext`;
- a timer calculated as `analyzedAt + 15 minutes - Date.now()` in the browser.

Backend `MatchContexts`, in contrast, uses monotonic `performance.now()` for its
15-minute TTL. A client/API wall-clock skew can make a fresh backend context look
immediately expired to the browser. A valid P6 analysis can thus remain displayed
while its ID is withheld from P8. P8 had no independent authoritative readiness
check or reason explaining the missing ID. This is an application dependency
error, not user error. The exact private-session trigger remains uninspected;
other hidden local blockers are now surfaced rather than guessed.

Tab switching alone does not discard the component: `JobEditor.tsx` keeps one
`CvMatchPanel` keyed by job ID and hides/shows its Match/Improve panels. Job/form
revision changes invalidate matching state; changing only the selected tab does
not. Source review taking time, server restart, replacement by another analysis,
or clock skew can expose the invalid coupling on return to Improve CV.

Two separate feedback defects compounded this:

- Continue only scrolled/focused the Tailored CV heading, without checking or
  announcing readiness or providing a visible next step.
- `TailoredCvReview.list()` only stored items/cursor. Empty results produced no
  message, and nonempty items were placed inside a closed disclosure.

## Complete predicate trace

| Layer                  | Before                                                                                                                 | Implemented behavior                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Job Detail             | `savedJobUpdatedAt` from saved job; form/revision changes clear Match                                                  | Preserved; readiness validates the exact saved timestamp and explains stale metadata |
| Parent local guard     | Match busy, suggestions busy, review busy/dirty, or job dirty disables P8                                              | Preserved with a specific reason: wait, save Source Review, or save Edit JD          |
| Draft local guard      | Busy or unsaved draft operations                                                                                       | Preserved, with save/discard feedback                                                |
| Generate inputs        | Nonempty CV, match ID and job revision; profile fetched only after click                                               | Metadata plus explicit, independently tested server readiness/pins                   |
| P7 coupling            | Rejection erased the P8 match ID                                                                                       | Removed; P7 timer/suggestion shape does not govern P8 eligibility                    |
| Backend source/profile | Owner, latest profile, expected revision, source hash/text/filename/timestamp, exact evidence and reviewed eligibility | The same `TailoredDraftService.context` checks now serve preflight and generation    |
| Backend job/match      | Saved job revision, canonical requirement identity, owner/job/CV identity, live monotonic context                      | Unchanged; readiness reports current validity and remaining lifetime                 |
| Persistence            | Generation rechecks inputs before save and creates a separate draft                                                    | Unchanged; preflight cannot reserve or bypass these checks                           |

## API and UI behavior

New bounded POST `/api/v1/tailored-cv/jobs/:id/drafts/readiness`:

```json
{
  "contractVersion": "1",
  "expectedJobUpdatedAt": "2026-01-01T00:00:00.000Z",
  "expectedSavedCvUpdatedAt": "2026-01-01T00:00:00.000Z",
  "matchId": null
}
```

CV timestamp and match ID may be null. Existing version/exact-key/UUID/date
validation, local Host/Origin guard, owner scoping and no-store responses apply.
The response has `ready`, `reason`, `pins` and `matchValidForMs`. Ready pins contain
source/profile revision IDs, expected profile revision, expected job timestamp
and match ID; no CV/JD text is returned. Not-ready responses return no pins and
an explicit reason. Missing source/profile, incomplete review, stale CV/job/
profile/match, absent job requirements and existing draft-budget bounds have
separate recovery messages. Preflight runs no AI and writes no source, profile or
draft. Generation remains authoritative and can still reject a race.

P8 checks on Improve CV entry, fresh match, source-review save, Continue, window
focus and the backend-provided expiry. Its timer uses remaining monotonic lifetime,
not browser/API wall-clock comparison. A cancellation guard ignores late
responses from a prior job/CV/match. Readiness is modeled/tested separately in
`tailored-cv-readiness.ts`.

Refresh CV Match runs the existing P6 path in place and automatically updates
readiness. Refresh failure is visible in Tailored CV instead of only in the hidden
Match panel. No upload or repeated review is required for unchanged saved sources.
Stale saved CV/job metadata offers Reload job; an incomplete profile offers Go to
Source CV Review. Continue now focuses Tailored CV, triggers preflight and shows
an announced next-step message. Load saved drafts reports empty/nonempty results
and opens the list. Reopening historical drafts does not require a CV or match.

## Validation

- PASS before fix: `pnpm --filter @ai-job-hunter/web test test/p8-generation-readiness.test.tsx` reproduced the incorrect disabled state with six reviewed sections and a fresh analysis under controlled clock skew. Sanitized control state is in `artifacts/p8-workflow/before-diagnosis.json`.
- PASS after fix: focused readiness/review tests cover P7 clock rejection, in-place expiry recovery, tab navigation, empty-list feedback, invalid pins/reasons, local blockers and late readiness responses. The focused three-file run passed 10 tests before the late-response case was added; all 11 are included in the final full run below.
- PASS: exact CI command `pnpm -r --workspace-concurrency=1 run test` — **2,200 backend tests (99 suites), 407 frontend tests (37 suites)**. Seven existing web tests in two suites remain skipped. No worker overrides.
- PASS: `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='source-profile-review|tailored-cv|tailored-draft'` — **42 tests / 3 suites**. Readiness verifies owner isolation, exact pins, no-store, invalid Host/Origin, strict body keys, replaced context, stale job timestamp, and unchanged reviewed profile/draft count. Existing suites cover stale inputs, concurrency, restart durability, grounding and rollback.
- PASS: `pnpm typecheck`, `pnpm build`, scoped `pnpm exec prettier --check <changed files>`, scoped `pnpm exec eslint <changed TS/TSX/MJS> --max-warnings 0`, and `git diff --check`. Existing Vite large-chunk advisory remains.
- The final full suite ran after the readiness cancellation guard was simplified for lint. Backend checks were rerun on the unchanged final backend code; subsequent changes are comments, documentation and browser-harness recording only.

### Actual qwen3:4b browser journey

`p8-workflow.probe.mjs` refuses an occupied, non-isolated database and serves a
separate test API/built frontend at port 3001 against guarded test PostgreSQL at 5433. It seeds a synthetic saved CV and a **pending**, exactly grounded six-section
proposal. Browser actions, not a preconfirmed fixture, confirm all six sections
and save profile revision 3. P6 matching and P8 generation use the actual Ollama
provider, with configuration asserted as qwen3:4b. No API responses were mocked.

The reusable test in `p8-workflow.browser.mjs` ran through Playwright MCP. Its
function body was adapted to MCP's VM (assertion/result sinks supplied by the
orchestrator, since VM dynamic Node module import is unavailable). A harness-only
report property typo was corrected; the complete final journey then passed.
There is no new Playwright dependency or product test-control endpoint.

| Acceptance criterion                                               | Actual result                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completed Source Review + fresh matching analysis enables Generate | PASS: six sections confirmed/saved, then actual P6 analysis; Generate enabled despite a controlled 960,000-ms client clock skew and P7 rejection                          |
| Generation persists a draft                                        | PASS: POST succeeded; draft row `3c88ffec-55cb-4b2c-9329-47983510ff54`, reviewed profile pin `2f30b8a3-5df4-4a0e-b39f-1a28e55aceef`; HTTP generation latency **2,980 ms** |
| Match ↔ Improve navigation                                         | PASS before generation and again after loading the saved draft                                                                                                            |
| Expired/mismatched context recovery                                | PASS: a real second P6 analysis replaced the UI's snapshot; readiness showed stale-match recovery; in-place Refresh used real P6 AI and automatically re-enabled Generate |
| No repeated source review/upload                                   | PASS: source review completed once; refresh used the same saved CV and profile                                                                                            |
| Existing drafts accessible                                         | PASS: Load displayed a count, opened the list and reopened the persisted draft; empty-list feedback is separately tested                                                  |
| Continue                                                           | PASS: heading focus and announced next step, with a fresh readiness check                                                                                                 |
| Desktop/mobile/zoom                                                | PASS at 1440×900, 390×844 and CSS 200% zoom; scrollWidth 390/390 and 1440/1440; no page/console errors                                                                    |

Exact 15-minute expiry is exercised by the monotonic cache unit test; frontend
expiry behavior is tested with a stale readiness response. The live browser uses
real **replacement/mismatch**, not a simulated fifteen-minute wait. No claim is
made of waiting for real TTL expiry.

Provider timings in the final run: initial match 990 ms, three draft calls
993/894/957 ms, replacement match 1,022 ms, in-place refresh match 973 ms. HTTP draft
latency includes validation/persistence overhead. The server probe verified the
persisted draft, exact accepted source wording and unchanged historical pending
profile before cleanup. Diagnostics contain only IDs, booleans, timings and reason
codes; no CV/JD text was logged or written into diagnostic JSON.

All five test domain tables were verified empty after owned fixtures were removed;
the isolated service and PostgreSQL test container were stopped. Development
services/data and unrelated artifacts were preserved. Screenshots and sanitized
results are listed below.

To reproduce, build/compile tests and start/migrate the existing guarded test DB,
then from `apps/api` run:
`P8_WORKFLOW_BROWSER=1 node --env-file=../../.env.test ../../docs/audits/p8-workflow.probe.mjs`.
Run the exported browser test with Playwright MCP against its printed synthetic
URL, then SIGTERM the probe to verify persistence/history and remove its fixtures.
The source proposal is seeded pending to isolate workflow readiness; source AI
classification is not part of this acceptance. Matching and draft AI are live.

## Remaining limitations

- The private session was not inspected; its specific clock or rejection trigger
  is not claimed. The opaque P7 dependency was reproduced and eliminated for P8.
- P6 match contexts remain in memory with the existing 15-minute TTL and capacity.
  Restart/replacement/expiry requires Refresh, not a source re-upload/review.
- P7 retains its existing suggestion clock/timer behavior. P8 no longer inherits
  it; this checkpoint does not redesign P7.
- Existing source/profile/fact/context budgets remain authoritative. A completed
  profile above the existing draft budget receives an explicit budget reason;
  no bound or grounding rule was weakened.
- Eligibility does not guarantee local AI availability or valid generation output.
  Existing typed generation failures preserve prior drafts and reviewed sources.
- UI readiness is advisory. Concurrent edits or expiry after preflight can still
  fail generation safely; the failed request rechecks readiness for recovery.
- No new migration or dependency. No full Pre-PR gate or migration lifecycle run
  was required for this development checkpoint; no commit/PR was requested.

## Exact files changed

- `README.md`
- `apps/api/src/matching/job-match.service.ts`
- `apps/api/src/matching/match-context.ts`
- `apps/api/src/tailored-cv/tailored-cv.controller.ts`
- `apps/api/src/tailored-cv/tailored-draft.service.ts`
- `apps/api/test/integration/tailored-draft.spec.ts`
- `apps/api/test/support/p8-workflow-fixture.ts`
- `apps/api/test/unit/match-context.spec.ts`
- `apps/web/src/features/inbox/CvMatchPanel.tsx`
- `apps/web/src/features/inbox/SourceCvReview.tsx`
- `apps/web/src/features/inbox/TailoredCvReview.tsx`
- `apps/web/src/features/inbox/tailored-cv-readiness.ts`
- `apps/web/test/p8-generation-readiness.test.tsx`
- `apps/web/test/tailored-cv-readiness.test.tsx`
- `apps/web/test/tailored-cv-review.test.tsx`
- `docs/architecture.md`
- `docs/audits/p8-workflow-acceptance.md`
- `docs/audits/p8-workflow.browser.mjs`
- `docs/audits/p8-workflow.probe.mjs`

Synthetic/sanitized artifacts:

- `artifacts/p8-workflow/before-diagnosis.json`
- `artifacts/p8-workflow/browser-results.json`
- `artifacts/p8-workflow/live-results.json`
- `artifacts/p8-workflow/review-desktop.png`
- `artifacts/p8-workflow/review-mobile.png`
- `artifacts/p8-workflow/review-zoom.png`

All fixtures/screenshots are synthetic. Test data/services were isolated and
cleaned up. No commits, pushes or PRs. Stop for review.
