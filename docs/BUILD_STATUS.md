# Build Status

Last updated: 2026-10-26

## Current repository state

Phase 0/1 starter code and Phase 2 attendance/leave code are committed on the development branch. It has not been deployed to Apps Script or tested against live Google accounts or real spreadsheets. GitHub commit success is not runtime verification.

Development must follow the agreed six-phase plan. Do not use unrelated repository references or introduce features outside the agreed project requirements.

## Implemented in source

- Apps Script web-app entry point and responsive HTML shell.
- Identity-only diagnostic endpoint that intentionally reads no spreadsheet data.
- Identity gate closed unless Script Property `IDENTITY_GATE_PASSED` is exactly `true`.
- `getMyWork()` now checks the identity gate before opening the master spreadsheet or reading task data.
- Server-side active employee and role validation.
- Server-side project access filtering and source-sheet reads by configured tab name.
- Server-side filtering by the authenticated user's normalized email; no browser email parameter.
- Read-only My Work table and basic row/status/set/project counts.
- Visible project errors and a partial-data warning if one or more project reads fail.
- Date-only values serialized in the configured project timezone to reduce browser timezone shifts.
- Duplicate mapping and duplicate header checks.
- Phase 2 attendance actions: clock-in, clock-out, start/end break, and leave requests for full day, half day (AM/PM) and short leave.
- Admin-only initialization of five app-owned attendance tabs; mismatched existing headers fail closed.
- Script-lock-protected actions with request IDs and replay records to reduce duplicate writes on retries.
- Append-only attendance event log; server-side timestamps and Asia/Kolkata date keys.
- Admin approve/reject actions for leave requests; labellers can only list their own requests.
- Configurable stale-session closure function; it refuses to run until `ATTENDANCE_MAX_SESSION_HOURS` is explicitly set.

## Not implemented

- Automatic trigger installation for stale-session closure (planned in Phase 3); the closure function is not scheduled automatically.
- Full admin attendance history/dashboard (Phase 4).
- TAT calculations, issue lifecycle, duplicate task detection or validation reminders.
- Scheduled scanner, email digests, quota-aware mail handling or heartbeat monitoring.
- Admin People/Projects management or grant/revoke flows.
- My Reports, attendance history, charts, snapshots or performance/load tests.
- Deployment audience verification, identity matrix, live Google account tests, production deployment or pilot.

## Known limitations and release blockers

1. **Identity is deployment-dependent.** `Session.getActiveUser().getEmail()` can be blank depending on account type and deployment. Never substitute `getEffectiveUser()` as the visitor identity.
2. **Status semantics are provisional.** The current completed-status list is proposed in the build plan and must be confirmed against the actual task workflow before metrics are used operationally.
3. **Task counts are source rows.** Distinct sets are counted by Project ID + Dataset Set ID. Confirm this is the intended counting unit.
4. **Date fields are treated as date-only.** If a source column contains date-time values, this serializer intentionally presents the date portion only; confirm the source's actual semantics.
5. **Required mappings are enforced for Set ID, Annotator Mail and Status.** The `Required` flag in Column_Map is documented for configuration but additional required-field validation belongs to the issue-scanner phase.
6. **Reads are not chunked yet.** Each configured tab is read in one `getDataRange()` call. Large projects need load testing and a chunked scanner before wider rollout.
7. **Partial totals can still be displayed.** The UI now labels them as partial and lists project failures. Do not use partial totals for decisions.
8. **No automated Apps Script test runner is included.** Static inspection cannot prove deployment, authorization, quota, or Google Sheets runtime behavior.

## Phase 2 verification status

Phase 2 source has been added and read back from GitHub after push. It has **not** been executed in Apps Script. Required tests include identity/role denials, request replay, concurrent actions, break invariants, leave overlap/review, date/timezone handling, partial-write recovery, and stale-session closure. The maximum session duration must be approved and configured before stale-session closure is enabled. Do not call Phase 2 complete until the TEST checklist passes.

## Release rule

Keep the gate closed until the deployed `/exec` identity matrix passes for both admin and labeller accounts. Do not connect production data or enable scheduled triggers/outgoing emails until privacy isolation, metric definitions, date handling, quotas, backup/restore and pilot acceptance are verified.
