# Build Status

Last updated: 2026-10-28

## Current repository state

The development branch build/phase-0-1-dashboard contains source for all planned phase areas (0–6). Draft PR #1 remains open and unmerged. The newer Phase 3–6 source and UI are **not fully verified in the live Google Apps Script TEST deployment**. No production deployment or pilot has been approved.

The source of truth remains the modular files under apps-script/; browser-deploy/Main.gs is the browser-copy bundle and browser-deploy/Index.html is the matching UI. Existing project task spreadsheets stay read-only. App-owned records are written only to the separate private master spreadsheet.

A GitHub Actions validation workflow and in-memory identity-gate regression tests are now in place. Latest checked run #14 on 2026-10-28 passed: 17/17 repository source/release-guard checks, 9/9 fake-Script-Properties identity-gate behavior tests, and Node.js syntax checks for modular Apps Script, the combined bundle and dashboard client JavaScript. This is repository-level regression protection only; it does not test deployed Google Apps Script permissions, live sheet I/O, quotas, concurrency or restore behavior.

## Phase-by-phase status

| Phase | Implemented in source | Verified in live TEST? |
|---|---|---|
| 0 — Identity/authentication gate | Access-code authentication, hashed credentials, short-lived session tokens, active employee/role checks, sign-out and credential-rotation invalidation. | Selected checks passed: valid/invalid code, sign-out, rotation invalidation and data gate behavior. More inactive/duplicate account and direct role-denial tests remain. |
| 1 — Read-only My Work | Project access filtering, authenticated-email row isolation, summary cards, escaped task table and partial-source error display. | Synthetic assignment isolation passed; large task tabs and failure edge cases remain. |
| 2 — Attendance/leave | Clock-in/out, breaks, full/half/short leave, admin review, request idempotency, event log and guarded stale-session closure function. | Selected flows passed: clock-in/out, break start/end, full-day leave approval, short-leave validation, own-request privacy and overlap regression fix. Half-day, past-date, concurrency and recovery tests remain. |
| 3 — Issue/TAT | Admin-only chunked source scans, stable issue keys, issue registry, scan-run log/cursor, explicit per-project/status TAT rules, resolve flow, digest preview, quota-aware email guard and opt-in 6/12-hour trigger. | Parser and in-memory scan smoke passed; the live TEST project still needs the updated bundle, synthetic scan and TAT/partial-run checks. Emails and triggers must stay off during initial verification. |
| 4 — Admin/reporting | People/projects/access/mapping console, input validation, last-admin/self-demotion protections, audit logging, date-filtered team reports, visual summaries/charts, partial-data flag and private report snapshots. | Source/UI present. Live admin role-denial, configuration CRUD, access revoke, report hand-calculation, partial-report and snapshot tests remain. |
| 5 — Operations/reliability tooling | Read-only health overview, configuration/source audit, TEST release checklist, explicit TEST backup creation/verification, trigger/config metadata and audit log. | Source/UI present. Tooling does not replace concurrency/load/failure-injection tests or a real separate restore drill. Those have not been completed. |
| 6 — Controlled rollout | Environment/master binding, production approval gate, TEST/PROD separation rules and staged rollout checklist. | Code and runbook present. No separate PROD Apps Script project or master has been created/approved here; no pilot or production rollout has been executed. |

## Implemented source features

- Access-code login for personal Gmail users; email is an account lookup, not Google SSO.
- Server-side session, role and active-employee validation on protected endpoints.
- Project assignment filtering and read-only source task reads.
- Attendance and leave records in app-owned private-master tabs.
- Issue/TAT scan storage, run metrics and guarded reminder/schedule functions.
- Admin-only management of Employees, Projects, Access and Column_Map.
- Admin audit log and private team-report snapshots.
- Operational health view, configuration audit and TEST readiness checklist.
- Explicit environment/master matching for the app data gate.
- Private TEST backup functions that require a TEST label, matching TEST master, admin storage and an explicit backup-enable property.

## Remaining verification / release blockers

- Copy the current browser bundle into the existing TEST Apps Script project and deploy a **new version**, preserving owner execution and signed-in-Google-account access settings.
- Set and verify APP_ENV_LABEL=TEST, MASTER_SPREADSHEET_ID equal to TEST_MASTER_SPREADSHEET_ID, and IDENTITY_GATE_PASSED=false during auth testing. Enable the TEST data gate only after auth checks pass.
- Complete the Phase 3 live scan, configured test-only TAT rule, partial-run coverage, digest preview and disabled-trigger checks.
- Complete Phase 4 write-permission tests, project-access revoke tests, date filters, chart cross-checks, report partial-data behavior and snapshot prevention when data is partial.
- Complete Phase 5 concurrent actions, idempotency/replay, midnight/timezone, quota/load tests, write-failure recovery, private backup verification and a separate TEST restore drill.
- Confirm completed-status semantics, task/set counting rules, date-field meaning and operational attendance/leave policies with the business owner.
- Complete a separate-environment Phase 6 review. Never store a PROD master ID in TEST. Do not deploy real employee data or enable reminders/schedules until explicitly accepted.
- Run a controlled synthetic pilot and record human acceptance before broader access.

## Known limitations

1. **Personal Gmail auth is app-level access-code authentication**, not proof that the browser's active Google account equals the email typed into the form.
2. **Task status semantics are provisional.** The completed-status list must be agreed before reports are used for decisions.
3. **My Work currently reads each configured source tab in one read.** It has not passed load testing for large source tabs.
4. **The report row limit is a safety cap, not pagination.** If reached, reports must be marked partial and cannot be snapshotted.
5. **Google Sheets multi-tab writes are not transactional.** Script locks serialize this Apps Script project's calls, but failure injection and recovery still require real TEST validation.
6. **No automated Apps Script service emulator exists.** A GitHub Actions workflow now checks source/bundle synchronization, key release guards and JavaScript syntax, but it still cannot prove actual Apps Script permissions, service quotas, browser deployment behavior or data integrity.
7. **A verified backup is not a restore test.** Restore must be rehearsed with a separate TEST copy/project, never by overwriting the active master in place.

## Phase 0/1/2 live TEST notes

- The Labeller signed in and saw exactly the two synthetic task rows assigned to their normalized email; another user's row stayed hidden.
- Wrong-code rejection, sign-out behavior and access-code rotation invalidation were observed.
- Clock-in/out and break start/end were recorded in the private master. Full-day leave was submitted and approved, and the Labeller could view their own leave without review controls.
- Invalid short-leave time order was rejected; a valid short leave was accepted.
- The same-date leave-overlap regression was fixed and retested: the duplicate attempt was blocked without adding another row. The duplicate record created by the earlier failing test was rejected with an audit note.
- Small display/polish issues were deferred; they are not evidence of data-processing correctness.

## Release rule

Keep PR #1 a draft and unmerged until the relevant live TEST gates pass. Do not enable issue email, install scheduled triggers, use real employee data, or create a production deployment until source, permissions, operational tests, metrics and human acceptance are reviewed.
