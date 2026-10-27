# Browser-only TEST setup

This guide is for the current branch's Apps Script build. It requires only a browser, a Google account with access to Google Apps Script and Google Sheets, and access to this GitHub repository. Do not install local software and do not run OS or terminal commands.

## Files to copy

Use the files under `browser-deploy/` for the browser-only install and for updates to an existing TEST project:

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

## 3. Set up app-level authentication while the data gate is closed

1. Keep Script Property IDENTITY_GATE_PASSED set to false.
2. Add an active admin row and a synthetic active labeller row to Employees. Their Role values must be exactly admin and labeller.
3. In the Apps Script function selector, run initializeAuthStorage_. It creates Employee_Credentials inside the private master spreadsheet.
4. In Project Settings → Script Properties, set ACCESS_CODE_FOR_EMAIL to the admin's email. Return to the code editor, run provisionEmployeeAccessCode_, and copy the one-time code from the private execution log.
5. Repeat step 4 with the labeller's email. The helper deletes ACCESS_CODE_FOR_EMAIL after issuing a code. Deliver each code through a separate private channel. Do not put plaintext codes in Sheets, GitHub or chat.
6. These helpers end in an underscore intentionally. Keep them editor-only; do not rename them to public browser-callable functions.

The app uses app-level access-code authentication for personal Gmail users. The email is a lookup key, not proof that the browser is logged into that exact Google account. This is not Google SSO. Do not share the private master spreadsheet with labellers.

## 4. Deploy and verify Phase 0

1. Use Deploy → New deployment → Web app. Set Execute as to the script owner so that the app can read the private master and project task sheets using the owner's permissions.
2. Restrict Who has access to signed-in Google accounts (the option wording may be Anyone with Google account). Do not allow anonymous/public access.
3. Deploy and copy the versioned /exec URL. The /dev test URL is restricted to script editors and does not replace testing the intended deployed access path.
4. Open the app and sign in using the admin email and private access code. While IDENTITY_GATE_PASSED is false, sign-in may succeed but task/attendance data must remain blocked.
5. Test an incorrect code and a disabled/inactive employee. Both must fail closed without exposing task data.
6. Rotate the labeller's access code and confirm any previous session for that employee is rejected. Test sign-out as well.
7. Keep the gate false if any authentication or privacy test fails.

## 5. Enable TEST data after authentication tests pass

1. Create a separate fake project spreadsheet with a task tab and synthetic rows. Configure Projects, Access and Column_Map with synthetic IDs and headers.
2. Only after valid/invalid code, role, session and sign-out tests pass, set IDENTITY_GATE_PASSED to true in TEST Script Properties.
3. Sign in as the synthetic labeller and confirm My Work returns only their mapped rows.
4. Sign in as the TEST admin and use Initialize attendance storage. This creates Attendance_Sessions, Attendance_Events, Attendance_Breaks, Leave_Requests and Attendance_Requests. It must not overwrite tabs with unexpected headers.
5. Test clock-in/out, breaks, leave requests and admin review with synthetic data.

## 5. What to report back

Share only the visible error text or a screenshot of the test result. Never send passwords, OAuth codes, session cookies, or private employee data.

Use `docs/TEST_PLAN.md` and `docs/VERIFICATION_LOG.md` as the phase checklist. Browser-editor syntax checks and mock tests are useful, but only running the deployed test web app can verify Google account identity, permissions, and real Sheets behavior.

## 6. Update TEST for Phase 3

Phase 3 is implemented on the development branch, but it is not considered live-tested until copied to Apps Script and deployed as a new version.

1. Open the current development copies: [browser-deploy/Main.gs](https://github.com/vamshivardhan22/uppi-s_Employee_tracker/blob/build/phase-0-1-dashboard/browser-deploy/Main.gs) and [browser-deploy/Index.html](https://github.com/vamshivardhan22/uppi-s_Employee_tracker/blob/build/phase-0-1-dashboard/browser-deploy/Index.html).
2. Copy each complete file into the matching file in the existing `Labeller Dashboard TEST` project. Save both files.
3. Use **Deploy → Manage deployments → Edit** on the existing web app deployment; choose **New version** and deploy. Keep execution as owner and the audience restricted to signed-in Google accounts. Do not create a public/anonymous deployment.
4. Sign in as Admin using the private access code. The **Issue detection & turnaround time · Admin** panel should be visible only to Admin.
5. Click **Initialize issue/TAT storage** once. It creates `Issue_Registry`, `Issue_Scan_Runs`, `TAT_Rules`, and `Issue_Reminder_Log` in the private master spreadsheet.
6. Click **Run issue/TAT scan** using only the synthetic task source. Inspect the dashboard summary and `Issue_Scan_Runs`. A task assigned to an email not present in the active `Employees` list should be reported as `ANNOTATOR_NOT_ACTIVE`; the scan must not modify the source `Tasks` tab.
7. TAT warnings/breaches require an explicit row in `TAT_Rules`. For a synthetic test, choose and record test-only thresholds; do not treat them as the real business SLA.
8. **Do not enable `ISSUE_EMAILS_ENABLED` or install a schedule yet.** Preview the digest first. Manual scans never send email. Scheduled scans remain off unless an Admin explicitly installs a 6- or 12-hour trigger after a complete manual scan and all live checks are accepted.

Use synthetic data only. If a scan is partial, has project errors, or produces unexpected findings, keep email/scheduling off and record the visible message for troubleshooting.

## Official Google instructions

- [Apps Script overview](https://developers.google.com/apps-script/overview)
- [Deploy and test a web app](https://developers.google.com/apps-script/guides/web)
