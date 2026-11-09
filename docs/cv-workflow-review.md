# CV Workflow Review — Job Detail to Export

Status: discovery only. No code changed. Findings are **confirmed** from source unless marked _recommendation_.

## 1. Current flow (confirmed)

```
/jobs/:id  (JobEditor tabs: Overview · CV Match · Improve CV · Application · Edit JD)
   │  ?tab=match ──► CvMatchPanel view="match"   → GET/POST /opportunities/:id/match
   │  ?tab=improve ─► CvMatchPanel view="improve" → CvSuggestionsSection (P7, local AI)
   │                                              + "Open Tailored CV" button (blocked if JD dirty)
   ▼
/jobs/:id/tailored-cv  (TailoredCvPage → the SAME CvMatchPanel, wizard=true)
   Stepper (nonLinear): 0 Source CV → 1 CV Match → 2 Tailor & Review → 3 Preview & Export
   - Entry step auto-resolved once from: draft list, match status, /drafts/readiness
   - Step 0 SourceCvReview  → "Continue" jumps to 1, or 2 if match VALID
   - Step 1 match panel (same markup as Job Detail tab)
   - Step 2/3 TailoredCvReview (one component, sections hidden by wizardStep)
     generate /jobs/:id/drafts · review ops · approve revision · export DOCX/PDF
   - "Continue existing draft" button above stepper
   - Back link → /jobs/:id?tab=improve
```

Persistence: saved CV (`/cv/current`), source profile/review revisions, one current `cv_match` per job (status VALID / STALE_CV / STALE_JOB / EXPIRED, `matchValidForMs` ≤ 15 min, re-polled on window focus), tailored drafts with revisioned review + approval pinned to profile/source/match/job revisions. Export re-validates approval server-side (`canonicalExport`).

Invalidation: job save or CV change → match STALE; readiness reports `CV_DRAFT_STALE_MATCH` / `MATCH_REQUIRED`; saved drafts remain as history with their own approval and are never treated as current readiness.

## 2. CV Match duplication (confirmed)

- **Same analysis, same component.** Both screens render `CvMatchPanel` and read the same `GET /opportunities/:id/match`. Analysis is only started by explicit user action; neither screen re-runs AI on load. There is no duplicated AI work — only duplicated **display and controls** (upload CV, Analyze, requirement list) in two places.
- **Inputs differ subtly.** Job Detail passes `revision = savedRevision + JSON(form)` and `jobDirty`, so unsaved JD edits reset the result locally; the wizard passes the saved `updatedAt` only. The server result is the same record, keyed to saved job + CV timestamps.
- **Sharing is already safe**: a VALID match is validated against current `cvUpdatedAt`/`jobUpdatedAt`; draft generation pins `matchId` and readiness rechecks it.
- **Purposes overlap**: Job Detail "CV Match" answers _"should I apply?"_; wizard step 1 is a _gate_ before tailoring. Same UI serves both, so the gate looks like a full analysis screen.
- **Structural cost**: `CvMatchPanel` (~1.9k lines) owns tab content, wizard stepper, entry resolution, source review, suggestions and draft orchestration via `wizard`/`view` flags. This is the main source of coupling and regressions.

## 3. Top UX problems (ranked by user impact)

1. **Two homes for one job.** "Improve CV" tab offers P7 suggestions _and_ a button to a separate Tailored CV wizard; users can't tell which produces the CV they export.
2. **Opaque auto-entry.** The wizard opens on a computed step after "Finding your next step…"; plus a separate "Continue existing draft" button — two competing resume mechanisms.
3. **Step statuses are noisy and inconsistent**: "Saved match", "Earlier draft approved", "Unavailable · open a draft first", "Action required", "Not completed", "Active". Draft history leaks into step status.
4. **CV Match repeated in full** as step 1 instead of a compact gate ("Match current ✓ / Re-analyze").
5. **Tailor & Review / Preview & Export are one component split by visibility**; approval, local-edit and "not approved" messages repeat across both steps.
6. **Blocker copy is scattered** (dirty JD, dirty source review, busy analysis, suggestions running, stale match) across alerts, disabled buttons and tooltips; no single "what to do next".
7. **Return path** always lands on `?tab=improve`, not where the user came from or a summary of the draft.

## 4. Proposed flow (_recommendation_)

```
Job Detail                                   Tailored CV workspace (/jobs/:id/tailored-cv)
 Overview · Fit (CV Match) · Application · Edit JD
   Fit = read/run match, view evidence        1 Source CV   (review once, reused across jobs)
   CTA: "Tailor CV for this job" ───────────► 2 Tailor      (compact match gate + generate + review)
   Card: latest draft status/ resume ◄────────3 Approve & Export
```

- **Job Detail owns fit assessment** (full CV Match, evidence). **Tailored CV owns producing the document.**
- **Unify CV Match data, separate presentation**: one shared match hook/read model; wizard shows a compact `MatchGate` (score, freshness, Re-analyze, "View details" → Job Detail Fit tab). Never auto-analyze.
- **Merge "Improve CV" into the workspace**: P7 suggestions become a side panel in Tailor (they target the same CV), removing the extra tab.
- **One resume model**: always open the latest draft if it matches current pins; otherwise open first blocked step with one explicit banner ("Your CV/job changed — re-check match"). Drafts list as "History", not step status.
- **Three statuses only**: Done · Needs action (with reason) · Locked (with reason). One "Next step" panel lists the single current blocker.
- **Keep safeguards**: per-fact accept/reject/edit, revision-specific approval, server-side export recheck, no silent AI acceptance, no generation on stale pins.

## 5. Implementation plan (_recommendation_)

| #   | Change                                                                                                                        | Risk / mitigation                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Extract match read/analyze state from `CvMatchPanel` into a `useCvMatch(jobId)` hook; no UI change                            | Stale-guard and generation-counter logic must move intact; reuse `cv-match`, `match-reuse-navigation` tests |
| 2   | Split `CvMatchPanel` into `JobFitPanel` (Job Detail) and `TailoredCvWorkspace` (wizard)                                       | Largest refactor; do behind unchanged tests, one PR                                                         |
| 3   | Replace wizard step 1 with compact `MatchGate`; link to Job Detail for evidence                                               | Ensure readiness `MATCH_REQUIRED/STALE` still blocks generation                                             |
| 4   | Simplify statuses + single "Next step" blocker panel; drop "Continue existing draft" button in favour of deterministic resume | Resume must never present an old draft as current/approved                                                  |
| 5   | Move P7 suggestions into Tailor side panel; remove "Improve CV" tab (redirect `?tab=improve`)                                 | Keep suggestion invalidation on match change                                                                |
| 6   | Job Detail draft-status card + return to origin                                                                               | Low                                                                                                         |

Backend contracts (match, readiness, drafts, export) need no change for steps 1–6. Remaining risk: hidden coupling inside `CvMatchPanel` dirty/busy flags that gate navigation; test coverage of those combinations should be confirmed before step 2.
