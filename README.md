# Labeller Dashboard

A Google Apps Script + Google Sheets dashboard for labelling teams. The agreed design keeps existing project spreadsheets as the task source of truth and uses a separate, private master spreadsheet for employee/project access configuration and app-owned records.

## Build status

The repository currently contains the Phase 0/1 starter implementation. It is **not a completed or production-verified application**.

- **Phase 0:** verify the deployed app's active-user identity without reading spreadsheet data.
- **Phase 1:** deliver the authenticated, read-only My Work dashboard.
- **Phase 2:** attendance, leave, login/logout and break tracking.
- **Phase 3:** issue scanning, turnaround-time checks, reminders and quota-aware scheduled processing.
- **Phase 4:** admin People/Projects management, team dashboard, reports, charts and snapshots.
- **Phase 5:** privacy, concurrency, edge-case, load, quota, backup and restore verification.
- **Phase 6:** separate TEST and PROD setup, staged pilot, and controlled release.

Implementation must follow this sequence. Do not add unrelated systems, external project templates, or features outside the agreed scope.

## Locked design

- Existing project spreadsheets remain the task source of truth. The dashboard does not create a second task database or edit task rows.
- A separate private master spreadsheet stores employee access, project configuration and app-owned records.
- Server-side authorization derives identity from `Session.getActiveUser().getEmail()`. Browser-supplied email is never accepted as an authorization parameter.
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
10. Test that the labeller sees only rows assigned to their normalized email, then test access denial, missing mappings, partial project failures and source-sheet errors.

## Required source mappings

Phase 1 requires canonical mappings for `Dataset Set Id`, `Annotator Mail` and `Status`.

Optional mappings: `Assigned Date`, `Submitted Date`, `Approved Objects`, `Rejected Objects`, `Reviewer Rejected Count`, and `Hold Note`.

The canonical names are mapping keys; each `Sheet Header` value must match the header in its configured source tab (case-insensitive matching is used).

## Security and release rules

- The identity gate remains closed by default.
- Never put the master spreadsheet ID or secrets in client HTML.
- Never deploy TEST code against the production master.
- Do not add attendance, email reminders, triggers or admin-write actions until their phase is implemented and tested.
- Before a production pilot, test privacy isolation with at least two separate synthetic users and review current Apps Script quotas and identity behavior.

See [Architecture](docs/ARCHITECTURE.md), [Build status](docs/BUILD_STATUS.md) and [Test plan](docs/TEST_PLAN.md).
