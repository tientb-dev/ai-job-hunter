# P8 UX Checkpoint C — review and export polish

## User-visible changes

Before: proposal choices remained active after a decision, comparisons were plain
text, review status was scattered, and default-included facts could disappear
from content preview. Skills categories looked like values; reviewed Experience
headline fields did not receive role styling.

After:

- Original and AI suggestion appear side by side on desktop and stack on mobile.
  Exact token differences are struck through/underlined; neither string nor
  evidence changes. Pending, Accepted and Kept original are explicit. Decided
  proposals show Change decision instead of active Accept/Keep controls. Manual
  edits are distinguished from a kept-original decision.
- Keep all original wording requires confirmation and queues pending rejections
  only. No bulk accept, autosave, implicit issue acknowledgement or approval.
  Cancel is available; completed confirmation focuses Save.
- Summary shows pending count, saved/unsaved state, approval and the next-action
  sequence. Inclusion is labelled optional and remains independent of wording.
- Preview assembled CV works before approval, including local changes and default
  inclusion. Export still requires the saved approved revision. A/B smart entry,
  manual step selection, resume, match reuse and navigation guards remain intact.
- Every Experience role is tested bold, including reviewed headline fields.
  Skills categories are bold, separated from normally weighted values. DOCX
  anchor grouping and PDF page-break measurement are consistent with the simple
  single-column template. Stakeholder Communication stays together via layout
  whitespace, without changing accepted facts.

## Changed files

Existing unrelated and previous-checkpoint changes were preserved.

- `apps/web/src/features/inbox/TailoredCvReview.tsx`: decision integration, bulk
  confirmation, summary, preview and focus handling.
- `apps/web/src/features/inbox/ProposalComparison.tsx`: exact-text diff and
  explicit decision/change controls.
- `apps/web/src/features/inbox/TailoredCvPreview.tsx`: shared included-content
  preview with canonical section ordering.
- `apps/web/test/tailored-cv-review.test.tsx`: transitions, safe bulk behavior,
  inclusion, preview and save/approval checks.
- `apps/web/test/proposal-comparison.test.tsx`: exact Unicode additions/deletions.
- `apps/api/src/tailored-cv/tailored-cv-export.ts`: anchor/category presentation,
  nonbreaking phrase and pagination handling.
- `apps/api/test/support/cv-polish-fixture.ts`: synthetic three-role/long-skills CV.
- `apps/api/test/unit/cv-export.spec.ts`: DOCX/PDF style, text, fonts and geometry.
- `docs/architecture.md` and this report.
- `artifacts/p8-c/`: generated synthetic DOCX/PDF, two PDF page images and
  `verification.json` evidence. No private CV or production data.

## Verification

PASS — 5 targeted frontend files, 35 tests:

```sh
pnpm --filter @ai-job-hunter/web exec vitest run test/tailored-cv-review.test.tsx test/proposal-comparison.test.tsx test/match-reuse-navigation.test.tsx test/tailored-cv-wizard.test.tsx test/p8-generation-readiness.test.tsx
```

PASS — 2 targeted backend files, 14 tests:

```sh
pnpm --filter @ai-job-hunter/api test:compile
pnpm --filter @ai-job-hunter/api exec node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.js --runInBand --runTestsByPath .test-dist/test/unit/cv-export.spec.js .test-dist/test/unit/tailored-draft-review.spec.js
```

The backend results remain applicable after frontend-only focus/test changes;
export code, fixture and policy were unchanged after their final passing run.

PASS — relevant typechecks and scoped lint/format/whitespace:

```sh
pnpm --filter @ai-job-hunter/web typecheck
pnpm --filter @ai-job-hunter/api typecheck
pnpm exec eslint apps/web/src/features/inbox/{ProposalComparison,TailoredCvPreview,TailoredCvReview}.tsx apps/web/test/{proposal-comparison,tailored-cv-review}.test.tsx apps/api/src/tailored-cv/tailored-cv-export.ts apps/api/test/{support/cv-polish-fixture.ts,unit/cv-export.spec.ts} --max-warnings 0
pnpm exec prettier --check apps/web/src/features/inbox/{ProposalComparison,TailoredCvPreview,TailoredCvReview}.tsx apps/web/test/{proposal-comparison,tailored-cv-review}.test.tsx apps/api/src/tailored-cv/tailored-cv-export.ts apps/api/test/{support/cv-polish-fixture.ts,unit/cv-export.spec.ts} docs/architecture.md docs/audits/p8-ux-checkpoint-c.md artifacts/p8-c/verification.json
 git diff --check
```

PASS — scoped Chromium smoke with synthetic intercepted responses on temporary
port 5175: keyboard proposal acceptance, Change decision, confirmation/cancel,
no silent writes, explicit save/approval, unapproved local preview, approved
export eligibility, Step 3 return focus, mobile at 390px and 200% CSS zoom. No
horizontal overflow, page errors or console warnings/errors. No analysis calls.
The preview visibility probe was rechecked after waiting for lazy content; it
shows local unapproved wording while dirty navigation remains blocked. The final
focus recheck confirmed keyboard confirmation moves focus to Save. No downloads
or private CV/AI processing were triggered in browser smoke.

## DOCX/PDF evidence

- [Generated DOCX](../../artifacts/p8-c/synthetic-multi-role.docx)
- [Generated PDF](../../artifacts/p8-c/synthetic-multi-role.pdf)
- [PDF page 1](../../artifacts/p8-c/page-1.png) and
  [page 2](../../artifacts/p8-c/page-2.png), rendered with existing PDF.js/canvas
  dependencies and visually inspected.
- [Machine-readable evidence](../../artifacts/p8-c/verification.json).

The PDF has two A4 pages. All three roles use embedded DejaVuSans-Bold, verified
from actual PDF text/font objects. OOXML inspection verifies all role/category
paragraphs are bold with keep-next/keep-lines. The communication phrase uses a
nonbreaking space in DOCX and stays on one PDF line. Extracted DOCX/PDF text is
identical after NFC/whitespace normalization. The source document is unchanged.
Existing Unicode, long-URL, multi-page and exact approval export tests also pass.

## Limitations

Native DOCX visual pagination is **unverified**: Word/LibreOffice is unavailable.
The actual DOCX package, text, styling and paragraph properties were inspected;
this is not a claim of Word-rendered page parity. Word may substitute fonts if
DejaVu Sans is unavailable. PDF and Word remain semantically equivalent, with
independent page layout engines. The protected phrase applies to horizontal
whitespace inside Skills; explicit source paragraph breaks are preserved.

Browser smoke used synthetic responses and CSS zoom rather than live PostgreSQL,
Ollama or native browser zoom. Full repository/CI suites and model benchmarks were
not run. No new dependencies, migrations, match persistence, prompts, extraction,
P6/P7 semantics or approval policy changes. No commit, push or PR. Stop after C
for review; no subsequent checkpoint was started.
