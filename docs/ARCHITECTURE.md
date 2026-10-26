# Labeller Dashboard Architecture

This document describes the architecture agreed for this project. Implement the project in its defined phases; do not introduce external repository-derived architecture or unrelated systems.

## Request flow — Phase 0/1

1. `Index.html` loads and calls `getIdentityDiagnostic()`. This endpoint reads no spreadsheet data.
2. The administrator verifies the identity result for the deployed audience. The identity gate remains closed by default.
3. When the gate is explicitly enabled in TEST, `getBootstrap()` and `getMyWork()` derive the active-user email on the server.
4. `Auth.gs` requires exactly one active Employees row and a valid role.
5. `SheetsRepository.gs` resolves only active projects assigned through an active Access row and reads the configured source tab.
6. `Metrics.gs` maps source headers, filters rows by the authenticated user's normalized email, and computes basic counts.
7. `Index.html` displays only the server-filtered result. HTML text values are escaped before rendering.

## Data ownership

- Existing task spreadsheets are read-only source systems for this application.
- The private master spreadsheet stores employee/project configuration and, in later phases, the application's attendance, break, issue and reporting records.
- No task rows are written back to project spreadsheets and no second task database is introduced.
- The master spreadsheet must remain private; never share it with labellers just to make the script work.

## Trust boundaries

- Browser input is untrusted. User-data APIs must not accept an email argument as the user's identity.
- `Session.getActiveUser().getEmail()` is the intended visitor identity, but Apps Script may return blank depending on account type and deployment configuration.
- `Session.getEffectiveUser().getEmail()` is diagnostic only, logged server-side, and never returned to the browser or used for authorization.
- The script owner must have read access to every configured source spreadsheet.
- Attendance and other app-owned writes must be authorized server-side and protected against concurrent requests.

## Phase boundaries

- **Phase 0:** identity diagnostic only; no spreadsheet reads through the diagnostic endpoint. Do not open the gate until active identity has been verified for the actual deployment audience.
- **Phase 1:** authenticated, read-only My Work dashboard and summary cards.
- **Phase 2:** attendance, full/half/short leave, login/logout and breaks. Use server timestamps, locking, duplicate-action protection, and rules for automatically closing stale sessions.
- **Phase 3:** issue detection, turnaround-time checks, reminders/digests and scheduled scanning. Stable issue keys, chunking and quota-aware execution are required; measure execution duration before choosing scan frequency.
- **Phase 4:** admin People/Projects management, team dashboard, date filters, reports, charts and snapshots.
- **Phase 5:** privacy, concurrent actions, duplicate/retry behavior, dates, timezones, edge cases, load, quotas, and backup/restore tests.
- **Phase 6:** separate TEST and PROD projects and master spreadsheets, followed by a staged pilot before wider rollout.

## Metric assumptions requiring approval

- Assigned tasks currently means source rows matching the authenticated email.
- Completed tasks currently uses the proposed statuses `Labelling Done`, `Review Done`, `Approved` and `Rework Done`.
- Distinct sets means unique `Project ID + Dataset Set ID` pairs.
- These definitions must be checked against the real task workflow before the figures are used for decisions.

## Operational constraints

- The master spreadsheet is private and is not a replacement for project task sheets.
- Scheduled scans must be designed around measured execution time and Apps Script quotas. As a planning upper bound, a six-minute execution every 15 minutes can consume up to 576 execution-minutes in 24 hours; during an eight-hour workday that cadence is 32 runs and up to 192 execution-minutes. Actual duration and applicable account quotas must be confirmed before scheduling.
- Never turn on production triggers or outgoing email before the applicable verification checklist has passed.
