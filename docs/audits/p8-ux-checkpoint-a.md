# P8 UX polish — Checkpoint A

Implemented only Tailored CV wizard work. No commit, push or PR.

## Before → after

- Improve CV previously stacked suggestions, source review and draft review. It
  now retains suggestions and a concise link to the dedicated workspace.
- `/jobs/:id/tailored-cv` presents Source CV, CV Match, Tailor & Review, and
  Preview & Export, with current/completed labels, next actions and blockers.
- Saved drafts are discovered on entry. Continue existing draft opens the newest
  listed draft directly; paginated history keeps older drafts available.
- Source review and match context are reused. Generation still requires the P8
  server preflight, independently of P7 suggestion rejection.
- Preview shows included accepted wording. Editing, evidence, explicit saves,
  revision pins, approval and download authorization keep their existing rules.
- Step navigation focuses the current heading and blocks switching while local
  review edits are unsaved. The existing route/unload guard protects leaving.
- The return link opens `/jobs/:id?tab=improve`; existing job routes remain valid.

## Files changed in this checkpoint

Paths below are relative to the repository. Several files already contained
uncommitted P8 work at entry; that work was preserved.

- `apps/web/src/app/App.tsx`: dedicated route.
- `apps/web/src/features/inbox/TailoredCvPage.tsx`: job loading and exit guard.
- `apps/web/src/features/inbox/CvMatchPanel.tsx`: wizard composition, step actions,
  concise Improve CV entry and session match-ID reuse.
- `apps/web/src/features/inbox/SourceCvReview.tsx`: optional primary entry action
  and source-upload helper copy.
- `apps/web/src/features/inbox/TailoredCvReview.tsx`: draft discovery/resume,
  readiness/status callbacks, review blockers and content preview.
- `apps/web/src/features/inbox/JobEditor.tsx`: recognize the Improve CV return link.
- `apps/web/test/tailored-cv-wizard.test.tsx`: resume, pins, export blockers,
  keyboard focus and concise entry regression coverage.
- `apps/web/test/p8-generation-readiness.test.tsx`: exercise existing readiness
  regressions through the wizard navigation.
- `docs/architecture.md`: composition decisions and limitations.
- `docs/audits/p8-ux-checkpoint-a.md`: this report.

## Verification

PASS — targeted tests: 8 files, 104 tests. Exact command:

```sh
pnpm --filter @ai-job-hunter/web exec vitest run test/tailored-cv-wizard.test.tsx test/p8-generation-readiness.test.tsx test/tailored-cv-review.test.tsx test/tailored-cv-readiness.test.tsx test/source-cv-review.test.tsx test/cv-match.test.tsx test/cv-match.proficiency.test.tsx test/cv-suggestions.test.tsx
```

PASS — frontend typecheck and scoped lint/format/whitespace:

```sh
pnpm --filter @ai-job-hunter/web typecheck
pnpm exec eslint apps/web/src/features/inbox/{CvMatchPanel,TailoredCvReview,TailoredCvPage,SourceCvReview,JobEditor}.tsx apps/web/src/app/App.tsx apps/web/test/{tailored-cv-wizard,p8-generation-readiness}.test.tsx --max-warnings 0
pnpm exec prettier --check apps/web/src/features/inbox/{CvMatchPanel,TailoredCvReview,TailoredCvPage,SourceCvReview,JobEditor}.tsx apps/web/src/app/App.tsx apps/web/test/{tailored-cv-wizard,p8-generation-readiness}.test.tsx docs/architecture.md docs/audits/p8-ux-checkpoint-a.md
 git diff --check
```

PASS — scoped Chromium smoke through Playwright MCP, using synthetic intercepted
API responses: direct route, saved-draft resume, review/preview navigation,
keyboard Enter and heading focus, disabled PDF download with visible approval
instructions, 390px mobile layout and 200% CSS zoom at a 1280px viewport. No page
horizontal overflow or browser console errors. No private CVs, live Ollama,
exports or destructive mutations were exercised. Browser screenshots were taken
in the tool's temporary filesystem; the descriptions above provide the handoff.

Initial focused runs exposed a source-continue readiness race and a router
assumption in embedded component tests. Both were fixed before the final runs.
No full workspace, backend, PostgreSQL, build or pre-PR CI gate was run; this is a
scoped development checkpoint and is not PR-ready verification.

## Limitations and follow-up

- Match reuse lasts within the browser session. There is no current-match read
  endpoint, so a new session may require reanalysis; persisted source reviews and
  drafts remain reusable. Storage failure also falls back to in-memory matching.
- Preview is a content view, not the generated PDF/DOCX layout. The existing
  export generator is unchanged.
- The browser smoke used synthetic responses, not live backend acceptance.
  Zoom was checked with CSS zoom, not the browser's native zoom control.
- Checkpoints B/C were not implemented. Review and approve A before defining or
  starting subsequent UX work; broader CI parity remains required before a PR.
