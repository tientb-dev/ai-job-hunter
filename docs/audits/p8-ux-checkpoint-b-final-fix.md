# P8 Checkpoint B final fix — draft loading and approved-state clarity

## Root causes and behavior

Previously, draft load completion passed approval to navigation, sending approved
drafts to preview. Initial readiness also selected a step before draft discovery
finished. Save, Discard, confirmation and Approve rendered without checking whether
the loaded saved revision was already approved and unchanged.

Now:

- Initial entry waits for draft discovery and loads the latest listed saved draft
  into Step 3, approved or unapproved, even with an unavailable match. With no
  draft, existing source/match readiness selects Steps 1–3.
- Explicit Load/Resume selects Step 3 when clicked. Completion only loads the
  requested document; it does not change steps or scroll to the bottom.
- Explicit step choices lock the initial decision. Background match/draft reads
  cannot redirect the current session. Epoch checks protect selected drafts from
  late automatic-load responses.
- Step 4 requires explicit Preview & Export or Stepper selection. Approval alone
  never navigates there or marks export completed.
- Approved unchanged content shows “Approved — Ready to export,” with revision,
  explanation and the existing primary preview action. Inactive Save/Discard and
  redundant approval controls are hidden. Secondary reload, full CV, evidence
  and editing remain available.
- Local changes show Save/Discard and an unapproved-edit warning. Saved approval
  is retained until explicit save; existing save/approval and export gates apply.
- Active Stepper labels say “Active”; completion remains a separate MUI state.

## Changed files

Pre-existing unrelated and earlier checkpoint work was preserved.

- `apps/web/src/features/inbox/CvMatchPanel.tsx`: one entry/manual-navigation
  decision, discovery coordination, approval-independent resume and active labels.
- `apps/web/src/features/inbox/TailoredCvReview.tsx`: initial draft loading,
  click-time review selection, stale-load protection and approved-state controls.
- `apps/web/test/match-reuse-navigation.test.tsx`: navigation and approved-state
  regressions, including delayed loading, selected older drafts and edit guards.
- `apps/web/test/tailored-cv-wizard.test.tsx`: expect automatic draft loading.
- `docs/architecture.md`: final navigation and state decisions.
- `docs/audits/p8-ux-checkpoint-b-final-fix.md`: this report.

## Verification

PASS — 5 affected frontend test files, 32 tests:

```sh
pnpm --filter @ai-job-hunter/web exec vitest run test/match-reuse-navigation.test.tsx test/tailored-cv-review.test.tsx test/tailored-cv-wizard.test.tsx test/p8-generation-readiness.test.tsx test/tailored-cv-readiness.test.tsx
```

Coverage includes no source, incomplete source, missing/stale/valid/replaced match,
initial approved/unapproved drafts, explicit Resume/Load from another step,
manual selection during delayed loading, explicit preview and return, historical
selection, approved summaries/controls, changed-content export blocking, backend
confirmation of save/approval, browser back/unload guards and shared match reuse.

PASS — frontend typecheck, scoped lint/format and whitespace:

```sh
pnpm --filter @ai-job-hunter/web typecheck
pnpm exec eslint apps/web/src/features/inbox/{CvMatchPanel,TailoredCvReview}.tsx apps/web/test/{match-reuse-navigation,tailored-cv-wizard}.test.tsx --max-warnings 0
pnpm exec prettier --check apps/web/src/features/inbox/{CvMatchPanel,TailoredCvReview}.tsx apps/web/test/{match-reuse-navigation,tailored-cv-wizard}.test.tsx docs/architecture.md docs/audits/p8-ux-checkpoint-b-final-fix.md
 git diff --check
```

PASS — one focused synthetic Chromium pass through Playwright MCP on temporary
port 5175, using the actual Job Detail and wizard routes:

- Open Tailored CV with an approved saved draft and expired match → Step 3,
  complete draft content immediately visible, no redundant approval/save controls.
- Explicit preview → load that approved draft from history → Step 3 without
  another Step 3 click; explicit preview and keyboard return stay in review.
- Background focus refresh leaves Step 3 selected. Zero analysis calls.
- Keyboard focus returns to the step heading. No horizontal overflow at 390px or
  200% CSS zoom at a 1280px viewport. No browser page/console errors.

One older test expected a transient Resume button before automatic loading; it
was updated to assert the loaded content. No backend code changed, so backend,
PostgreSQL, full frontend/workspace and full CI suites were not run.

## Limitations and scope

Initial entry selects the first draft in the server's existing ordered list.
Historical drafts remain explicitly selectable and are not replaced by refreshes.
Manual step selection lasts for the mounted wizard session; a full route reload
resolves initial saved state again. Browser smoke used synthetic responses and
CSS zoom, not live private CV processing or native browser zoom.

No match persistence, approval model, dependencies, database migrations, prompts,
extraction or PDF/DOCX generation changed. Temporary preview is stopped; port 5173
was not used. No commit, push or PR. Checkpoint C was not started. Stop for review.
