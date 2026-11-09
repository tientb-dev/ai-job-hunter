# P8 acceptance blockers: organizing and experience attribution

Synthetic-only diagnosis and acceptance, 2026-11-06. No private saved CV, JD or
development database was accessed. Findings below identify the observed error
class through an actual qwen3:4b reproduction; they do not claim access to the
private user's failed request or persisted legacy document.

## Diagnosis before product edits

A 3,031-character synthetic CV with 83 passages reproduced
`CV_PROFILE_INVALID_OUTPUT` after **35,949 ms**. Its real model response had 70
rows and classified combined-contact passage **p3 four times**: email, phone,
location and link. JSON, kinds and fields were valid; duplicate-ID validation in
`source-profile-proposal.ts:assembleProposal` correctly rejected it. Artifacts:
`artifacts/p8-blockers/before-{diagnosis.json,model-output.txt,structure.json}`
and `synthetic-source.txt`. The output contains synthetic data only.

The previous application schema allowed at most 96 output rows, but did not
express ID uniqueness. A single model call requested every passage. The provider
used the existing 8,192-token context, 6,080 prompt-token ceiling, 2,048 initial /
up-to-4,096 output-token allocation and 1-MiB response cap. The proposal had source
12,000-character / 49,152-byte, 96-passage, 4,000-character fact, 64-KiB prompt and
96-KiB document limits. **The reproduced failure was duplicate IDs, not a size or
context error.** Above-96-passage documents separately failed the old proposal
budget, regardless of whether they fit the persisted profile contract.

Pipeline responsibilities:

| Stage               | Exact cause / responsible code                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request and pinning | `tailored-cv.controller.ts:rebuild` delegates to `TailoredCvService.propose(..., true)`. `load` checks owner, expected latest revision, captured source identity, saved CV timestamp/text/filename before AI and again under the append lock.                                                                                                            |
| Model input/output  | `source-profile-proposal.ts:generate` previously supplied one combined contact passage and the complete passage set in one call. qwen reasonably attempted multiple fields for one ID, violating the application's strict contract.                                                                                                                      |
| Runtime rejection   | `assembleProposal` rejects duplicate, unknown and heading IDs before reconstruction. `SourceProfileError` plus `tailored-cv.http.ts:foundationError` maps this to sanitized 502 / CV_PROFILE_INVALID_OUTPUT. This validation remains strict.                                                                                                             |
| Grouping            | `source-profile-structure.ts:segmentSource` recognized WORK EXPERIENCE already. The defect was that nested Projects and Technology Stack were treated as global headings, switching subsequent content to projects/skills. Explicit work experience alone did not protect nested content.                                                                |
| Headline/contact    | The previous profession vocabulary missed SOFTWARE DEVELOPMENT; the unsplit contact line had no separate evidence-bearing fields. A model-selected name/location could therefore cover the wrong whole passage.                                                                                                                                          |
| UI                  | Legacy source-review data remains displayed on rebuild failure because there is no save until successful generation/validation. Edit/Confirm were disabled by `legacy`; generic retry/manual-review text recommended unavailable actions. The read-only renderer also hid every project fact whenever a record had any title, including employer titles. |

The synthetic legacy profile intentionally placed work history in additional.
Failure left it there unchanged. Separately, a successful deterministic proposal
using the old reconstruction produced **19 fragmented sections**: experience
mostly held employer/role/dates while nested project/stack headings diverted the
rest. Thus legacy data explains persistent Other information after failure, but
old reconstruction could still misgroup content after success. The user's exact
private document state remains uninspected.

## Changes and before/after structure

- Strong contact tokens split before AI, including separator-delimited or plain
  one-line phone/email/URL combinations. Every value is an exact substring;
  separators and whitespace stay covered by exact evidence. Unclear text remains
  flagged, not guessed. Name and professional headline remain distinct.
- Serial batches: at most 12 global passage IDs and 6,500 serialized passage
  bytes, one 90-second deadline, strict batch/aggregate validation. The passage
  processing ceiling is 240; existing fact/document/source evidence limits remain.
- WORK EXPERIENCE owns nested project names, stacks, local labels and bullets.
  Records preserve employer, role, dates and order. Detached ambiguous projects
  start an unattributed record requiring clarification. Clear repeated employer
  record text can be section-reviewed with exact offsets; ambiguous repetitions
  still require individual attention.
- Corrected structure format is version 3 inside the existing version-1 API
  document. Earlier version 2 / unmarked profiles are not silently modified.
- Legacy reviews have one primary **Organize my CV** action and a collapsed
  previous-review preview. Organization explicitly creates a new pending review,
  preserving corrections and drafts. Failures retain the previous revision and
  offer retry/reload. After success editing is enabled; confirmation blockers
  explain which highlighted details need attention. Nested project names are
  visible in employer cards.

| Content                                  | Before                                                    | After                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Name / SOFTWARE DEVELOPMENT headline     | Model-dependent name/headline split                       | Separate exact source name/headline fields                                                                |
| Combined location, phone, email, URL     | One ID; real model returned it four times, rejected       | Four distinct spans/IDs; no duplicate accommodation                                                       |
| Three employers and nine nested projects | 19 fragmented sections; projects/stacks escape experience | One experience section with three employer records, all nine project names/stacks/bullets in source order |
| Skill categories                         | Could absorb work-history technology labels               | Separate Technical Skills categories; work technology labels stay with their employer                     |
| Legacy additional record                 | Disabled form and unclear invalid-proposal recovery       | Organize primary action; old review preserved; new structured review after success                        |

The five-employer fixture exceeds 96 passages and validates within the unchanged
profile bounds. Exact after profiles and model batches are saved under
`artifacts/p8-blockers/`. No factual wording is generated or accepted from AI.

## Results

- PASS: `pnpm -r --workspace-concurrency=1 run test` — 2,192 backend unit tests (99 suites), 401 web tests (35 suites); 7 existing web skips in 2 suites. Exact CI workspace command, no worker overrides.
- PASS: `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='source-profile-review|tailored-cv|tailored-draft'` — 40 tests / 3 suites, including ownership, stale sources, conflicts, legacy/draft immutability, malformed second-batch rollback and transport failure rollback/retry.
- PASS: focused API reconstruction/contract checks (55 tests) and source-review frontend checks (16 tests); these are also included in the full unit run.
- PASS: `pnpm typecheck`, `pnpm build`; existing Vite chunk-size advisory remains.
- PASS: scoped `pnpm exec prettier --check <changed files>`, `pnpm exec eslint <changed TS/TSX/MJS> --max-warnings 0` and `git diff --check`.
- No migration or dependency changed. PostgreSQL checks used the existing guarded test database at port 5433. Test fixture rows were verified absent afterward and the test container was stopped. This checkpoint did not run the full Pre-PR gate or migration revert/reapply cycle; no commit/PR is requested.

Actual qwen3:4b through the existing capture/proposal APIs:

| Fixture                                                                             | Latency   | Source facts | Unresolved | Clarifications      | Result |
| ----------------------------------------------------------------------------------- | --------- | ------------ | ---------- | ------------------- | ------ |
| Three employers, nine nested projects, combined contact, skills, academic qualifier | 36,582 ms | 86           | 0          | 1 (unlabelled name) | PASS   |
| Ambiguous employer plus prompt injection                                            | 3,331 ms  | 8            | 1          | 2                   | PASS   |

All persisted proposal values remain exact source substrings with exact evidence
and complete coverage; no facts are confirmed before user review. A further live
browser rebuild of the legacy fixture also succeeded. The recorded calls total
15 serial batches (initial proposals plus browser rebuild), at most 12 IDs each.
Existing legacy document equality was asserted before test cleanup. Synthetic
model batches, full profiles and results are in `artifacts/p8-blockers/`.

Chromium PASS: desktop 1440×900, mobile 390×844 and CSS 200% zoom. Verified one
legacy primary organize action, no disabled legacy Edit/Confirm wall, real legacy
rebuild, three employer cards and visible nested project names, separate contact
fields, enabled editing, issue-field focus, keyboard confirmation, all six section
confirmations, Save, Continue focus, saved review reopening, evidence disclosure
keyboard access, unsaved navigation/Stay focus and retained edits. Mobile page
scrollWidth = 390 and zoom scrollWidth = 1440; no horizontal page overflow or
page/console errors during service-backed smoke. A selector retry distinguished
the main name text from its hidden evidence quote; it was not a product failure.
Malformed/transport failures were tested through unit/integration mocks, and the
frontend retry test covers a forced invalid-proposal response; browser success
used actual local Ollama/API, without API mocks.

Reproduce after building, compiling tests and applying test migrations, from
`apps/api`: `node --env-file=../../.env.test ../../docs/audits/p8-blockers.probe.mjs`.
`P8_BLOCKERS_BROWSER=1` temporarily serves the built frontend on port 3001; SIGTERM
after browser checks verifies historical equality and cleans only owned synthetic
fixtures. The probe refuses an occupied test database. Screenshots and browser
assertions are in the same dedicated artifact directory.

## Remaining limitations

- This is synthetic acceptance, not validation of the private saved CV.
- Name/headline detection cannot cover every possible title; unsupported labels
  and unclear contact remnants remain user-reviewable.
- Bare Projects after a blank boundary can mean independent work or employment
  subprojects. It is flagged without automatically inheriting an employer.
  Explicit Personal Projects / Independent Projects is a top-level boundary.
- Exact source offsets establish occurrence, not independent truth. Section
  confirmation records the user's review. Academic use, team contribution and
  unfinished qualifications retain their source wording and qualifiers.
- Source/fact/JSONB limits still apply. Oversized passages or a slow sequence can
  fail with actionable context-limit/timeout errors. Nothing is truncated; saved
  revisions remain unchanged. Repeated malformed model output can still require
  retry; validation is not bypassed.
- Previously damaged PDF text ordering or missing text needs source replacement
  or an explicit user correction; the parser was not changed.
- Earlier user corrections are accessible in history and must be consciously
  reapplied; old drafts remain pinned to their historical revisions.

## Exact files changed

- `README.md`
- `apps/api/src/tailored-cv/source-profile-proposal.ts`
- `apps/api/src/tailored-cv/source-profile-structure.ts`
- `apps/api/src/tailored-cv/tailored-cv.contract.ts`
- `apps/api/test/integration/source-profile-review.spec.ts`
- `apps/api/test/support/long-source-structure-fixture.ts`
- `apps/api/test/unit/source-profile-proposal.spec.ts`
- `apps/api/test/unit/source-profile-structure.spec.ts`
- `apps/web/src/features/inbox/SourceCvReview.tsx`
- `apps/web/src/features/inbox/source-cv-review.contract.ts`
- `apps/web/test/fixtures/source-cv-review.ts`
- `apps/web/test/fixtures/structured-source-review.ts`
- `apps/web/test/source-cv-review.test.tsx`
- `docs/architecture.md`
- `docs/audits/p8-blockers-acceptance.md`
- `docs/audits/p8-blockers.probe.mjs`

Synthetic artifacts:

- `artifacts/p8-blockers/after-deterministic.json`
- `artifacts/p8-blockers/after-model-batches.json`
- `artifacts/p8-blockers/ambiguous-injection-profile.json`
- `artifacts/p8-blockers/ambiguous-injection-source.txt`
- `artifacts/p8-blockers/before-diagnosis.json`
- `artifacts/p8-blockers/before-model-output.txt`
- `artifacts/p8-blockers/before-structure.json`
- `artifacts/p8-blockers/legacy-desktop.png`
- `artifacts/p8-blockers/live-results.json`
- `artifacts/p8-blockers/review-desktop.png`
- `artifacts/p8-blockers/review-mobile.png`
- `artifacts/p8-blockers/review-zoom.png`
- `artifacts/p8-blockers/structured-profile.json`
- `artifacts/p8-blockers/structured-source.txt`
- `artifacts/p8-blockers/synthetic-source.txt`
- `artifacts/p8-blockers/browser-results.json`

No dependencies, migrations, new infrastructure, commits, pushes or PRs.
Unrelated artifacts, local skills and development services/data were preserved.
Stop for review.
