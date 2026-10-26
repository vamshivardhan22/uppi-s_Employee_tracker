# Labeller Dashboard

A Google Apps Script + Google Sheets dashboard for labelling teams. The agreed design keeps existing project spreadsheets as the task source of truth and uses a separate, private master spreadsheet for access configuration and app-owned records.

## Build status

This repository is being built in ordered phases. Phase 0/1 is a **starter implementation**, not a verified production application.

- Phase 0: identity diagnostic only; do not expose task data until identity is confirmed for the actual deployment audience.
- Phase 1: read-only My Work view and basic summary cards after the identity gate is explicitly enabled.
- Later: attendance and breaks; issue detection and reminders; admin/team dashboards and charts; reliability testing and controlled pilot.

## Locked design

- Task data remains in existing Google Sheets; the dashboard does not create a second task database or edit task rows.
- A separate private master spreadsheet stores employee access, project configuration and column mappings.
- Server-side authorization derives identity from `Session.getActiveUser().getEmail()`. Browser-supplied email is never accepted as an authorization parameter.
- Project access is checked server-side.
- Timezone: `Asia/Kolkata`.
- Target: no additional software-license cost, subject to actual Google account type and quotas.
- Use synthetic data only during TEST.

## Current file layout

```
apps-script/
  Code.gs
  Config.gs
  Auth.gs
  SheetsRepository.gs
  UserApi.gs
  Index.html
docs/
  BUILD_STATUS.md
  TEST_PLAN.md
```

## TEST setup

1. Create a **new test Apps Script project** and a private TEST master spreadsheet. Do not use production employee data.
2. Copy each file under `apps-script/` into its matching Apps Script file. Create an HTML file named `Index` and paste `Index.html`.
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
10. Test that the labeller can see only rows assigned to their normalized email, then test access denial, missing mappings and source-sheet failures.

## Required source mappings

Phase 1 requires canonical mappings for:
- `Dataset Set Id`
- `Annotator Mail`
- `Status`

Optional mappings:
- `Assigned Date`
- `Submitted Date`
- `Approved Objects`
- `Rejected Objects`
- `Reviewer Rejected Count`
- `Hold Note`

The names above are canonical mapping keys; each `Sheet Header` cell must exactly identify the column header in its configured source tab.

## Security and release rules

- The identity gate must remain closed by default.
- Never put the master spreadsheet ID or other secrets in client HTML.
- Never deploy TEST code against the production master.
- Do not add attendance, email reminders, triggers or admin-write actions until their phase is implemented and tested.
- Before a production pilot, test privacy isolation with at least two separate synthetic users and review current Google Apps Script quotas and identity behavior.

See [Build status](docs/BUILD_STATUS.md) and [Test plan](docs/TEST_PLAN.md).
