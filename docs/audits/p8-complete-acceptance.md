# P8 complete tailored CV acceptance

**Verdict: READY for user acceptance.** P8 only; no commit, push, PR or merge.

## User journey and manual acceptance

Start the application with the existing local setup (`pnpm dev`). Use the
[synthetic source DOCX](../../artifacts/p8-acceptance/journey-source.docx) or the
sample CVs below, and a saved job describing Java API work. The live acceptance
used only isolated PostgreSQL (`ai_job_hunter_test`, role of the same name,
loopback port 5433) and local Ollama qwen3:4b. No development data was accessed.

1. In Job Detail → CV Match, upload/select the current source CV and Analyze CV
   Match. Uploading replaces the one current CV while retaining captured revisions.
2. In Improve CV, Review source CV → Generate structured proposal. Inspect exact
   evidence, confirm clear sections, clarify ambiguous facts, and map or explicitly
   exclude unresolved passages. Save source review.
3. Generate new draft. Review every section, accept wording or keep the original,
   edit existing fields and choose inclusion in downloads. Review issues separately.
   Save draft, acknowledge complete-content review and Approve saved draft.
4. Download DOCX or PDF. Reopen through Load saved drafts or reload the page and
   load again. Downloads do not require a current match or an available model.
5. Edit wording or inclusion: downloads disable immediately and Save clears
   approval. Save and approve again before downloading. Generate new draft creates
   a separate UUID and leaves approved work intact.

## Implementation and guarantees

`POST /api/v1/tailored-cv/drafts/:id/export` takes exactly version 1,
`expectedRevision`, and `format: "docx" | "pdf"`. Both formats require exact saved
approval, owner scope and strict local Host/Origin. Canonical projection rechecks
review prerequisites; the service checks revision/approval before and after
rendering. Exports never call AI or persist binaries. Filenames are fixed ASCII,
MIME types are correct, responses are no-store/nosniff attachments.

Canonical content contains accepted included facts only, in conventional CV section
order and unchanged entry chronology. Pending/rejected proposal text, issues,
evidence, JD snapshots and internal provenance are not rendered. Exclusion is an
explicit independent review operation and never deletes a fact. Outer paragraph
whitespace/line-ending layout is normalized, preserving every factual character;
saved wording and evidence stay unchanged. Tests compare NFC-normalized factual
text with whitespace ignored for line wrapping, not merely the presence of keywords.

Runtime additions: `docx` **9.15.2**, `pdfkit` **0.20.2**, `fontkit` **2.0.4**.
Fontkit was already PDFKit's transitive dependency and is declared directly for
public glyph coverage checks. Development declarations: `@types/pdfkit` **0.17.7**
and `@types/fontkit` **2.0.9**. Bundled DejaVu Sans regular/bold TTFs include their
license. This supplies Vietnamese Unicode without system font/network dependencies
for PDF, and avoids private PDFKit APIs. No new database, migration, worker, cloud
provider or frontend dependency was added.

Actual browser acceptance found a pre-existing P8 private-read issue: same-origin
GETs omit Origin and correctly received 403. Versioned POST read aliases now let
the browser reopen sources/profiles/drafts while preserving the strict guard.
GET remains protected; missing/foreign Origin and unexpected bodies are tested.
POST metadata listing is `/jobs/:id/drafts/list`, with version 1 and `before`.

## Export acceptance and sample files

| Fixture                  | DOCX                                                      | PDF                                                      | PDF pages | Parity / geometry |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------------- | --------- | ----------------- |
| Standard                 | [Download](../../artifacts/p8-acceptance/standard.docx)   | [Download](../../artifacts/p8-acceptance/standard.pdf)   | 1         | PASS              |
| Long experience          | [Download](../../artifacts/p8-acceptance/multi-page.docx) | [Download](../../artifacts/p8-acceptance/multi-page.pdf) | 5         | PASS              |
| Vietnamese / English     | [Download](../../artifacts/p8-acceptance/vietnamese.docx) | [Download](../../artifacts/p8-acceptance/vietnamese.pdf) | 1         | PASS              |
| Long URLs / additional   | [Download](../../artifacts/p8-acceptance/long-urls.docx)  | [Download](../../artifacts/p8-acceptance/long-urls.pdf)  | 2         | PASS              |
| Academic-only SQL Server | [Download](../../artifacts/p8-acceptance/academic.docx)   | [Download](../../artifacts/p8-acceptance/academic.pdf)   | 1         | PASS              |

Every fixture's DOCX text was extracted with Mammoth; PDF text and all page bounds
were checked with PDF.js against the canonical document. Every PDF page contains
text and fits A4/margins, including wrapped URLs. All PDF pages were rendered to
PNG through PDF.js and its existing optional canvas dependency. Representative
pages from every fixture were visually inspected, including the final multi-page
page and the long-URL page. No blank/clipped pages or missing Vietnamese glyphs
were observed. Standard-sized DOCX files also pass the application's strict parser;
the expanded multi-page CV correctly exceeds the unchanged 12,000-unit re-upload
limit. These are actual styled OOXML/text PDFs, not screenshots.

Word/LibreOffice opening, font fallback and DOCX pagination are **UNVERIFIED**:
those viewers are not installed. Headless Chromium starts a PDF download instead
of opening its viewer; PDF viewer compatibility beyond PDF.js is **UNVERIFIED**.
Different DOCX/PDF page counts across layout engines are permitted; factual parity
is the guarantee. No universal ATS, PDF/A or cross-viewer pagination claim is made.

Reproduce the synthetic renderer acceptance after build/test compilation:
`node docs/audits/p8-export-acceptance.probe.mjs`. Results and every rendered page
are in [export-results.json](../../artifacts/p8-acceptance/export-results.json).

## Live end-to-end acceptance

`docs/audits/p8-journey.probe.mjs` uses the real AppModule, upload parser, protected
APIs, durable PostgreSQL, source proposal, P6 matching and qwen3:4b draft generator.
It refuses occupied domain tables, tracks only its own synthetic rows and cleans
up after exit. It does not mock model responses. Explicit synthetic author review
checks exact spans and accounts for every unresolved passage before confirmation.

Final live run: upload **221 ms**, source proposal **4,070 ms**, match **1,346 ms**,
draft **4,042 ms**, regeneration **4,074 ms**. DOCX/PDF export took **36/76 ms**.
Reopening returned the saved document unchanged. Regeneration produced a distinct
draft and preserved the approved original. A later edit cleared approval; export
returned **409 CV_EXPORT_NOT_APPROVED** in **3 ms**. Restoration/reapproval succeeded.
No fabricated claims entered accepted fields. Prior approved P8.3 academic,
attribution and injection live cases remain relevant; matching/provider grounding
logic was not changed here.

Results: [journey-results.json](../../artifacts/p8-acceptance/journey-results.json).
Actual API outputs: [DOCX](../../artifacts/p8-acceptance/journey-approved.docx),
[PDF](../../artifacts/p8-acceptance/journey-approved.pdf).
Browser-downloaded files were independently text-compared with their canonical
approved content: [download-parity.json](../../artifacts/p8-acceptance/download-parity.json).

## Chromium acceptance

Playwright MCP used the real Vite frontend and isolated API/database/Ollama, without
intercepting API responses in the final pass. Desktop **1440×900**, mobile
**390×844**, and **200% CSS zoom at 1440×900** passed with no horizontal overflow.
The live source review reopened, matching and generation ran from the UI, wording
was reviewed, Save/Approve succeeded, and real browser downloads completed.
Keyboard Enter triggered DOCX download. Mobile editing disabled downloads; Stay
received focus in the unsaved dialog and preserved entered text. Save/reapproval
then enabled a real PDF download. Final successful passes had no console errors
or page exceptions. A smoke selector initially selected the source form instead
of the tailored form; its local synthetic edit was discarded and the correctly
scoped scenario passed.

- [Desktop workspace](../../artifacts/p8-acceptance/workspace-desktop.png)
- [Desktop source review + generated CV](../../artifacts/p8-acceptance/workspace-desktop-generated.png)
- [Mobile workspace](../../artifacts/p8-acceptance/workspace-mobile.png)
- [200% zoom](../../artifacts/p8-acceptance/workspace-zoom.png)
- [Rendered standard PDF](../../artifacts/p8-acceptance/standard-page-1.png)
- Actual browser downloads: [reopened PDF](../../artifacts/p8-acceptance/browser-approved.pdf),
  [generated DOCX](../../artifacts/p8-acceptance/browser-generated.docx),
  [edited/reapproved PDF](../../artifacts/p8-acceptance/browser-edited.pdf).

## Full local Pre-PR CI gate

Node 24.22.1, pnpm 12.14.0. Authority: `.github/workflows/ci.yml` and
`docs/audits/dev-02-pre-pr-ci-gate.md`. All locally reproducible gate steps passed:

| Exact command / check                                                                              | Actual result                                                                                        |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                   | PASS; exact pinned lockfile                                                                          |
| `pnpm format:check`                                                                                | PASS; repository-wide                                                                                |
| `pnpm lint`                                                                                        | PASS; repository-wide, zero warnings                                                                 |
| `pnpm typecheck`                                                                                   | PASS; both packages                                                                                  |
| `pnpm -r --workspace-concurrency=1 run test`                                                       | PASS; API 98 suites / 2,180 tests; web 35 files / 396 tests, 7 existing conditional skips in 2 files |
| `pnpm build`                                                                                       | PASS; web reports a >500 kB bundle warning (873.46 kB / 266.22 kB gzip)                              |
| `pnpm db:test:up`                                                                                  | PASS; fresh isolated temporary PostgreSQL                                                            |
| `pnpm db:test:migrate:compiled`                                                                    | PASS; all 9 migrations applied to fresh DB                                                           |
| `pnpm test:integration`                                                                            | PASS; 11 suites / 89 tests                                                                           |
| `pnpm db:test:revert:compiled`, `pnpm db:test:migrate:compiled` twice                              | PASS; P8 foundation revert/reapply/repeat after fresh compiled apply                                 |
| `pnpm db:test:revert`, `pnpm db:test:migrate`, `pnpm db:test:revert`, `pnpm db:test:migrate` twice | PASS; TypeScript P8 foundation apply/revert/reapply/repeat                                           |
| `git diff --check`, `git diff --cached --check`                                                    | PASS; index remains empty, nothing staged                                                            |

The existing `.env.test` was preserved, mode 0600, with guarded test identity;
no credentials were displayed or development settings loaded. Conditional skipped
web files are the existing live-API/real-upload opt-in suites, not new skips.
Initial formatting/probe-lint failures were corrected before the final gate run.
Only documentation, license whitespace and generated acceptance artifacts changed
after the passing code gate; final formatting/whitespace checks cover them.
No worker overrides: serial workspace command, API Jest runInBand, web maxWorkers 2.
GitHub-hosted actions/setup/status publication remain CI-only and are not claimed.
No staging/commit/push is authorized.

Cleanup passed: zero saved CVs, source revisions, profile revisions, drafts and
jobs remained in the guarded test database; all nine migrations were applied.
`pnpm db:test:down` stopped/removed the owned disposable database. The temporary
API and Vite services were stopped. There are 24 implementation/documentation
files changed for this completion and 40 synthetic artifact files; exact lists
follow. Earlier approved work, benchmark artifacts and local skills are preserved.

## Limits and remaining risks

- DejaVu covers Vietnamese/English but not all scripts/emoji; unsupported glyphs
  fail explicitly. API runtime packaging must include `apps/api/assets/fonts`.
- Export inherits bounded documents (96 facts / 96 KiB), adds 1,200 explicit lines
  and a 40-page PDF cap; browser download cap is 10 MiB. Oversize output fails,
  never truncates. The source parser retains its separate 12,000-unit upload limit.
- Approval means user-reviewed, not independently verified. Manual edits remain
  user-authored and never acquire source evidence or change P6/P7 assessments.
- Editing adds no rich text, marketplace or new fact restructuring. New facts go
  through Source CV Review and a separate generation. Local AI can still return
  typed failures; prior saved drafts remain intact.
- No binary persistence, export history, embedded DOCX fonts, universal-script
  fallback or separate append-only approval audit ledger is introduced.
- Web build bundle-size warnings and standard-viewer limitations are reported,
  rather than suppressed or represented as successful viewer checks.

## Exact implementation files changed in this completion

The following list excludes already approved P8.1–P8.4 changes and unrelated
benchmark/local-skill artifacts. Generated synthetic samples/screenshots/reports
are confined to `artifacts/p8-acceptance/`.

- `README.md`
- `apps/api/assets/fonts/DejaVuSans-Bold.ttf`
- `apps/api/assets/fonts/DejaVuSans.ttf`
- `apps/api/assets/fonts/LICENSE.txt`
- `apps/api/package.json`
- `apps/api/src/tailored-cv/tailored-cv-export.ts`
- `apps/api/src/tailored-cv/tailored-cv.controller.ts`
- `apps/api/src/tailored-cv/tailored-cv.module.ts`
- `apps/api/src/tailored-cv/tailored-draft-review.policy.ts`
- `apps/api/src/tailored-cv/tailored-draft.contract.ts`
- `apps/api/test/integration/tailored-draft.spec.ts`
- `apps/api/test/support/cv-export-fixtures.ts`
- `apps/api/test/unit/cv-export.spec.ts`
- `apps/api/test/unit/tailored-draft-review.spec.ts`
- `apps/web/src/features/inbox/CvMatchPanel.tsx`
- `apps/web/src/features/inbox/TailoredCvReview.tsx`
- `apps/web/src/features/inbox/source-cv-review.contract.ts`
- `apps/web/src/features/inbox/tailored-cv.contract.ts`
- `apps/web/test/tailored-cv-review.test.tsx`
- `docs/architecture.md`
- `docs/audits/p8-complete-acceptance.md`
- `docs/audits/p8-export-acceptance.probe.mjs`
- `docs/audits/p8-journey.probe.mjs`
- `pnpm-lock.yaml`

## Exact generated artifact files

- `artifacts/p8-acceptance/academic-page-1.png`
- `artifacts/p8-acceptance/academic.canonical.json`
- `artifacts/p8-acceptance/academic.docx`
- `artifacts/p8-acceptance/academic.pdf`
- `artifacts/p8-acceptance/browser-approved.pdf`
- `artifacts/p8-acceptance/browser-edited.canonical.json`
- `artifacts/p8-acceptance/browser-edited.pdf`
- `artifacts/p8-acceptance/browser-generated.docx`
- `artifacts/p8-acceptance/download-parity.json`
- `artifacts/p8-acceptance/export-results.json`
- `artifacts/p8-acceptance/journey-approved.canonical.json`
- `artifacts/p8-acceptance/journey-approved.docx`
- `artifacts/p8-acceptance/journey-approved.pdf`
- `artifacts/p8-acceptance/journey-results.json`
- `artifacts/p8-acceptance/journey-source.docx`
- `artifacts/p8-acceptance/long-urls-page-1.png`
- `artifacts/p8-acceptance/long-urls-page-2.png`
- `artifacts/p8-acceptance/long-urls.canonical.json`
- `artifacts/p8-acceptance/long-urls.docx`
- `artifacts/p8-acceptance/long-urls.pdf`
- `artifacts/p8-acceptance/multi-page-page-1.png`
- `artifacts/p8-acceptance/multi-page-page-2.png`
- `artifacts/p8-acceptance/multi-page-page-3.png`
- `artifacts/p8-acceptance/multi-page-page-4.png`
- `artifacts/p8-acceptance/multi-page-page-5.png`
- `artifacts/p8-acceptance/multi-page.canonical.json`
- `artifacts/p8-acceptance/multi-page.docx`
- `artifacts/p8-acceptance/multi-page.pdf`
- `artifacts/p8-acceptance/standard-page-1.png`
- `artifacts/p8-acceptance/standard.canonical.json`
- `artifacts/p8-acceptance/standard.docx`
- `artifacts/p8-acceptance/standard.pdf`
- `artifacts/p8-acceptance/vietnamese-page-1.png`
- `artifacts/p8-acceptance/vietnamese.canonical.json`
- `artifacts/p8-acceptance/vietnamese.docx`
- `artifacts/p8-acceptance/vietnamese.pdf`
- `artifacts/p8-acceptance/workspace-desktop-generated.png`
- `artifacts/p8-acceptance/workspace-desktop.png`
- `artifacts/p8-acceptance/workspace-mobile.png`
- `artifacts/p8-acceptance/workspace-zoom.png`
