# Browser-only TEST setup

This guide is for the current branch's Apps Script build. It requires only a browser, a Google account with access to Google Apps Script and Google Sheets, and access to this GitHub repository. Do not install local software and do not run OS or terminal commands.

## Files to copy

Use the files under `browser-deploy/` for the initial browser-only install:

- `Main.gs` — combined from the current modular Apps Script files in `apps-script/`.
- `Index.html` — the current dashboard UI.
- `appsscript.json` — runtime and timezone settings.

The modular source files under `apps-script/` remain the source of truth for ongoing changes. If they change, regenerate and verify this browser bundle before copying it to Apps Script.

## 1. Create a TEST Apps Script project

1. Open [Google Apps Script](https://script.google.com/home) in the browser and sign in. Google provides a browser-based editor and runs Apps Script code on Google's servers, so there is no local installation required.
2. Create a new standalone project named `Labeller Dashboard TEST`.
3. Rename the default `Code.gs` file to `Main.gs` if rename is available, or replace its contents with `browser-deploy/Main.gs`.
4. Copy the complete contents of `browser-deploy/Main.gs` from GitHub into the script editor, then save.
5. Add an HTML file named exactly `Index`, and copy the complete contents of `browser-deploy/Index.html` into it.
6. In Project Settings, enable showing the manifest file if it is hidden. Replace the manifest contents with `browser-deploy/appsscript.json`. Save.
7. Confirm the project timezone is `Asia/Kolkata`.

## 2. Create synthetic TEST spreadsheets

Do not use real employee information yet.

Create a new private Google spreadsheet for the TEST master. Create these tabs with these exact headers in row 1:

- `Employees`: `Email`, `Display Name`, `Role`, `Active`
- `Projects`: `Project ID`, `Project Name`, `Spreadsheet ID`, `Tab Name`, `Timezone`, `Active`
- `Access`: `Email`, `Project ID`, `Active`
- `Column_Map`: `Project ID`, `Canonical Field`, `Sheet Header`, `Required`

Create a separate fake project spreadsheet containing a task tab with headers that can be mapped to `Dataset Set Id`, `Annotator Mail`, and `Status`. Add only synthetic email addresses to test assignment filtering. The Apps Script owner must have read access to that fake source sheet.

In the Apps Script editor, open **Project Settings → Script Properties** and set:

- `MASTER_SPREADSHEET_ID` = the ID of the private TEST master spreadsheet.
- `IDENTITY_GATE_PASSED` = `false`.

The master spreadsheet ID is the portion between `/d/` and `/edit` in its browser URL. Keep the master private; do not put its ID in HTML or share the sheet with labellers.

## 3. Test Phase 0 first — keep the gate closed

1. Keep `IDENTITY_GATE_PASSED=false`.
2. In Apps Script, select **Deploy → New deployment → Web app**. Choose the intended test access audience and execution identity. Use only the audience allowed by your organization's policy; do not make the app public for convenience.
3. Deploy this TEST project and copy its versioned `/exec` URL. Using **Deploy → Test deployments** creates a `/dev` URL that is restricted to script editors; that is useful for a quick editor smoke test, but it does **not** prove identity behavior for your intended `/exec` audience.
4. Open the deployed `/exec` URL while signed in as the synthetic test admin; click **Check identity** and compare the returned active-user email with the Google account used.
5. Repeat with the synthetic labeller using the intended real access path (for example, a separate browser profile). If the intended account cannot open the app under the chosen deployment settings, record that as a failed gate.
6. If either identity is blank or incorrect, STOP. Leave `IDENTITY_GATE_PASSED=false`. Do not substitute the script owner's email or bypass the gate.

Google documents that web-app deployment settings affect how the app runs and which users can access it. The exact settings must match the intended usage; a successful `/dev` editor test alone is insufficient.

## 4. Only after the identity matrix passes

1. Populate the TEST master configuration with the synthetic accounts, project, access row and column mappings.
2. Set `IDENTITY_GATE_PASSED=true` in the TEST Script Properties only after identity passed in both sessions.
3. Open the test web app as the synthetic labeller. Confirm they see only their mapped task rows and cannot see the other user's rows.
4. Sign in as the TEST admin and use **Initialize attendance storage**. This creates the five app-owned tabs: `Attendance_Sessions`, `Attendance_Events`, `Attendance_Breaks`, `Leave_Requests`, and `Attendance_Requests`. It must not overwrite existing tabs with different headers.
5. Test clock-in/out, break actions, leave requests and admin leave review using only synthetic data.

## 5. What to report back

Share only the visible error text or a screenshot of the test result. Never send passwords, OAuth codes, session cookies, or private employee data.

Use `docs/TEST_PLAN.md` and `docs/VERIFICATION_LOG.md` as the phase checklist. Browser-editor syntax checks and mock tests are useful, but only running the deployed test web app can verify Google account identity, permissions, and real Sheets behavior.

## Official Google instructions

- [Apps Script overview](https://developers.google.com/apps-script/overview)
- [Deploy and test a web app](https://developers.google.com/apps-script/guides/web)
