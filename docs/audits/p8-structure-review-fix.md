# P8 structure quality and source review acceptance fix

Synthetic-only acceptance, 2026-11-06. No private CV/JD was inspected, copied or
logged. Development services and data were left untouched; live checks used the
guarded PostgreSQL test database and a separate API/frontend at port 3001.

## Root cause, established before implementation

| Stage          | Finding and original code responsibility                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF parsing    | `apps/api/src/extraction/pdf.parser.ts` preserves PDF item text and line breaks. Wrapping can trigger downstream fragmentation, but intact synthetic plaintext reproduced the defects. No evidence establishes a defect in the user's private PDF. Parser remains unchanged. |
| Segmentation   | Original `source-profile-proposal.ts:sourcePassages` split every newline, including sentence continuations. Colon-ended/all-uppercase lines reset context to additional: `Backend:`, `Tools:` and local experience labels were affected.                                     |
| Classification | Original field vocabulary lacked headline and skill category. A legal classification could label both name and professional title as name.                                                                                                                                   |
| Reconstruction | Original `assembleProposal` emitted one fact per passage. No logical summary/bullet reconstruction followed classification.                                                                                                                                                  |
| Grouping       | Original grouping followed blank-line blocks rather than employer/role/institution anchors; wrapped bullets could be orphaned or assigned to additional.                                                                                                                     |
| UI             | Original `SourceCvReview.tsx` rendered every fact as an input, exposing field/type/entry labels and repetitive per-passage controls. Backend fragmentation multiplied the burden.                                                                                            |

Phase A used synthetic Avery Chen text with a headline, wrapped summary, employer,
role, dates, wrapped bullet, and categorized skills. The original legal deterministic
classification produced two contact `name` facts, split summary/bullet facts, and
`additional` records for Backend/Tools. This was reported before product edits.
These are recorded observations, not a claim of a live-model baseline run.

## Before and after

| Synthetic content                                                                               | Before                                        | After                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `Synthetic Avery Chen` / `Senior Software Engineer`                                             | Both could be contact names                   | Distinct name and headline, displayed together with contact details     |
| `Builds reliable Java APIs and supports` / `team testing. Academic SQL Server coursework only.` | Two summary inputs                            | One exact multiline summary fact/editor; academic qualifier retained    |
| `• Improved internal API tests with the` / `team, without individual ownership claims.`         | Separate description fragments                | One exact multiline bullet in Example Alpha's role record               |
| Example Alpha / Example Beta                                                                    | Blank-line-dependent groups                   | Separate anchored records; missing role stays a clarification           |
| `Backend: Java, SQL Server (academic coursework only)`                                          | Undifferentiated skills or additional content | Category and verbatim item list; both reference the exact original line |
| Injection attempting to invent a PhD/proficiency                                                | Untrusted source instruction                  | Explicit unresolved coverage; not a factual qualification or skill      |

Exact synthetic inputs and complete actual persisted profiles are in
`artifacts/p8-structure-review/{structured,ambiguous-injection}-{source.txt,profile.json}`.
`after-deterministic.json` records deterministic reconstruction of the rich fixture.
Newline characters remain in values and evidence; visual paragraph rendering does
not rewrite source facts.

## Implementation and contracts

`source-profile-structure.ts` bounds and reconstructs passages before the existing
Ollama provider classifies them. Section/record anchors, bullets, whitespace,
uncertainty and instruction boundaries constrain merges. Ambiguous/repeated
attribution needs clarification; missing classification stays unresolved.
Server assembly supplies all values, offsets and quotes. Full coverage remains a
validated partition of the immutable source. No P6/P7 matching policy changed.

Optional document metadata `reconstruction: {version:"2",previousRevisionId}`
identifies the new review format within existing contract version 1. No migration,
dependency or infrastructure was added. Pending user-entered details need explicit
individual confirmation before section confirmation. Edits remain separate
user-entered replacements with no source evidence claim.

`POST /api/v1/tailored-cv/profiles/:id/rebuild` takes
`{contractVersion:"1",expectedRevision,expectedSavedCvUpdatedAt}` and returns a new
pending profile revision linked to the previous revision UUID. Owner, Host/Origin,
no-store, concurrency, saved-source and pinned-source checks are preserved.
Invalid AI output/stale/concurrent requests do not append a revision. Rebuilding
never mutates historical profiles or drafts and does not silently copy corrections.
Earlier review/corrections remain retrievable. Immutable lineage is checked on save.

The UI defaults to readable section/record cards, one summary editor, category
lists, section confirmation and focused issues. Evidence and record adjustments
use disclosures. Save and Continue reflect saved review state. Keyboard focus,
unsaved navigation and late-response guards remain active.

## Verification

- PASS: `pnpm -r --workspace-concurrency=1 run test` — 2,187 API tests (99 suites), 399 web tests (35 suites); 7 web tests in 2 suites remain skipped by existing test configuration.
- PASS: `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='source-profile-review|tailored-cv|tailored-draft'` — 39 tests, 3 suites.
- PASS: `pnpm typecheck` and `pnpm build` for both packages. Vite retains its large-chunk advisory.
- PASS: scoped `pnpm exec prettier --check <changed files>` and `pnpm exec eslint <changed TS/TSX/MJS> --max-warnings 0`.
- No migration changed; compiled migrations applied to the isolated database for acceptance. No new migration lifecycle was required.

Regression coverage includes real synthetic PDF line wrapping, exact quotes,
headline/name separation, summary/bullet reconstruction, two employers, categorized
skills/academic qualifiers, injection, repeated quotes, incomplete attribution,
legacy history, stale sources, rollback, ownership and revision conflicts.
Frontend checks cover section confirmation, explicit edited-fact review, evidence
keyboard access, unresolved content, rebuild/history, save conflicts and unsaved
navigation. Existing full unit suites exercise P6/P7 evidence behavior unchanged.

Live qwen3:4b through actual capture/proposal APIs:

| Fixture                                                                               | Latency  | Facts | Unresolved passages | Clarifications | Result |
| ------------------------------------------------------------------------------------- | -------- | ----- | ------------------- | -------------- | ------ |
| Ambiguous employer plus injection                                                     | 4,632 ms | 8     | 1                   | 2              | PASS   |
| Structured headline, wrapped summary/bullets, two employers, skills, academic project | 8,855 ms | 28    | 0                   | 1              | PASS   |

Both persisted outputs have exact evidence, complete coverage, and no confirmed
facts before user review. The structured fixture's unlabeled name required focused
clarification. Legacy revision equality was asserted during cleanup. The isolated synthetic API was stopped and its fixture data removed; the test database container was then stopped. Reproduce
with the probe script, after build/test
compilation and test migrations, from `apps/api`:
`node --env-file=../../.env.test ../../docs/audits/p8-structure-review.probe.mjs`.
It refuses an occupied test database, uses only synthetic fixtures and removes
its own data. `P8_STRUCTURE_BROWSER=1` temporarily serves the built frontend too.

Chromium smoke PASS at desktop 1440×900, mobile 390×844 and CSS 200% zoom:
legacy rebuild/cancel focus, readable two-employer/category layout, no default
text inputs, one summary editor, focused issue review, explicit field/section
confirmation, save, earlier correction retrieval, Continue focus, keyboard Stay
on unsaved navigation and retained input, and discard of local edits. No
horizontal overflow or page/console errors were observed. Screenshots:
`artifacts/p8-structure-review/review-{desktop,mobile,zoom}.png`.

## Remaining boundaries

- Already missing/fused/reordered PDF text cannot be repaired from saved text alone.
- Unlabelled employers, promotions/shared role anchors, repeated text and disputed
  paragraph boundaries require focused review or explicit record adjustment.
  Unindented uppercase continuations without clear structure can remain separate;
  attribution is not guessed.
- Skill lists preserve exact category/list wording and qualifiers; they do not
  imply independently verified proficiency or professional use.
- Rebuild resets review; earlier user corrections must be consciously reapplied as
  user-entered facts. Old drafts remain pinned to old revisions.
- Oversized logical passages/documents fail with typed bounds errors; no truncation.
- Browser acceptance used synthetic text; the private saved CV was not tested.

## Exact changed files for this checkpoint

- `README.md`
- `apps/api/src/tailored-cv/source-profile-proposal.ts`
- `apps/api/src/tailored-cv/source-profile-structure.ts`
- `apps/api/src/tailored-cv/tailored-cv.contract.ts`
- `apps/api/src/tailored-cv/tailored-cv.controller.ts`
- `apps/api/src/tailored-cv/tailored-cv.service.ts`
- `apps/api/test/integration/source-profile-review.spec.ts`
- `apps/api/test/integration/tailored-draft.spec.ts`
- `apps/api/test/support/source-structure-fixtures.ts`
- `apps/api/test/unit/source-profile-proposal.spec.ts`
- `apps/api/test/unit/source-profile-structure.spec.ts`
- `apps/web/src/features/inbox/CvMatchPanel.tsx`
- `apps/web/src/features/inbox/SourceCvReview.tsx`
- `apps/web/src/features/inbox/TailoredCvReview.tsx`
- `apps/web/src/features/inbox/source-cv-review.contract.ts`
- `apps/web/test/fixtures/source-cv-review.ts`
- `apps/web/test/fixtures/structured-source-review.ts`
- `apps/web/test/source-cv-review.test.tsx`
- `docs/architecture.md`
- `docs/audits/p8-structure-review-fix.md`
- `docs/audits/p8-structure-review.probe.mjs`

Synthetic acceptance artifacts are confined to `artifacts/p8-structure-review/`.
Other existing P8 work, benchmark artifacts and local skills were preserved.
No commit, push or PR was made. Stop for review.
