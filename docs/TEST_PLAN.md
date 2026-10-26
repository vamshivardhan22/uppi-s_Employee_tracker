# Verification Plan

Use only synthetic data in a dedicated TEST master spreadsheet and fake source project sheet. This checklist is the project's verification path; do not substitute unrelated project examples.

## A. Configuration

- [ ] Apps Script project timezone is `Asia/Kolkata`.
- [ ] Script Property `MASTER_SPREADSHEET_ID` points to the private TEST master.
- [ ] Script Property `IDENTITY_GATE_PASSED` is exactly `false` during identity tests.
- [ ] Master tabs exist with exact headers:
  - Employees: `Email`, `Display Name`, `Role`, `Active`
  - Projects: `Project ID`, `Project Name`, `Spreadsheet ID`, `Tab Name`, `Timezone`, `Active`
  - Access: `Email`, `Project ID`, `Active`
  - Column_Map: `Project ID`, `Canonical Field`, `Sheet Header`, `Required`
- [ ] Duplicate/missing headers produce a visible error.
- [ ] Configured source spreadsheet IDs and tab names are correct; script owner can read each source.

## B. Access-code authentication gate — mandatory before task data

- [ ] Keep Script Property `IDENTITY_GATE_PASSED=false` while setting up codes.
- [ ] Create `Employee_Credentials` by running editor-only `initializeAuthStorage_()` after `MASTER_SPREADSHEET_ID` points to TEST.
- [ ] Add exactly one active Employees row per test account, with role `admin` or `labeller`.
- [ ] Run editor-only `provisionEmployeeAccessCode_('email@example.com')` for each synthetic test employee. Deliver the logged one-time code privately; do not store the plaintext in Sheets or GitHub.
- [ ] Correct email + correct code signs in; wrong code, malformed code, unknown employee, inactive employee and duplicate employee rows fail closed with no role/data leakage.
- [ ] The login response returns a random session token; the server stores session state in Script Cache and does not accept a client-supplied role.
- [ ] No data API returns task/attendance data while the gate is false, even with a valid login token.
- [ ] Rotate a code and confirm existing sessions for that employee are invalidated.
- [ ] Confirm sign-out removes the server-side session.
- [ ] Open the deployed TEST `/exec` URL with the intended “Google account required” audience. Verify app-level access code works with personal Gmail accounts; this is not Google SSO and does not prove the browser's Google session email matches the typed email.
- [ ] Only after these checks pass, set `IDENTITY_GATE_PASSED=true` in TEST and proceed to the Phase 1/2 data tests.

## C. Authorization and privacy

- [ ] With gate false, `getMyWork` cannot return task records.
- [ ] Unknown, inactive, duplicate employee rows and invalid roles are denied.
- [ ] Client changes to the token, email, role or displayed UI cannot grant access; the server validates its cached session and loads the identity from the credential/employee records.
- [ ] Only projects with an active Access row for the authenticated user are read.
- [ ] Rows assigned to another email never appear; email matching trims surrounding whitespace and ignores case.
- [ ] A source read failure is shown as an error and marks totals as partial.

## D. Mapping and metrics

- [ ] Map Dataset Set Id, Annotator Mail and Status for every test project.
- [ ] Missing required mappings or missing mapped source headers fail visibly.
- [ ] Duplicate canonical mappings fail visibly.
- [ ] Hand-calculate assigned-row count and proposed completed-status count.
- [ ] Confirm completed statuses against the final real workflow before using reporting.
- [ ] Confirm distinct set count uses Project ID + Dataset Set ID.
- [ ] Test blank email, blank set ID, blank status, mixed-case email and surrounding spaces.
- [ ] Test date-only cells in the project timezone and confirm the displayed date.
- [ ] Test source values containing angle brackets, quotes and ampersands; they must render as text.

## E. UI and runtime

- [ ] Initial render calls only the identity diagnostic.
- [ ] Refresh updates the displayed timestamp.
- [ ] Empty assignments show a clear empty state.
- [ ] Partial project failures are visibly labeled; don't use partial totals operationally.
- [ ] Test mobile-width layout.
- [ ] Record execution duration and quota consumption for expected row counts.
- [ ] Confirm source spreadsheets are not modified.

## F. Phase 2 — attendance and breaks (before implementation is considered complete)

- [ ] Only an authenticated active employee can write attendance actions.
- [ ] Attendance events use server-generated timestamps in `Asia/Kolkata`.
- [ ] Concurrent duplicate clock-in/out requests do not create inconsistent sessions.
- [ ] Break start/end rules prevent overlapping or unmatched breaks.
- [ ] A retry of the same action does not double-write events.
- [ ] Full-day, half-day and short leave rules follow the agreed definitions.
- [ ] Stale open sessions follow the agreed auto-close policy and preserve an audit trail.
- [ ] Labellers cannot read or modify other employees' private attendance details unless explicitly authorized by the role policy.

## G. Phase 2 — attendance and leave

- [ ] Admin initialization creates exactly the five attendance/leave tabs in the private TEST master.
- [ ] Initialization does not overwrite any existing tab with unexpected headers or data.
- [ ] Direct attendance API calls fail when the identity gate is closed.
- [ ] Unauthenticated, inactive, duplicate employee and non-admin review calls are denied.
- [ ] Clock-in creates one open session with a server-generated timestamp and event.
- [ ] Replaying the same request ID and action returns the original result without adding rows.
- [ ] Reusing a request ID for a different action is rejected.
- [ ] Concurrent clock-in requests create at most one open session for the employee.
- [ ] Clock-out is rejected while a break is open.
- [ ] A second break cannot start until the first is ended; unmatched break-end is rejected.
- [ ] Clock-in is rejected while a prior-day session remains open; no guessed clock-out time is inserted.
- [ ] Full-day leave accepts a valid date range; half-day leave requires one date and AM/PM; short leave requires one date and valid increasing times.
- [ ] Leave requests cannot be submitted for past dates or overlap another pending/approved request for that employee.
- [ ] Labellers can only read their own leave requests; admin review is role-checked and only pending requests can be reviewed.
- [ ] Event log records clock-in/out, break start/end, leave request/review, and auto-close events.
- [ ] `ATTENDANCE_MAX_SESSION_HOURS` missing or outside 1–24 causes stale-session closure to fail safely.
- [ ] With an approved max-session setting, stale sessions close at the configured duration and record the actual closure time/reason separately.
- [ ] Simulate a Sheets write failure between multi-tab updates and document recovery behavior before production.
- [ ] Verify local date handling across midnight and daylight-saving-free `Asia/Kolkata` assumptions.
- [ ] Confirm no attendance/leave writes touch source project task spreadsheets.

## H. Release rule

No real employee data, scheduled triggers, outgoing reminder emails or production deployment until applicable checks pass and a reviewer verifies the exact metric definitions.
