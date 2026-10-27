# Labeller Dashboard Architecture

This document describes the architecture agreed for this project. Implement the project in its defined phases; do not introduce external repository-derived architecture or unrelated systems.

## Request flow — Phase 0/1

1. Index.html presents employee email + access-code sign-in; the status endpoint reads no spreadsheet data and exposes no active-user or owner identity.
2. login(email, accessCode) checks an active Employees row and the private Employee_Credentials hash. The email alone is not authentication.
3. Successful login returns a random session token; a server-side Script Cache entry binds that token to the employee, expiry and current credential hash.
4. getBootstrap(token) validates the session and reports whether the app data gate is open. With the gate closed, no task or attendance data can be returned.
5. Every data API validates the token, reloads the active employee/role and checks that the credential hash is unchanged.
6. SheetsRepository.gs resolves only active projects assigned through an active Access row and reads the configured source tab.
7. Metrics.gs filters rows by the server-authenticated employee email. Index.html escapes rendered values before display.

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
- **Phase 3:** admin-only issue detection, configurable turnaround-time (TAT) rules, an issue registry, scan-run metrics, reminder digest preview, quota-aware digest delivery, and optional scheduled scans. Source project sheets remain read-only. Scanner runs use stable project/entity/issue keys, chunks of 200 rows, configurable row and time budgets, and a cursor to record partial runs. Findings include missing Set ID/annotator/status, annotator not found among active employees, hold markers/notes, and configured TAT warning/breach/missing-start cases. Without an active `TAT_Rules` row, no TAT threshold is assumed. `ISSUE_EMAILS_ENABLED` and `ISSUE_SCAN_TRIGGER_ENABLED` must be explicitly `true` before email or scheduled execution is enabled; both default off. Scheduled scans are limited to 6- or 12-hour intervals after a complete manual scan. Validate quota and business thresholds before turning either on. Phase 3 source has passed static parser and in-memory mock checks; live TEST validation is still pending.
- **Phase 4:** admin People/Projects management, team dashboard, date filters, reports, charts and snapshots.
- **Phase 5:** privacy, concurrent actions, duplicate/retry behavior, dates, timezones, edge cases, load, quotas, and backup/restore tests.
- **Phase 6:** separate TEST and PROD projects and master spreadsheets, followed by a staged pilot before wider rollout.


## Phase 4 admin, reporting and snapshot design

- AdminConsole.gs exposes admin-only APIs for employee records, project metadata, project grants, canonical mappings, team reports and snapshots. UI visibility is convenience only; server endpoints call the admin-role guard independently.
- Employee email and project-ID uniqueness, valid roles, required task mappings, self-demotion prevention and the last-active-admin rule are checked before writes. Deactivation invalidates access through the active-employee check and revokes project grants; access-code provisioning remains editor-only.
- Admin_Audit_Log records admin actions and before/after summaries. If an audit write fails after an action saved, the response warns the operator to inspect both the entity and audit log before retrying.
- Team reports read active configured task sources in 500-row batches, apply an optional date filter to the selected date field, and cap each project at ADMIN_REPORT_MAX_ROWS (default 25,000; configurable only within a bounded range). Hitting the cap or encountering a project error marks the report partial.
- Team snapshots contain report aggregates and summary fields in Team_Snapshots. Snapshots are refused for partial reports and for JSON that exceeds the configured cell-size safety cap. They are operational snapshots inside the private master, not immutable external audit records or a backup.

## Phase 5 operational readiness design

- OperationsHealth.gs provides read-only operational metadata, source/mapping/configuration checks, a TEST readiness checklist and explicitly gated TEST backup create/verify actions.
- A configuration audit checks duplicate people/projects/mappings, dangling grants, required mapping presence, readable project sources, active credentials and environment/master-ID separation. Its result is a diagnostic tool, not a substitute for live tests.
- TEST backup creation requires an explicit TEST label, a matching TEST master, a passed environment gate, admin storage and TEST_BACKUP_ENABLED=true. It verifies the copied sheet has the required tabs and attempts to keep the copy private. The function does not restore a backup in place.
- Script locks serialize calls within the same Apps Script project, but Sheets does not provide a multi-tab transaction. Concurrent action tests, write-failure injection, quota/load tests, and a separate restore drill remain required before rollout.

## Phase 6 environment separation and release control

- isIdentityGatePassed_ requires APP_ENV_LABEL=TEST and MASTER_SPREADSHEET_ID=TEST_MASTER_SPREADSHEET_ID for TEST. PROD requires the matching PROD_MASTER_SPREADSHEET_ID and PRODUCTION_RELEASE_APPROVED=true. Missing or mismatched environment bindings keep app data locked.
- TEST must not contain a configured PROD master ID. A production rollout must use a distinct Apps Script project and private master; the code's property checks do not replace a human review of the actual deployment configuration.
- Email reminders and scheduled issue scans are separately gated. The default is off; only explicit approval following live verification may enable them.
- The admin release checklist is evidence of configuration state, not automatic approval. A human reviewer must verify all critical test cases, metrics, privacy boundaries, backup/restore, quotas, rollback and pilot acceptance.


## Metric assumptions requiring approval

- Assigned tasks currently means source rows matching the authenticated email.
- Completed tasks currently uses the proposed statuses `Labelling Done`, `Review Done`, `Approved` and `Rework Done`.
- Distinct sets means unique `Project ID + Dataset Set ID` pairs.
- These definitions must be checked against the real task workflow before the figures are used for decisions.

## Phase 2 storage and trust boundaries

- The editor-only initialization helper creates `Employee_Credentials` in the private master, storing one SHA-256 hash per active employee.
- The editor-only provisioning helper creates/rotates a unique per-employee access code and logs it once. These helpers end in `_` so they are not exposed through `google.script.run`.
- The admin-only initialization action creates `Attendance_Sessions`, `Attendance_Events`, `Attendance_Breaks`, `Leave_Requests`, and `Attendance_Requests` in the private master spreadsheet. Existing tabs with mismatched headers fail closed rather than being overwritten.
- Attendance actions do not accept an employee email from the browser. The server resolves the employee from the validated session token and rechecks the employee and credential records for each call.
- `Attendance_Events` is append-only from application code. Session and break summary rows are updated as the current state; request records support safe replay of a previously successful request.
- The script lock serializes actions within this Apps Script project, but Google Sheets does not provide a multi-tab transaction. Runtime failure-injection tests are required before production use.
- Work dates and leave dates are stored as ISO `YYYY-MM-DD` strings to avoid browser and spreadsheet timezone shifts; event timestamps remain server-generated date-time values formatted in `Asia/Kolkata`.
- A labeller can read only their own leave requests; admin leave-review calls are role-checked on the server.

## Phase 3 issue/TAT storage and run safety

- The admin-only initializer creates `Issue_Registry`, `Issue_Scan_Runs`, `TAT_Rules`, and `Issue_Reminder_Log` in the private master. Existing tabs with mismatched headers fail closed.
- A scan reads active configured project sources but never writes to those task-source sheets. Stable issue keys allow open findings to be refreshed and no-longer-present findings to be resolved only when scan coverage makes that safe.
- Scan runs log duration, attempted/completed projects, row counts, opened/updated/resolved finding counts, errors, truncation and outcome. Partial scans must not be treated as complete.
- Reminder digest groups findings by the employee assigned to the issue; unrecognized assignees route to Admin. A recipient is limited to one digest reservation per Asia/Kolkata date, and sends are capped by both remaining MailApp quota and a configurable recipient ceiling. A failed/SENDING row needs Admin review before any retry policy is added.
- Email and schedule are disabled by default; manual scanning never sends mail. A scheduled trigger is not installed until a complete manual scan has been logged. Use the official [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas) and [best practices](https://developers.google.com/apps-script/guides/support/best-practices) when sizing scan cadence.

## Operational constraints

- The master spreadsheet is private and is not a replacement for project task sheets.
- The login email is an account lookup and is not proof that the browser is logged into that exact Gmail account. Authentication depends on possession of the separately distributed high-entropy access code. Do not describe this as Google SSO.
- Scheduled scans must be designed around measured execution time and Apps Script quotas. As a planning upper bound, a six-minute execution every 15 minutes can consume up to 576 execution-minutes in 24 hours; during an eight-hour workday that cadence is 32 runs and up to 192 execution-minutes. Actual duration and applicable account quotas must be confirmed before scheduling.
- Never turn on production triggers or outgoing email before the applicable verification checklist has passed.
