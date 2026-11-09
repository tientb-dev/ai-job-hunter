# P8 acceptance: contact fields and skills coverage

Synthetic-only investigation and verification. The
private CV/profile was not accessed, logged or copied. No development data was
read or modified. The user's screenshot does not establish the exact private
profile state; the findings below distinguish direct code findings from a
synthetic reproduction with the same visible symptoms.

## Root causes

### Contact fields

`apps/api/src/extraction/pdf.parser.ts` passes extracted PDF item text into saved
source text; there is no P8-specific repair of font/icon mappings. The source
review previously treated only pipe/bullet separators specially. Replacement
squares and private-use icon characters remained ordinary text.

In `source-profile-structure.ts:contactParts`, the old non-pipe token path returned
nothing when fewer than **two** strong tokens were found. Thus a location plus
one phone remained a single passage. `reconstructSource` could accept an AI
Location classification of that entire line. On other lines, glyph-only remnants
could likewise become Location facts. No later normalization or renderer split
corrected that persisted representation. This is a segmentation/classification
boundary defect, not evidence that the private PDF parser lost specific bytes.

The synthetic before-profile contains `location = "� Example City □ +84 900 000
123"`, two glyph-only Location facts, and an unknown contact fragment labelled
Location. The source has legible location and phone text; no missing digits need
to be invented. Original private font mappings cannot be diagnosed without the
PDF and were not inspected.

The fix isolates strong single email/phone/URL tokens, retains exact evidence and
leaves glyphs, damaged words and unclear remnants explicitly unresolved. It does
not substitute characters, normalize source text or infer missing details. An
instruction-like source line is rejected before token splitting, so a phone
embedded in an injection is not extracted as a candidate fact.

### Skill groups: omission versus hidden or lost content

The complete synthetic source and before-profile were inspected, including every
section, record, fact and coverage range. A legal model response was constructed
that omits Backend, Frontend and Leadership category/list IDs. The existing AI
contract explicitly permits omitted IDs. Old `reconstructSource` returned no fact
for an omitted non-heading passage, even when a deterministic category/list hint
already existed. **All six source ranges remained unresolved, not dropped.**

The persisted synthetic before-profile therefore has four skill cards:
Architecture, Databases, Cloud & DevOps, AI-assisted Development. Backend,
Frontend and Leadership are neither mapped elsewhere nor hidden by the renderer;
they are in unresolved coverage. The browser reproduced that exact four-card
state from the seeded historical revision before reorganizing it.

`SourceCvReview.tsx` renders every mapped skills entry. Its title-field filtering
does not explain these missing cards. In this reproduction the defect is model
selection controlling whether structurally recognized groups reach the mapped
profile, plus unresolved data being separate from the primary skills view. This
is **not a claim** that the user's private profile has the same coverage state.

The fix uses source-owned category/list hints in an explicit skills section even
when AI omits them. Unknown categories remain flagged for clarification. The
new `assertSkillSourceCoverage` rejects newly assembled profiles that omit a
recognized category/list, relabel its fields or attach its list to another
category. It complements the existing exact quote and full partition validation.
It does not override later explicit user exclusions. Bare genuine Languages
headings keep their existing section boundary behavior.

## Before and after synthetic structure

| Source-supported detail                                          | Before                                    | After                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Name / professional headline                                     | Already distinct in this fixture          | Preserved as separate source facts                                                             |
| `� Example City □ +84 900 000 123`                               | One malformed Location fact               | `location: Example City`, `phone: +84 900 000 123`; two artifact spans unresolved              |
| Icon-prefixed email / URL                                        | Glyph-only remnants could become Location | Exact email/URL tokens; glyph remnants unresolved                                              |
| Unknown contact handle                                           | AI could label it Location                | Explicit unassigned contact fragment requiring review                                          |
| Backend                                                          | Category/list unresolved                  | Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, Express.js, PHP, Laravel under Backend |
| Frontend                                                         | Category/list unresolved                  | React, Next.js, Vue.js, Nuxt.js, TypeScript, JavaScript under Frontend                         |
| Leadership & Communication                                       | Category/list unresolved                  | Exact team/communication wording under its own category                                        |
| Architecture, Databases, Cloud & DevOps, AI-assisted Development | Four visible categories                   | Preserved after the recovered groups, in source order                                          |
| Three employers / nine nested projects                           | Correctly grouped                         | Preserved; role/date/project/bullet wording remains source-grounded                            |

Before JSON, the legal omitted-ID classification and exact synthetic source are
under `artifacts/p8-contact-skills/before-*` and `synthetic-source.txt`.
`after-profile.json` records the actual live proposal; `saved-review.json` records
the saved review after explicit separator exclusions and skills confirmation.
Every factual value remains an exact source substring with original offsets.

## Revision-3 behavior

**Use the existing Reorganize from source action. No new action, API, migration,
document version or automatic data rewrite is introduced.** The integration and
browser tests start from an immutable historical revision 3 with the missing
skill groups, then explicitly append revision 4. Saved edits subsequently append
revision 5. Revision 3 remains exactly unchanged as a document, and source
revision identity remains pinned. Previous corrections/drafts stay historical;
reapply corrections consciously and review the new revision. Existing revision-3
reviews remain editable until the user chooses to reorganize.

## Verification

- PASS: `pnpm --filter @ai-job-hunter/api test --testPathPatterns='source-profile|tailored-cv.contract'` — 62 focused unit/contract tests, also covered by the full workspace run.
- PASS: `pnpm --filter @ai-job-hunter/web test test/source-cv-review.test.tsx` — 17 tests, including all category/list rendering, explicit glyph exclusions, focus, Save/reload, confirmation and blocked Continue.
- PASS: `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='source-profile-review|tailored-cv|tailored-draft'` — 41 PostgreSQL tests / 3 suites. Includes revision-3 reorganization with forced AI omission of all skills, exact evidence, old-document equality, retrieval, ownership, stale sources, conflicts and failure rollback.
- PASS: exact CI workspace unit command `pnpm -r --workspace-concurrency=1 run test` — 2,199 backend tests (99 suites), 402 frontend tests (35 suites); 7 existing web skips in 2 suites. No worker overrides.
- PASS: `pnpm typecheck` and `pnpm build` for both packages. The existing Vite large-chunk advisory remains.
- PASS: scoped `pnpm exec prettier --check` over the changed-file manifest below; scoped `pnpm exec eslint <changed TS/TSX/MJS files> --max-warnings 0`; `git diff --check`.
- No dependency or migration changed. The full Pre-PR gate and migration revert/reapply cycle were not run for this development checkpoint. Existing migrations were applied by the isolated integration harness.

Live qwen3:4b and Chromium used only the synthetic source, existing API/Ollama
provider and an isolated API/frontend at port 3001 with guarded test PostgreSQL
at 5433. The before profile was an explicit synthetic historical snapshot; no
private profile was read. The **actual live reorganize** completed in **37,867 ms**
with **93 exact source-derived facts, seven skill groups, three employer records,
complete coverage and six unresolved ranges**. These were four icon/separator
spans, one unknown contact handle and the summary omitted by AI. No fact was
confirmed automatically. The summary remained recoverable as one coherent
unresolved passage, and Continue stayed blocked.

Browser PASS at desktop 1440×900, mobile 390×844 and CSS 200% zoom:

- Before: four visible skill cards; after actual Reorganize: all seven, in source
  order, with full Backend/Frontend lists and Leadership recoverable/visible.
- Three employer records remained before and after. Location and phone appeared
  as separate primary fields; glyphs/unknown contact text appeared in the warning.
- Keyboard exclusion required explicit user action. Four separator exclusions,
  Skills confirmation and all seven skill groups survived Save and reload.
- Review unassigned contact text moved focus to the unresolved-content heading.
  Unknown contact text and the omitted summary remained unresolved; Continue was
  disabled. Unsaved location correction triggered Stay and edit, focused it, and
  retained the typed value on keyboard activation. Local correction was discarded.
- Mobile scrollWidth 390 / viewport 390; zoom scrollWidth 1440 / viewport 1440.
  No horizontal page overflow or page/console errors during service-backed smoke.

The isolated service verified the revision-3 document unchanged before cleanup.
All owned fixture rows were removed; the five P8/opportunity domain tables were
verified empty and the test container stopped. Development services/data were
untouched. Screenshots, profiles and `live-results.json` are in the dedicated
artifact directory below.

To reproduce with the included synthetic before-profile artifact, build and
compile tests, start/migrate the guarded test database, then run from `apps/api`:
`P8_CONTACT_BROWSER=1 node --env-file=../../.env.test ../../docs/audits/p8-contact-skills.probe.mjs`.
It refuses an occupied test database; SIGTERM after browser review verifies
historical equality and removes owned fixtures. Without the browser flag, it
performs one API reorganization and exits. No product test-control endpoint or
additional provider is introduced.

## Remaining limitations

- This fixes reproduced source patterns; the private CV/profile was not inspected.
- Missing PDF characters, damaged words, unknown contact formats and uncertain
  fragments require comparison with the original or explicit user correction.
  No original bytes or font metadata are invented.
- A recognizable token is a source-derived candidate fact, not independently
  verified contact information. User confirmation is still required.
- Unusual headings without a clear skills boundary/category structure can remain
  unresolved. Unknown colon-labelled categories require clarification instead of
  inferred proficiency. Source-supported qualifiers remain intact.
- AI can still omit other untyped content. In the live run, the coherent summary
  remained unresolved and explicitly recoverable. It was not silently discarded;
  Continue remained blocked. This checkpoint does not broaden into summary or
  experience extraction redesign.
- Existing source, passage, fact, JSONB and time bounds remain; oversized or failed
  proposals never truncate content or overwrite saved work.

## Exact files changed

- `README.md`
- `apps/api/src/tailored-cv/source-profile-structure.ts`
- `apps/api/test/integration/source-profile-review.spec.ts`
- `apps/api/test/support/contact-skills-fixture.ts`
- `apps/api/test/unit/source-profile-structure.spec.ts`
- `apps/web/src/features/inbox/SourceCvReview.tsx`
- `apps/web/test/fixtures/contact-skills-review.ts`
- `apps/web/test/source-cv-review.test.tsx`
- `docs/architecture.md`
- `docs/audits/p8-contact-skills-acceptance.md`
- `docs/audits/p8-contact-skills.probe.mjs`

Synthetic artifacts:

- `artifacts/p8-contact-skills/after-profile.json`
- `artifacts/p8-contact-skills/before-classification.json`
- `artifacts/p8-contact-skills/before-profile.json`
- `artifacts/p8-contact-skills/browser-results.json`
- `artifacts/p8-contact-skills/live-results.json`
- `artifacts/p8-contact-skills/review-desktop.png`
- `artifacts/p8-contact-skills/review-mobile.png`
- `artifacts/p8-contact-skills/review-zoom.png`
- `artifacts/p8-contact-skills/saved-review.json`
- `artifacts/p8-contact-skills/synthetic-source.txt`

No new dependency, migration or infrastructure. No commits, pushes or PRs.
Unrelated artifacts and local skills were preserved. Stop for review.
