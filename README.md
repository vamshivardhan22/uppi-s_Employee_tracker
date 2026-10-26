# Labeller Dashboard

A Google Apps Script + Google Sheets dashboard for labelling teams. The agreed design keeps existing project spreadsheets as the task source of truth and uses a separate, private master spreadsheet for employee/project access configuration and app-owned records.

## Build status

The repository contains the Phase 0/1 starter and Phase 2 attendance/leave implementation. It is **not a completed or production-verified application**.

- **Phase 0:** verify the deployed app's active-user identity without reading spreadsheet data.
- **Phase 1:** deliver the authenticated, read-only My Work dashboard.
- **Phase 2:** attendance, leave, login/logout and break tracking (code added; TEST runtime verification is still pending).
- **Phase 3:** issue scanning, turnaround-time checks, reminders and quota-aware scheduled processing.
- **Phase 4:** admin People/Projects management, team dashboard, reports, charts and snapshots.
- **Phase 5:** privacy, concurrency, edge-case, load, quota, backup and restore verification.
- **Phase 6:** separate TEST and PROD setup, staged pilot, and controlled release.

Implementation must follow this sequence. Do not add unrelated systems, external project templates, or features outside the agreed scope.

## Locked design

- Existing project spreadsheets remain the task source of truth. The dashboard does not create a second task database or edit task rows.
- A separate private master spreadsheet stores employee access, project configuration and app-owned records.
- The deployment does not rely on `Session.getActiveUser().getEmail()` to identify personal Gmail visitors. Each employee signs in with their Employees email and a unique, high-entropy access code; the backend verifies the code's SHA-256 hash from the private master and issues a short-lived server-cache session token. Email alone is never sufficient to authenticate.
- Project access is checked server-side before project sheets are read.
- Timezone: `Asia/Kolkata`.
- Target: no additional software-license cost, subject to actual Google account type and service quotas.
- Use synthetic data only in TEST.
- Build the application from the agreed requirements and architecture; do not base it on or import code, design or decisions from unrelated repositories.

## Repository layout

```
apps-script/
  appsscript.json
  Code.gs
  Config.gs
  Auth.gs
  Validation.gs
  SheetsRepository.gs
  Metrics.gs
  UserApi.gs
  Attendance.gs
  Index.html
docs/
  ARCHITECTURE.md
  BUILD_STATUS.md
  TEST_PLAN.md
```

## TEST setup

1. Create a **new test Apps Script project** and a private TEST master spreadsheet. Do not use production employee data.
2. Copy each file under `apps-script/` into its matching Apps Script file. Create an HTML file named `Index` and paste `Index.html`. Copy `appsscript.json` into the Apps Script manifest.
3. Set the Apps Script project timezone to `Asia/Kolkata`.
4. In Script Properties, set:
   - `MASTER_SPREADSHEET_ID`: the private TEST master spreadsheet ID.
   - `IDENTITY_GATE_PASSED`: `false`.
5. Create master tabs with these exact headers:
   - `Employees`: `Email`, `Display Name`, `Role`, `Active`
   - `Projects`: `Project ID`, `Project Name`, `Spreadsheet ID`, `Tab Name`, `Timezone`, `Active`
   - `Access`: `Email`, `Project ID`, `Active`
   - `Column_Map`: `Project ID`, `Canonical Field`, `Sheet Header`, `Required`
6. Use synthetic users and a fake project sheet. Ensure the script owner has read access to that source sheet.
7. Deploy a **test** web app using the intended access audience. Do not assume Apps Script returns the visitor's email: behavior depends on account type and deployment settings.
8. Open the deployed `/exec` URL as a test admin and a test labeller in separate sessions. Confirm `activeUserEmail` is nonblank and exactly matches each signed-in account. If blank or incorrect, STOP; keep the gate closed.
9. Only after the identity matrix passes and the data-access model is approved, set `IDENTITY_GATE_PASSED=true` in TEST Script Properties.
10. Test sign-in with a valid code, invalid code, inactive employee and rotated code while the data gate remains closed. Only after sign-in isolation passes should the gate be enabled in TEST.
11. Test that the labeller sees only rows assigned to their normalized email, then test access denial, missing mappings, partial project failures and source-sheet errors.
12. Run the editor-only helper `initializeAuthStorage_()` to create `Employee_Credentials`. For each active test employee, run `provisionEmployeeAccessCode_('email@example.com')` from the Apps Script editor and copy the generated one-time code from the private execution log. Deliver it privately; never put codes in spreadsheet rows, GitHub, or chat.
13. The helper names end with `_` intentionally and must not be exposed as browser-callable APIs. The stored credential is a hash; reissuing a code invalidates that employee's existing sessions.
11. After identity and Phase 1 checks pass, sign in as the TEST admin and use **Initialize attendance storage** in the dashboard. This creates only the five app-owned attendance/leave tabs in the private TEST master. Existing tabs with different headers are not overwritten.
12. Test attendance and leave actions using synthetic users and dates only. Keep `IDENTITY_GATE_PASSED=false` until the Phase 0 identity matrix has passed.

## Personal Gmail authentication

Because personal Gmail accounts do not share a Workspace domain, the current deployment cannot reliably use Apps Script's active-user email as the visitor identity when executed as the app owner. The application therefore uses a unique per-employee access code as its credential. The email is an account lookup, not proof by itself that the browser is signed in to that exact Google account. Keep the master private and distribute codes through a separate private channel. This avoids sharing the master spreadsheet with labellers and avoids sending an email on every login.

The property `IDENTITY_GATE_PASSED` is retained for compatibility but now acts as the TEST application-data gate: keep it `false` while preparing and testing access codes. Login can be tested while it is false; My Work and attendance endpoints remain blocked. After the admin and labeller access-code checks pass, the TEST admin may set it to `true` for data-flow testing.

## Required source mappings

Phase 1 requires canonical mappings for `Dataset Set Id`, `Annotator Mail` and `Status`.

Optional mappings: `Assigned Date`, `Submitted Date`, `Approved Objects`, `Rejected Objects`, `Reviewer Rejected Count`, and `Hold Note`.

The canonical names are mapping keys; each `Sheet Header` value must match the header in its configured source tab (case-insensitive matching is used).

## Phase 2 attendance storage

The Phase 2 module stores attendance in the private master spreadsheet, not in the project task sheets. The admin initialization action creates `Attendance_Sessions`, `Attendance_Events`, `Attendance_Breaks`, `Leave_Requests`, and `Attendance_Requests`. Event records are append-only; request IDs make repeated identical calls return the original result. The server uses a script lock around each action.

Leave types supported by the current implementation are full day, half day (AM/PM), and short leave (single date with a start/end time). Requests begin as `PENDING`; admins can approve or reject them. The automatic stale-session closure function requires an explicitly approved `ATTENDANCE_MAX_SESSION_HOURS` Script Property (1–24 hours); no scheduled trigger is enabled yet. Phase 3 owns scheduled scanning/trigger setup.

## Security and release rules

- The identity gate remains closed by default.
- Never put the master spreadsheet ID or secrets in client HTML.
- Never deploy TEST code against the production master.
- Do not add attendance, email reminders, triggers or admin-write actions until their phase is implemented and tested.
- Before a production pilot, test privacy isolation with at least two separate synthetic users and review current Apps Script quotas and identity behavior.

See [Browser-only setup](docs/BROWSER_ONLY_SETUP.md), [Architecture](docs/ARCHITECTURE.md), [Build status](docs/BUILD_STATUS.md), [Test plan](docs/TEST_PLAN.md) and [Verification log](docs/VERIFICATION_LOG.md).
