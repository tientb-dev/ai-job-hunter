# Hosted beta deployment

One small VPS (2 vCPU / 4 GB is plenty for 5–10 testers) running Docker Compose.

```
browser ──HTTPS──▶ web (Caddy: TLS, SPA, /api proxy) ──▶ api (NestJS) ──▶ postgres
                   ports 80/443 only                     private network only
```

- `Dockerfile`: targets `api` (Node 24, production dependencies, `dist` and PDF
  fonts, runs as `node`) and `web` (Caddy with the SPA built with `VITE_HOSTED=1`).
- `compose.prod.yaml`: the three services, named volumes `postgres-data`,
  `caddy-data` (certificates) and `caddy-config`. Only `web` publishes ports.
- `deploy/Caddyfile`: automatic HTTPS for a real domain, security headers, SPA
  fallback, `/api/*` to the API. Caddy keeps the `Host` header and replaces any
  client `X-Forwarded-For`, which the API trusts only with `TRUST_PROXY=1`.

Development (`pnpm db:up`, `pnpm dev`, `compose.yaml`) is unchanged.

## Configuration

Copy `.env.production.example` to `.env.production` on the server and
`chmod 600` it. It is git-ignored; never commit it.

| Variable                         | Purpose                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SITE_ADDRESS`                   | Caddy site, e.g. `beta.example.com` (automatic HTTPS)                                                              |
| `PUBLIC_ORIGIN`                  | The browser origin, e.g. `https://beta.example.com`. The API accepts only this Host/Origin                         |
| `DB_PASSWORD`                    | PostgreSQL password (long and random)                                                                              |
| `GEMINI_API_KEY`                 | Server-side Gemini key; never sent to browsers                                                                     |
| `AI_REQUEST_TIMEOUT_MS`          | Optional, default 120000                                                                                           |
| `AI_DAILY_USER_LIMIT`            | Gemini requests per account per day, default 100                                                                   |
| `AI_DAILY_GLOBAL_LIMIT`          | Gemini requests for the whole beta per day, default 500                                                            |
| `AI_MAX_CONCURRENT`              | Gemini requests in flight at once, default 4                                                                       |
| `JOB_URL_FETCH_TOPCV`            | `1` lets users import TopCV job links; default `0` (off). See [job link sources](architecture.md#job-link-sources) |
| `JOB_URL_FETCH_VIETNAMWORKS`     | `1` lets users import VietnamWorks job links; default `0` (off)                                                    |
| `PUBLISH_HTTP` / `PUBLISH_HTTPS` | Optional host ports, default 80 / 443                                                                              |

Fixed in `compose.prod.yaml`: `NODE_ENV=production`, `AI_PROVIDER=gemini`, the
`ai_job_hunter` database identity, `DB_HOST=postgres`, `TRUST_PROXY=1`.
The API refuses to start in production with plain-HTTP origins (except
`http://localhost`), Ollama, or any `*_DIAGNOSTICS` flag set (those logs can
contain CV/JD text). Session cookies are `__Host-`, `Secure`, `HttpOnly`,
`SameSite=Lax`.

## Deploy or update

Run from the repository checkout on the server:

```bash
C="docker compose -f compose.prod.yaml --env-file .env.production"
$C build
$C up -d --wait postgres
# Explicit migration step; the API never migrates itself. Never revert in production.
$C run --rm api node node_modules/typeorm/cli.js migration:run -d dist/database/production-data-source.js
$C up -d --wait
$C exec api node dist/auth/auth-cli.js invite --local-owner   # first account only
$C exec api node dist/auth/auth-cli.js invite --days 7        # each tester
$C exec api node dist/auth/auth-cli.js reset --email tester@example.com
```

Point the domain's DNS at the VPS and open ports 80 and 443 before the first
start so Caddy can obtain the certificate. Keep SSH key-only and close every
other port.

## Local production test (no domain)

Use a separate project name and a throwaway env file so nothing touches the
development database or a real deployment:

```bash
cp .env.production.example /tmp/ajh-prodtest.env   # then edit:
#   SITE_ADDRESS=http://localhost
#   PUBLIC_ORIGIN=http://localhost:8080
#   PUBLISH_HTTP=127.0.0.1:8080
#   PUBLISH_HTTPS=127.0.0.1:8443
#   DB_PASSWORD=<random>   GEMINI_API_KEY=<any 20+ chars; AI calls will fail>
C="docker compose -p ajh-prodtest -f compose.prod.yaml --env-file /tmp/ajh-prodtest.env"
```

Then run the deploy commands above with this `$C` and open
<http://localhost:8080>. Browsers treat `localhost` as secure, so the `Secure`
cookie works without TLS. Remove everything afterwards with `$C down -v`
(deletes only this test project's volumes).

## Backup and restore

```bash
scripts/backup-prod.sh backups          # writes backups/ai_job_hunter-<UTC>.dump (mode 600)
```

Run it daily from cron and copy each file off the VPS (for example with
`rsync`/`scp` to your own machine or encrypted object storage); a backup on the
same disk does not survive losing the server. For a 30-day beta, keep 14 daily
dumps plus the dump taken before each deploy, and delete all copies when the
beta data is deleted.

Restore into a **separate** database first and check it before replacing
anything:

```bash
$C exec -T postgres createdb -U ai_job_hunter restore_check
$C exec -T postgres pg_restore -U ai_job_hunter -d restore_check --no-owner --exit-on-error < backups/<file>.dump
$C exec -T postgres psql -U ai_job_hunter -d restore_check -c 'select count(*) from ai_job_hunter.users'
$C exec -T postgres dropdb -U ai_job_hunter restore_check
```

Replacing the live database is a deliberate, manual operation: stop `api` and
`web`, restore into a fresh `ai_job_hunter` database, then start them again.

## Hosted limitations

- Speech-to-text is off (no whisper.cpp on the server); recording, playback and
  typed answers work. The TopCV/VietnamWorks bookmarklet is hidden; use URL
  import, paste or upload.
- One API instance: login rate limits and the one-at-a-time CV Match/discovery
  runs are in memory.
- Gemini limits count requests, not tokens or money: keep a Google Cloud budget
  alert on the API key as the backstop. Today's usage:
  `$C exec -T postgres psql -U ai_job_hunter -d ai_job_hunter -c 'select * from ai_job_hunter.ai_usage order by day desc, requests desc'`
  (the `00000000-…` row is the beta-wide total).
