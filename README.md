# AI Job Hunter

A personal job-search workspace that runs on your own computer. Track job
applications, compare your CV with job descriptions, create tailored CVs and
practise for interviews. It is for one person and has no login.

AI results are suggestions. Review them before you use them. Missing evidence in
a CV match does not prove you lack a skill.

## Key features

- **Dashboard**: a job search summary, follow-ups due today or overdue (with
  **Done** and **Dismiss**), and **Continue where you left off**.
- **Jobs**: add jobs by pasting text, uploading a PDF/DOCX, importing a supported
  URL or typing them in, then review and save. Track application status, applied
  date, channel, notes, HR contacts and follow-up dates.
- **Discover**: find new jobs from a fixed set of company job boards. You review
  each one and save it to Jobs yourself; nothing is saved automatically.
- **My CV**: upload and save the one source CV that every job uses.
- **Per job**: **CV Match** compares your CV with the job, **Improve CV**
  suggests changes and builds a tailored CV you review, approve and download as
  DOCX or PDF, and the **Interview** tab prepares questions for that job.
- **Interview Prep**: practise questions or run a mock interview with optional
  AI feedback. Voice answers are optional; you can always type.

The app never applies for jobs, sends messages or syncs calendars.

## Recommended journey

Start with whichever you have first, a CV or a job:

1. Save your CV in **My CV**, and add a job in **Jobs** (**Add job**).
2. Open the job and run **CV Match**.
3. In **Improve CV**, review your source CV, generate a tailored draft, then
   save, approve and download it.
4. Track the application in the job's **Application** tab and set a follow-up
   date. Due follow-ups appear on the **Dashboard**.
5. Prepare in the job's **Interview** tab or in **Interview Prep**.

## Get started

**Recommended for beta testers: Local + Gemini.** Follow the
[Local + Gemini beta setup guide](docs/beta-local-gemini-setup.md). The app runs
on your computer and uses Google Gemini (free tier, no billing) for AI features.
It includes a synthetic CV and job description for a first test.

**Alternative: Local AI with Ollama.** For technical or privacy-focused users who
can run a local model: [Local AI (Ollama) setup](docs/setup-ollama.md). Ollama is
the app's default AI provider.

Tracking jobs and applications works without any AI.

## Privacy

- Your jobs, CVs, drafts and interview answers are stored in a PostgreSQL
  database on your computer. Interview audio is never stored.
- **With Gemini, the CV and job text you analyze are sent to Google.** On the
  free tier, Google may use them to improve its products and people at Google may
  read them. Use synthetic data unless you accept that.
- With Ollama, AI processing stays on your computer. Other features, such as URL
  import and Discover, still contact the job websites.
- Keep API keys only in your local `.env` file. The app has no login, so do not
  expose it to a network or host it online.

## Beta limitations

- Tested with English CVs and job descriptions for IT/software roles.
- One user per installation. AI output can be wrong or incomplete.
- Free Gemini usage has per-minute and daily limits.
- CV upload accepts text-based PDF or DOCX, not scans.
- Discover covers only a few configured company job boards.
- Voice answers need whisper.cpp, which is optional and for technical users.

## For developers

- [Development](docs/development.md): commands, migrations, testing and optional
  speech-to-text.
- [Architecture](docs/architecture.md): module boundaries, API contracts,
  security and design decisions.
- [AGENTS.md](AGENTS.md): contributor and coding-agent workflow.
- [UX guidelines](docs/ux-guidelines.md) and
  [historical audit reports](docs/audits/).
