# Labeller Dashboard

A Google Apps Script + Google Sheets dashboard for labelling teams. The agreed design keeps existing project spreadsheets as the task source of truth and uses a separate, private master spreadsheet for employee/project access configuration and app-owned records.

## Build status

The development branch contains source implementation for all agreed phase areas (Phases 0–6). The draft pull request remains unmerged. The source build is **TEST-gated and not production-approved**.

| Phase | Source implementation | Verification status |
|---|---|---|
| 0 — Authentication gate | Access-code authentication for personal Gmail users, credential hashes, short-lived sessions, sign-out and rotation invalidation. | Selected live TEST checks passed; identity edge cases and full role-denial tests remain. |
| 1 — My Work | Read-only task view, assigned-row filtering, summary cards and partial-source error reporting. | Live synthetic-data isolation check passed; large-data/load checks remain. |
| 2 — Attendance and leave | Clock-in/out, breaks, leave submission/review, request replay handling and event logging. | Selected live TEST flows passed, including the overlap regression fix; edge cases and concurrency/recovery checks remain. |
| 3 — Issue/TAT monitoring | Read-only issue scans, configurable TAT rules, issue registry, scan logs, digest preview, guarded email and optional scheduled scanning. | Parser and in-memory smoke checks passed; updated bundle has not yet been verified live in Apps Script TEST. |
| 4 — Admin, reports and snapshots | People/projects/access/mapping management, team report filters, charts, snapshots and admin audit log. | Source and UI are present; live role, write, reporting and snapshot checks remain. |
| 5 — Operational readiness | Health overview, configuration audit, TEST backup creation/verification and release checklist. | Source tooling is present; real quota, failure-recovery, concurrency, backup privacy and restore-drill checks remain. |
| 6 — Controlled rollout | Environment-to-master binding, production-approval gate, browser-only runbook and staged rollout checklist. | Release controls are present in source; no separate production project or pilot has been approved or deployed. |

Do not interpret source presence, parser checks, or mocks as proof that a deployed Apps Script behaves correctly. Continue with synthetic data only until the live TEST checklists pass. Email reminders, scheduled triggers, production access and merge remain gated.

See docs/VERIFICATION_LOG.md for the distinction between live TEST observations and in-memory/static checks, and docs/TEST_PLAN.md for Phase 0–6 acceptance gates.

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
  IssueScanner.gs
  Index.html
browser-deploy/
  Main.gs
  Index.html
  appsscript.json
docs/
  ARCHITECTURE.md
  BUILD_STATUS.md
  TEST_PLAN.md
  VERIFICATION_LOG.md
  BROWSER_ONLY_SETUP.md
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
7. Run editor-only helper initializeAuthStorage_ to create the private Employee_Credentials tab.
8. Add one active synthetic admin and one active synthetic labeller row in Employees. For each employee, set Script Property ACCESS_CODE_FOR_EMAIL to that email, run editor-only provisionEmployeeAccessCode_, then copy the one-time code from the private execution log. The helper removes the temporary property after issuing the code. Deliver codes privately.
9. Test sign-in with valid and invalid codes, inactive users, sign-out and code rotation while IDENTITY_GATE_PASSED=false. Task and attendance data must stay blocked during these checks.
10. Deploy the TEST web app as the script owner, restricted to signed-in Google accounts (not anonymous). Open the versioned /exec URL and sign in with the employee email + access code.
11. Only after the access-code tests pass, set IDENTITY_GATE_PASSED=true in TEST Script Properties. Then test that a labeller sees only rows assigned to their normalized email, missing mappings, partial project failures and source-sheet errors.
12. Sign in as the TEST admin and use Initialize attendance storage. This creates only the five app-owned attendance/leave tabs in the private TEST master; existing tabs with mismatched headers are not overwritten.
13. Test attendance and leave actions using synthetic users and dates only.

## Personal Gmail authentication

Because personal Gmail accounts do not share a Workspace domain, the current deployment cannot reliably use Apps Script's active-user email as the visitor identity when executed as the app owner. The application therefore uses a unique per-employee access code as its credential. The email is an account lookup, not proof by itself that the browser is signed in to that exact Google account. This is app-level authentication, not Google SSO. Keep the master private and distribute codes through a separate private channel. This avoids sharing the master spreadsheet with labellers and avoids sending an email on every login.

The property `IDENTITY_GATE_PASSED` is retained for compatibility but now acts as the TEST application-data gate: keep it `false` while preparing and testing access codes. Login can be tested while it is false; My Work and attendance endpoints remain blocked. After the admin and labeller access-code checks pass, the TEST admin may set it to `true` for data-flow testing.

## Required source mappings

Phase 1 requires canonical mappings for `Dataset Set Id`, `Annotator Mail` and `Status`.

Optional mappings: `Assigned Date`, `Submitted Date`, `Approved Objects`, `Rejected Objects`, `Reviewer Rejected Count`, and `Hold Note`.

The canonical names are mapping keys; each `Sheet Header` value must match the header in its configured source tab (case-insensitive matching is used).

## Phase 2 attendance storage

The Phase 2 module stores attendance in the private master spreadsheet, not in the project task sheets. The admin initialization action creates `Attendance_Sessions`, `Attendance_Events`, `Attendance_Breaks`, `Leave_Requests`, and `Attendance_Requests`. Event records are append-only; request IDs make repeated identical calls return the original result. The server uses a script lock around each action.

Leave types supported by the current implementation are full day, half day (AM/PM), and short leave (single date with a start/end time). Requests begin as `PENDING`; admins can approve or reject them. The automatic stale-session closure function requires an explicitly approved `ATTENDANCE_MAX_SESSION_HOURS` Script Property (1–24 hours); its trigger remains uninstalled. Phase 3 code includes a separate opt-in issue-scan trigger, also disabled by default.

## Security and release rules

- The identity gate remains closed by default.
- Never put the master spreadsheet ID or secrets in client HTML.
- Never deploy TEST code against the production master.
- Do not add attendance, email reminders, triggers or admin-write actions until their phase is implemented and tested.
- Before a production pilot, test privacy isolation with at least two separate synthetic users and review current Apps Script quotas and identity behavior.

See [Browser-only setup](docs/BROWSER_ONLY_SETUP.md), [Architecture](docs/ARCHITECTURE.md), [Build status](docs/BUILD_STATUS.md), [Test plan](docs/TEST_PLAN.md) and [Verification log](docs/VERIFICATION_LOG.md).
