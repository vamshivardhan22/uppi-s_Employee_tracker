# Verification Plan

Use only synthetic data in a dedicated TEST master spreadsheet and fake source project sheet. This checklist is the project's verification path; do not substitute unrelated project examples.

## A. Configuration

- [ ] Apps Script project timezone is `Asia/Kolkata`.
- [ ] Script Property `MASTER_SPREADSHEET_ID` points to the private TEST master.
- [ ] Script Property `IDENTITY_GATE_PASSED` is exactly `false` during access-code authentication tests.
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
- [ ] For each synthetic test employee, set Script Property `ACCESS_CODE_FOR_EMAIL` to their email and run editor-only `provisionEmployeeAccessCode_()`; the helper deletes the temporary property after issuing the code.
- [ ] Deliver the logged one-time code privately; do not store the plaintext in Sheets or GitHub.
- [x] Correct email + correct code signs in for both Admin and Labeller; a wrong access code was rejected in the deployed TEST UI.
- [ ] Malformed code, unknown employee, inactive employee and duplicate employee rows fail closed with no role/data leakage.
- [ ] The login response returns a random session token; the server stores session state in Script Cache and does not accept a client-supplied role.
- [ ] No data API returns task/attendance data while the gate is false, even with a valid login token.
- [x] Rotate a code and confirm the previously active Labeller session becomes invalid after refresh; the new code can sign in.
- [x] Confirm sign-out removes the server-side session; after refresh the app displayed “Sign in required.”
- [ ] Open the deployed TEST `/exec` URL with the intended “Google account required” audience. Verify app-level access code works with personal Gmail accounts; this is not Google SSO and does not prove the browser's Google session email matches the typed email.
- [ ] Only after these checks pass, set `IDENTITY_GATE_PASSED=true` in TEST and proceed to the Phase 1/2 data tests.

## C. Authorization and privacy

- [ ] With gate false, `getMyWork` cannot return task records.
- [ ] Unknown, inactive, duplicate employee rows and invalid roles are denied.
- [ ] Client changes to the token, email, role or displayed UI cannot grant access; the server validates its cached session and loads the identity from the credential/employee records.
- [ ] Only projects with an active Access row for the authenticated user are read.
- [x] Rows assigned to another email never appear in the live synthetic project test; the Labeller saw 2 assigned rows while the third employee's row stayed hidden.
- [ ] Live edge test for email whitespace/case normalization.
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

- [ ] Initial render displays the sign-in form without exposing account identities or reading task-source data.
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
- [x] A tea break was recorded as `OPEN`, then the same row was changed to `CLOSED` with an end timestamp/request ID.
- [ ] Verify duplicate/unmatched break actions and clock-out while a break is active are rejected in live TEST.
- [ ] A retry of the same action does not double-write events.
- [ ] Full-day, half-day and short leave rules follow the agreed definitions.
- [ ] Stale open sessions follow the agreed auto-close policy and preserve an audit trail.
- [ ] Labellers cannot read or modify other employees' private attendance details unless explicitly authorized by the role policy.

## G. Phase 2 — attendance and leave

- [ ] Admin initialization creates exactly the five attendance/leave tabs in the private TEST master.
- [ ] Initialization does not overwrite any existing tab with unexpected headers or data.
- [ ] Direct attendance API calls fail when the identity gate is closed.
- [ ] Unauthenticated, inactive, duplicate employee and non-admin review calls are denied.
- [x] Clock-in created an `OPEN` session with a recorded server timestamp in the live TEST master.
- [ ] Confirm a corresponding event row and verify server-side behavior under duplicate concurrent clock-in.
- [ ] Replaying the same request ID and action returns the original result without adding rows.
- [ ] Reusing a request ID for a different action is rejected.
- [ ] Concurrent clock-in requests create at most one open session for the employee.
- [ ] Clock-out is rejected while a break is open.
- [ ] A second break cannot start until the first is ended; unmatched break-end is rejected.
- [ ] Clock-in is rejected while a prior-day session remains open; no guessed clock-out time is inserted.
- [x] Full-day leave was submitted and approved by Admin in live TEST.
- [x] Short leave with an end time earlier than the start time was rejected; a valid increasing interval was accepted.
- [ ] Half-day leave requires one date and AM/PM.
- [ ] Leave requests cannot be submitted for past dates.
- [x] Overlap regression was fixed and retested: a repeated same-date request was blocked, and the sheet had no extra row from the latest blocked attempt.
- [ ] Confirm leave dates returned to the UI are normalized to `YYYY-MM-DD` after the latest bundle deployment.
- [x] In the live UI, the Labeller could see their own approved leave request without Approve/Reject controls; Admin successfully approved a pending request.
- [ ] Attempt direct-call authorization checks and verify that only pending requests can be reviewed at the server layer.
- [ ] Event log records clock-in/out, break start/end, leave request/review, and auto-close events.
- [ ] `ATTENDANCE_MAX_SESSION_HOURS` missing or outside 1–24 causes stale-session closure to fail safely.
- [ ] With an approved max-session setting, stale sessions close at the configured duration and record the actual closure time/reason separately.
- [ ] Simulate a Sheets write failure between multi-tab updates and document recovery behavior before production.
- [ ] Verify local date handling across midnight and daylight-saving-free `Asia/Kolkata` assumptions.
- [ ] Confirm no attendance/leave writes touch source project task spreadsheets.

## I. Phase 3 — issue detection, TAT, reminders and scheduling

- [ ] Copy the current `browser-deploy/Main.gs` and `browser-deploy/Index.html` into the TEST Apps Script project and deploy a new version. Confirm the existing Google-account audience and owner-execution settings remain unchanged.
- [ ] Confirm the Phase 3 panel is visible to Admin only; the Labeller must not see scan, resolve, digest, or scheduling actions.
- [ ] Admin initialization creates `Issue_Registry`, `Issue_Scan_Runs`, `TAT_Rules`, and `Issue_Reminder_Log` with exact headers, and rerunning initialization is idempotent.
- [ ] Run a manual scan using synthetic rows. Verify missing Set ID, missing annotator/status, inactive/unknown annotator and hold findings as applicable.
- [ ] Verify task-source sheets are not modified by issue scanning.
- [ ] Configure a test TAT rule explicitly; verify warning, critical breach and missing-start behavior using known timestamps. No business threshold is inferred when rules are absent.
- [ ] Verify identical findings reuse the stable issue key, repeated scans update an existing issue instead of duplicating it, and a fully scanned resolved finding becomes `RESOLVED`.
- [ ] Simulate a project read error or row/time-budget truncation; the scan must report `PARTIAL`, preserve the next cursor, and must not automatically resolve issues belonging to incompletely scanned projects.
- [ ] Verify run logs record start/end/duration, rows, project coverage, findings, errors, and complete/partial outcome.
- [ ] Preview a digest; verify recipients and issue counts without sending email. Confirm `ISSUE_EMAILS_ENABLED` missing or `false` prevents sending.
- [ ] Only after explicit approval, test a single digest with a synthetic recipient. Verify remaining quota, recipient cap, per-day duplicate prevention and `SENT`/`FAILED` log outcomes.
- [ ] Confirm no schedule exists by default. Only enable a 6- or 12-hour trigger after a complete manual scan and explicit approval; verify disable removes the trigger and stops scheduled execution.
- [ ] Confirm all recipient, TAT, row-limit and schedule decisions are recorded; keep scheduled email off until TEST acceptance.

## J. Phase 4 — admin management, reports and snapshots

- [ ] Copy and deploy the latest TEST bundle before exercising Phase 4 UI; confirm only Admin sees the admin console.
- [ ] Initialize admin storage; verify Admin_Audit_Log, Team_Snapshots and Backup_Log headers; rerun initialization and confirm it is idempotent and does not overwrite unexpected headers.
- [ ] Verify every admin API rejects unauthenticated users and Labeller-role sessions, regardless of which UI elements are hidden.
- [ ] Create/update synthetic employees; reject malformed email, invalid role, duplicate normalized email, duplicate records and blank display name.
- [ ] Confirm an Admin cannot demote/deactivate themselves or remove the last active Admin.
- [ ] Confirm deactivating a user disables their project grants and credentials, and old sessions cannot access data. Verify the new user receives no access code from the UI; issue codes only through the editor-only provisioning helper.
- [ ] Add/update/disable a synthetic project; verify invalid IDs/timezones are rejected and source task sheets are never edited.
- [ ] Grant and revoke a project-access row. Confirm the Labeller sees rows only while both the project and grant are active.
- [ ] Add/update canonical mappings; enforce Dataset Set Id, Annotator Mail and Status as required; duplicate/missing mappings fail closed.
- [ ] Hand-calculate team report totals from synthetic rows for Assigned Date and Submitted Date filters, statuses, employees, projects and distinct sets.
- [ ] Force a source error and a per-project report row limit; verify partial-data warnings/errors appear and the report must not be treated as complete.
- [ ] Save a snapshot only from a complete report, then confirm the snapshot contains the summary and aggregate rows in the private master. Partial reports and oversized snapshots must be refused.
- [ ] Verify rendered table/chart text is escaped, mobile layout remains usable, and snapshots are admin-only.

## K. Phase 5 — operational health, security, reliability and backup

- [ ] Run operational health and confirm it is read-only; check environment, gate, tab metadata, active counts and installed trigger metadata.
- [ ] Run configuration audit against clean synthetic config and against intentionally broken config (duplicate email/project IDs, dangling access, missing mappings, bad sources, missing credentials and incorrect environment/master properties). Blockers must be clear and a blocked audit must not promote release.
- [ ] Verify the release checklist labels itself TEST-only and does not imply production approval.
- [ ] Test all admin/attendance/issue APIs using missing, invalid, expired, inactive-user, Labeller-role and rotated-credential sessions.
- [ ] Exercise simultaneous clock-in, break and leave submissions, duplicate request IDs, replay with mismatched payload, issue scan leases, simultaneous admin updates, and retry after simulated service failure.
- [ ] Test partial multi-tab writes and recovery. Google Sheets writes are not transactional; document exactly what persisted and do not blindly replay an uncertain write.
- [ ] Measure realistic source row counts, execution duration, Sheets service calls, Cache behavior, Apps Script quotas and report/scan row caps. Do not enable a trigger cadence until measured cost fits the account quota.
- [ ] Keep scheduled scans and outgoing mail disabled. If separately approved for a TEST drill, use a synthetic recipient, verify one-per-day deduplication and recipient caps, and then disable email/trigger again.
- [ ] Confirm TEST_BACKUP_ENABLED is false by default; enable it only for an approved backup drill in an explicitly labelled TEST environment.
- [ ] Create a TEST backup and verify Drive privacy and required tabs. Treat the backup as containing employee records and access-code hashes; never share it with labellers.
- [ ] Perform a separate restore drill using a copy of the backup and a separate TEST Apps Script project/master. Verify sign-in, sample task read, attendance/leave records, issue registry and app-owned data; never overwrite the active master in place.
- [ ] Record every failure, recovery action, resulting row count and audit entry. Passing the audit tool alone is not a substitute for these tests.

## L. Phase 6 — environment separation and staged rollout

- [ ] TEST project uses APP_ENV_LABEL=TEST, MASTER_SPREADSHEET_ID=TEST_MASTER_SPREADSHEET_ID, and IDENTITY_GATE_PASSED remains false during auth tests.
- [ ] TEST project has no PROD_MASTER_SPREADSHEET_ID; email and scheduled-scan properties remain off unless an approved isolated test is underway.
- [ ] Change the expected TEST master ID in a controlled test and confirm app data remains locked on mismatch; restore the correct ID and verify recovery.
- [ ] Create a distinct PROD Apps Script project and private PROD master only after approval. Never repoint the existing TEST app to the PROD master.
- [ ] Production configuration uses APP_ENV_LABEL=PROD and a matching PROD_MASTER_SPREADSHEET_ID; production approval stays off until signed human review.
- [ ] Verify deployment executes as the intended owner and requires sign-in with a Google account; anonymous/public access is prohibited.
- [ ] Create a release evidence packet: configuration audit, all phase test results, metric definitions, backup/restore evidence, quota observations, reviewer approval and rollback plan.
- [ ] Run a small synthetic/internal pilot first. Expand access only after the owner confirms metrics, data access boundaries, escalation policy and rollback are correct.
- [ ] Record explicit go/no-go decision. The repository's release checklist never authorizes deployment automatically.

## H. Release rule

No real employee data, scheduled triggers, outgoing reminder emails or production deployment until applicable Phase 0–6 checks pass, a separate-environment review is complete, and a human reviewer verifies metric and attendance policy definitions.
