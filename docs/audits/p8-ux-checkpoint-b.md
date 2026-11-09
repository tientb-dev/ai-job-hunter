# P8 UX Checkpoint B — Match reuse and smart wizard navigation

## Change

Before: the views kept independent React results, only a match ID crossed routes,
and the wizard always started with Source CV. Opening a draft did not distinguish
approved preview from review. Long review content separated users from save and
approval controls.

After: both views read the same current server match. Navigation performs reads,
never implicit analysis. P8 readiness chooses the first useful step; explicit
step navigation is retained thereafter. Resume opens the draft directly, with
approved revisions opening preview. An expired/missing match does not block draft
access. The MUI Stepper exposes current/completed/action-required/unavailable
state, keyboard navigation and linked panels. Save/approval controls are above the
review; separate generation and history collapse after resume.

## Files changed in B

Pre-existing uncommitted P8 work is preserved. These paths contain this
checkpoint's edits; no commits, pushes or PRs were made.

- `apps/api/src/matching/match-context.ts`: read current snapshot and lifetime,
  retaining ownership, revision, expiry, replacement and capacity rules.
- `apps/api/src/matching/job-match.service.ts`: return current assessment without
  inference or private owner metadata.
- `apps/api/src/opportunities/opportunities.controller.ts`: no-store GET endpoint
  with UUID validation.
- `apps/api/test/unit/match-context.spec.ts`
- `apps/api/test/unit/job-match.regression.spec.ts`
- `apps/api/test/unit/cv-suggestions.spec.ts`: snapshot, service and HTTP regression
  checks, including isolation, changed revisions, expiry and no inference on read.
- `apps/web/src/features/inbox/CvMatchPanel.tsx`: shared match loading, smart entry,
  MUI Stepper, specific blockers and one read retry for replaced context.
- `apps/web/src/features/inbox/TailoredCvReview.tsx`: resume by approval state,
  identity-aware readiness callback and compact review actions.
- `apps/web/test/match-reuse-navigation.test.tsx`: entry/reuse/resume, replacement
  races, browser back/unload guards, manual selection and malformed reads.
- `apps/web/test/p8-generation-readiness.test.tsx`
- `apps/web/test/tailored-cv-wizard.test.tsx`: update prior coverage for GET state
  and MUI Stepper semantics.
- `apps/web/test/cv-match.test.tsx`: identify analysis progress specifically now
  that the view also reports reusable-match status.
- `apps/web/test/cv-suggestions.test.tsx`: CV replacement now offers Reanalyze.
- `docs/architecture.md`
- `docs/audits/p8-ux-checkpoint-b.md`: this report.

## Verification

PASS — targeted frontend tests, 9 files / 117 tests:

```sh
pnpm --filter @ai-job-hunter/web exec vitest run test/match-reuse-navigation.test.tsx test/p8-generation-readiness.test.tsx test/tailored-cv-wizard.test.tsx test/tailored-cv-review.test.tsx test/tailored-cv-readiness.test.tsx test/source-cv-review.test.tsx test/cv-match.test.tsx test/cv-match.proficiency.test.tsx test/cv-suggestions.test.tsx
```

PASS — targeted backend tests, 3 files / 78 tests, including HTTP boundary tests
with synthetic repositories; no PostgreSQL or live AI:

```sh
pnpm --filter @ai-job-hunter/api test:compile
pnpm --filter @ai-job-hunter/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.js --runInBand --runTestsByPath .test-dist/test/unit/match-context.spec.js .test-dist/test/unit/job-match.regression.spec.js .test-dist/test/unit/cv-suggestions.spec.js
```

PASS — relevant typechecks and scoped lint/format/whitespace:

```sh
pnpm --filter @ai-job-hunter/web typecheck
pnpm --filter @ai-job-hunter/api typecheck
pnpm exec eslint apps/web/src/features/inbox/{CvMatchPanel,TailoredCvReview}.tsx apps/web/test/{match-reuse-navigation,p8-generation-readiness,tailored-cv-wizard,cv-match,cv-suggestions}.test.tsx apps/api/src/matching/{match-context,job-match.service}.ts apps/api/src/opportunities/opportunities.controller.ts apps/api/test/unit/{match-context,job-match.regression,cv-suggestions}.spec.ts --max-warnings 0
pnpm exec prettier --check apps/web/src/features/inbox/{CvMatchPanel,TailoredCvReview}.tsx apps/web/test/{match-reuse-navigation,p8-generation-readiness,tailored-cv-wizard,cv-match,cv-suggestions}.test.tsx apps/api/src/matching/{match-context,job-match.service}.ts apps/api/src/opportunities/opportunities.controller.ts apps/api/test/unit/{match-context,job-match.regression,cv-suggestions}.spec.ts docs/architecture.md docs/audits/p8-ux-checkpoint-b.md
 git diff --check
```

PASS — one scoped Playwright MCP Chromium smoke using intercepted synthetic API
responses and the actual Job Detail/wizard routes on temporary port 5175:

- Analyze in Job Detail → open wizard → Step 3, still one analysis.
- Explicit reanalysis in wizard → browser back → Job Detail reuses it, still two
  analyses total; navigation itself runs none.
- Expired match → Step 2 with expiry reason → resume draft → review without AI.
- Editing → Back link guard → Enter on Stay retains edits.
- Stepper arrow/Enter navigation and heading focus; tab/panel associations.
- Unapproved PDF download remains disabled with instructions.
- 390px mobile and 200% CSS zoom at 1280px: no settled horizontal overflow after
  fixing horizontal Stepper shrink/wrapping. No browser console/page errors.

The browser smoke found Stepper zoom overflow, which was fixed and rechecked only
for the affected responsive/keyboard scenarios. Earlier focused test failures
from obsolete roles/request fixtures and ambiguous status queries were corrected;
all listed results refer to the final scoped checks. Full frontend/backend,
PostgreSQL and pre-PR CI suites were not run for this checkpoint.

## Limits and risks

- Matches remain bounded, process-local and valid for at most 15 minutes. Server
  restart/eviction loses them. Missing state cannot distinguish a previously
  pruned expiry from never-analyzed or restarted state.
- A browser reload reuses a match only if the server still holds valid context.
  Session storage is no longer a match authority. Source profiles/drafts retain
  their existing database persistence.
- Browser acceptance used synthetic API responses, not live PostgreSQL/Ollama.
  The new endpoint was separately exercised through Nest HTTP unit tests.
- Zoom was checked through CSS zoom, not the native browser zoom control.
- No schema, dependencies, AI prompts, extraction, PDF/DOCX rendering or draft
  approval policy changed. Checkpoint C and the full pre-PR gate remain future
  work requiring their own approval.
