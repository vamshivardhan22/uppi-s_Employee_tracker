# Build Status

Last updated: 2026-10-27

## Current repository state

Phase 0/1 and Phase 2 source are deployed to a dedicated TEST Apps Script project. Browser-based live checks have verified authentication/session behavior, assigned-task isolation, clock-in/out, break start/end, leave submission/review, short-leave time validation and the leave-overlap regression after its fix. Phase 3 issue/TAT code is now added to the development branch and passed parser and in-memory scan smoke checks, but it has not yet been copied into the live TEST project or verified against live Sheets. No production deployment or merge has been performed.

Development must follow the agreed six-phase plan. Do not use unrelated repository references or introduce features outside the agreed project requirements.

## Implemented in source

- Apps Script web-app entry point and responsive HTML shell.
- Safe status endpoint that reveals no active-user or script-owner identity.
- Access-code login for personal Gmail users, with high-entropy codes stored only as SHA-256 hashes in a private `Employee_Credentials` tab.
- Short-lived random server-cache sessions; data endpoints recheck active employee status and credential hash on each request.
- Editor-only access-code initialization/provisioning helpers, not exposed as browser-callable functions.
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
- Phase 3 issue/TAT module (`IssueScanner.gs`): admin-only storage initialization, read-only chunked scans, stable issue keys, missing-data/assignment/hold findings, optional per-project/status TAT rules, scan-run duration and coverage logs, partial-run cursor, resolve action, daily-deduplicated reminder digest with MailApp quota check, and opt-in 6/12-hour scan trigger. Emails and triggers default to disabled.
- Phase 3 synthetic in-memory smoke test: a 3-row fake source produced `ANNOTATOR_NOT_ACTIVE` and `TAT_BREACH`; a following scan after correcting the synthetic row marked both issues `RESOLVED`. This is not a live Apps Script test.
- In-memory mocked verification: a previous revision passed combined Apps Script/inline JavaScript syntax checks and 28 access-code, session, task-isolation, attendance and leave behavior checks. Those results predate the live date-normalization regression fix; the corrected revision's complete mock/parser suite must be rerun. See `docs/VERIFICATION_LOG.md`.
- Browser-only deployment bundle maintained under `browser-deploy/`: `Main.gs`, `Index.html`, and `appsscript.json`. The combined script and HTML have been checked against modular sources at the matching revision.
- `docs/BROWSER_ONLY_SETUP.md` describes browser-only setup. Live TEST now exists; remaining runtime edge checks are tracked in `docs/TEST_PLAN.md` and `docs/VERIFICATION_LOG.md`.

## Not implemented

- Automatic trigger installation for stale-session closure (planned in Phase 3); the closure function is not scheduled automatically.
- Full admin attendance history/dashboard (Phase 4).
- Duplicate task detection (needs a confirmed stable task key/business rule), validation-specific reminders and heartbeat monitoring.
- Live deployment/runtime validation of Phase 3 scanning, TAT rules, digest delivery and scheduled-trigger behavior.
- Admin People/Projects management or grant/revoke flows.
- My Reports, attendance history, charts, snapshots or performance/load tests.
- Remaining browser-based edge tests, production deployment or pilot. Core login, task-isolation and selected Phase 2 workflows have been tested live in the dedicated TEST deployment.

## Known limitations and release blockers

1. **Personal Gmail authentication uses access codes.** The email is a lookup key, not proof of Google account identity. Codes must be high entropy and distributed privately; this is app-level authentication, not Google SSO.
2. **Status semantics are provisional.** The current completed-status list is proposed in the build plan and must be confirmed against the actual task workflow before metrics are used operationally.
3. **Task counts are source rows.** Distinct sets are counted by Project ID + Dataset Set ID. Confirm this is the intended counting unit.
4. **Date fields are treated as date-only.** If a source column contains date-time values, this serializer intentionally presents the date portion only; confirm the source's actual semantics.
5. **Required mappings are enforced for Set ID, Annotator Mail and Status.** The `Required` flag in Column_Map is documented for configuration but additional required-field validation belongs to the issue-scanner phase.
6. **Reads are not chunked yet.** Each configured tab is read in one `getDataRange()` call. Large projects need load testing and a chunked scanner before wider rollout.
7. **Partial totals can still be displayed.** The UI now labels them as partial and lists project failures. Do not use partial totals for decisions.
8. **No automated Apps Script test runner is included.** Static inspection cannot prove deployment, authorization, quota, or Google Sheets runtime behavior.

## Phase 2 verification status

### Verified live in TEST
- Attendance storage initialized in the private master spreadsheet.
- Labeller clock-in created an `OPEN` session; clock-out changed that session to `CLOSED`.
- A tea break was started and the same break row was subsequently marked `CLOSED` with an end request ID.
- Full-day leave request was submitted and approved by Admin; the Labeller later saw their own request without approval controls.
- Invalid short-leave times (end before start) were rejected; a valid short-leave interval was accepted.
- A duplicate same-date request was first reproduced as a regression; after the date normalization fix, the app returned the overlapping-leave rejection and the test duplicate was rejected by Admin with an audit note. The sheet showed the original approved row and the rejected regression row, with no additional row from the latest blocked attempt.

### Still to verify before Phase 2 is complete
- Half-day leave AM/PM behavior; direct API denial for labeller/admin-only actions; unauthorized access to another employee's attendance/leave records.
- Idempotent retry and request-ID mismatch in live Sheets, concurrent clock-in/break/leave calls, clock-out while a break is open, unmatched/duplicate break actions, and previous-day open-session behavior.
- Event log completeness, date/timezone rendering after the latest deployed bundle, multi-tab partial-write recovery, and stale-session closure with an approved `ATTENDANCE_MAX_SESSION_HOURS` value.

The 28/28 in-memory mock results predate the live date-normalization regression and must not substitute for these remaining live tests. Do not merge or release to production until critical TEST gates pass.

## Release rule

Keep the data gate enabled only in TEST while synthetic testing is active; disable it if a regression or data-isolation issue appears. Do not connect production data, merge the branch, or enable scheduled triggers/outgoing emails until authorization edge cases, metric definitions, date handling, quotas, backup/restore and pilot acceptance are verified.
