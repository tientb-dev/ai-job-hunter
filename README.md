# ai-job-hunter

Local single-user job inbox, application tracking, JD import/review, and explicit
CV–JD matching with local Ollama. The primary checkout is
`/home/tientb/projects/ai-job-hunter`. Authentication and multi-user deployment are
not implemented. Matching results require review; missing evidence is not proof
of missing ability.

## Implemented workflow

- `/` redirects to `/dashboard`; `/dashboard` and `/jobs` show Job Inbox.
- `/jobs/new` imports a job, then presents Review & Save. Manual entry, pasted
  text, PDF/DOCX, supported URL import, and supported open-page bookmarklets feed
  the same review/save flow. Extraction is an explicit action.
- `/jobs/:id` provides Overview, CV Match, Improve CV, Application, and Edit JD tabs.
- Application status, notes, recruiter/contact notes, contact dates, and follow-up
  dates persist in PostgreSQL. P4.1 adds applied date and application channel.
- CV Match saves parsed CV text locally and analyzes the latest saved CV/job only
  when requested. Results are shown in the UI, not written into tracking fields.
- Improve CV is always accessible. Upload/save a CV and successfully analyze
  the saved job in CV Match before explicitly requesting suggestions. Review up to four
  action-first suggestions initially, use Review evidence to inspect CV Match or
  Show all to see the remainder, and copy only supported original wording. CV/job edits and expired matches require fresh analysis.
  See the [P7 design and API contract](docs/audits/p7-cv-improvement-design.md).
- On-demand discovery queues candidates from the configured Axon, Backbase,
  Temus and Go1 Vietnam Greenhouse boards for explicit review and Save. Discovery ranking is not CV suitability scoring.
- `/cv` (My CV) saves, replaces and reviews the one source CV that every job
  uses; the one-off CV/JD analyzer is at `/cv/analyze`.

No automatic application submission, messaging, calendar sync, or status history
is implemented.

## Local development

Beta testers: follow the [Local + Gemini beta setup guide](docs/beta-local-gemini-setup.md)
instead of this section.

Use Ubuntu WSL2, Bash, Node 24.22.1 and pnpm 12.14.0:

```bash
cd /home/tientb/projects/ai-job-hunter
source "$HOME/.nvm/nvm.sh"
nvm use
pnpm install --frozen-lockfile
```

Preserve existing `.env` and `.env.test`. For a new installation only, copy the
example files without overwriting existing files and set distinct local passwords.
Never commit environment files, resumes, credentials, or production data.

Development requires `NODE_ENV=development`, `DB_ENV=development`, host
`127.0.0.1`, and database/user `ai_job_hunter_dev`. The Compose default database
port is 5432; retain the existing configured `DB_PORT` when reusing a local
installation. Port 5433 is reserved for tests. Process environment values override
file settings.

After checking the target database and authorizing any change to existing data:

```bash
pnpm db:up
pnpm db:status
pnpm db:migrate
pnpm dev
```

Migrations never run automatically. The commands above are setup instructions,
not a statement that migrations have been applied to an existing installation.
Do not reset existing volumes to resolve configuration or credential problems.

Open `http://127.0.0.1:5173`. Vite proxies `/api` to
`http://127.0.0.1:3000`; the API prefix is `/api/v1`. Changing `API_PORT` alone
does not update the Vite proxy. Local write endpoints validate Host and Origin;
arbitrary alternate frontend ports are not supported by default. Vite preview
on port 4173 is not the development API integration entry point.

- `GET /api/v1/health/live` checks process liveness without querying PostgreSQL.
- `GET /api/v1/health/ready` checks database readiness. It does not verify Ollama.

The default AI provider is local Ollama. Defaults are
`http://127.0.0.1:11434`, `qwen3:4b`, and a 120000 ms timeout. Generation checks
the pinned server/model profile in `apps/api/src/ai/ollama.context.ts`.
Manual tracking does not require inference. No model installation or cloud
fallback occurs automatically.

Optional hosted provider (PR29): set `AI_PROVIDER=gemini` and `GEMINI_API_KEY`
to use Google Gemini (`gemini-3.5-flash-lite`, the only accepted model). This
sends prompts, including CV and job text, to Google; use synthetic data unless
you accept that. Keep the key in an ignored env file, never in `.env.example`.

### Optional local speech-to-text (PR16)

Interview practice can transcribe a recording locally with
[whisper.cpp](https://github.com/ggml-org/whisper.cpp). It is optional; without it,
type or paste the answer into the transcript field. Build `whisper-cli` (CPU
build) and download the English `ggml-base.en.bin` model outside this repository,
then restart the API. A checkout at `~/whisper.cpp` (built in place, model in
`models/`) is found automatically; anywhere else, set absolute paths in `.env`:

```bash
STT_BIN=/path/to/whisper.cpp/build/bin/whisper-cli
STT_MODEL=/path/to/whisper.cpp/models/ggml-base.en.bin
```

The browser converts the recording to 16 kHz mono WAV (0.5 s–3 min) and sends it
only to this app's local API. Audio, transcripts and transcript feedback are not
saved. Transcription errs on technical terms; review and edit the text before
requesting AI feedback.

### Mock interview (PR17)

`/interview-prep/mock` (or **Mock interview** on Interview Prep, job practice and
a job's Interview tab, which uses that job's current set) asks 5–8 questions in a
row. Progress is saved, so a refresh resumes; an interview already in progress is
resumed before a new one can start. Opening a mock interview for a different
job or for Interview Prep asks first: continue the unfinished one, or finish it
(answers stay in Past interviews) and start the requested one. AI feedback
is optional. Only the confirmed answer text and optional feedback are stored,
never audio; finished interviews stay until you delete them.

### Interview feedback regression suite (PR23)

Shared synthetic cases live in `apps/api/test/support/interview-feedback.cases.ts`.
The unit suite replays genuine recorded model outputs through the real guards
(offline, in CI). For live model quality, run
`pnpm --filter @ai-job-hunter/api eval:feedback [--model qwen3:8b] [--out file.json]`
against local Ollama (refused under `CI`). Results are one indicative run per case;
invented-fact detection is heuristic. Documented limitations print as `KNOWN`.
To compare a prompt change, run it on a worktree of `main` and on the branch, then
diff the `--out` files.

## Commands and verification

| Command                                                                | Purpose                                      |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| `pnpm dev`                                                             | Run API compile/restart watcher and Vite     |
| `pnpm --filter @ai-job-hunter/api typecheck`                           | API and test TypeScript checks               |
| `pnpm --filter @ai-job-hunter/web typecheck`                           | Web TypeScript checks                        |
| `pnpm --filter @ai-job-hunter/api test:compile`                        | Compile backend tests into `.test-dist`      |
| `pnpm --filter @ai-job-hunter/web exec vitest run test/inbox.test.tsx` | Focused Inbox/Application tests              |
| `pnpm db:status` / `pnpm db:migrate` / `pnpm db:revert`                | Show/apply/revert development migrations     |
| `pnpm db:test:status` / `pnpm db:test:migrate` / `pnpm db:test:revert` | Equivalent isolated test operations          |
| `pnpm build`                                                           | Production compilation for both applications |
| `pnpm test` / `pnpm test:integration`                                  | Full unit/component suite / database suite   |
| `pnpm lint` / `pnpm format:check`                                      | Repository-wide quality checks               |

Use focused checks for small changes according to [AGENTS.md](AGENTS.md). Full
checks are for release checkpoints or explicit requests. No command listed here
is a claim of a fresh passing result.

Compiled migration commands append `:compiled` and require current API output
in `apps/api/dist`. Reverting removes the latest migration's schema additions;
review its impact before running it against a database with user data.

The separate test Compose project uses tmpfs, port 5433, database/user
`ai_job_hunter_test`, `DB_ENV=test`, and `NODE_ENV=test`. `pnpm db:test:up` and
`pnpm db:test:down` manage that disposable database. Integration tests must never
use development or production targets, and must not run concurrently against the
same test database. Some HTTP tests use Host port 3000; align their process
`API_PORT` with the test fixture when invoking them.

See [architecture](docs/architecture.md) for module boundaries, persistence,
security, and P4.1 migration verification. Older checkpoint and investigation
reports in `docs/` record historical work, not current acceptance results.

### Application details (P4.1)

Run `pnpm db:migrate` before using the updated API. In a saved job's Application
tab, optionally enter the date you actually applied and the application channel
(e.g. company website or referral), then **Save changes**. Both fields can be
edited or cleared; unknown dates remain blank and channel is separate from job
source. Contact dates represent actual contact. Follow-up date is a plan to
proactively contact HR if no response arrives, not a record of contact. Nothing
is sent automatically. Last HR contact date edits the latest stored contact date. Save replaces or
clears only that entry, preserves earlier history, and leaves follow-up unchanged.

### Due follow-ups (P4.2)

Job Inbox labels active jobs with past follow-up dates as Overdue and dates equal
to the browser's local calendar day as Due today. Future dates remain dates;
missing dates show —. REJECTED and CLOSED jobs keep their saved dates but have no
actionable label. Select **Due follow-ups** to show only overdue/due-today active
jobs in the existing order. Click a due label to open the job's Application tab.
Labels refresh across local midnight and when the page resumes. This is a planned
HR contact reminder only; it never records contact, changes status, or sends a
message.

Job Inbox displays ten jobs per page. Pagination below the table shows the current
range and filtered total. Changing Due follow-ups returns to page one; paging and
filtering reuse loaded jobs without fetching again or changing their saved order.

Open **Discover Jobs** in the navigation (or `/discover`) to use the discovery
form. It adds up to 50 new candidates per run to the persistent Discovery Queue.
Review candidates and explicitly Save to Inbox; discovery never saves automatically.
Use To review (NEW before SEEN), New, Seen, Saved, Dismissed, or All. The queue
uses ten items per page, with filter/page stored in the URL. Opening details does
not mark a candidate seen. Mark as seen and Dismiss are explicit actions.
Results stay on the Discover page; choose **View Job Inbox** when ready. If no jobs
are found, adjust preferences or use **Add Job**. The empty Inbox also links to
Discover Jobs and Add Job.
The Saved Jobs section shows the total saved count and groups the All jobs /
Due follow-ups selection with the table. The total heading counts all saved jobs;
the pagination range counts the selected filter's results.

The Discover page uses the Discovery Queue backend under `/api/v1/discovery`.
Apply the additive candidate migration using the existing migration commands
before using it; there is no historical backfill. Existing Inbox jobs stay unchanged.
The retired `/api/v1/opportunities/discover` returns 410 to stale clients.

- `POST /discovery/runs`: existing discovery preference body; returns
  `found`, `added`, `refreshed`, `remaining`, `errors`, `scannedAt`, `scope`.
- `GET /discovery/candidates?filter=to-review&page=1`: ten rows per page.
- `GET /discovery/candidates/:id`: candidate detail without changing review state.
- `PATCH /discovery/candidates/:id/status`: `{ "status": "SEEN" }` or
  `{ "status": "DISMISSED" }`.
- `POST /discovery/candidates/:id/save`: `{}` creates or links an Inbox job
  atomically. A `POSSIBLE_DUPLICATE` 409 requires explicit confirmation with
  `{ "confirmSeparate": true }` to create a separate job. An
  `AMBIGUOUS_INBOX_MATCH` 409 cannot be bypassed by that confirmation.

All paths above use the `/api/v1` prefix and mutations retain local Host/Origin
protection. Save returns `candidateId`, `status`, `opportunityId`, and an outcome
of `created`, `linked_existing`, or `already_saved`. Repeated Save returns the same
Inbox link. The UI asks for confirmation before creating a separate possible
duplicate; multiple exact matches cannot be overridden. After Save, use Open Inbox
job. Discovery reports Added / Refreshed / Remaining / Errors and stays on the page.

### P8.1 durable CV API foundation

Apply `pnpm db:migrate` before starting the updated API against a development
installation (or build the API and use `pnpm db:migrate:compiled`). P8.1 adds
immutable source/profile revisions and draft persistence. The completed workflow
below builds on that foundation while preserving CV Match and suggestion semantics. Capture is explicit; uploading alone does not archive a P8
source revision. The [architecture and API contract](docs/architecture.md#p81-durable-cv-foundation)
document version-1 endpoints, bounds, owner scoping and retention. Source text
requires an explicit protected content request. Referenced history cannot be
deleted automatically; explicit deletion proceeds draft → profile → source and
does not remove the separately saved current matching CV.

### P8.2 source CV review

In Job Detail → Improve CV, choose **Review source CV**, then explicitly **Build
structured proposal** or review unresolved passages manually. Confirm clear
sections, clarify ambiguous fields, edit separate user-entered values and **Save
source review** to append a revision. Exact original wording/evidence is retained;
unknown passages remain visible and exclusions require a reason. Local Ollama
uses the existing qwen3:4b configuration. Failure leaves the saved profile intact.
Tailored draft generation and downloads are covered below. See the
[P8.2 architecture and API contracts](docs/architecture.md#p82-structured-source-cv-review).

### P8.3 tailored draft generation API

The backend can generate a complete structured draft from the latest fully
reviewed source profile, a saved job revision and its current CV Match identity.
Version-1 endpoints under `/api/v1/tailored-cv` generate/list job drafts and retrieve
a saved draft. Original reviewed wording remains accepted; AI priorities and
bounded wording changes remain separate recommendations/pending proposals.
Unselected eligible content remains included and recoverable. No migration or
new dependency was needed for generation beyond the P8.1 foundation. Review
and downloads are covered below. See the [P8.3 contracts and limits](docs/architecture.md#p83-grounded-tailored-draft-generation).

P8.4 adds Tailored CV review in Job Detail → Improve CV: load or generate a draft,
edit section fields, decide AI wording proposals, save, and explicitly approve the
saved revision. Later edits clear approval; regeneration creates a separate draft.
DOCX/PDF downloads are available in the completed journey below. Review APIs under `/api/v1/tailored-cv` are
`POST /drafts/:id/review` (version 1, expected revision and bounded operations) and
`POST /drafts/:id/approve` (version 1, expected revision and reviewed edited-fact IDs).
See [the review contract](docs/architecture.md#p84-tailored-cv-review-and-editing)
and [P8.4 acceptance](docs/audits/p84-tailored-cv-review-acceptance.md).

### Complete tailored CV journey

1. Open a saved job → **CV Match**. Upload a text-based PDF/DOCX (or use the current
   saved CV) and **Analyze CV Match**.
2. In **Improve CV**, open **Review source CV**, generate a structured proposal,
   review/confirm sections and clarify ambiguous fields. Map or explicitly exclude
   unresolved passages, then **Save source review**.
3. **Generate new draft**. Inspect the complete CV, accept AI wording or keep the
   original, edit section fields, choose which facts to include in downloads, and
   acknowledge review issues. **Save draft**, review the complete saved content,
   then **Approve saved draft**.
4. **Download DOCX** or **Download PDF**. Any subsequent wording/inclusion edit
   clears approval and requires Save/Approve again. **Load saved drafts** reopens
   previous work; generation always creates a separate draft.

Export uses exact approved wording and no AI. Downloads use a single-column A4
layout with Vietnamese Unicode support; unsupported font characters fail with a
clear error. Font assets under `apps/api/assets/fonts` must accompany API runtime
files. DOCX layout can vary with the viewer's available fonts.

The version-1 export API is `POST /api/v1/tailored-cv/drafts/:id/export` with
`expectedRevision` and `format: "docx" | "pdf"`. Private browser reads use POST
aliases with version-only bodies to preserve strict local Origin validation.
See [P8 completion/acceptance](docs/audits/p8-complete-acceptance.md) for full test
results, screenshots, synthetic downloadable samples and known limitations.

Source CV Review now groups paragraphs, experience records and skill categories.
Use **Review issues** for uncertain details, **Edit** for corrections, **Confirm
section** for clear source facts, then **Save review** and **Continue**. Corrections
require explicit confirmation and retain user-entered provenance. Source evidence
is available in expandable record disclosures.

Older profiles show an explicit **Organize my CV** action. Organizing
creates a new pending revision; previous corrections remain accessible under
**Earlier review**, and saved drafts remain unchanged. Review and reapply any
needed corrections before continuing. See the
[structure/review acceptance report](docs/audits/p8-structure-review-fix.md).

If an earlier Source CV Review shows work history under Other information, choose
**Organize my CV**. It creates a new review and preserves earlier corrections and
tailored CVs. After success, check highlighted details, confirm sections and save.
If organization fails, your saved review remains unchanged; retry Organize my CV
(or start Ollama if it is unavailable). Use **Reload saved review** after a stale
revision conflict. Over-limit CVs require a shorter source uploaded in CV Match;
content is never silently truncated. See the
[P8 organizing blocker report](docs/audits/p8-blockers-acceptance.md).

For a saved review with combined contact text or missing skill groups, choose
**Reorganize from source** to apply the contact/skills fix as a new revision.
Earlier reviews and tailored drafts stay unchanged. Recognized contact details
are separated from unreadable fragments; separator symbols require explicit
review/exclusion. Backend, Frontend and other structurally clear skill groups
are preserved even when AI omits their classification. Resolve any remaining
unassigned content before continuing. See the
[contact/skills acceptance report](docs/audits/p8-contact-skills-acceptance.md).

Tailored CV shows explicit generation readiness. After saving Source CV Review,
use **Continue to tailored CV**, then analyze CV Match (or use **Refresh CV Match**
in place). A fresh match enables generation automatically, including after tab
navigation. Expired/replaced matches can be refreshed without another upload or
source review. **Load saved drafts** reports an empty list or shows saved drafts
that can be reopened independently of match readiness. See the
[workflow acceptance report](docs/audits/p8-workflow-acceptance.md).
