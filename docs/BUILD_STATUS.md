# Build Status

Last updated: 2026-10-26

## Implemented in starter code

- Web-app entry point and responsive HTML shell.
- Identity-only diagnostic endpoint that does not read employee or task spreadsheets.
- Closed-by-default identity gate controlled by Script Properties.
- Server-side active employee and role validation.
- Server-side project assignment filtering.
- Read-only source-sheet reads using the configured tab name.
- Server-side row filtering by the authenticated account email.
- Basic My Work table and counts for assigned rows, completed statuses, distinct set IDs and assigned projects.
- Project-level configuration errors are returned for display rather than silently treated as zero records.

## Not implemented

- Attendance, full/half/short leave, login/logout, breaks or automatic session closure.
- TAT calculations or issue lifecycle/duplicate detection.
- Reminder mail, digest caps or scheduled scanner/triggers.
- Admin screens, People/Projects editing or grant/revoke flows.
- My Reports, attendance history, charts, snapshots or heartbeat monitoring.
- Performance, concurrency, quota, deployment-audience or live Google account testing.
- Production deployment and pilot.

## Known design constraints requiring verification

1. **Identity gate is deployment-dependent.** `Session.getActiveUser().getEmail()` may be blank for some web-app deployments and account types. Never infer identity from `getEffectiveUser()`; it may be the script owner.
2. **Source-sheet access.** The executing account needs access to each configured project spreadsheet.
3. **Header mapping.** Canonical names in `Column_Map` must match application keys; source header strings must match source headers. Rename events should be tested.
4. **Status semantics.** The starter currently counts `Labelling Done`, `Review Done`, `Approved`, and `Rework Done` as completed. Confirm this list against the final task workflow before using it for reporting.
5. **Counting semantics.** A task count is the number of matching source rows. Distinct sets are counted by project ID plus Dataset Set ID. Confirm that this is the intended unit.
6. **Date handling.** The starter returns ISO timestamps. Date-only source cells can be serialized through JavaScript Date objects; verify visible dates for actual source cell types and spreadsheet timezone.
7. **Load limits.** Current code reads each configured source tab's `getDataRange()` in one operation. Chunking and scan cursors are not included. Load-test before adding many large projects.
8. **Partial project failures.** The UI can show rows from successful projects plus visible errors from failed projects; users must not interpret partial totals as complete. This should become a clearly labeled partial-data state before wider rollout.
9. **No automated test runner yet.** The code has not been run inside Apps Script. A push does not prove deployment correctness.

## Release gate

Do not enable production access until identity, privacy isolation, metric definitions, date behavior, failure presentation, quotas, backup/restore, and pilot acceptance have been tested.
