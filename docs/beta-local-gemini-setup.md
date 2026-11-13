# Beta setup: run locally with Google Gemini

This guide is for beta testers. It runs AI Job Hunter on your own computer and
uses Google Gemini for AI features. Plan for about 30–60 minutes. The app is for
one person, on your own computer. It has no login and you should not host it
online.

**Beta scope:** English CVs and job descriptions for IT/software roles. Other
languages and job fields are not tested in this beta, so results may be poor.

## 1. What you need

- **Windows 10/11 with WSL2 (Ubuntu)**, or macOS/Linux. Run every command below
  in the Ubuntu/terminal window, not in PowerShell.
- **Docker Desktop**, running, with WSL2 integration turned on for Ubuntu
  (Settings → Resources → WSL integration). It runs the database.
- **git**, and **nvm** to install the exact Node version
  ([nvm install guide](https://github.com/nvm-sh/nvm#installing-and-updating)).
- **A Google account** (you must be 18 or older) to create a free Gemini API
  key. Section 3 shows how. No credit card or billing is needed.

Check the tools:

```bash
docker --version && docker compose version
git --version
command -v nvm
```

## 2. Get the code and install

The repository is public, so you do not need a GitHub account to download it.

```bash
git clone https://github.com/tientb-dev/ai-job-hunter.git
cd ai-job-hunter
nvm install            # reads .nvmrc (Node 24.22.1)
nvm use
corepack enable        # provides the pinned pnpm 12.14.0
pnpm install --frozen-lockfile
```

If `corepack enable` reports a permission error, run `npm install -g pnpm@12.14.0`
instead.

## 3. Get a Gemini API key (free, no billing)

Google changes this screen from time to time. If a label below does not match,
follow Google's official guide: [Using Gemini API keys](https://aistudio.google.com/docs/api-key).
These steps were checked against Google's documentation in November 2026.

1. Open [Google AI Studio](https://aistudio.google.com/) and sign in with your
   Google account. Accept the terms of service if asked.
2. Open the **API Keys** page ([direct link](https://aistudio.google.com/apikey)).
3. **Project:** new AI Studio users get a default Google Cloud project
   automatically. If you already use Google Cloud, AI Studio may not create one.
   In that case, open **Projects**, choose **Import projects** and pick a
   project, or create a new one.
4. Click **Create API key** and choose the project.
5. Copy the key. Keep the browser tab open until you have pasted it into `.env`.
6. Optional but recommended: on the key, choose **Add restrictions** →
   **Restrict to Gemini API only** → **Restrict key**.

**Do not set up billing for this beta.** The free tier needs only an active
project. Some projects must first be verified, for example with a phone number.
The model this app uses (`gemini-3.5-flash-lite`) is available on the free tier.

### Free and paid usage

|                                 | Free tier (use this)                                   | Paid tier (not needed)                          |
| ------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Cost                            | Free                                                   | Billed per use; needs a billing account         |
| Limits                          | Lower per-minute and per-day limits                    | Higher limits                                   |
| Used to improve Google products | **Yes**; people at Google may read your inputs/outputs | No (logged for a limited time for abuse checks) |

In the EEA, Switzerland and the UK, Google applies the paid-tier data terms to
free usage too. Sources: [pricing](https://aistudio.google.com/docs/pricing),
[rate limits](https://aistudio.google.com/docs/rate-limits),
[terms](https://aistudio.google.com/docs/terms). Your current limits are shown
in AI Studio on the [rate limit page](https://aistudio.google.com/rate-limit).

### Keep the key secret

- The key works like a password. Anyone who has it can use your quota.
- Paste it only into your local `.env` file. `.env` is ignored by git. Never put it
  in chat, email, screenshots, bug reports, `.env.example` or a commit.
- If it leaks: create a new key, put it in `.env`, restart the app, then delete
  the old key in AI Studio.
- With Gemini, **the CV and job text you analyze are sent to Google**. For this
  beta, **use only the synthetic samples in section 7**, not your real CV.
- Saved jobs, CVs and drafts stay in the local database on your computer.

## 4. Configure `.env`

```bash
cp -n .env.example .env
```

Open `.env` in a text editor (for example `nano .env`) and change these lines:

```ini
DB_PASSWORD=choose-any-long-password
AI_PROVIDER=gemini
GEMINI_API_KEY=paste-your-key-here
```

`DB_PASSWORD` is used only by your local database. Leave the `GEMINI_MODEL` line
commented out; only `gemini-3.5-flash-lite` is accepted. Put the key straight after `=`, with no quotes and no spaces. Leave the other
lines as they are. The `OLLAMA_*` lines are ignored when `AI_PROVIDER=gemini`.
Choose the database password once; changing it later stops the existing
database from accepting connections.

### Check the key works

This sends one tiny request (it uses one request from your quota). It prints
only an HTTP status code, never the key:

```bash
GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-) \
  sh -c 'curl -s -o /dev/null -w "%{http_code}\n" \
    -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" \
    -d "{\"contents\":[{\"parts\":[{\"text\":\"Reply OK\"}]}]}" \
    https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
```

| Result        | Meaning and fix                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`         | The key works.                                                                                                                                                                                                                                            |
| `400`         | Usually a wrong or incomplete key. Copy it again from AI Studio.                                                                                                                                                                                          |
| `403`         | The project cannot use the API yet: it needs verification, the free tier is not available, or the key was blocked as leaked. Read the message in AI Studio. A new key in the **same** project does not fix this. Do not add billing; tell the maintainer. |
| `429`         | Quota reached. Wait a minute (per-minute limit) or until the next day (daily limit).                                                                                                                                                                      |
| `500` / `503` | Google is busy. Try again in a few minutes.                                                                                                                                                                                                               |
| `000`         | No internet connection, or a firewall/VPN blocked the request.                                                                                                                                                                                            |

Google's full list: [troubleshooting](https://aistudio.google.com/docs/troubleshooting).

The app itself shows only general "AI unavailable" or "busy" messages, not these
codes. If AI features fail in the app, run this check again to see the reason.

### Rate limits in the app

The app retries short "busy" errors automatically. If an AI action still fails,
wait a minute and try once more. One CV Match or tailored draft can use several
requests, so the daily free limit can run out during a long test session.

## 5. Start the app

```bash
pnpm db:up        # starts PostgreSQL in Docker (first run downloads the image)
pnpm db:migrate   # creates the tables; safe to run again
pnpm dev          # starts the API and web app; keep this window open
```

Open <http://127.0.0.1:5173>. To check the API is ready, open
<http://127.0.0.1:5173/api/v1/health/ready>. It should report the database as ready.

To stop: press `Ctrl+C` in the `pnpm dev` window, then run `pnpm db:down`. Your
data is kept. Next time, run `pnpm db:up` and `pnpm dev`. After you pull a new
version, also run `pnpm install --frozen-lockfile` and `pnpm db:migrate`.

Do not delete Docker volumes or run `docker compose down -v`; that erases your data.

## 6. Optional: voice answers (whisper.cpp)

Interview practice works without it. Type or paste your answers instead. If you
want local speech-to-text, follow "Optional local speech-to-text" in the
[README](../README.md#optional-local-speech-to-text-pr16). This step needs a
C/C++ build and is meant for technical testers.

## 7. Test with synthetic data

The CV upload accepts **PDF or DOCX only**. A ready-made file with the sample CV
below is in the repository:
[`docs/beta-samples/synthetic-cv.docx`](beta-samples/synthetic-cv.docx). In WSL,
you can open its folder from Windows with `explorer.exe docs/beta-samples`.

**Sample CV (fictional):**

```text
Alex Example
alex.example@example.com | +00 000 000 000 | Example City

SUMMARY
Backend developer with 4 years of experience building REST APIs.

EXPERIENCE
Software Engineer, Example Tech Ltd — Jan 2022 to Present
- Built REST APIs with Node.js, TypeScript and NestJS.
- Designed PostgreSQL schemas and wrote migrations.
- Added unit tests with Jest; reduced production bugs by 30%.

Junior Developer, Sample Solutions — Jun 2020 to Dec 2021
- Maintained a React front end and fixed accessibility issues.

EDUCATION
BSc Computer Science, Example University, 2020

SKILLS
Backend: Node.js, TypeScript, NestJS, PostgreSQL
Frontend: React, HTML, CSS
Tools: Git, Docker, Jest
```

**Sample job description (fictional):**

```text
Backend Engineer — Fictional Corp — Remote
Requirements:
- 3+ years of experience with Node.js and TypeScript (required)
- Experience with PostgreSQL (required)
- Familiarity with Docker (nice to have)
- Experience with Kubernetes (nice to have)
Responsibilities:
- Build and maintain REST APIs
- Write automated tests
```

Steps:

1. **Add job** → paste the sample job description → **Extract with AI** →
   review and **Save**.
2. Open **My CV** → upload `docs/beta-samples/synthetic-cv.docx` → save it.
3. Open the saved job → **CV Match** → **Analyze CV Match**. Expect Node.js,
   TypeScript and PostgreSQL to be matched and Kubernetes to be missing.
4. Optional: **Improve CV** → review the source CV → generate a tailored draft →
   save, approve and **Download DOCX**.
5. Optional: **Interview Prep** → practise one question by typing an answer.

## 8. Reporting problems

Send the maintainer the step number, what you clicked, the message on screen
and your operating system. Do not send your `.env`, API key or real CV.

| Problem                                         | Try                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm db:up` fails: cannot connect to Docker    | Start Docker Desktop; enable WSL integration for Ubuntu                 |
| `pnpm db:up` fails: port 5432 already allocated | Another PostgreSQL is running; set `DB_PORT=5434` in `.env`             |
| API stops with `GEMINI_API_KEY must be set...`  | Check the key line in `.env`: no quotes or spaces                       |
| API stops with `GEMINI_MODEL must be...`        | Comment out or delete the `GEMINI_MODEL` line                           |
| Port 3000 or 5173 already in use                | Close the other app; these ports cannot be changed without code changes |
| AI busy / unavailable                           | Wait a minute (rate limit); check internet connection                   |
| PDF upload reads no text                        | Use a text-based PDF or DOCX, not a scan                                |
