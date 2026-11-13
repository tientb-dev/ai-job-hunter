# Setup: run locally with Local AI (Ollama)

This is the alternative to the recommended
[Local + Gemini beta setup](beta-local-gemini-setup.md). It suits technical or
privacy-focused users: AI requests go to an Ollama server on your own computer
instead of Google. Other features still use the network as usual, for example
URL job import and Discover.

Ollama is the application's default provider (`AI_PROVIDER=ollama`).

## 1. Prerequisites

Follow sections 1, 2 and 5 of the [beta guide](beta-local-gemini-setup.md)
for the tools, code install and starting the app. Skip its Gemini key sections.

You also need:

- [Ollama](https://ollama.com/download) **0.40.10**. Generation checks the exact
  server version and model digest pinned in
  [`apps/api/src/ai/ollama.context.ts`](../apps/api/src/ai/ollama.context.ts)
  and refuses other versions.
- The `qwen3:4b` model (a download of a few GB). Nothing is downloaded automatically:

```bash
ollama pull qwen3:4b
```

A GPU is recommended. On CPU only, AI actions are slow and may time out.

## 2. Configure `.env`

```bash
cp -n .env.example .env
```

Set `DB_PASSWORD`. The Ollama defaults in `.env.example` need no changes:

```ini
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:4b
AI_REQUEST_TIMEOUT_MS=120000
```

`OLLAMA_BASE_URL` must be a literal `127.0.0.1` or `[::1]` origin. The timeout
accepts 1000–300000 ms.

## 3. Start and check

Make sure Ollama is running (`ollama list` shows `qwen3:4b`), then:

```bash
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open <http://127.0.0.1:5173>. `GET /api/v1/health/ready` checks only the
database, not Ollama. To check AI, use **Extract with AI** on a pasted job
description. Manual tracking works without any AI.

If AI fails with a version or model error, compare `ollama --version` and
`ollama list` with the pinned profile above.

## Privacy

With Ollama, CV and job text are processed on your computer and stored in the
local PostgreSQL database. The app has no login; do not expose it to a network.
