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

## B. Identity gate — mandatory before task data

- [ ] Deploy the TEST web app for the intended audience and open its `/exec` URL as a test admin.
- [ ] Record active-user email, timestamp and deployment audience. The effective-user identity is logged server-side in Apps Script execution logs and is not exposed in the public diagnostic response.
- [ ] Repeat in a separate browser/incognito session as a test labeller.
- [ ] Active-user email is nonblank and exactly matches the signed-in account in both sessions.
- [ ] Active-user identity is not confused with the script owner's effective identity.
- [ ] Repeat after creating a new deployment version.
- [ ] If active-user email is blank or wrong for either account, keep the gate closed and stop.

## C. Authorization and privacy

- [ ] With gate false, `getMyWork` cannot return task records.
- [ ] Unknown, inactive, duplicate employee rows and invalid roles are denied.
- [ ] Client changes cannot substitute another user's email; `getMyWork` accepts no email argument.
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

## G. Release rule

No real employee data, scheduled triggers, outgoing reminder emails or production deployment until applicable checks pass and a reviewer verifies the exact metric definitions.
