# P8.3 grounded tailored draft acceptance

6 November 2026 (Asia/Saigon). **PASS** on the final revision. P8.3 only; no
editor, export, dependency, migration, development-data mutation, commit, push or PR.

## Implemented behavior

The new backend generates a complete structured CV from a fully reviewed latest
profile revision, its immutable source and a saved job with a current P6 match.
It pins source/profile/job identities and hashes, canonical requirement states,
model identity and per-batch prompt/output hashes. Accepted text is copied exactly
from effective confirmed profile facts; user-entered facts retain distinct
provenance and no borrowed original-CV evidence. Missing sections are empty with
review issues rather than invented content. Unselected content stays included;
priorities remain separate recommendations and entry chronology remains unchanged.

Existing PostgreSQL JSONB columns suffice. `kind: "tailored_cv"` distinguishes new
generated documents from old internal profile placeholders. Generation inserts a
new draft at revision 1; there is no endpoint to mutate accepted text or accept
AI proposals before P8.4. The legacy internal profile-save method rejects generated
documents. Typed failures and per-proposal unsafe-rewrite issues are documented in
`docs/architecture.md` under P8.3.

The API adds POST/GET `/api/v1/tailored-cv/jobs/:id/drafts` and GET
`/api/v1/tailored-cv/drafts/:id`. Generate requires version 1, profileRevisionId,
expectedProfileRevision, expectedJobUpdatedAt and matchId. List returns metadata
only, in 20-item pages with an owner/job-scoped `before` UUID and nextCursor. All
reads/writes retain local Host/Origin, owner scoping and no-store protections.

## Grounding boundaries

- Full source coverage must be mapped or explicitly excluded; ambiguous and
  unconfirmed factual fields block generation. Source headings are structural and
  imperative instruction passages are ineligible.
- Source wording/confirmed user values remain accepted. Only eligible narrative
  IDs enter small section/entry-local batches. Anchors such as employer, title,
  dates and qualifications do not enter rewrite batches.
- P6 canonical text, AND/OR/Unknown modes, component/parent states and credit stay
  unchanged. Partial is never promoted. Conflict/Unknown groups receive no positive
  source-support links. AI relevance is explicitly distinct from source support.
- The model-facing schema constrains fact and parent requirement IDs; independent
  runtime validation rejects unknown/cross-batch IDs, component IDs masquerading
  as parents, duplicate proposals and proposals for unselected facts.
- A conservative literal numeric check and case-sensitive substantive-word
  multiset reject changed numbers, entities and qualifiers. Unsafe text is discarded
  with a typed issue. Retained style/function-word proposals are pending and always
  flagged for semantic review; these checks do not prove entailment.
- One process slot plus an owner-scoped PostgreSQL session lock prevent overlapping
  generation across API instances. Inputs are rechecked throughout inference and
  under final transactional profile/job/current-CV protection. There is no open
  transaction during inference and no partial draft insertion.

## Focused automated verification

- PASS — `pnpm --filter @ai-job-hunter/api test --testPathPatterns='tailored-draft|source-profile|tailored-cv|cv-suggestions|suggestion-policy|match-context|cv-match'`: **23 suites, 717 tests**.
- PASS — `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='tailored-draft|source-profile|tailored-cv|cv-match'`: **4 suites, 32 tests**.
- PASS — `pnpm --filter @ai-job-hunter/api typecheck`.
- PASS — `pnpm --filter @ai-job-hunter/api build`.
- PASS — scoped formatting, zero-warning ESLint and whitespace checks for this checkpoint's changed files.

New tests cover effective confirmation, replacement provenance, complete assembly,
entry order, AND/OR/Partial/Unknown/Conflict, unsafe numeric/entity/ownership/qualifier
changes, injection, invalid IDs, typed AI failures, owner isolation, transactional
persistence, retrieval through a fresh API instance and database connection, stale
inputs during inference, cross-instance generation locking, failure preservation,
legacy-save conflicts and exact metadata pagination.

## Live qwen3:4b acceptance

Real local Ollama 0.40.10 / qwen3:4b pinned digest
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`.
All pairs used synthetic parsed CV text and explicit synthetic profile review.
Capture/review, P6 matching, generation and retrieval were real HTTP routes in an
isolated API with the real provider. The database was the guarded test identity on
127.0.0.1:5433; occupied test tables are refused. No development CV/JD, original
private document, credentials or raw private payload was accessed or logged.

| Pair                          | Result     | P6 match latency | Draft HTTP latency | Accepted facts | Serial batches | Pending wording |
| ----------------------------- | ---------- | ---------------- | ------------------ | -------------- | -------------- | --------------- |
| complete-java                 | PASS / 201 | 1.008 s          | 5.184 s            | 17             | 5              | 2               |
| academic-vs-proficiency       | PASS / 201 | 1.373 s          | 1.950 s            | 9              | 2              | 0               |
| ambiguous-then-user-clarified | PASS / 201 | 0.928 s          | 1.576 s            | 7              | 1              | 0               |
| jd-injection                  | PASS / 201 | 1.045 s          | 1.529 s            | 7              | 1              | 0               |

- Complete Java: all ten section kinds contain reviewed content; all 17 values and
  evidence remain exact. Two style proposals (skill punctuation and a prototype
  function-word adjustment) are pending only, never accepted automatically.
- Academic SQL Server: the professional proficiency OR requirement stays
  NOT_EVIDENCED with zero credit and all three alternatives NOT_EVIDENCED. Coursework,
  non-production/non-proficiency wording and the in-progress degree remain exact.
- Ambiguous attribution: initial generation returns 422 /
  CV_DRAFT_PROFILE_INCOMPLETE. After explicit synthetic user clarification, accepted
  employer content is user_entered with empty evidence and no original-CV support.
  The superseded source fact remains recoverable through the pinned profile.
- Injected JD: no PhD, expert SQL proficiency, 500-system production ownership or
  20-year leadership claim enters accepted fields. Job text remains relevance
  context, not candidate evidence.

Every final live result was compared against both the reviewed profile and its
persisted database document. Pins, exact accepted text, provenance and the original
P6 requirement modes/statuses/credit all matched. The final recorded source and
compiled hashes match the implementation used for acceptance.

A real provider transport failure against an isolated closed loopback port returned
503 / CV_DRAFT_UNAVAILABLE in 25 ms. The existing
draft remained unchanged and no extra draft was inserted. The shared Ollama daemon
was not stopped or reconfigured. Timeout/context/invalid-output failures were
covered by focused automated tests rather than fault-injected live.

### Failures found during live iteration

The initial run rejected a duplicated proposal in a singleton batch and a valid
fact proposal paired with an empty selection. Diagnostics also found a component
ID (`c3`) used as a parent requirement ID (`p1`). These failures created no partial
drafts. The initial result snapshot is retained in
`fixtures/p83-live-results.initial.json`.

The fixes tightened singleton proposal caps and explicit selection instructions,
distinguished parent/component names, and added model-facing ID allowlists while
retaining independent runtime envelope/allowlist validation through the existing
AiService dual-schema method. No references, evidence assertions or duplicate
checks were relaxed, and no repair/retry/fallback loop was added. All four pairs
were rerun against the final implementation and passed.

## Reproduce

Requires current API build/test compilation, the existing .env.test configuration,
and the pinned local model. The probe refuses stale compiled proposal/provider code.

```bash
pnpm db:test:up
cd apps/api
node --env-file=../../.env.test ../../docs/audits/p83-grounded-draft.probe.mjs
cd ../..
pnpm db:test:down
```

`P83_CASES=<comma-separated pair IDs>` scopes a diagnostic run;
`P83_DIAGNOSTICS=1` retains synthetic-only candidate responses. Default acceptance
runs all four pairs. Inputs and final documents/results are saved in
`fixtures/p83-live-inputs.json` and `fixtures/p83-live-results.json`. The probe uses
the real provider and confines its transport-failure injection to its own isolated
generator instance. Fixture rows/API services are cleaned up afterward.

## Limits and review boundary

No browser pass was needed because there are no frontend changes. No migration
lifecycle was rerun because the schema is unchanged. Full pre-PR CI remains pending.
The MVP intentionally supports bounded style changes rather than general prose
entailment; substantive paraphrases are rejected or require future work. Unknown
requirements and missing source sections remain visible, not filled with invented
facts. Live acceptance is a small synthetic sample, not a general reliability or
performance guarantee. Generation needs a current P6 match for the same source CV;
older drafts remain independently readable after that match expires.

Stop before P8.4. Benchmark artifacts, local skills and all pre-existing work were
preserved; no development data was modified.
