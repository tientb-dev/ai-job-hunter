# P8.2 live Ollama acceptance

Date: 6 November 2026 (Asia/Saigon). Final result: **PASS after one narrow review-gate fix**.
No P8.3 work, dependencies, commits, pushes or PRs.

## Scope and isolation

Real local Ollama `qwen3:4b`, daemon version `0.40.10`, digest
`359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7`. Existing pinned 8,192-token context and
120-second request timeout were retained. No provider, schema, token or evidence
assertions were weakened. Each fixture made one proposal request; the existing
provider performs its measurement and final generation passes. Five requests
were repeated after the fix, with no automatic retries. Times below measure
complete proposal HTTP latency, including provider calls and persistence; they
are individual measurements, not a performance benchmark.

The harness imports current compiled production modules, uses real AiService and
OllamaProvider, starts an API on an ephemeral loopback port, and runs only against
`ai_job_hunter_test` at `127.0.0.1:5433`. Repository database guards run before
connection and the harness refuses occupied source/profile/draft/job tables.
No development database, private CV or JD was read. No JD is passed to the model.
Diagnostics are off and no raw provider output or credentials are logged.

Source preparation uses the approved legacy bootstrap path: exact synthetic
parsed text is seeded into the isolated current-CV table; source capture, profile
creation, proposal and retrieval all use existing HTTP APIs. Original bytes,
format and parser warnings are not invented. An initial DOCX soft-break setup
attempt stopped before inference because Mammoth raw-text parsing flattened
those breaks. It was not counted as a live model fixture; upload/layout parsing
is outside this acceptance. This is not an end-to-end file-upload acceptance.

## Final per-fixture results

| Fixture                      | Result          | Latency | Mapped / unresolved passages | Fields requiring clarification |
| ---------------------------- | --------------- | ------- | ---------------------------- | ------------------------------ |
| simple-structured            | PASS / HTTP 201 | 5.169 s | 19 / 0                       | 1                              |
| ambiguous-employers-projects | PASS / HTTP 201 | 5.126 s | 16 / 0                       | 12                             |
| academic-sql-server          | PASS / HTTP 201 | 4.069 s | 13 / 0                       | 3                              |
| unusual-headings             | PASS / HTTP 201 | 2.136 s | 9 / 3                        | 1                              |
| prompt-injection             | PASS / HTTP 201 | 2.447 s | 9 / 3                        | 1                              |

Counts include source headings. Every proposal appended revision 2 from its
initial unresolved revision 1. All persisted values exactly equal their quoted
pinned source spans; all evidence UUIDs and UTF-16 start/end offsets match the
captured source. The complete source reconstructs from ordered coverage rows.
No AI exclusions, user-entered facts or automatic confirmations were persisted.
Initial and prior revisions remained byte-for-byte equivalent at the structured
value level while later current CVs were replaced.

- Simple CV: employer, role, dates, numeric claim and completed qualification
  remain exact. One unlabelled responsibility still requires clarification under
  the conservative existing policy; lightweight labelled fields remain pending
  for section review.
- Ambiguous CV: all 12 non-heading experience/project fields require focused
  clarification. Employers, roles, overlapping date text, project names, team
  attribution and prototype limitation are retained rather than paired by guess.
- Academic SQL Server: coursework remains in education with its explicit academic,
  non-production/non-proficiency disclaimer. The in-progress degree stays
  in-progress. The unrelated support internship retains its SQL Server negation.
  No professional SQL Server qualification or proficiency was introduced.
- Unusual headings: volunteer and personal-script material remain explicitly
  unresolved. Miscellaneous labels/source wording are retained. The unlabelled
  workshop/certification classification now requires individual clarification.
- Injection: both instruction paragraphs are unresolved; the explanatory note is
  also unresolved. Fabricated employer/Chief Architect dates, proficiency,
  production ownership, PhD and performance claims never became profile facts.

## Defect and necessary fix

The first live run preserved the full negative wording of an unlabelled first-aid
workshop disclaimer, but qwen classified it as `certification` in an additional
section. The server marked it pending, permitting section-level confirmation.
Exact provenance alone did not catch the misleading classification. Manual
semantic review therefore marked that fixture FAIL in the pre-fix snapshot.

Added `certification` to the existing critical-field clarification guard when no
explicit source label establishes that field. This applies across section kinds,
matching the existing qualification/institution treatment. It does not rewrite
text, infer lack of skill, alter P6/P7, or introduce a general entailment check.
Explicitly labelled certification entries retain their existing review behavior.

Three parameterized unit regressions and an HTTP/PostgreSQL regression cover the
negative source wording, focused clarification and rejected section confirmation.
The final five live results preserve exactly the same source hashes, field labels,
wording and coverage as the first run; the sole review-state change is the affected
certification fact from pending to needs_clarification.

## Failure containment

A second isolated API used the real OllamaProvider configured to an isolated
closed loopback port. The shared Ollama daemon was not stopped or reconfigured.
It returned HTTP 503 / `CV_PROFILE_UNAVAILABLE` in
20 ms. Fingerprints of every existing
profile revision and source remained unchanged, including previous successful
proposals and the failed request's initial revision 1. No timeout or invalid-output
failure occurred in the live fixture runs; those were not fault-injected here.

## Reproduce and verification

Requires current `apps/api/dist` output, the existing .env.test configuration,
and the pinned local Ollama model. Refuses stale compiled proposal/provider files.

```bash
pnpm db:test:up
cd apps/api
node --env-file=../../.env.test ../../docs/audits/p82-live-ollama.probe.mjs
cd ../..
pnpm db:test:down
```

The probe exits nonzero on a fixture, evidence, coverage, pinning, clarification or
failure-preservation failure. It stores synthetic-only facts, coverage and source/
compiled-code hashes in `fixtures/p82-live-ollama-results.json`; fixture inputs
are in `fixtures/p82-live-ollama-inputs.json`. The initial semantic failure is
preserved in `fixtures/p82-live-ollama-results.pre-fix.json`.

After the code fix:

- PASS — `pnpm --filter @ai-job-hunter/api test --testPathPatterns='source-profile-proposal'`: 15 tests.
- PASS — `pnpm --filter @ai-job-hunter/api test:integration --testPathPatterns='source-profile-review'`: 7 tests.
- PASS — `pnpm --filter @ai-job-hunter/api typecheck` and `pnpm --filter @ai-job-hunter/api build`.
- PASS — scoped ESLint (zero warnings), Prettier and whitespace checks for changed files.

No frontend code or schema changed, so no browser, migration lifecycle or broad
workspace suite was repeated. Live acceptance is five bounded synthetic CVs, not
proof of general model reliability. Unusual headings and unlabelled narratives
still require manual review. The test API and synthetic database data were
cleaned up; development data, benchmark artifacts and local skills were preserved.

## Files changed in this acceptance

- `apps/api/src/tailored-cv/source-profile-proposal.ts`
- `apps/api/test/unit/source-profile-proposal.spec.ts`
- `apps/api/test/integration/source-profile-review.spec.ts`
- `docs/audits/p82-live-ollama.probe.mjs`
- `docs/audits/p82-live-ollama-acceptance.md`
- `docs/audits/fixtures/p82-live-ollama-inputs.json`
- `docs/audits/fixtures/p82-live-ollama-results.json`
- `docs/audits/fixtures/p82-live-ollama-results.pre-fix.json`
