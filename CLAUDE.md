@AGENTS.md

## UI/UX PR workflow (PR #92 onward)

- Agree on the visual reference and UX layout before implementing. No major redesign without an approved reference.
- Build on the MUI theme and shared UI foundation from PR #91 (`apps/web/src/app/theme.ts` `surface` tokens, app shell, `PageHeader`); do not add parallel styling.
- One screen or user flow per PR. Preserve business logic, API contracts, vi-VN/en-US strings and existing data.
- Run targeted tests first; no repeated full suites or exhaustive audits for small UI-only changes (the Pre-PR CI Gate still applies before push).
- Screenshots: normally one desktop and one 375px mobile view of the affected screen.
- PR description: changes, tests, known limitations. Keep it short.
- No screenshot/evidence branches, committed proof images or long reports unless explicitly requested.
- Preserve the development database and `.env`; never deploy without approval.
