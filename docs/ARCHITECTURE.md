# Phase 0/1 Architecture

## Request flow

1. `Index.html` loads and calls `getIdentityDiagnostic()`. This endpoint reads no spreadsheet data.
2. The administrator verifies the identity result for the deployed audience. The identity gate remains closed by default.
3. When the gate is explicitly enabled in TEST, `getBootstrap()` and `getMyWork()` derive the active-user email on the server.
4. `Auth.gs` requires exactly one active Employees row and a valid role.
5. `SheetsRepository.gs` resolves only active projects assigned through an active Access row and reads the configured source tab.
6. `Metrics.gs` maps source headers, filters rows by the authenticated user's normalized email, and computes basic counts.
7. `Index.html` displays only the server-filtered result. HTML text values are escaped before rendering.

## Data ownership

- Existing task spreadsheets are read-only source systems for this application.
- The private master spreadsheet owns app configuration only in Phase 0/1: Employees, Projects, Access and Column_Map.
- No task data is copied into a second database.
- No attendance, breaks, issue scans, reminders, triggers or admin-write APIs are implemented in this phase.

## Trust boundaries

- Browser input is untrusted. The API accepts no email parameter for user data requests.
- `Session.getActiveUser().getEmail()` is the intended visitor identity, but Apps Script may return blank depending on account type and deployment configuration.
- `Session.getEffectiveUser().getEmail()` is diagnostic only, logged server-side, and never returned to the browser or used for authorization.
- The script owner must have read access to every configured source spreadsheet.
- The master spreadsheet must remain private; never share it with labellers just to make the script work.

## Metric assumptions requiring approval

- Assigned tasks currently means source rows matching the authenticated email.
- Completed tasks currently uses the proposed statuses `Labelling Done`, `Review Done`, `Approved` and `Rework Done`.
- Distinct sets means unique `Project ID + Dataset Set ID` pairs.
- These definitions must be checked against the real task workflow before the figures are used for decisions.

## Future phase boundaries

- Phase 2: attendance, leave and breaks, with server timestamps and locking.
- Phase 3: validation issues, TAT and reminders, with stable issue keys and quota-aware scheduled processing.
- Phase 4: admin People/Projects screens, reports, charts and snapshots.
- Phase 5/6: privacy, concurrency, load/quota, backup/restore and controlled pilot.
