# Development

Developer commands, migrations and testing. Contributor and coding-agent rules
are in [AGENTS.md](../AGENTS.md); design choices, module boundaries and API
contracts are in [architecture.md](architecture.md).

## Environment

Use Ubuntu WSL2 (or Linux/macOS), Bash, Node 24.22.1 and pnpm 12.14.0:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use
pnpm install --frozen-lockfile
```

Preserve existing `.env` and `.env.test`. For a new installation only, copy the
example files without overwriting (`cp -n`) and set distinct local passwords.
Never commit environment files, resumes, credentials, or production data.

Development requires `NODE_ENV=development`, `DB_ENV=development`, host
`127.0.0.1`, and database/user `ai_job_hunter_dev`. The Compose default database
port is 5432; keep the existing `DB_PORT` when reusing an installation. Port 5433
is reserved for tests. Process environment values override file settings.

AI provider setup: [Local + Gemini](beta-local-gemini-setup.md) or
[Local AI (Ollama)](setup-ollama.md). Ollama is the default
(`AI_PROVIDER=ollama`); `AI_PROVIDER=gemini` accepts only
`gemini-3.5-flash-lite` and needs `GEMINI_API_KEY`.

## Running

After checking the target database and authorizing any change to existing data:

```bash
pnpm db:up
pnpm db:status
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to `http://127.0.0.1:3000`;
the API prefix is `/api/v1`. Changing `API_PORT` alone does not update the Vite
proxy. Local write endpoints validate Host and Origin, so arbitrary alternate
frontend ports are not supported by default. Vite preview on port 4173 is not
the development API integration entry point.

- `GET /api/v1/health/live` checks process liveness without querying PostgreSQL.
- `GET /api/v1/health/ready` checks database readiness. It does not check the AI provider.

## Migrations

Migrations never run automatically. Run `pnpm db:migrate` after pulling changes
that add migrations; `pnpm db:status` shows what is pending. Do not reset
existing volumes to resolve configuration or credential problems.

Compiled migration commands append `:compiled` and require current API output
in `apps/api/dist`. Reverting removes the latest migration's schema additions;
review its impact before running it against a database with user data.

## Commands

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

Use focused checks for small changes according to [AGENTS.md](../AGENTS.md).
Full checks are for release checkpoints, explicit requests and the Pre-PR CI
Gate ([CI parity audit](audits/dev-02-pre-pr-ci-gate.md)). No command listed
here is a claim of a fresh passing result.

## Testing

The separate test Compose project uses tmpfs, port 5433, database/user
`ai_job_hunter_test`, `DB_ENV=test`, and `NODE_ENV=test`. `pnpm db:test:up` and
`pnpm db:test:down` manage that disposable database. Integration tests must never
use development or production targets, and must not run concurrently against the
same test database. Some HTTP tests use Host port 3000; align their process
`API_PORT` with the test fixture when invoking them.

### Interview feedback regression suite

Shared synthetic cases live in `apps/api/test/support/interview-feedback.cases.ts`.
The unit suite replays recorded model outputs through the real guards (offline,
in CI). For live model quality, run
`pnpm --filter @ai-job-hunter/api eval:feedback [--model qwen3:8b] [--out file.json]`
against local Ollama (refused under `CI`). Results are one indicative run per case;
invented-fact detection is heuristic. Documented limitations print as `KNOWN`.
To compare a prompt change, run it on a worktree of `main` and on the branch,
then diff the `--out` files.

## Optional local speech-to-text

Interview practice can transcribe a recording locally with
[whisper.cpp](https://github.com/ggml-org/whisper.cpp). Without it, users type or
paste answers. Build `whisper-cli` (CPU build) and download the English
`ggml-base.en.bin` model outside this repository, then restart the API. A
checkout at `~/whisper.cpp` (built in place, model in `models/`) is found
automatically; anywhere else, set absolute paths in `.env`:

```bash
STT_BIN=/path/to/whisper.cpp/build/bin/whisper-cli
STT_MODEL=/path/to/whisper.cpp/models/ggml-base.en.bin
```

The browser converts the recording to 16 kHz mono WAV (0.5 s–3 min) and sends it
only to this app's local API. Audio, transcripts and transcript feedback are not
saved. Transcription errs on technical terms; users should review the text before
requesting AI feedback.

## Runtime notes

- Tailored CV export uses exact approved wording and no AI. Font assets under
  `apps/api/assets/fonts` must accompany API runtime files. DOCX layout can vary
  with the viewer's fonts.
- The retired `/api/v1/opportunities/discover` returns 410 to stale clients.
- API contracts (Discovery, tailored CV review/approve/export, durable CV
  revisions) are documented in [architecture.md](architecture.md). Historical
  checkpoint and acceptance reports are in [docs/audits](audits/) and record past
  work, not current acceptance results.
