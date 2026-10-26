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
- The private master spreadsheet stores employee/project configuration plus app-owned attendance, break, leave, issue and reporting records. Attendance and leave tabs are separate from source task sheets.
- No task rows are written back to project spreadsheets and no second task database is introduced.
- The master spreadsheet must remain private; never share it with labellers just to make the script work.

## Trust boundaries

- Browser input is untrusted. Email alone is not an authentication factor.
- Personal Gmail users authenticate with unique, high-entropy employee access codes. The private master stores only the SHA-256 hash; the plaintext code is logged once by an editor-only provisioning helper and must be delivered privately.
- Successful login creates a short-lived random session token stored server-side in Script Cache. Every data endpoint validates the token, rechecks that the employee is active, and confirms the credential hash has not changed. Cache eviction fails closed and may require sign-in again.
- The application does not rely on `Session.getActiveUser().getEmail()` or use `Session.getEffectiveUser()` as visitor identity.
- The script owner must have read access to every configured source spreadsheet.
- Attendance and other app-owned writes must be authorized server-side and protected against concurrent requests.

## Phase boundaries

- **Phase 0:** build and verify secure access-code login for personal Gmail users. Keep the application data gate closed while testing valid/invalid codes, inactive accounts, session expiry, code rotation and role boundaries. The login endpoint reads only the employee/credential records it needs; it does not read task-source data. Do not open the gate until the access-code model passes these tests.
- **Phase 1:** authenticated, read-only My Work dashboard and summary cards.
- **Phase 2:** attendance, full/half/short leave, login/logout and breaks. The current code uses server timestamps, a script lock, per-request idempotency records, an append-only attendance event log, overlap checks for pending/approved leave, and admin review. Full-day requests may cover a date range; half-day requests use AM/PM for one date; short leave uses a same-day time range. Stale-session closure requires the explicit `ATTENDANCE_MAX_SESSION_HOURS` property; automatic trigger installation remains in Phase 3. Validate all policy thresholds with the agreed business rules before enabling this function.
- **Phase 3:** issue detection, turnaround-time checks, reminders/digests and scheduled scanning. Stable issue keys, chunking and quota-aware execution are required; measure execution duration before choosing scan frequency.
- **Phase 4:** admin People/Projects management, team dashboard, date filters, reports, charts and snapshots.
- **Phase 5:** privacy, concurrent actions, duplicate/retry behavior, dates, timezones, edge cases, load, quotas, and backup/restore tests.
- **Phase 6:** separate TEST and PROD projects and master spreadsheets, followed by a staged pilot before wider rollout.

## Metric assumptions requiring approval

- Assigned tasks currently means source rows matching the authenticated email.
- Completed tasks currently uses the proposed statuses `Labelling Done`, `Review Done`, `Approved` and `Rework Done`.
- Distinct sets means unique `Project ID + Dataset Set ID` pairs.
- These definitions must be checked against the real task workflow before the figures are used for decisions.

## Phase 2 storage and trust boundaries

- The editor-only initialization helper creates `Employee_Credentials` in the private master, storing one SHA-256 hash per active employee.
- The editor-only provisioning helper creates/rotates a unique per-employee access code and logs it once. These helpers end in `_` so they are not exposed through `google.script.run`.
- The admin-only initialization action creates `Attendance_Sessions`, `Attendance_Events`, `Attendance_Breaks`, `Leave_Requests`, and `Attendance_Requests` in the private master spreadsheet. Existing tabs with mismatched headers fail closed rather than being overwritten.
- Attendance actions do not accept an employee email from the browser. The server derives the active user and checks the employee record for each call.
- `Attendance_Events` is append-only from application code. Session and break summary rows are updated as the current state; request records support safe replay of a previously successful request.
- The script lock serializes actions within this Apps Script project, but Google Sheets does not provide a multi-tab transaction. Runtime failure-injection tests are required before production use.
- Work dates and leave dates are stored as ISO `YYYY-MM-DD` strings to avoid browser and spreadsheet timezone shifts; event timestamps remain server-generated date-time values formatted in `Asia/Kolkata`.
- A labeller can read only their own leave requests; admin leave-review calls are role-checked on the server.

## Operational constraints

- The master spreadsheet is private and is not a replacement for project task sheets.
- The login email is an account lookup and is not proof that the browser is logged into that exact Gmail account. Authentication depends on possession of the separately distributed high-entropy access code. Do not describe this as Google SSO.
- Scheduled scans must be designed around measured execution time and Apps Script quotas. As a planning upper bound, a six-minute execution every 15 minutes can consume up to 576 execution-minutes in 24 hours; during an eight-hour workday that cadence is 32 runs and up to 192 execution-minutes. Actual duration and applicable account quotas must be confirmed before scheduling.
- Never turn on production triggers or outgoing email before the applicable verification checklist has passed.
