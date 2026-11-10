# Architecture

## Workspace and runtime

The pnpm workspace contains `apps/web` (React, Vite, MUI, React Router) and
`apps/api` (NestJS modular monolith). TypeScript is strict. The API uses NodeNext
ESM, `.js` import specifiers, and decorator metadata. There is no shared ORM
package or separate application-tracking service.

`tsc-watch` recompiles the API and starts Node after successful compilation.
Vite serves the browser on loopback port 5173 and proxies `/api` to port 3000.
API routes use `/api/v1`; liveness is independent of database readiness.
`App.tsx` mounts Job Inbox at `/dashboard` and `/jobs`, JobEditor at `/jobs/new`
and `/jobs/:id`, and the retained CV/review dashboard at `/cv`.

## Module ownership and product flows

`opportunities` owns saved jobs, original JD content/documents, reviewed import
fields, and application tracking. Its controller exposes list/create/read/update,
parse/import/extract, saved-CV, matching, and discovery operations. Writes validate
external input and use the existing local Host/Origin policy. The service uses
TypeORM directly; no generic repository wrapper or duplicate Application entity
is needed.

JobEditor imports sources before Review & Save. Saved jobs have Overview,
CV Match, Application, and Edit JD tabs. Editing remains local until Save changes;
failed saves retain input. Saves update the whole editable record across tabs.
Existing unresolved import conflicts can prevent a save. Updates have no version
check and retain last-save-wins behavior.

`extraction` owns bounded PDF/DOCX parsing, extraction contracts, evidence handling,
and local AI orchestration. Parsing and inference are distinct actions; a parsed
document is not automatically a verified qualification. `ai` validates the local
Ollama configuration and generated output. The pinned context profile requires
Ollama 0.40.10 and the configured qwen3:4b digest: 8192 context tokens, at most
6080 measured prompt tokens, 64 safety tokens, and a final output budget of
min(4096, 8192 minus measured prompt tokens minus 64), with a minimum of 2048.
There is no automatic remote-provider fallback.

`matching` owns the saved CV and saved-job matching service as well as the
retained analysis matching code. Explicit CV Match uses the latest saved CV/job,
validates source evidence, and returns a heuristic assessment for user review.
CV quotes are selected from bounded source passages and validated against saved
text; missing/unverified evidence must not be described as proof of missing skill.
Browser matching results do not alter application status, dates, or notes.

Saved-CV compound matching uses shallow request-local parent/component identifiers
inside the existing matching module (`cv-match.coverage.ts`). Contextual source
clauses retain one required/preferred weight (3/1); only bare comma/semicolon
technology lists create independent parents. The server derives explicit flat
AND/OR components and common constraints, so model-selected passages cannot alter
the denominator, operator or component count. Optional per-component quotations
support evidence on separate CV lines while legacy parent-only proposals remain
valid. AND earns proportional component credit; OR needs one supported alternative
and any recognized shared constraints. Unknown and conflicting coverage earns zero;
any non-full required parent blocks Apply. Generic-duration and Domain weights
remain unchanged. Extra model requirements are validated but excluded from scoring.

Evidence provenance is checked separately from bounded semantic support. Explicit
term/alias and action/knowledge checks, personal production-delivery guards,
minimum-duration guards and source-backed negative/contradictory passages constrain
compound credit. Ambiguous/nested forms remain Unknown rather than being flattened
into an invented logic tree. This deliberately conservative parser is not universal
natural-language entailment or a new requirements AST; uncommon synonyms and
unrecognized equivalence need human review. Model schema/evidence failures retain
the existing typed failure paths. CV Match displays parent/component quotations,
Partial, Unknown and Conflict alongside Matched; no entity or migration is needed.
The separate Task 04 structured-extraction matcher keeps its existing policy.

When a verified proposal omits an explicit OR alternative, deterministic recovery
may select a positive original CV passage for a term in the existing alias registry.
The same component support checks enforce common context, delivery and duration;
negation, aspiration, contradictory evidence and coding-tool passages cannot become
full OR credit. Recovery keeps an exact source span, never changes raw model output,
and this OR path is disabled for rejected parent evidence, AND/SINGLE/ambiguous groups and
unrecognized aliases. Existing Java/generic-duration recovery remains unchanged.

Canonical Bachelor-level education OR groups have a separate degree recovery path,
without adding education prose to technical aliases. An explicit degree assertion
and a relevant named field are required. The scorer can retain a bounded original
span containing a degree line, an immediately adjacent field-only continuation and
nearby completion/status metadata (at most four lines, 2,000 characters). Blank
lines, another qualification or intervening institutions prevent field stitching.
Incomplete, pending, negative or contradictory degree evidence cannot earn full
credit; selected degree-only quotes cannot hide adjacent pending status. Attendance
and dates alone do not establish a degree, and generic work duration never recovers
practical equivalence. Rejected evidence stays rejected; no general AND recovery,
schema, score-weight or persistence change is involved.

AND omission recovery is a separate bounded path for explicit design-context
components: APIs, CI/CD practices, integrations, data flows and cloud-based
architectures. Each component must match its own validated term and positive
source context; non-CI/CD components require design context. Technology lists,
AWS or RabbitMQ alone are insufficient.
Future, incomplete, negative, contradictory and coding-tool evidence cannot earn
recovery credit. Original source passages are retained (at most 2,000 characters),
and rejected parent evidence disables recovery. Existing proportional credit and
one canonical-parent weight remain; one component never satisfies a five-component
parent. Knowledge/experience-only, unrecognized and ambiguous AND groups receive
no new recovery. OR and education paths keep their existing semantics.

The design-context AND component `CI/CD practices` has a narrow applied-work
exception: explicit pipeline/automation design, implementation, configuration or
optimization can satisfy that component. Implementation/configuration/optimization
must act on a named CI/CD pipeline/workflow/automation context, its spelled-out
continuous integration/delivery/deployment equivalent, or a bounded automated
build-and-test/deployment pipeline form. Using a pipeline for unrelated work is
not pipeline implementation evidence. Model-selected quotations and omission
recovery use the same component-specific predicate and existing negative/conflict
and rejected-evidence gates. Other component design predicates, OR and education
semantics, source quotations, parent weights and recommendation rules are unchanged.

`discovery` retrieves the configured Axon, Backbase, Temus and Go1 Vietnam public Greenhouse boards
on demand, ranks using the supplied filters, and queues candidates for explicit
Save through OpportunitiesService. Exact links preserve existing Inbox jobs. This is not
background crawling, auto-apply, or CV fit analysis. The legacy `jobs` feed module
and `analysis` transport remain in the API; they do not replace the saved-job
workflow.

URL/page import reuses review/save rather than adding a second job model.
Server-side URL fetching is restricted and bounded; open-page import validates
its supported payload, origin, and nonce handshake. Importing or saving a job
does not submit an application or send messages.

ITviec Fetch preserves the verified server-rendered job-header taxonomy in
response-only `sourceMetadata` arrays. Existing xmldom tooling parses a balanced,
scoped header fragment, avoiding unrelated page XML/SVG and excluding tooltip
content. Skills remain supplemental tags; expertise remains source classification.
Explicit domains map to the existing Domain string with `; ` separators and a
bounded, verbatim source block. Deterministic recovery treats each block entry as
atomic evidence, preserving commas/conjunctions and genuine source conflicts.
Add Job protects fetched domains against omitted AI proposals and respects manual
edits and source replacement. Generic JSON-LD industry is not a domain fallback.
No taxonomy entity, migration or new dependency is required; unknown page layouts
remain absent rather than being inferred from navigation or analytics.

Explicit qualification headings in Add Job extraction consistently enable
source-clause recovery. Mandatory and preferred qualifications preserve knowledge
levels, delivered-project constraints, education and AND/OR alternatives; plain
technology lists keep the existing safe splitting rules. The existing proposal
normalizer replaces fragments with the recovered clauses from their source row,
so generic keywords do not duplicate complete requirements. Plus-years experience
is normalized separately while the accompanying qualification remains evidence.
This applies to new suggestions; historical/manual evidence is not retroactively
rewritten. The pinned model profile, single-generation budget and strict evidence
gates remain unchanged. CV Match still consumes the existing saved text fields.

## Persistence and configuration

PostgreSQL runs in Docker. The development Compose project uses a persistent
named volume. The test project has separate identity/credentials and tmpfs
storage. Development defaults to port 5432; an existing installation may override
it. Port 5433 is reserved for tests. `databaseOptions` validates target, role,
database, loopback host, port, and required password before connecting.

`Opportunity` stores job/import data, source documents, tracking fields, discovery
metadata, and creation/update timestamps. `SavedCv` stores one current parsed CV
per local owner. The server assigns a fixed local owner; this is not authentication
or multi-user isolation. Source document bytes and saved CV text are private
local data, not fixtures or repository artifacts.

Status is one of SAVED, CONTACTED, JD_RECEIVED, APPLIED, INTERVIEW, OFFER,
REJECTED, or CLOSED. Transitions are unrestricted. Application notes and
recruiter/contact notes are separate strings. Contact dates are a bounded array
of unique valid calendar dates; array order records entry order rather than
chronological sorting. Follow-up is a nullable PostgreSQL date. Job Inbox currently
displays that date with the P4.2 due/overdue behavior described below.

TypeORM uses an explicit migration list in `database.config.ts`,
`synchronize: false`, and `migrationsRun: false`. History is in public; domain
tables are in `ai_job_hunter`. The migrations create the application schema,
opportunities, smart-import fields, complete import fields, saved CV, discovery
metadata, and P4.1 application details. CLI source execution uses ts-node ESM;
compiled commands use `dist` and require current compiled output. Startup does
not apply migrations.

## Security and operational limits

The API binds to loopback. Local write guards validate explicit Host/Origin
allowlists; opportunities also supports explicit localhost development aliases.
Those guards do not provide authentication. Credentials and server configuration
stay out of frontend bundles. Storage failures use sanitized responses.
Development/test identities are deliberately distinct; integration tests must
refuse development and production targets.

No authentication, multi-user deployment, automatic messaging, calendar sync,
or status-history timeline is implemented.
Real-browser acceptance and live inference quality are separate from synthetic
checks. Archived checkpoint reports must not be interpreted as current test
results. Apply the Fast Iteration policy in AGENTS.md when selecting checks.

## P4.1: application details

The existing Opportunity owns nullable `appliedDate` (PostgreSQL date) and
`applicationChannel` (varchar(200)). Applied date means actual submission, never
inferred from status, contact dates or timestamps. Channel is manually entered
text independent of job source; a separate application model or channel catalog
is unnecessary for this local MVP. Blank/whitespace-only channels normalize to
null. Existing records receive null without a backfill.

Existing create/update routes serialize these fields with the opportunity.
Omitted fields default to null on creation and preserve saved values on update,
so older clients do not erase them. Explicit null clears either field. The
Application tab retains the existing whole-record Save changes flow and keeps
input on failure. Contact dates record actual contact; follow-up is a plan to
contact HR if no response arrives. Neither action automatically changes the
other or status. The Application UI edits only the chronological latest contact date through
Last HR contact date. ISO date strings are compared directly without timezone
conversion, so unsorted history works. Save replaces or removes that original
latest entry, preserves earlier entries and deduplicates the replacement. An
unchanged picker sends history unchanged. After Save, the picker shows the latest
remaining date, which can reveal an older entry after clearing. Input and history
remain intact on failure, and edits survive tab switching. The existing 100-date
bound is preserved because replacement never grows nonempty history.

Application uses one outlined Paper matching Overview, with compact responsive
fields and dividers for details, contact/follow-up, and notes. Its submit button
lives in a normal-flow Paper footer and uses the existing whole-record form save;
Edit JD retains its existing action layout. No scroll container is added.

The additive ApplicationDetails migration adds only these two nullable columns.
Rollback removes only those columns (and any newly entered values), preserving
all older fields and rows. Status history and follow-up indicators remain outside
P4.1. Whole-record updates retain existing last-save-wins concurrency behavior.

P4.1 verification used `test/manual/application-details.migration.ts` against a
fresh disposable test database, first through `node --env-file=../../.env.test
--loader ts-node/esm test/manual/application-details.migration.ts` from apps/api,
then through `node --env-file=../../.env.test
.test-dist/test/manual/application-details.migration.js` after `pnpm
--filter @ai-job-hunter/api test:compile`. Recreate only the dedicated disposable
P4 test container between these runs: the harness refuses an existing opportunities
table. Each run checks database identity, applies the baseline, inserts a synthetic
row, and verifies apply/repeat/revert/reapply/repeat and preservation of older values.
This uses test compilation, not a production build.

## P4.2: actionable follow-ups

The Inbox derives urgency from validated YYYY-MM-DD strings compared to a date
constructed from the browser's local year/month/day. Stored dates are never
parsed as UTC timestamps. REJECTED and CLOSED are excluded from actionable labels
and the Due follow-ups filter without changing their persisted dates. Filtering
preserves API row order. Due links use the existing job route with
`?tab=application`; JobEditor honors this on navigation while retaining ordinary
tab switching and the existing save flow.

A local-midnight timer refreshes labels and filter membership. Focus and visibility
changes catch suspended tabs; a one-minute timer cap catches clock/timezone
changes. Timers and listeners are removed on unmount. No extra API polling, writes,
backend changes, schema changes, status transitions, or contact recording occurs.

## Inbox pagination

Job Inbox filters the already loaded records before selecting a ten-row page,
retaining API order. Filter changes reset to page one; the displayed page is
bounded by the current result count. MUI pagination below the table reports the
range and filtered total without extra API calls. Entering the Inbox loads the
current saved jobs, including jobs imported from the separate Discover page.

The table remains mounted for empty results. The Inbox pilot combines title,
company and source into a primary row identity, with status and follow-up at the
trailing edge (stacked below on narrow screens). Rows omit discovery timestamps and technology lists; persisted data is unchanged.
Valid original links remain accessible via a labelled external-link action.
Ordinary rows use two text lines with 8px vertical padding (approximately 64–72px
including status), growing naturally when text wraps. Missing follow-up dates
render no placeholder; actionable dates show urgency linked to Application.

Inbox routes now use the existing viewport-bound shell. The results container
scrolls within the remaining flex allocation, while the toolbar and pagination
remain outside it. This addresses document-height shrinkage as a likely source
of filter scroll clamping without fixed row heights or empty spacers. The results
container reserves scrollbar width and disables scroll anchoring; filtering still
uses local data and stable row keys. Its own scroll offset may clamp when results
shrink, but that should not move the toolbar. The Inbox outer area allows overflow
as a fallback; short screens, zoom and nested scrolling need real-browser
acceptance. Smoothness has not been browser verified.

Discover Jobs now lives at `/discover`, using the existing navigation and normal
document scrolling. A thin PageHeader/outlined-Paper page wrapper reuses the
existing DiscoverJobs form and request/state logic; there is no second discovery
implementation or global state store. The form is visible immediately. Copy
explains direct saving and the 50-new-job limit before submission; result counts,
partial errors, cache guidance and a View Job Inbox link remain on the page.
Navigation is explicit, not automatic. Component-local preferences/results last
while the page is mounted; leaving and returning starts a fresh form, as other
unmounted local-state screens do. Backend discovery behavior is unchanged.

The Inbox no longer embeds a disclosure or discovery form. Its empty state links
to Discover Jobs and Add Job. A Saved Jobs section groups the total count,
exclusive labelled filter buttons, compact table, and bottom pagination. The
all-jobs count is separate from the filtered pagination total. Local spacing and
cell wrapping changes do not alter global styling, data order, or source links.

## UX foundation

The frontend retains one MUI theme and the existing 8px spacing base. Shared
page titles use PageHeader; the shell owns matching header/content gutters.
Specialized job-editor headers remain local. Typography preserves CV Match's
section/body metrics and score styling; no global surface, field, icon or
accordion overrides are introduced. Button casing, minimum sizes and focus
treatment are shared defaults. This avoids a second design system or generic
table/form framework. See [UX guidelines](ux-guidelines.md) for conventions.

## Discovery queue persistence foundation (P5.2b)

Verification update: the checkpoint-era pending database checks below were
completed in P5-M2. Source/compiled migration lifecycle, PostgreSQL concurrency
tests and Chromium acceptance against an isolated live API/database passed.
See [P5 merge readiness](audits/p5-merge-readiness.md) for current evidence and
remaining scope; earlier checkpoint verification notes are historical.

`discovery_candidates` stores owner-scoped source identities, four queue states,
validated bounded JSONB snapshots, first/last-seen timestamps and an optional
restricted foreign key to an Inbox opportunity. A unique source identity, finite
ordered timestamps and SAVED/link consistency are enforced by the additive
migration. Snapshots use the existing DiscoveredJob shape with bounded fields and
metadata; ORM writes validate them, and ORM updates cannot replace the initial
snapshot. The database additionally enforces object shape and a 512 KiB JSON-text
bound. Direct SQL still requires the same application validation for full shape.

The read-only DiscoveryQueueService requires a trusted owner ID. To review sorts
NEW before SEEN, then firstSeenAt descending and UUID ascending; other filters
use chronological order with the same UUID tie-breaker. A short read-only
REPEATABLE READ transaction keeps totals and ten-row page slices consistent.
Out-of-range pages clamp to the last page; an empty result returns page 1 and zero
total pages. No read changes review state. The separate DiscoveryQueueModule
exports the read service. P5.2c adds separate API wiring as described below.

There is no backfill. P5.2d connects the Discover page to the persistent queue.
The foreign key checks existence, so Save also checks linked-job ownership in the
service. Schema rollback drops queue data only and requires explicit authorization
for any populated database.

## Discovery queue ingestion and review actions (P5.2c)

DiscoveryQueueModule now exposes `/api/v1/discovery/runs` and candidate list,
detail, status and save endpoints. It imports exported services from
OpportunitiesModule; the reverse dependency is not introduced. The queue route reuses DiscoveryService.scan (fetch/normalize/rank), including
the same GreenhouseSource instance and its cache/cooldown. In P5.2d the legacy
auto-import route returns 410 without fetching or saving; stale clients must reload.

Queue ingestion deduplicates by stable board key and provider ID, inserts at most
50 new candidates, and refreshes all existing eligible identities regardless of
state. Only lastSeenAt changes on rescan, using GREATEST to resist out-of-order
runs. Snapshots, firstSeenAt, updatedAt, links and review states are untouched.
Counts use distinct eligible identities: found = added + refreshed + remaining.
Source errors remain partial-success messages, while a persistence failure rolls
back the entire run. Fetching happens before the database transaction.

Candidate actions and opportunity identity writes use the same owner-scoped
transaction advisory lock as legacy discovery, acquired before candidate row
locks. Manual creation now checks/inserts inside that lock; manual update only
wraps its existing persistence step, without changing validation or edit rules.
No external feed request or document parsing occurs while holding the lock.
An explicit later manual edit may still create equivalent URLs, as before.

Save uses one transaction for the candidate row lock, opportunity lookup/create,
and SAVED/link update. Opportunity entities and creation rules stay in the owning
OpportunitiesService through a transaction-aware exported operation. Exact
matches are the union of source identity and normalized URL matches; one links
without changing the existing record, multiple return AMBIGUOUS_INBOX_MATCH.
Company/title/location is only a warning: POSSIBLE_DUPLICATE requires an explicit
boolean confirmSeparate before creating a new job. Confirmation never bypasses
an exact ambiguity or permits client-supplied job content. Both conflicts expose
at most 20 same-owner IDs/titles/companies/locations, not notes or source payloads.
Every retry rechecks current matches under the lock. Already-linked candidates
return the same owner-checked opportunity without reapplying source fields.

NEW can become SEEN/DISMISSED; SEEN can become DISMISSED; all three unsaved states
can Save. Repeated same-state actions are no-ops, and SAVED cannot be changed by
the status endpoint. Reads never mark SEEN. Client owner IDs, source fields,
job IDs and arbitrary status values are rejected. Responses expose explicit
candidate DTOs and use no-store; local-write protection is shared unchanged,
with structured queue conflicts and a safe storage-error fallback.

PostgreSQL integration cases cover race/rollback behavior, source identity,
immutable rescans, exact/heuristic duplicates, owner isolation and manual-create
coordination. These require the existing isolated test database. In-memory unit
and HTTP-controller tests do not establish transaction correctness. The P5.2b
migration lifecycle remains pending until that database is available. There is
no bulk save, AI ranking or scheduler.

## Discovery Queue UI and endpoint cutover (P5.2d)

The existing Discover form now posts to `/discovery/runs` and refreshes the queue
without navigating away. DiscoveryQueue reads server-filtered, ten-row pages;
filter/page query parameters preserve browser history and direct links. Server
page clamping replaces the URL. Requests are aborted and stale responses ignored.
Candidate details use a dialog and a candidate query parameter. Reads have no
review side effects; only explicit actions change status or save. A successful
Save keeps the summary visible and offers Open Inbox job. Possible duplicates
require a separate confirmation button; exact ambiguity offers no override.
The Inbox layout and interactions are unchanged. Candidate ingestion is independent
of existing Inbox identities, so old imports still produce NEW candidates. Explicit
Save links an exact match without overwriting fields or application history.
No local data rewrite or backfill is part of this cutover.

## Shared frontend notifications (P5.2f)

The feedback audit found one Snackbar, owned by JobEditor for Application saves,
plus inline discovery completion/review success Alerts. Other Alerts represent
field/import validation, loading failures, conflicts, or persistent contextual
warnings; those remain local.

NotificationProvider wraps the router under the existing MUI theme. A typed
React context accepts success/error/warning/info messages; one bottom-right
Portal/Snackbar/Alert displays them in arrival order. Success auto-hides after
three seconds, info after six; errors and warnings require dismissal. Clickaway
never dismisses. New messages, edits and retries do not silently clear existing
errors. Pending messages exist only in memory, without history or an event bus.
Success/info announcements are polite, errors/warnings assertive. The host does
not move focus. Its responsive width and safe-area bottom offset keep it outside
page and dialog flow.

Discover stores the latest run details in its existing local state and exposes
them through a permanently positioned Run details button and an on-demand
popover. Completion and review success use the shared host, without inserting
inline success banners. Review failures and duplicate confirmation stay local
and actionable. Application saves reuse the shared host instead of owning a
second Snackbar. DOM tests verify overlay placement and unchanged dialog scroll
containers; actual scroll and narrow-screen acceptance still require a browser.

## Greenhouse source registry and coverage (P5.3b)

`discovery/greenhouse-registry.ts` owns the static registry, validated at module
startup: one to five entries, bounded lowercase tokens/keys/names, boolean enabled
flags, no duplicate tokens/keys or caller URLs. Canonical API URLs derive from the
fixed HTTPS host. Existing Axon/Backbase names, keys and URLs remain exact. All
entries, including disabled boards, remain resolvable for historical Save identity;
only enabled boards may fetch. Entries and the registry are frozen.

Discovery scans batches of at most two boards. Each board catches its own failure;
Promise.all retains registry order before existing score/title sorting. This keeps
equal-rank ordering deterministic without changing ranking rules. Batches are simpler
than a worker pool but a slow board can delay starting the next batch. Existing
15-second timeout, response bounds, five-minute cache/cooldown and Retry-After
handling remain per source. The 50-new-candidate cap, immutable snapshots, timestamp
refreshes, review states and explicit Save behavior are unchanged.

On 2026-11-04, direct public API GETs reverified Temus (HTTP 200, 46 posts) and Go1
Vietnam (HTTP 200, 2 posts), matching the audit. Browser research tool access failed,
but direct HTTPS JSON retrieval succeeded. No discovery run or database mutation
was used for this verification. Frontend static two-board explanatory copy is
unchanged under this backend-only checkpoint; the returned scope names all active
boards. Copy/semantics cleanup remains a later checkpoint.

### P5.3c discovery run accounting

The queue run response adds fetched (raw rows in valid envelopes, including
cached payloads), normalized (valid rows, including repeats), and eligible
(distinct eligible board/post identities). found remains an alias of eligible;
eligible = added + refreshed + remaining. Deduplication keeps the first ranked
occurrence, preserving existing cap selection and feed-order tie behavior.
Queue snapshots, review states, ordering and eligibility rules are unchanged.

sources follows the bounded active registry order. Each outcome includes
sourceKey/sourceName, status, fetched/normalized/invalid, cacheHit, fetchedAt,
and a safe failure code/message. Failed or malformed feeds have null counts;
aggregate counts sum only valid envelopes. fetchedAt records successful JSON
decoding time, including for a malformed envelope; cached reads retain that
timestamp. It does not imply fresh listings or successful normalization.
sourceFailures counts failed boards; warnings contains invalid-row warnings.
The existing errors array retains both categories for older clients. Failure
codes distinguish INVALID_FEED from SOURCE_UNAVAILABLE without exposing upstream
payloads or internal exceptions. No persistence or frontend contract migration
is required.

### P5.3d discovery semantics and run details

Discovery keeps the same preference payloads and compact expandable controls.
Labels distinguish the match-any stack keyword filter from location/work-mode/
level priorities used to select new candidates under the cap. Copy discloses
the four boards, existing geographic scope, unknown metadata, and Queue history.

The frontend consumes P5.3c stage counts and per-source outcomes directly.
Completion stays in the shared Snackbar; partial/all-source failures use warnings.
Run details uses a bounded, wrapping popover with keyboard dismissal and focus
restoration. It separates raw/valid listing counts from unique eligibility and
labels refreshed as known candidates. Failed source counts remain unavailable;
cached reads retain their original fetch timestamp. The UI uses local explanatory
copy instead of displaying the older backend scope wording, which conflates
eligibility and ranking. Queue filtering, pagination and review actions are unchanged.

### P5.3e Discovery Queue viewport layout

Discovery reuses the Inbox shell's 100dvh flex layout on desktop when there is
room for the controls plus at least 12rem of candidate rows. The page measures
its header/preferences and Queue control/pagination heights with ResizeObserver,
and rechecks on window resize. Narrow widths, expanded controls, errors or short
windows that leave insufficient row space release the shell to document scrolling.
This avoids a resolution-specific Queue height and keeps preferences accessible.

Only the candidate-row region scrolls in bounded mode; it is keyboard focusable,
uses a stable scrollbar gutter and disables scroll anchoring like the Inbox.
Queue controls and pagination remain outside it. The region stays mounted during
loading, filters and review; layout code performs no scrolling or focus changes.
Pagination retains its previous totals while a new request is loading and disabled.
Run details and shared notifications remain overlays. URL state, ten-row pages,
review states and Save behavior are unchanged. DOM tests cover fit decisions and
element continuity; real desktop/mobile scroll and zoom acceptance remains pending.

### UX-C1 semantic contrast

Compared a dark warning.contrastText palette value with a filled-warning-Chip
theme override. The palette option also changes other warning-colored consumers
that use contrastText. The narrower override uses existing grey[900] only for
MuiChip filled warning indicators, retaining warning.main and all palette values.
This corrects JobEditor/ApiReadiness indicator contrast without redesigning Chips
or changing standard warning Alerts. Unsaved confirmation keeps the same handlers
and action order; Stay is outlined/autofocused and Discard uses error semantics.

### UX-C1b unsaved-dialog keyboard entry

The safe action retains native button Enter/Space activation. Mount-time
autofocus is supplemented at dialog entering/entered transitions so focus can be
retried after visibility changes. The retry leaves an intentional focus position
inside the dialog alone and uses preventScroll. MUI retains ownership of trapping
and restoring focus; Escape continues to leave this guard open. Stay is outlined
primary and Discard outlined error, with the existing reset/proceed handlers.

### UX-C1c unsaved-dialog focus ownership (supersedes UX-C1b retries)

Lifecycle inspection confirms that sidebar NavLinks request navigation and the
router blocker leaves the current editor and sidebar mounted. The guard opens
Dialog without a close handler; Escape/backdrop cannot reset or proceed.
Modal portals the dialog, FocusTrap owns its initial surface focus and records
the previously focused sidebar link for restoration. Dialog's marked focus target
is its Paper; containment can also focus its enclosing surface.

UX-C1b separately focused Stay at React mount and animation callbacks, rather
than responding to MUI's focus selection. Those callbacks do not run for every
surface-focus event (including containment or lifecycle reactivation). This
confirmed ownership gap is fixed locally: remove button autofocus and transition
retries; use the Dialog root's supported onFocus handler to synchronously hand
focus from an ancestor surface to Stay. The root handler runs after FocusTrap's
child handler records the restoration target. Focus on Stay/Discard does not
satisfy the ancestor check, and no delayed task can override a user's selection.
MUI autofocus, enforcement and restoration remain enabled; reset/proceed handlers,
Escape behavior, outlined actions and native keyboard activation are unchanged.

The real-App StrictMode test now edits Application notes, tabs to the actual
sidebar Settings link, activates it with Enter, asserts document.activeElement,
checks Tab/Shift+Tab and confirms Enter/Space on Stay retain notes and return focus.
A separate focus trace verifies MUI surface-first/Stay-second ordering and no
focus theft after entry completes. The pre-fix sidebar test also passed in JSDOM:
it did not reproduce the reported browser failure. Thus the code ownership gap
is confirmed, but the exact browser event ordering behind B01 is not independently
confirmed here. B01 browser acceptance remains pending; no browser tooling is
available in this session.

### UX-C2a confirmed browser focus indicator diagnosis

DevTools confirmed Stay already owns initial focus inside the dialog, while
neither :focus-visible nor Mui-focusVisible applies. The browser issue is visual;
the UX-C1c lifecycle is unchanged. A Stay-only :focus style reuses the existing
2px primary outline and 2px offset. Both focus selectors set the same outline
property, so they do not create separate rings; blur removes the local rule.

### UX-C3 local button hierarchy

Queue filters retain their existing buttons, pressed states and URL handlers, but
use outlined neutral styling with action.selected fill instead of contained
primary styling. This aligns selection emphasis with Inbox without changing the
filter control's keyboard behavior. Discover and Save remain primary; preferences,
Run details, Mark as seen and Close remain low-emphasis disclosures/actions.
Task navigation uses outlined buttons (Back to Job Inbox adds one decorative 20px
arrow); content destinations use MUI Link with their existing href/route and
external-link protections. After Save, Open Inbox is outlined navigation. Add Job
Continue is contained; explicit optional extraction is outlined. No handlers,
viewport ownership, CV Match evidence controls, Application behavior, theme or
accepted unsaved-dialog focus styles/lifecycle are changed.

### UX-C4 local typography consistency

Candidate Review keeps subtitle1 metrics but gives its three subsection headings
the existing local 600 weight convention. Dialog title/content and the Job Details
header allow unbroken imported text to wrap. Overview's full-description disclosure
uses the same subsection convention; supporting “Show all” disclosures use body2,
and import evidence disclosures use subtitle2 group-label typography. They remain
native summary elements with their existing disclosure behavior.

Inbox title links use body1 instead of a literal 1rem size, retaining their medium
weight and dense row layout. No global subtitle1 change is needed: that variant
also serves ordinary metadata. Discover/Queue headings, MUI field/helper/button
metrics, compact Application fields and CV Match score/evidence emphasis retain
their existing contextual hierarchy. No business or navigation handlers change.

### UX-C5 visible actions and local layout corrections

Discovery preferences/details, readiness retry, Candidate Review close/seen/cancel,
Queue retry and editor source/conflict actions now explicitly use outlined buttons.
Their previous omitted variants rendered borderless text actions. Primary commands
stay contained; inline content links and existing icon/tab controls retain their
semantics. The accepted unsaved guard, including outlined error Discard, is untouched.

Discover's controls use one outlined Paper with theme spacing and no shadow,
separate from Queue. Existing measured viewport fitting accounts for that surface's
padding; rows still own desktop scrolling and short/mobile layouts fall back to
document scrolling. Queue's inherited text color previously made borders nearly
black. Unselected borders now use action.disabled with secondary text; selection
uses primary.main text/border and the primary color at action.selectedOpacity.
No filter handlers or eligibility/ranking rules change.

Edit JD's shared wizard action row applied flex: 1 to every button. Existing-job
actions now align at the end without growing, while Add Job keeps its accepted
wizard layout. The grid's separate save row remains reachable as fields scroll;
the compact Save retains a 44px mobile touch target. Save/validation handlers and
scroll ownership are unchanged.

Application was checked at 1440×900 and 390×844: no horizontal overflow or nested
form scroller was reproduced. Its longer-than-viewport form uses normal document
scrolling, with two desktop columns and stacked mobile fields; no form compression
or layout change is justified. Browser acceptance uses intercepted synthetic data.

### UX-C6a shared discovery provenance and live layout diagnosis

Job Details now renders one provenance Alert immediately after Tabs and before
all panels. Previously it followed the Overview panel, so it appeared below
Overview content but above other active panels. SourceName retains both the
source and platform (for example, Axon · Greenhouse); discovery time is unchanged.
An explicit Open original job link uses the existing validated, credential-free
HTTP(S) job URL with noopener noreferrer. The provenance sourceUrl is a feed API
endpoint for current Greenhouse records, so it is not substituted for a missing
original job link. Jobs without provenance omit the Alert.

Live Chromium diagnosis at 1440×900 and 390×844 confirmed Application's document
scrolling, without horizontal overflow or nested form scrollers. A synthetic job
already in the live database measured document heights of 1009px / 1534px; ordinary
scrolling brought Save fully inside each viewport. Edit JD measured a 726px / 432px
field region with a stationary Save row. No Application clipping defect was
reproduced, so neither tab's scrolling model nor Save handler changes in C6a.
The smallest proposed follow-up is an in-page Jump to Save action near Application's
heading, retaining document scrolling and the existing single submit button.
That optional discoverability action is not implemented in this checkpoint.

### UX-C6a-02 Application editing workspace

The acceptance requirement is a consistent desktop editing workspace, not merely
Save reachability after page scrolling. This checkpoint supersedes C6a's proposal
to keep Application entirely document-scrolled with an optional Jump to Save.

Application reuses JobActionLayout inside its existing Paper: the compact form
scrolls in the first grid row, and the existing submit action stays in the second
row. The shared header, tabs and provenance remain outside that form scroller.
Its local height is measured from the panel's document position to the viewport
bottom, allowing for the main gutter, Paper padding/border and actual action-row
height. ResizeObserver tracks panel/main/footer geometry. No global shell height,
new layout abstraction or change to Edit JD is needed.

Bounded mode requires at least the md breakpoint and 12rem of usable form space
after accounting for the footer. Narrow/short windows remove the local height and
internal overflow, using one natural document scroller and an in-flow Save row.
Fields stay mounted when modes change. Existing field handlers, form submission,
validation, provenance and the accepted unsaved-navigation guard are unchanged.

Live Chromium at 1440×900 measured form clientHeight/scrollHeight of 331/520px,
with scrollTop 0 → 100 → 189 and Save fixed at y802.41–838.91. The document remained
900px high with scrollY 0; header/tabs/provenance did not move. At 390×844 and
1440×600 the internal scroller was absent and Save remained reachable in normal
page flow. Resize-mode switching preserved local unsaved notes without saving.

### UX-C6b Edit JD details first

Edit JD starts with the saved editable fields under Job details. The existing
source-import JSX is reused below those fields inside a native, initially closed
Replace JD from another source disclosure. Add Job renders that same JSX in its
original import step, retaining its heading, Continue and Review & Save progression.
No new import component abstraction or source-processing behavior is introduced.

Native details keeps source controls mounted when collapsed, so toggling the
section does not reset manual edits, file/source state or evidence. Expanding and
selecting methods still do not fetch or extract; the existing explicit actions
and manual-value protections remain responsible for those operations.

The existing Edit JD field scroller and compact Save row are unchanged. On entry,
a one-time check reveals Job details inside that scroller only if the heading is
below its visible boundary (reproduced on mobile with the tall shared header).
It does not focus a field or repeat on edits/disclosure toggles. The shared header,
provenance, Application workspace, CV Match and unsaved-dialog lifecycle are not
changed. Live browser acceptance uses local edits restored without saving; import
and extraction behavior remains covered with synthetic automated fixtures.

### UX-C6d MVP manual-only Edit JD

This decision supersedes the C6b replacement disclosure. Existing jobs no longer
render any source-import controls. URL fetching, document parsing and extraction
handlers reject existing-job use, and extraction targets only Add Job's `/extract`
route. Add Job retains its import components, wizard progression and current
suggestion behavior. Obsolete saved-value inference for re-extraction and loaded
document import state are removed from Edit JD.

Job description edits the existing `description` field supported by the current
frontend/PUT contract. It does not edit extracted document `jdText`, original bytes
or imported `postText`; these remain preserved. The backend does not accept raw
document-text replacement through this manual field, so no new source-editing
semantics are introduced. Source remains editable as ordinary metadata alongside
the structured fields, independently of import controls.

Save still sends the current draft, original postText and importReview. Editing
description or metadata does not clear evidence or unresolved conflicts. Existing
per-field acknowledgement reset and explicit candidate selection are preserved,
as are the compact Save footer, field scroller and accepted unsaved guard. The
retired replacement characterization tests are superseded by manual-only safety
regressions; the C6c audit remains a historical account of the removed workflow.
It does not claim that Add Job's audited suggestion semantics or historical data
have been changed, nor that backend import endpoints have been removed.

### P5.4a Add Job import reliability

Add Job tracks the last applied page preview. A repeat Fetch replaces that
preview's exact source segment instead of appending it. A different URL requires
explicit replacement confirmation, updates automatic fields and clears obsolete
AI suggestions, while deliberate edits and separate source text survive. If the
original source segment was rewritten manually, Fetch reports a recoverable error
rather than guessing which text to remove. Responses apply to the latest draft,
with request generations rejecting results after method or URL changes and unmount.
Failed requests leave the valid draft available for retry.

A document becomes an active attachment only after a readable parse succeeds.
Leaving Upload JD cancels parsing and clears its attachment, preview
and error; Paste JD extraction and Save therefore cannot resend a failed or stale
file. Separate pasted text can still be combined with a document by entering the
text first and then choosing Upload JD. This deliberately replaces implicit
attachment retention across methods with an explicit active upload; the UI states
that leaving Upload removes the document. Evidence/conflict validation, explicit
Save, manual-only Edit JD and Discovery Queue remain unchanged. No backend,
transport policy, schema or dependency changes are needed.

### P5.4b Early exact-URL duplicate warning

Add Job debounces valid source URLs for 500 ms, including URLs populated by
imports, and calls `GET /api/v1/opportunities/duplicate-url?url=…`. The read-only,
no-store endpoint returns `{ match: { id, title, company } | null }`, validates
HTTP(S) URLs without credentials and selects only the owned Inbox rows' link
metadata. It uses the same `normalizedUrl` function as Create: tracking parameters,
hash, www and trailing slash handling remain consistent with Save. There is no
title/company heuristic, external URL fetch or Discovery Queue change.

No dedicated early lookup existed; this narrow endpoint avoids transferring the
whole Inbox and duplicating normalization rules in the browser. It retains the
current linear lookup strategy without adding a schema/index or search framework.
A future scale change can optimize both early lookup and Create together.

The warning is advisory and stays visible during review. Its existing-job link
opens a new tab to retain the draft. Lookup failure gives safe, non-blocking
guidance; URL changes abort pending requests and ignore late success/failure.
Create's transactional duplicate enforcement remains authoritative, including
when early lookup fails or another job is saved after checking. P5.4a replacement
confirmation, manual-edit protection and upload recovery remain in place.

### P7.2 Trusted CV Match context and evidence boundary

Saved-CV matching now returns an additive opaque matchId backed by an immutable,
process-local assessment snapshot: 15-minute monotonic TTL, maximum 20 entries,
latest per owner/job. Lookup checks source revisions and identity; no database
migration, duplicate full-CV storage or durable suggestion history is introduced.
This avoids trusting browser-supplied evidence or rerunning matching for future
suggestions, at the cost of reanalysis after expiry, eviction or restart.

Matching-owned evidence references identify exact saved parsed-CV text or canonical
saved-job requirement quotes, immutable source revisions and parent/component
linkage. Unique CV anchors use UTF-16 offsets; duplicate quotes have no unique
anchor. Pure policy preserves P6 scores/statuses, orders conflicts first and
returns up to five extractive-wording or clarification candidates. Wording is
restricted to complete self-contained source entries; arbitrary paraphrases and
uncertain attribution require clarification. No suggestions endpoint or AI
selection is implemented in this checkpoint.

The [P7 design and P8 boundary](audits/p7-cv-improvement-design.md) documents the
full policy and tradeoffs. P8 may reuse provenance concepts but must independently
validate durable source revisions and user-approved content. Ephemeral matchId,
parsed-text anchors and suggestions are not a structured CV profile, file-layout
model or verified employment facts.

### P7.3 On-demand CV improvement selection API

`POST /api/v1/opportunities/:id/cv-improvement-suggestions` accepts only a bounded
opaque matchId. The existing controller retains UUID/local-write/no-store
protections and exposes allowlisted `CV_SUGGESTIONS_*` errors. JobMatchService
loads saved sources, resolves the P7.2 owner/job-scoped context, verifies revisions
and shares its existing admission flag between matching and suggestions. It
rechecks source revisions and the current snapshot identity before selection and
after success or failure. A job deleted after initial resolution is stale; an
initially unknown job is 404. No CV/job/tracker writes or suggestion persistence.

The matching-owned CvSuggestionsService uses existing AiService structured
validation and provider budgets to select only unique eligible candidate IDs.
Model output cannot supply wording, evidence, status or explanations. The server
keeps P7.2 eligibility, conflict-first order, exact source passages and five-card
limit; an empty candidate set bypasses AI. Prompts include candidate evidence as
untrusted JSON data, not the full CV or raw JD, and refuse oversized input rather
than truncating context. A route-scoped global exception fallback registered at bootstrap sanitizes
JSON/body-parser failures before controller dispatch; unrelated routes use the
existing Nest behavior. No global queue, provider changes or new dependencies.
The shared guard covers CV Match/suggestions, not unrelated extraction workflows.
P6 scoring and evidence semantics remain unchanged; P7.4 UI and P8 remain deferred.

### P7.4 CV improvement suggestions in CV Match

The existing CV Match document flow hosts a compact suggestions section between
Requirements and Application advice. It explicitly requests selection using the
successful matchId and validates the response against the displayed match's
source revisions, parent/component linkage and exact evidence before enabling
copy. The UI preserves server ordering and wording; it does not generate claims,
compute scores or reinterpret requirement satisfaction.

Snapshot/component keys and abort/generation guards discard late results.
Reanalysis, CV replacement and relevant job/form changes clear cards immediately;
expired/replaced contexts require explicit Reanalyze. Source-changing actions are
disabled during selection. Evidence navigation reuses the existing reveal,
instant-scroll and focus callback. Clipboard errors leave exact wording available
for manual copy. Parsed-text and canonical-requirement provenance labels avoid
claiming original-file positions or verbatim uploaded-JD traceability.

The browser has excerpts only: its runtime checks establish source identity,
evidence equality, safe offset shape/length and wording/clarification exclusivity;
full-source span equality and unique-anchor validation remain backend-owned.
No schema library, backend correction, new persistence or P8 model is needed.

### P7.4.1 Dedicated Improve CV and shared match owner

Improve CV is now a separate, always-accessible Job Details tab. The already
mounted CvMatchPanel remains the single owner of saved-CV/match state and renders
sibling CV Match/Improve CV panels selected by JobEditor. This avoids lifting all
matching state into the editor or adding a global provider/store. Switching tabs
preserves one result/identity and does not invoke analysis or selection. A small
inspection handle reuses the existing exact-parent reveal/scroll/focus flow.

Suggestions require a successful current analysis. Dirty job forms, reanalysis,
CV replacement, saved-job revision changes and rejected/expired snapshots disable
selection and clear actionable cards. An owner-local save revision invalidates
matches even when saving leaves editable form JSON unchanged. A client lifetime
timer is conservative UX; backend snapshot/revision checks remain authoritative.
Cards default to two, with Show all/less and optional evidence/provenance details.
Only the neutral server clarification template was shortened; factual wording,
provenance contracts and copy validation remain server-owned and unchanged.

The Vietnamese database proficiency one-of family now parses before P6's generic
unresolved-quantity guard. Exact alternatives retain a shared proficiency context;
explicit level declarations or narrowly demonstrated production administration
with multiple database responsibilities can support one alternative. Bare names,
ordinary use, aspirations and negatives cannot. Recovery is restricted to this
recognized family and still respects rejected-evidence suppression and conflict
precedence. Existing P6 parent weights, AND/OR aggregation and other requirement
families are unchanged. The [P7 audit](audits/p7-cv-improvement-design.md) records
synthetic evidence cases, grammar bounds, shared-state tradeoffs and verification.

### P7.4.2 Database observations versus qualification support

Database/proficiency coverage now retains bounded original-source observations
(`mention` or `experience`) when the requested proficiency remains unverified.
These additive component fields and qualification reasons prevent ordinary
SQL Server project evidence from disappearing merely because it does not satisfy
a higher level predicate. Qualification-support quotes, OR credit and P6 weights
are unchanged; observations cannot authorize matching credit or copyable wording.
An explicit use denial can conflict with documented work, while a statement of
insufficient proficiency does not itself contradict ordinary use. Source text,
negation, rejected-evidence safeguards and project attribution remain intact.
Detailed observation rendering and compact Improve CV redesign are deferred;
the [P7 audit](audits/p7-cv-improvement-design.md) records the synthetic pipeline
trace and the boundary between documented work and verified requirement support.

### P6 reliability: recover managed-language work context

The recognized managed-language experience OR family now reuses bounded original
CV passage choices and exact quote resolution to recover a stronger professional
work passage after weak or empty model selection. It requires explicit language,
software development and professional context together; adjacent recognized
employment/role/project attribution is retained rather than truncated or borrowed
across entries. Bare lists, learning, aspirations and unrelated technologies cannot
authorize experience credit. Existing invalid-evidence suppression, negation,
minimum duration and conflict precedence still apply. Generic matching families,
P6 weights and aggregation remain unchanged. A broader matcher or prompt rewrite
was unnecessary for the confirmed recovery gap. The [P7 audit](audits/p7-cv-improvement-design.md)
records synthetic regressions, real-provider acceptance and bounded-context limits.

### P6 targeted proficiency and AI familiarity semantics

Recognized database-proficiency OR groups now use three bounded evidence levels:
mentions remain Unknown (0), exact substantive professional use is Partial (0.5),
and credible declarations or directly attributed practical database responsibilities
can be Matched (1). OR uses the strongest alternative, never sums evidence across
alternatives; required/preferred weights remain 3:1. The same exact-span, attribution,
negation, aspiration and conflict gates apply to selection and bounded recovery.
Generic MyBatis optimization cannot establish SQL Server responsibility/proficiency.

The exact Axon familiarity-or-interest sentence has two scoped OR predicates;
contextual development-tool use or explicitly relevant interest may satisfy it.
Interest does not establish professional experience, code generation or automation
experience, and this exception does not weaken other aspiration or AND policies.
Both families reuse existing bounded source choices, quote resolution and recovery.
CV Match renders exact source observations separately from qualification support,
including Partial reasons; uncredited mentions remain visible. No P7 redesign,
persistence, dependency or infrastructure change is needed. The [P7 implementation
record](audits/p7-cv-improvement-design.md) records acceptance and remaining bounds.

### P6 database PDF line and attribution recovery

Database-use classification now creates a temporary semantic view for a recognized
soft-wrapped preposition/database continuation, retaining the original source span
for every result. Sentence, bullet, blank-line and heading boundaries prevent joining.
Recognized database-proficiency matching may add up to 20 exact attributed work
candidates (2,000 characters each): three adjacent employer/role/project headers
plus one work line and its optional continuation. Both the model allowlist and
server recovery use these candidates. The generic three-span window, attribution
guards, database qualification levels, OR credit, weights and accepted Axon policies
are unchanged. The [SQL layout report](audits/p6-sql-server-layout-diagnosis.md)
records the focused regressions and bounded real-provider acceptance.

### P6 nominal database development responsibilities

Database observations now recognize bounded “Development of”, “Implementation of”
and “Responsible for developing/implementing” software responsibilities with an
explicit using/with/on relationship to a named database, including an explicit
coordinated use list. The software object and tool clause are bounded; raw stack
co-occurrence is insufficient. Professional context must come from the statement
or preceding recognized attribution, never an unrelated work bullet or a later role.
The existing exact-span resolver, continuation rules and candidate bounds are reused;
only database attributed-candidate starts gain these nominal forms. Experience earns
the existing Partial credit, not proficiency. Explicit denial of the same development
responsibility retains conflict precedence; lack of proficiency or administration
responsibility does not contradict ordinary use. No other requirement family,
weight, UI or infrastructure changes. The [SQL layout implementation record](audits/p6-sql-server-layout-diagnosis.md)
contains synthetic regressions and real-provider acceptance.

### P6 nominal database leadership prefix

The database-only nominal responsibility grammar accepts a past-tense leadership
verb and definite article before its existing development/implementation-of form.
This is a prefix alternative only: object/use parsing, attribution, negation,
continuation boundaries, Partial credit and proficiency qualification are unchanged.
Synthetic prefix regressions live in `cv-match.database-prefix.spec.ts`; no private
source text or diagnostic payload is retained in repository files.

### Calm Teal Workspace — checkpoint 1

The shared shell retains the 230px desktop sidebar, `lg` content width and
16/24px page gutters. Below MUI's `md` breakpoint, a temporary MUI Drawer
replaces wrapping navigation. Its native modal focus trap, Escape dismissal and
focus return avoid custom keyboard handling; route links and unsaved-change
protection retain their existing behavior. The drawer is closed on link activation
and hidden at desktop widths. The compact shared header retains readiness text,
manual retry and polling while reducing their visual emphasis.

The theme owns neutral palette tokens, 8px surface corners, 6px button/input
corners and visible icon-button focus. Typography metrics, semantic warning fills,
feature layouts and screen-specific scroll ownership remain unchanged. Existing
MUI primitives provide the shell without new dependencies or an icon package.

### Calm Teal Workspace — checkpoint 2

Jobs uses non-growing, shrinkable panel and table flex items: short result sets
size to their content, while longer pages retain the constrained row scroller
and separate filter/pagination controls. No row-count threshold or viewport
calculation is needed. Ten-row pagination, filtering and row order are unchanged.
Local styling emphasizes job titles, distinguishes company from source, and adds
row focus feedback with touch-sized links. Mobile status and follow-up information
wrap together. The Dashboard placeholder keeps its existing copy and destination,
with a compact responsive text/action composition and no new functionality.

### Calm Teal Workspace — checkpoint 3

Job Detail keeps its compact header and scroll ownership. Status retains a
teal outlined chip while neutral metadata uses supporting text; company emphasis
and smaller provenance links clarify the hierarchy without increasing header
height. Local tab treatments use the existing selection token and an inset
keyboard focus outline so the horizontal tab scroller does not clip focus.

Application uses three application-detail columns at desktop widths, two at `sm`
and one on mobile, with compact section headings, 44px single-line controls and
helper text aligned to field edges. Its existing form-height measurement,
independent Save footer, natural-scroll fallback, explicit Save and unsaved-change
guard are unchanged. No matching or suggestion presentation is modified.

### Calm Teal Workspace — checkpoint 4

CV Match styling reinforces the documented-fit summary, coverage counts and
requirement status labels. The score retains its original value, neutral progress
bar and heuristic interpretation; nearby copy explicitly distinguishes CV evidence
from the candidate's actual skills. Status text remains explicit alongside
restrained semantic colors, with dark text on the pale amber Partial treatment.

Requirement evidence keeps exact source strings, attribution, expansion state and
existing targeted scroll/focus callbacks. Quotations have clearer source headings,
comfortable line spacing and keyboard focus outlines. Component coverage uses
separators rather than nested cards. No matching/classification logic, source
selection, lifecycle states or P7 Improve CV content changed.

### Calm Teal Workspace — checkpoint 5

Improve CV presents each existing recommendation with its title, unchanged match
status, explicit JD coverage label, next step, supported original wording and a
shared action row. Static labels distinguish available CV wording, missing CV
evidence and information needing confirmation. Suggestions remain separated by
single dividers; supported wording uses a subtle surface and keyboard focus ring.
Review evidence is outlined and precedes the secondary text Copy action.

Suggestion summary rules, source validation, exact copied text, Copy eligibility,
initial four-item limit, regeneration and prerequisite/error/stale behavior are
unchanged. This checkpoint changes only presentation in CvSuggestionsSection.

## P8.1 Durable CV foundation

`tailored-cv` owns immutable `CvSourceRevision` and `CvProfileRevision` rows and
mutable `TailoredCvDraft` rows. The module uses existing PostgreSQL/TypeORM and
introduces no dependency, generation pipeline, UI or renderer. The explicit
`TailoredCvFoundation1794000000000` migration adds these tables and nullable
parser metadata to the current saved CV. Startup still never runs migrations.

Capture is explicit, not an upload side effect. Uploads continue replacing the
one current matching CV; P8 retains historical revisions only when captured.
The matching-owned exported `SavedCvSourceService` reads/locks the current CV
inside the capture transaction. P8 does not write matching data or reinterpret
P6/P7 statuses. Repeated capture of the same owner, timestamp, exact SHA-256 text
hash and filename returns the existing source ID. Capture and initial profile
creation require the expected current saved-CV timestamp; initial profile
creation additionally compares the captured text and filename. Concurrent CV
replacement cannot change the locked source during capture. Historical profiles
can continue receiving explicit revisions after the current upload changes;
those revisions remain pinned to their original source, never silently rebased.

Source revisions preserve exact parsed text, filename, SHA-256, original saved-CV
timestamp, capture timestamp and parser provenance. New uploads retain the known
PDF/DOCX format and source segments from `parseCv`; the parser identifier names
the bounded pipeline contract, not a claim about original layout or completeness.
`parseCv` does not return warnings, so warnings remain null (unavailable), never
an invented empty list. Legacy captures record `saved-text-bootstrap` with null
format/parser/segments/warnings. Filename extensions are not format evidence.
Original bytes are not retained. Hashes identify content, not authenticity.

Profiles are append-only revisions of one profile identity, each with a durable
UUID and integer revision. Database triggers reject source/profile UPDATEs.
Owner-scoped composite foreign keys prevent profiles and drafts referencing
another owner's resources; drafts also pin an exact profile revision and job.
Profile appends serialize per owner/profile and compare `expectedRevision`.
Draft saves use atomic compare-and-update and increment their revision. Draft
creation/save are internal persistence methods only; no HTTP generation, draft
creation, draft review or export is exposed in P8.1. Draft metadata is nullable
and reserved for future generation provenance; there is no claim of a generated
or export-ready document. No P6 assessment or ephemeral P7 match ID is persisted
as a confirmed CV fact.

The version-1 structured document has ordered sections, entries, stable IDs,
field/value facts, separate `source`/`user_entered` origins, exact UTF-16 source
references and pending/confirmed/needs-clarification review states. Source values
must occur in their cited exact quotes; user-entered facts cannot claim original
source evidence. Provenance validation does not prove field attribution or
semantic truth. Confirmed always means user-reviewed, not independently verified.
A section confirmation may cover clear pending facts, but cannot override a
field requiring clarification. This stores lightweight future review semantics
without implementing extraction, automatic confirmation or a review UI.

Coverage partitions every UTF-16 unit of the source into contiguous, nonoverlapping
mapped/unresolved/excluded intervals. Mapped intervals must be covered by linked
source evidence; exclusions require an explicit reason. Initial profiles contain
no invented structure and mark the entire source unresolved. No source passage
is silently discarded. Documents are bounded to 96 KiB in the API (expanded in P8.2), 20 sections,
100 entries per section, 300 facts total, 10 references per fact and 1,000 coverage
intervals; values/quotes are bounded to 4,000 units. PostgreSQL additionally bounds
stored JSONB representations to 128 KiB and future generation metadata to 16 KiB.
The normal JSON HTTP parser also bounds request bodies. Full source text is
excluded from metadata responses and available only through an explicit read.

### P8.1 API contract

All routes are under `/api/v1/tailored-cv`. All reads and writes require the
existing strict local Host/Origin policy, return `Cache-Control: no-store`, and
use the server-assigned local owner. This is not authentication or multi-user
hosting. Bodies reject extra fields and require `contractVersion: "1"`:

| Method / path                  | Body / behavior                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| POST `/sources`                | `{ contractVersion, expectedSavedCvUpdatedAt }`; capture current CV; metadata only                                 |
| GET `/sources/:id`             | Source metadata and parser provenance; no text                                                                     |
| GET `/sources/:id/content`     | Explicit source metadata plus exact parsed text                                                                    |
| POST `/profiles`               | `{ contractVersion, sourceRevisionId, expectedSavedCvUpdatedAt }`; create initial unresolved profile revision      |
| GET `/profile-revisions/:id`   | Exact profile revision, document and source identity                                                               |
| POST `/profiles/:id/revisions` | `{ contractVersion, expectedRevision, document }`; append revision, preserve prior revisions                       |
| DELETE `/sources/:id`          | Explicitly delete an unreferenced immutable source                                                                 |
| DELETE `/profiles/:id`         | `{ contractVersion, expectedRevision }`; delete the entire profile history if no revision is referenced by a draft |
| DELETE `/drafts/:id`           | `{ contractVersion, expectedRevision }`; explicitly delete one draft                                               |

POST responses use 201; reads/deletes use 200. Source/profile responses include
`contractVersion`, durable IDs and timestamps; profile responses include integer
revision and source ID. Error envelopes include contractVersion, statusCode,
`CV_FOUNDATION_<status>` and a fixed safe message. Invalid input is 400, denied
local access 403, missing/cross-owner resources 404, stale revisions/referenced
resources 409, oversized/unsupported HTTP bodies 413/415, and unexpected storage
failures 503. Controller and pre-controller body-parser failures are sanitized;
SQL, driver details and CV payloads are never returned or logged by this module.

### P8.1 deletion and retention

There is no TTL, automatic pruning, cascade deletion or background cleanup.
Current CV replacement does not delete captured sources, profiles or drafts.
Referenced source revisions cannot be deleted. Any draft referencing any revision
blocks deletion of the whole profile history. The user must explicitly delete
those drafts, then the profile history, then its source revision. A job referenced
by a draft is also protected by RESTRICT. Draft/profile deletion checks the
expected revision, so stale requests cannot discard newer edits. Owner-scoped
lookups do not disclose another owner's IDs.

Deleting P8 data never deletes the matching module's current saved CV, the job,
application tracking fields or another profile. Therefore deleting a source does
not erase a duplicate still retained as the current matching CV; an explicit
matching-CV removal workflow remains outside this checkpoint. Deletion is a
logical database removal, not a guarantee of erasure from backups. Migration
rollback drops P8 data and metadata; verify it only against the isolated test
database unless destructive rollback is separately authorized.

## P8.2 Structured source CV review

Improve CV now includes a Source CV Review area without adding a route or tab.
Review source CV explicitly captures the current upload, resumes its latest saved
profile, or creates an empty unresolved revision. Build structured proposal is a
separate explicit local-AI action. It reuses `AiModule`/`AiService`, the pinned
qwen3:4b provider and existing schema/token/deadline checks; no second provider,
job-tailoring prompt, renderer or database migration is introduced.

The model classifies at most 96 server-numbered original source passages by
section kind and field label. It cannot supply wording, dates, numbers, offsets,
confirmation or evidence. Known heading boundaries, paragraph blocks, original
order and all factual text are server-owned. Supported sections are contact,
links, summary, skills, experience, projects, education, certifications, languages
and additional. Recognized headings constrain classification; unknown content is
retained in additional or as unresolved text, never dropped. Heading detection is
bounded explicit vocabulary, not universal document-layout understanding.

All returned source fields contain the exact complete original passage, including
labels, qualifiers and delimiters. References use the pinned source UUID, quote
and UTF-16 offsets. Repeated wording retains distinct positional references and
requires clarification; quote uniqueness is never guessed. Explicit labelled
employer/role pairs in one block support lightweight experience review. Unlabelled
roles/dates, ambiguous multi-employer blocks and uncertain education/project/
certification attribution require individual field confirmation. Clearly labelled
education/certification entries can use section review. These are conservative
review gates, not independent verification of any qualification.

Every source unit remains covered by mapped, unresolved or explicitly excluded
intervals. Omitted model IDs and instruction-like passages remain unresolved.
Source text is untrusted JSON data; JD instructions are not consumed by this
operation. Invalid/unknown/duplicate IDs, generated prose, malformed schemas,
context overflow and provider failures do not append a revision. There is no
silent partial success, truncation, retry loop or fabricated fallback. The initial
unresolved profile remains available for manual review. Oversized sources or
individual passages are refused for AI proposal; manual review can account for
bounded pieces while retaining the remainder. Manual splitting avoids breaking
UTF-16 surrogate pairs.

The source profile document API bound is now 96 KiB, within the existing 128 KiB
PostgreSQL JSONB bound and normal 100 KiB HTTP request parser. Exact source values
plus repeated evidence quotes can exceed P8.1's 48 KiB even for a valid original
CV. The larger explicit bound permits those complete profiles without removing
provenance; all item, field, quote and database limits remain enforced. Oversized
review requests fail safely with their local edits retained.

### P8.2 API additions and review transitions

Under `/api/v1/tailored-cv`, all existing local-access/no-store/owner protections
apply, including personal-data reads:

| Method / path                        | Contract and behavior                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/sources/:id/profile`           | Latest complete saved revision for this owner/source, or null; exact revision reads remain available                                                |
| POST `/profiles/:id/proposal`        | `{ contractVersion: "1", expectedRevision, expectedSavedCvUpdatedAt }`; append a pending proposal only to an unstructured, fully unresolved profile |
| POST `/profiles/:id/confirm-section` | `{ contractVersion: "1", expectedRevision, sectionId }`; append section confirmation only when no field requires clarification                      |
| POST `/profiles/:id/revisions`       | Existing version-1 full-document append; review, field confirmation, grouping and explicit unresolved/excluded edits use optimistic revision checks |

Proposal checks current CV identity and the latest profile revision both before
and after inference, including after provider failure. CV replacement, deletion
or concurrent profile edits supersede model output. It never holds a database
transaction open during inference. A process-local admission flag bounds P8
proposal concurrency; no new queue is introduced. Successful proposals/reviews
append immutable profile revisions and preserve their predecessors.

`CV_PROFILE_BUSY`, `CV_PROFILE_CONTEXT_LIMIT`, `CV_PROFILE_INVALID_OUTPUT`,
`CV_PROFILE_TIMEOUT` and `CV_PROFILE_UNAVAILABLE` are allowlisted typed failures;
model payloads and driver details are not exposed. Existing foundation conflict,
not-found, invalid-request and storage errors remain sanitized.

Original source facts cannot be removed, rewritten or have their evidence changed
through review append. Explicit value edits add a `user_entered` fact with no
original-source evidence and an optional `replacesFactId` pointing to the retained
source fact in the same entry. Replacement targets/field types are validated;
there is at most one replacement per original. Source field-label corrections
require focused confirmation, and entries can be split without rewriting their
source words. Previously ambiguous fields cannot silently become pending to
bypass confirmation. Section confirmation cannot clear outstanding ambiguity.
Confirmed always means user-reviewed. P6 statuses/scores and P7 suggestion policy
are neither read as qualification facts nor changed by review.

### P8.2 UI and verification boundaries

The Calm Teal section form shows filename, pinned source identity, profile
revision and review progress. Source evidence is a keyboard-native disclosure;
field-type and entry-split controls are progressively disclosed. Source-derived
and user-entered values are labelled distinctly. Unresolved passages can be kept
in a chosen section or excluded with a mandatory reason; all unresolved and
excluded passages remain inspectable. User content can be added separately.

Confirmations and edits stay local until Save source review appends a revision.
Save conflicts/failures retain edits. Discard restores the saved document; reload
is disabled while dirty. Dirty review state, including unsubmitted user text or
exclusion reasons, joins the existing route/beforeunload guard. Internal tab
switches preserve state, and current-CV replacement is disabled during dirty or
busy review. No CV text is written to browser storage or logs. Current-CV changes
from elsewhere leave the review visibly pinned; stale proposals are rejected.

Chromium acceptance uses the real frontend with mocked synthetic HTTP responses,
separately from PostgreSQL integration and mocked provider tests. It does not
establish live-model quality or private-CV acceptance. Desktop/mobile checks
include native evidence Enter activation, ambiguity gates, edits/save/reload,
unsaved Stay focus, retained state across tabs, field correction/entry splitting,
44px review buttons and horizontal overflow. A 200% layout smoke supplements the
requested 1440×900 and 390×844 viewports. No tailored draft generation, document
export, new navigation area or P8.3 work is included.

## P8.3 Grounded tailored draft generation

P8.3 adds backend generation/list/retrieval only. It introduces no editor,
renderer, dependency, worker, queue or schema migration. `TailoredCvDraft` reuses
its existing bounded JSONB columns: `document` now accepts a version-1
`kind: "tailored_cv"` document in addition to the internal P8.1 profile placeholder.
The old internal profile-save method refuses generated documents; no public
accepted-text mutation or proposal-acceptance route exists before P8.4.

### Pinning and eligibility

Generation requires an exact latest `CvProfileRevision` UUID and integer revision,
the expected saved-job timestamp, and a current opaque P6 match ID. Matching's
exported JobMatchService resolves its own immutable owner/job-scoped snapshot;
P8 never accepts browser assessments, status/score overrides or evidence. The
captured source must still equal the current matching CV (filename, timestamp,
exact text and SHA-256). Canonical requirements are recomputed with the existing
matching-owned function and checked against the trusted assessment. Historical
sources/drafts remain readable, but a match for a different current CV cannot
be used to generate against an older profile.

The source/profile/job pins and hashes are checked before generation, before and
after each serial inference batch, after provider failure and during the final
insert transaction. Profile appends share the existing owner/profile advisory
transaction lock at commit; job/current-CV row locks protect the final read and
insert. There is no open transaction during inference. One process-local slot
and a PostgreSQL session advisory lock serialize generation for the local owner
across API instances. Every attempt creates a new draft UUID; failed attempts
never update an existing draft or persist partially completed batches.

A reviewed profile has no unresolved source coverage and no ambiguous or
unconfirmed factual field. Effective confirmation is explicit field confirmation
or a confirmed section containing no outstanding clarification. Heading facts
are structural; instruction-like imperative passages are not eligible factual
content. Source facts superseded by confirmed user replacements remain recoverable
through their pinned immutable profile, but the replacement alone becomes accepted
content. User-entered facts retain their origin, confirmation scope, replacement
link and empty source evidence; they never inherit original-CV proof.

### Assembly, relevance and pending wording

The server assembles every eligible reviewed fact, including unselected facts.
Accepted text is always the exact reviewed value, never model output. Source
provenance, numeric claims, qualifications and qualifiers remain unchanged.
Existing section/entry/fact ordering is preserved, including chronology and dated
anchors. AI priority IDs are separate per-entry recommendations for P8.4 rather
than automatic changes to accepted ordering. Contact, employer, title/role, dates,
qualification, named project and other anchor fields are excluded from rewrite
batches. Missing section kinds are represented by empty sections and explicit
review issues; no summary, qualification or other missing content is invented.

P6 requirement text, parent/component statuses, AND/OR/UNKNOWN modes and credit
are copied unchanged into the draft. Exact source quotations may link a fact's
passage to an EVIDENCED component; a Partial parent remains Partial. Conflict and
Unknown groups do not receive positive source-support links. User facts receive
no original-source support. Model-proposed requirement references are explicitly
`ai_relevance_only` unless independently linked to an existing source passage;
these references do not establish qualification or change scores. Conflicts,
Partial and Unknown requirements retain typed review issues.

AI sees only bounded eligible narrative facts and canonical requirement context,
not contact details, tracking notes, document bytes or a new candidate-evidence
source from the JD. It selects fact IDs, priorities and optional wording in small
serial batches confined to one section/entry. The existing AiService/OllamaProvider
and qwen3:4b defaults are reused. Model-facing ID enums guide the small model;
the existing dual-schema structured API separately validates the runtime envelope,
then server allowlists enforce exact fact ownership and parent requirement IDs.
Component IDs cannot be substituted for parent requirement IDs. No validator or
P6/P7 policy is weakened to accommodate model mistakes.

Each fact can have at most one proposal per batch and a singleton batch can have
at most one proposal. Proposals must refer to selected eligible facts. Unsafe
numeric/date, entity, substantive-word, ownership or qualifier changes are rejected
with `CV_DRAFT_UNSAFE_REWRITE` issues; their text is not retained in the document.
D2.1 replaces the word-multiset/numeric heuristic with an explicit fail-closed
transformation policy. Ordered wording and significant symbols must remain exact;
the only reviewable edit is one insertion of `the` after an existing standalone
`for`, `in`, `on` or `at`. Deletions, reordered claims and other punctuation changes
are rejected rather than inferred equivalent. This deliberately sacrifices recall
instead of attempting semantic verification or broadening the generation prompt.
Retained wording is `pending`, has a `SEMANTIC_REVIEW_REQUIRED` issue, and never
replaces accepted text without a decision. Identical/whitespace-only edits, a final
full stop after a letter, and a category-colon insertion after `Backend` or
`Leadership` in a Skills `skill` fact are suppressed without additional issues or
pending decisions. Original wording is always retained, never automatically
normalized. Control/format characters are checked before suppression; conflict
checks still reject reviewable edits. These deterministic checks do not prove
semantic equivalence. Existing persisted proposals and approvals are unaffected.

Limits are explicit: at most 96 effective facts, 32 serial batches, six facts per
batch, at most two proposals per batch, 600 units per proposal, 64 KiB assembled
prompt bytes, and a 180-second overall inference deadline. Existing provider
single-pass/partial-execution context and per-call deadlines remain enforced.
Oversized documents fail without truncation. Draft documents are bounded to
96 KiB serialized JSON; the final transaction also checks actual PostgreSQL JSONB
sizes against the existing 128 KiB document and 16 KiB metadata constraints.
Generation metadata stores pipeline/model identity, latency and prompt/output
hashes per batch, not raw model responses. Eligible unselected IDs, structural and
superseded IDs and complete source coverage remain recoverable.

### P8.3 version-1 APIs

All routes retain local Host/Origin checks on reads and writes, fixed local owner
scoping, sanitized errors and `Cache-Control: no-store`:

| Method / path under `/api/v1/tailored-cv`  | Behavior                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/jobs/:id/drafts`                    | `{ contractVersion: "1", profileRevisionId, expectedProfileRevision, expectedJobUpdatedAt, matchId }`; HTTP 201 complete newly persisted draft |
| GET `/jobs/:id/drafts?before=<draft UUID>` | Metadata only, ordered newest first; 20-item pages with `nextCursor`, scoped to this owner/job                                                 |
| GET `/drafts/:id`                          | Complete saved document, pins, requirements, recoverable content, review issues and generation metadata                                        |

Draft metadata includes UUID, integer revision (initially 1), job/profile links
and timestamps. Generated documents have pins, a saved matching-relevant job
snapshot (excluding tracking/private document data), requirement assessments,
sections/entries/facts with accepted text and separate pending wording, recoverable
references and review issues. Existing internal P8.1 placeholders are excluded
from these generated-draft read APIs. Retrieval needs no live match or model and
continues working after restart, source replacement or later profile revisions.
Pagination compares exact database timestamp/UUID tuples, including equal-time
rows, and does not expose CV text or generation prompts.

Typed request failures cover invalid input (400), missing job/profile/draft (404),
unreviewed profile/context budgets (422), stale profile/job/match, busy and save
conflicts (409), invalid model structure/unsupported references (502), timeout
(504), and AI/storage unavailable (503). Unsafe candidate wording is a typed
per-proposal review issue in an otherwise valid source-default draft, not an
unsafe accepted value or silent whole-draft fallback. Existing pre-controller
HTTP parser failures retain the sanitized foundation error envelope.

Deletion/retention stays P8.1's explicit draft → profile → source policy with
RESTRICT foreign keys. No automatic deletion, rebase, overwrite or generation
history cleanup is introduced. Live acceptance and focused verification are
recorded in `docs/audits/p83-grounded-draft-acceptance.md` using synthetic data only.

## P8.4 Tailored CV review and editing

P8.4 adds a CV-first workspace in Job Detail → Improve CV. It reads the complete
saved structured document, presents all ten section kinds, edits existing fields
one section at a time, and offers an explicit Generate new draft action using the
latest saved source profile and current P6 match. Job Detail passes its actual
saved `updatedAt` separately from the existing local form-invalidation token.
Generation continues to insert a separate draft UUID; it cannot overwrite review
work. No provider, renderer, dependency, database or migration is added.

### Review contract and concurrency

All routes use `/api/v1/tailored-cv`, the existing local Host/Origin guard, fixed
owner scope, safe error filter and `Cache-Control: no-store`:

- POST `/drafts/:id/review`: `{ contractVersion: "1", expectedRevision,
operations }`. Operations are strict allowlisted objects: `{ action: "edit",
factId, text }`, `{ action: "accept" | "reject" | "restore", factId }`, or
  `{ action: "acknowledge", issueIndex }`.
- POST `/drafts/:id/approve`: `{ contractVersion: "1", expectedRevision,
reviewedFactIds }`. The IDs must equal the set of facts with manually edited
  or explicitly accepted AI wording. The UI sends them only after the user checks
  the complete-saved-CV review acknowledgement.
- Existing generation/list/retrieval routes remain version 1. Full retrieval
  includes the bounded review state, decisions, original reviewed wording and
  current accepted text. Metadata pagination remains text-free.

Both mutations lock the owner-scoped draft row in a short transaction, compare
`expectedRevision`, validate its exact pinned immutable profile and hash, and
increment the saved revision. Concurrent writers produce one success and one
`CV_DRAFT_SAVE_CONFLICT` (409), without merging or losing edits. The request
cannot supply evidence, pins, assessments, arbitrary document JSON or approval
metadata. Missing/foreign drafts return the same 404. Invalid operations return
400; incomplete review returns `CV_DRAFT_REVIEW_INCOMPLETE` (422). Existing
sanitized storage errors and size failures remain in effect.

Limits: 384 operations/request, 96 KiB serialized review request, 4,000 UTF-16
units/edit, no empty/control-character edits, 96 edited-fact IDs on approval,
96 KiB complete serialized document and the existing 128 KiB PostgreSQL JSONB
constraint. No content is truncated to fit. Restoring a large original field is
allowed from the pinned profile, even if it exceeds the manual-edit limit.

### Wording provenance and approval

`document.review.contractVersion = "1"` stores per-fact `reviewedText`,
`wording` (`reviewed_profile`, `user_edited`, `ai_accepted`), and proposal decision
(`pending`, `accepted`, `rejected`, `none`), plus acknowledged issue indices and
nullable `{ revision, approvedAt }` approval. Existing generated documents without
review state receive the same initial state on read and persist it on first save;
new generation initializes it before insertion. Original generated proposals and
review issues remain available; decisions are separate from the immutable proposal
text, whose original generation status remains `pending`.

Accept is an explicit action on a retained proposal. Decisions can be revisited;
Keep original restores the exact pinned reviewed wording. Manual edits change only accepted text and mark user-edited
wording; they never change source fact origin, evidence, confirmation scope or P6
support. The UI explicitly labels this distinction and explains that pinned
evidence does not independently substantiate edited wording. Restoring reads the
exact fact value from the pinned profile, including confirmed user-entered facts;
it does not invent original-source evidence. Its UI action explicitly says
“restore … and save” and requires no outstanding local edits.

Approval requires decisions on every proposal, explicit acknowledgement of every
non-proposal review issue and exact edited-fact IDs. Semantic proposal issues are
resolved by Accept/Keep original rather than a generic acknowledgement. Approval
is itself a revisioned write: approving revision N saves revision N+1 with approval
for exactly N+1. Every later review save clears approval, including restoration
or issue decisions. “Approved” means user-reviewed, not independently verified.
Issue acknowledgement never resolves a P6 gap or changes Partial/Unknown/Conflict
or AND/OR assessments. Unsafe discarded proposals cannot be accepted.

Saved drafts remain editable against their original immutable context after a
new current CV, profile revision or job edit. They are never rebased; an older job
snapshot gets a visible warning. Their exact pinned profile must still exist and
hash-match. Generation still requires fresh current source/profile/job/match
context under P8.3. Explicit draft → profile → source deletion and RESTRICT
retention are unchanged; no historical revision is automatically removed.

### UX and boundaries

The workspace keeps all eligible facts, including those not selected by AI, in
readable section/entry order. Evidence, review issues and recoverable passages use
native keyboard-accessible disclosures. Structural/superseded/excluded source
content is loaded only by an explicit protected request to the pinned source and
profile. Save remains explicit. Loading, errors, conflict messages, saved revision,
unsaved status and approval are visible. Draft listing is explicit and paginated.
Requests disable editing while in flight; response epochs prevent late responses
after unmount from replacing state. Draft/source dirty states are combined in the
existing navigation/beforeunload guard and also prevent replacing the current CV.
No private text is stored in browser persistent storage or logs.

P8.4 edits existing structured fields. Adding/restructuring facts belongs in Source
CV Review followed by generation of a separate draft; empty sections remain
explicit and can be acknowledged, never populated by inference. There is no draft
history UI, rich-text editor, automatic semantic verification, export or automatic
AI rewrite acceptance. Approval records current review state rather than a separate
append-only audit ledger. Verification is documented in
`docs/audits/p84-tailored-cv-review-acceptance.md`.

## P8 completion: approved DOCX/PDF downloads

P8 now supports upload → structured source review → job relevance analysis →
separate draft generation → editing/review → saved revision approval → DOCX/PDF
download. The existing local Ollama/qwen3:4b provider and P6/P7 policies are
unchanged. No schema, binary storage, worker, browser renderer or cloud service
is added.

### Approval and canonical content

`POST /api/v1/tailored-cv/drafts/:id/export` accepts exactly
`{ contractVersion: "1", expectedRevision, format: "docx" | "pdf" }`. It uses the
same strict local Host/Origin guard and owner scope. A short read transaction
checks the integer revision, exact saved approval and all review prerequisites.
It projects only accepted wording into a canonical version-1 block document.
Rendering takes place outside the transaction. Before returning bytes, the service
rechecks the current revision and approval; an intervening save returns a conflict
rather than sending a stale file. Export never writes a draft or calls AI.

Both formats consume the same ordered canonical blocks. Contact, profile, skills,
experience, projects, education, certifications, languages, links and additional
sections use a fixed readable section order; entry/fact chronology remains exact.
Line endings are normalized (CRLF/CR → LF) and outer paragraph whitespace is
removed for layout, avoiding blank pages from source delimiters. Accepted words,
Unicode, names, dates, numbers and qualifications are preserved. Source evidence,
JD snapshots, assessment data, review issues, proposal text and internal provenance
are not rendered. Missing/empty source sections produce no invented content.
AI-unselected eligible facts remain included by default.

Review adds an independent operation `{ action: "include", factId, included }`
and optional per-fact `exportIncluded` (default true). Changing it clears approval
and requires Save/Approve again. Exclusion affects downloads only: the fact,
wording, evidence, chronology and original profile stay in the saved workspace.
It is explicitly labelled in the UI. Wording edits and inclusion changes are
coalesced independently so toggling inclusion cannot lose unsaved wording.

Missing/foreign drafts share 404. Stale revision is 409; missing/exactly invalid
approval is `CV_EXPORT_NOT_APPROVED` (409). Empty downloads and unsupported text
return `CV_EXPORT_EMPTY` / `CV_EXPORT_UNSUPPORTED_TEXT` (422). Renderer/storage
failures use sanitized `CV_EXPORT_UNAVAILABLE` (503). Existing context-limit and
review-incomplete failures are preserved. Attachments have fixed ASCII filenames
`tailored-cv-<UUID prefix>-r<revision>.<format>`, correct MIME, `Content-Length`,
`Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

### Renderers, fonts and bounds

Runtime dependencies are `docx` 9.15.2 (real OOXML paragraphs/styles, not images),
`pdfkit` 0.20.2 (actual embedded-font PDF text and automatic pagination), and
`fontkit` 2.0.4 (already a PDFKit transitive dependency, declared directly for its
public glyph coverage API). Development declarations are `@types/pdfkit` 0.17.7
and `@types/fontkit` 2.0.9. The two DejaVu Sans regular/bold TTF files and their
license are bundled under `apps/api/assets/fonts`; runtime packaging must include
that directory alongside `dist`. They are never shipped in the frontend bundle.

One ATS-friendly, single-column A4 template uses 10.5 pt body text, readable
spacing, styled headings and bold anchors. PDF embeds fonts; DOCX requests DejaVu
Sans and permits viewer font fallback. Paragraphs flow naturally over pages;
headings/anchors stay with following text, and long URLs wrap without inserting
new factual characters. Font coverage is checked before either format renders:
Vietnamese/mixed English text is supported; unavailable glyphs fail explicitly,
not silently as replacement boxes. This is not a universal-script, PDF/A or exact
cross-viewer pagination guarantee.

The existing 96-fact / 96 KiB document bounds remain. Canonical export additionally
refuses more than 1,200 explicit lines; PDF rendering stops at 40 pages, and browser
blob downloads have a 10 MiB bound. Files are generated in memory on demand and
never persisted by the product. The original upload parser's 12,000-unit text
limit remains unchanged; an unusually long manually expanded exported CV can
exceed that separate re-upload limit without losing any export content.

### Browser reads and journey reliability

Actual Chromium acceptance uncovered that same-origin GET fetches omit Origin,
while P8 intentionally protects private reads with the strict local Origin guard.
Rather than accepting Origin-less reads, browser contracts now POST version-1
read bodies to the existing source/content/profile/profile-revision/draft paths.
These read aliases return 200 and require exactly `{ contractVersion: "1" }`.
Metadata listing uses POST `/jobs/:id/drafts/list` with version 1 and
`before: null | <UUID>`. Original GET contracts remain available with explicit
local Origin headers; no guard or P6/P7 policy was relaxed.

Downloads are enabled only for the exact approved saved revision with no local
changes. Explicit busy/error states retain saved work; stale revisions prompt
reload/review/reapproval. Expired matches, absent source/profile and unavailable
AI have actionable generation messages. Match/model availability is not required
to reopen or download an approved historical draft. Blob URLs are revoked after
initiating download, and an epoch check suppresses downloads from late responses
after unmount. No CV/JD enters browser persistent storage or logs.

Verification, synthetic sample files/screenshots, full local CI gate results and
viewer limitations are recorded in `docs/audits/p8-complete-acceptance.md`.
Renderer API references: [docx Packer](https://docx.js.org/api/classes/index.Packer.html),
[docx paragraphs](https://github.com/dolanmiu/docx/blob/master/docs/usage/paragraph.md),
and [PDFKit text/fonts](https://pdfkit.org/docs/text.html).

### P8 acceptance fix: logical source reconstruction and review

`tailored-cv/source-profile-structure.ts` reconstructs bounded logical passages
before the existing Ollama classification call. Adjacent wrapped summary/body
lines retain their exact source substring, including newlines. Bullets, explicit
record anchors, section headings, uncertainty and instruction-like content bound
merges. Name and professional headline are separate fields. Skill categories and
verbatim technology lists remain distinct without inventing proficiency.
Employer/role/date and institution/qualification anchors group records; ambiguous
or repeated attribution remains a review issue. Missing AI selections and
instruction-like passages stay unresolved. Server assembly supplies all values
and exact evidence offsets; AI supplies classification only. Saved CV text, PDF
parsing, P6 assessments and P7 evidence policies are unchanged.

Profiles may carry `reconstruction: { version: "2", previousRevisionId: null | UUID }`
inside the existing bounded version-1 document. This optional metadata preserves
legacy decoding without a migration. Pending user-entered facts in reconstructed
profiles require individual confirmation before section confirmation. Source
edits remain separate user-entered replacements, with no source evidence claim.

`POST /api/v1/tailored-cv/profiles/:id/rebuild` accepts
`{contractVersion:"1", expectedRevision, expectedSavedCvUpdatedAt}`. It explicitly
reconstructs from the pinned source, appends a pending revision and links the
previous revision. Existing owner, local Host/Origin, no-store, stale-source,
AI admission and optimistic concurrency protections apply. Failed rebuilds do
not append. Historical revisions and their tailored drafts are unchanged;
corrections are accessible in the earlier-review disclosure and are never
silently copied into source evidence. Appended revisions cannot change lineage.

Source Review defaults to readable section/record cards, section confirmation,
focused clarification, one summary editor, and record-level evidence disclosures.
Internal field/type adjustment is available only in an advanced disclosure.
Continue requires a saved, fully reviewed profile with no unresolved passages.
Unsaved navigation and request-epoch protections remain in place. Acceptance
results and remaining boundaries are in
[the reconstruction report](audits/p8-structure-review-fix.md).

### P8 acceptance blockers: bounded organizing and experience scope

The long synthetic reproduction in `docs/audits/p8-blockers-acceptance.md` showed
qwen3:4b returning four classifications for the same combined contact passage.
The duplicate-ID validator correctly rejected it. Organization now splits strong
contact tokens into exact source substrings before classification, with delimiters
retained in evidence/coverage. Unlabelled remainder stays uncertain. Recognized
professional headlines, including SOFTWARE DEVELOPMENT, cannot become names.

The existing Ollama provider classifies serial batches of at most 12 globally
pinned passage IDs / 6,500 serialized passage bytes. An over-budget single passage
fails explicitly. Batch-local schema, duplicate-ID and ownership checks run before
aggregation; the full document still passes existing evidence and coverage
validation. A shared 90-second deadline uses the existing provider cancellation
contract. Malformed output, transport errors, timeout, stale sources or conflicts
append nothing. No partial AI response is accepted as facts or persisted.
The logical-passage processing ceiling is now 240 (previously 96); the source
12,000-character / 49,152-byte limits, 300-fact / 96-KiB JSONB document bounds,
50-fact entry bounds and all evidence validators remain unchanged. Nothing is
truncated to fit. This expands processing capacity without changing fact trust.

Inside WORK EXPERIENCE, local Projects, Technology Stack, Responsibilities and
similar labels preserve experience scope and source order. Explicit employer/role
anchors delimit records; nested project facts stay visible under the employer.
Personal Projects / Independent Projects and other explicit top-level sections
remain genuine boundaries. A detached Projects label after a blank boundary is
uncertain and starts an unattributed record rather than inheriting an employer.
Repeated wording in an otherwise explicit, unambiguous employer/role record is
reviewable with that section: exact offsets establish its occurrence. Repetition
without clear record context still requires focused clarification. Confirmation
always remains an explicit user action, and P6/P7 semantics are unchanged.

New documents use optional `reconstruction.version: "3"`; versions 2 and absent
metadata remain valid historical documents. Legacy reviews are read-only with one
primary Organize my CV action, an optional previous-review disclosure and an
explicit failure/reload recovery path. Organization appends a pending revision
linked to earlier work. User corrections and drafts are never silently migrated.
After organizing, Edit is available, flagged facts need clarification and clear
sections can be confirmed. The UI now hides only a record's actual title field;
it no longer hides nested project names inside employer cards. No migration,
dependency, parser, AI provider, authentication or infrastructure was added.

### P8 acceptance: contact tokens and complete structured skills

`source-profile-structure.ts` now isolates strong contact tokens even when there
is only one token (for example, a location plus phone without email). Email,
phone and URL patterns supply field hints deterministically; their values remain
exact source substrings. Separator/icon artifacts U+FFFD, U+25A1, U+25AF,
U+25A0 and private-use glyphs become explicitly unresolved coverage, rather than
model-selected Location facts. Damaged words are not repaired or partially
extracted. Other unrecognized contact remnants also stay unresolved. Instruction
checks precede token splitting, preventing an injected instruction containing a
phone/email from becoming a candidate fact. Saved source text, parser behavior,
hashes and offsets are unchanged; there is no global text normalization.

Within a genuine skills section, category labels and their associated lists use
server-owned structural hints even when a valid AI response omits those IDs.
Known category lines and categories with inline lists preserve source order and
verbatim technology/qualifier wording. Unknown colon-labelled categories require
focused clarification. No inference is made about proficiency, production use or
ownership. `assertSkillSourceCoverage` checks newly assembled proposals for
missing category/list facts, exact mapped coverage and category association.
This is deliberately not applied to explicit later user exclusions. Generic
source coverage remains a complete mapped/unresolved/excluded partition.
Existing model schema/ID checks, failure rollback and all runtime evidence
validation remain strict. Experience grouping and P6/P7 policies are unchanged.

The review displays unreadable contact fragments separately and lets users
explicitly exclude reviewed separator symbols together. Original glyphs remain
in source/evidence and excluded coverage; exclusion is never automatic. Unknown
text requires the existing focused assign/exclude review. Section confirmation
and Save remain explicit, and unresolved content blocks Continue. No browser
storage or logging was added.

No new document format or API is needed. Existing revision-3 reviews remain
readable and editable; **Reorganize from source** appends a corrected revision
using the existing expected-revision/source checks. It never mutates historical
profiles, user corrections or pinned drafts. Reorganization resets confirmations;
review the new result and reapply earlier corrections consciously if needed.
See [contact/skills acceptance](audits/p8-contact-skills-acceptance.md).

### P8 generation readiness and match lifecycle

P8 eligibility is independent of P7 suggestion readiness. Previously
`CvMatchPanel` passed no P8 match ID when P7's `contextRejected` flag was true.
Its wall-clock timer compared API `analyzedAt` to browser `Date.now`, whereas
backend `MatchContexts` expires by monotonic `performance.now`. Client/API clock
skew could therefore reject a fresh, valid match. The P7 timer/policies remain
unchanged; they no longer control P8 eligibility.

`POST /api/v1/tailored-cv/jobs/:id/drafts/readiness` accepts version 1 plus
`expectedJobUpdatedAt`, `expectedSavedCvUpdatedAt: ISO | null`, and
`matchId: UUID | null`. The existing owner/local Host/Origin/no-store protections
apply. The read-only response contains `ready`, a non-sensitive reason code,
`pins` (or null), and `matchValidForMs`. No CV/JD text is returned, no AI runs, and
no source/profile/draft is created or modified. It locates the latest profile of
the exact saved source and reuses `TailoredDraftService.context`, including
reviewed eligibility, current source hash/text/filename/timestamp, job revision,
canonical requirement identity, ownership and live match checks. Generation
still repeats those checks before AI and persistence; preflight is not approval.

Matching owns expiry: `JobMatchService.remainingSnapshotMs` validates the snapshot
then exposes only its remaining monotonic lifetime. P8 rechecks on Improve CV
entry, saved source review, fresh match, explicit Continue, window focus and the
server-provided expiry timer. Browser clock timestamps and P7 assessment/suggestion
shape are not eligibility proxies. A cancelled-effect guard ignores late
responses for previous source/job/match keys. No browser storage was added.

`tailored-cv-readiness.ts` independently maps local busy/dirty state and validated
server readiness into a precise message and recovery action. Missing/expired/
replaced context offers in-place Refresh CV Match using the existing P6 analysis
path; its completion automatically rechecks readiness without uploading or
reviewing the source again. Saved CV/job changes require metadata reload; an
incomplete profile directs the user to Source CV Review. Existing fact/context
bounds remain authoritative and have an explicit budget reason.

Continue focuses Tailored CV, triggers readiness and displays a next-step message.
Load saved drafts explicitly reports empty/nonempty results and opens the list.
Historical draft access does not require a CV Match or source proposal. Existing
unsaved-edit guards remain; generation always creates a separate draft. The
synthetic regression, actual qwen3:4b browser journey and remaining limits are in
[workflow acceptance](audits/p8-workflow-acceptance.md).

### P8 UX polish — Checkpoint A

The job's Improve CV tab retains P7 suggestions and links to
`/jobs/:id/tailored-cv`. The dedicated four-step workspace reuses SourceCvReview,
CvMatchPanel and TailoredCvReview instead of duplicating their evidence, revision,
approval or export rules. Hidden step content stays mounted to retain local review
state; step changes are blocked until local edits are saved or discarded. The
existing navigation/unload guard protects leaving the route.

Saved drafts are discovered on entry and can be resumed directly, independently
of generation readiness. Older drafts retain their pins and paginated access.
Preview shows included accepted wording; downloads retain the existing saved
revision approval gate. The preview is a content view, not a PDF layout preview.

Only the last successful match ID per job is retained in sessionStorage, with
no CV or job content. The P8 server preflight revalidates it; P7 rejection is never
a readiness input. If storage is unavailable or the browser session has ended,
match recovery may require reanalysis because there is no current-match read
endpoint. Persisted source reviews and drafts remain reusable. No backend,
schema, AI prompt, export generator or dependencies change in this checkpoint.

### P8 UX polish — Checkpoint B

Both Job Detail and Tailored CV now read `GET /api/v1/opportunities/:id/match`.
JobMatchService returns the current owner/job snapshot from its existing bounded,
15-minute in-memory MatchContexts cache. Reads use the same ownership and exact
CV/job revision validator as suggestions and draft generation, expose only the
assessment and public revision metadata, and never extend TTL or invoke AI.
There is no additional match engine, database table or browser match cache.

The endpoint distinguishes valid, missing, expired, changed-CV, changed-job and
unavailable-CV state. An expired entry already pruned, a capacity eviction or a
server restart is reported as missing; the UI states these possibilities without
inventing persistence. A later successful analysis replaces the same job's old
snapshot, and both views load the replacement on entry/refocus. Failed analysis
continues to retain the previous successful display; it does not create a result.

The wizard resolves its initial step only after matching the P8 preflight to the
loaded match identity: ready opens Tailor & Review; reviewed source with a missing
or stale match opens CV Match; incomplete source opens Source CV. Manual step
selection takes precedence over later readiness updates. A match replaced between
read and preflight gets one automatic read retry per rejected ID, never automatic
analysis. P7 rejection remains independent of P8 readiness.

An accessible responsive MUI Stepper links to the retained panels. Resume opens
the saved draft itself, routing approved revisions to Preview & Export and other
revisions to Tailor & Review, even when generation prerequisites are unavailable.
Draft save/approval controls precede the long content review; separate generation
and historical drafts collapse after opening a draft. Existing source evidence,
pins, explicit saves, approval policy, export generator and exit guard remain
unchanged. Checkpoint A's sessionStorage match-ID workaround is superseded by the
server read endpoint. Browser reloads can recover only a still-live server cache;
server restarts discard matches. Persisted profiles and drafts are unaffected.

### P8 Checkpoint B final follow-up — explicit review navigation

This supersedes B's approval-driven resume routing. Initial wizard entry waits for
saved-draft discovery; the latest listed draft is loaded into Tailor & Review,
regardless of approval or current match availability. Without a draft, existing
P8 readiness still chooses source review, match or tailoring. A single entry flag
and `goToStep` mechanism give explicit actions precedence over async completions.
Load/Resume select review before requesting content; completion only accepts the
selected document. An epoch check prevents a late automatic load from replacing
an explicitly selected draft. Preview & Export requires an explicit step/action.

An unchanged approved revision shows an export-ready summary and retains full CV,
evidence, edit and secondary reload access. Save/Discard appear only for local
changes; approval controls are hidden for unchanged approved revisions. Local
changes retain the saved approval until the existing explicit save operation,
but are visibly unapproved and block export/navigation. Existing save, revision,
approval, ownership and export policies remain authoritative and unchanged.

### P8 UX Checkpoint C — review clarity and export presentation

ProposalComparison compares exact word/whitespace token sequences using a bounded
CV-field LCS; highlighted deletions/additions do not alter either string or its
provenance. Pending proposals expose explicit choices; decided proposals expose a
status and Change decision. Manually authored replacements remain labelled as
manual wording rather than verified source evidence.

Keep all original wording confirms and queues existing `reject` operations only
for currently pending proposals. It neither saves nor changes prior decisions,
inclusion flags, issue acknowledgements or approvals. Existing backend review
validation remains mandatory; no new mutation route or approval model is added.
After confirmation, keyboard focus moves to Save. A compact summary describes the
sequence and local/saved/approved state. Inclusion remains explicitly optional.

The shared content preview includes facts by default unless explicitly excluded,
orders sections consistently with canonical export, and can show local edits in
Step 3 without changing steps. Step 4 and downloads keep A/B navigation, dirty
state guards and exact saved-approval checks. This content view is not a PDF/Word
pagination preview.

Canonical export retains semantic fields and annotates blocks with their section
for layout only. Typed roles remain bold for every entry; reviewed Experience
headline fields and skill-category labels now receive the same anchor styling.
DOCX anchors keep their lines together and with following content. PDF measures
wrapped anchor height before page breaks. Both renderers use a nonbreaking space
inside the skills phrase Stakeholder Communication; accepted/canonical text is
unchanged and Unicode/word-content parity remains tested. No source extraction,
match semantics, pinning, ownership, concurrency or export authorization changes.

### P8 D1: bounded qualification alternatives

Mixed bachelor/experience/coding-boot-camp requirements use internal typed
predicates before generic compound parsing, consistently for skill and experience
categories. Degree fields remain grouped under one bachelor predicate; the
recognized flat OR accepts two or three distinct alternative kinds. Unsupported
mixed/nested qualification wording remains Unknown. Existing equivalent-practical-
experience education handling and unrelated skill semantics remain unchanged.

Evidence requires an explicit accepted bachelor field, numeric software-development
experience meeting an integer month threshold, or explicit boot-camp completion.
A bachelor degree assertion represents an earned qualification unless its bounded
entry says otherwise. IT is not equivalent to CS/Engineering. No date-range tenure
calculation or summing roles is performed. Whole source lines retain punctuation
qualifiers; only adjacent field-only/status lines are joined as contiguous source
spans. Source recovery uses the same predicates as selected evidence, and rejected
model evidence cannot authorize recovery. Conflicting positive/negative evidence
retains the existing zero-credit parent veto. Ambiguous evidence stays Unknown.

A separate qualification helper keeps these bounded rules out of the existing
technology-specific guards; a recursive expression engine and field ontology are
unnecessary. Public assessment shape and parent IDs/weights stay unchanged. The
reported clause now has three components rather than four; component IDs are local
to the new assessment. Tailored-draft relevance reads component IDs from that
assessment, while existing stored drafts are never rewritten by matching.

MatchContexts cache entries carry an internal matching-policy version. The D1
version must be bumped for future deterministic semantic changes; mismatches fail
snapshot validation and use the existing expired/reanalysis path without rescoring.
API process restart also clears all in-memory assessments. No database migration,
match persistence, generation/review/export change or new dependency is involved.

## D2.2 PDF Skills layout

PDF parsing keeps its original text serialization and offsets. Optional version-1
geometry records exact UTF-16 item spans, page-normalized coordinates, dimensions
and horizontal direction, bound to the source SHA-256. The worker validates spans
against page segments. Capture is limited to 768 nonblank items and 48 KiB; an
incomplete capture contains no usable items and never truncates source text. This
metadata travels separately from ExtractionSource through the saved-CV import and
existing provenance JSONB. Legacy parsing/analysis callers keep their source-only
contract. No migration or existing-source backfill is needed.

Only newly organized profiles consume the metadata. A deterministic recognizer
requires an explicit Skills region, at least two known category labels, separated
stable columns, aligned first value lines, and unambiguous wrapped lines. It
abstains for rotation, overlap, unknown labels, mixed pages or incomplete/stale
hints. Ambiguous source passages retain exact wording and require clarification;
last-category hints are removed so text order cannot silently override abstention.
No model supplies geometry or row ownership. Internal ownership hints are omitted
from model prompts.

Reliable rows create category/value facts from exact source slices. Wrapped spans
merge only when adjacent in source order; interleaved spans remain separate facts
in the same geometry-owned entry. Entries/facts follow visual row order while
coverage remains a gap-free source-order partition. The ownership invariant checks
geometry rows separately and retains the existing adjacency check for text-only
profiles. This is a bounded Skills recognizer, not a general table parser.
Existing reviewed revisions, drafts, approvals, D2.1 filtering and export formats
are unchanged. Existing sources lacking geometry require a newly parsed upload
to gain automatic layout recognition. Recognition does not replace user review.

Category candidates must occupy the geometry-established left column. A known
category word such as `Communication` can also be a wrapped value in the right
column; it must not become a row anchor or invalidate the table's column checks.
This restriction preserves all existing alignment, spacing and coverage checks.

## P8 contact fragments and profile references

The envelope glyph U+2709 is segmented separately from intact contact values,
like existing PDF private-use icon glyphs. Unreadable characters embedded inside
words remain unresolved; icon exclusion never removes their surrounding values.
Validated PDF item geometry can mark a hyphenated contact reference immediately
beside an icon and on the same baseline as an email/phone as a possible LinkedIn
reference. This is context for review, not proof of the platform or a URL. The
source fragment stays unresolved until the user retains, classifies or excludes
it. Original PDF hyperlink annotations must be inspected before attributing a URL;
no URL is inferred from a glyph code or candidate slug.

Source review offers explicit detail types and independently excludes reviewed
icon-only fragments, including legacy envelope fragments. Constructing a LinkedIn
URL requires a platform-confirmation checkbox and an explicit action. It creates
a user-entered replacement with empty evidence alongside the unchanged source
reference, using existing revision/save/confirmation rules. It never changes old
source/profile revisions or approved drafts, and does not label constructed URLs
as source-verified links.

### Ledger visual foundation

The workspace moves from Calm Teal to Ledger: neutral warm-gray surfaces, one
ink-blue primary for actions, links and focus, and MUI's default semantic status
colors (their filled-Chip contrast is already covered by tests). IBM Plex Sans
and Source Serif 4 are bundled with `@fontsource` because the previous Inter
stack was never loaded and fell back to platform fonts; bundling avoids runtime
font requests. The serif is scoped to the CV preview so CV templates stay
independent of the app theme. Navigation is reduced to Jobs, Discover and My CV;
retired placeholder routes redirect to Jobs. Alternatives considered: refining
Calm Teal (lower churn, but teal kept meaning brand, action and status at once)
and a document-only Paper theme (too sparse for job tables).

### Job workspace navigation

Each job is one workspace at `/jobs/:id/*` with tabs Overview, Match, Tailored
CV and Application (`/jobs/:id`, `/match`, `/tailored-cv`, `/application`);
Edit JD is a header action at `/jobs/:id/edit`. One route keeps `JobEditor`
mounted across sections, so hidden form and source-review state survive tab
changes without re-fetching. The unsaved-changes guard therefore allows
navigation inside the workspace, except leaving the Tailored CV tab with unsaved
review decisions (that workflow unmounts). Legacy `?tab=` links redirect;
Improve CV advice now sits below the Match assessment. Tab badges use loaded data
only: match score or Outdated, Outdated for a draft built on an older job
version (the draft list has no review/approval state, and a revision number does
not convey it, so nothing else is shown), and follow-up due state or date. Match
messaging separates "Not analyzed yet" (no saved match) from "Outdated" (a saved
match invalidated by CV, job or rule changes) in both the assessment and advice.
