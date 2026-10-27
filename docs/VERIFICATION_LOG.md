# Verification Log

This log records checks run against code read back from the GitHub development branch. It separates static/source checks and in-memory mocks from tests performed on the live Google Apps Script platform.

## Current source under test

- Branch: `build/phase-0-1-dashboard`
- Browser bundle `browser-deploy/Main.gs` SHA: `90c820d2955849dc1d965295e14cbad1ec892f99`
- Modular `apps-script/Auth.gs` SHA: `f68809bfa20ab54d4d9eb0589be8194e57617043`
- Modular `apps-script/Attendance.gs` SHA: `3c9b3266838108d4b0eb9d260dbc9be487824b69`
- Modular `apps-script/Code.gs` SHA: `6b30e23c1887420af3b9a393247e4de46a5657e7`
- Modular `apps-script/UserApi.gs` SHA: `a3d38e14df704d37db0df1384392f0b6693b8584`
- UI `apps-script/Index.html` SHA: `ccbb7608afa468ef98f025bb77615615d37e46ce`
- No OS/terminal commands were used.
- No external repositories were used as implementation or design references.

## Why Phase 0 changed for personal Gmail

Google documents that `Session.getActiveUser().getEmail()` can be blank for a web app deployed to execute as its owner when the visitor is outside the developer's Workspace domain. See Google's [Session reference](https://developers.google.com/apps-script/reference/base/session) and [Web Apps guide](https://developers.google.com/apps-script/guides/web).

The current implementation uses app-level access-code authentication instead of claiming to know the visitor's Google identity:
- The employee email is a lookup to one active `Employees` row; it is not authentication by itself.
- The unique access code is generated in the Apps Script editor, stored only as a SHA-256 hash, and delivered privately.
- Successful sign-in creates a random four-hour server-cache session. Every data API validates the token, active employee/role and current credential hash.
- This is **not Google SSO** and does not verify that the browser's active Google account matches the typed email.
- The app must be deployed to execute as the owner and restricted to signed-in Google accounts, never anonymous/public access. The private master remains unshared.

## Browser bundle checks — passed

- `browser-deploy/Main.gs` matches the exact concatenation of the modular Apps Script files at the source revision above.
- `browser-deploy/Index.html` exactly matches `apps-script/Index.html`.
- `browser-deploy/appsscript.json` exactly matches `apps-script/appsscript.json`.
- Combined Apps Script source parses.
- Inline JavaScript in the dashboard HTML parses.
- The UI passes the session token to all protected My Work, attendance and leave endpoints.
- Authentication source does not use `Session.getActiveUser().getEmail()` or `Session.getEffectiveUser().getEmail()` as visitor identity.
- Provisioning helpers end in underscores and are editor-only; the UI does not invoke them.
- `IDENTITY_GATE_PASSED` blocks task and attendance data endpoints until the administrator enables the TEST data gate.
- The docs and code avoid the five unrelated repositories the user explicitly rejected.

## Phase 0–2 in-memory behavior checks — 28/28 passed

The current modular source was combined and run against in-memory mocks of Apps Script, Sheets, Script Properties, Cache and locking:

1. Credential storage initializes.
2. Admin access code is provisioned from `ACCESS_CODE_FOR_EMAIL`.
3. Labeller access code is provisioned from the property.
4. Codes are unique 64-character hexadecimal tokens.
5. Invalid code is rejected with a generic message.
6. Admin sign-in succeeds while the data gate is closed.
7. Bootstrap reports Phase 0 while the gate is closed.
8. My Work is blocked while the gate is false.
9. Bootstrap reports Phase 1 after enabling the test data gate.
10. Labeller sign-in succeeds with the valid code.
11. My Work returns only rows assigned to the authenticated employee.
12. Admin initializes the app-owned attendance tabs.
13. Clock-in creates an open session.
14. Replaying the same request is idempotent.
15. A break can start after clock-in.
16. Clock-out is rejected while a break is open.
17. Break end and clock-out work.
18. Reusing a request ID for a different action is rejected.
19. Half-day leave accepts an ISO date.
20. Overlapping pending leave is rejected.
21. Another labeller can be provisioned.
22. The other labeller can sign in.
23. The other labeller cannot see someone else's leave request.
24. A labeller cannot review leave.
25. An admin can approve pending leave.
26. Rotating an access code invalidates the previous session.
27. Stale-session closure requires explicit approved configuration.
28. Sign-out clears the server-side session.

The browser bundle and inline JavaScript were also parsed successfully after the access-code refactor.

**Limitations:** These checks use in-memory stand-ins, not real Google Apps Script services. They do not prove that Apps Script authorizations succeed, that the browser UI behaves correctly, or that real Sheets and Script Cache have identical behavior. Real concurrent calls, partial multi-tab write recovery, and deployed access settings still require TEST.

## Still required in Google Apps Script TEST

- Create `Employee_Credentials` using editor-only `initializeAuthStorage_()`.
- Provision synthetic admin and labeller codes by setting `ACCESS_CODE_FOR_EMAIL` and running editor-only `provisionEmployeeAccessCode_()`; deliver codes privately.
- While the data gate is false, verify valid and invalid sign-in, inactive/duplicate users, sign-out, code rotation and data API denial.
- Deploy the web app as the script owner and restrict the audience to signed-in Google accounts (not anonymous access).
- Only after authentication checks pass, set `IDENTITY_GATE_PASSED=true` in TEST and verify Phase 1 row isolation and Phase 2 attendance/leave behavior against synthetic sheets.
- Test concurrent requests and recovery if a multi-tab write fails partway through.
- Approve `ATTENDANCE_MAX_SESSION_HOURS` before using stale-session closure; trigger installation belongs to Phase 3.

## Release decision

**Do not merge or deploy to production yet.** The source and mocked checks pass, but Phase 0–2 are not live-runtime verified. Keep the TEST data gate closed until the browser-based authentication checks pass. Do not use real employee data until the TEST configuration and privacy checks are complete.


## Live TEST regression discovered on 2026-10-27

During browser-based Phase 2 testing, submitting another leave request for the same date as an already approved request created a new PENDING row. This is a failed live test, despite the earlier in-memory mock check. The row date was being read from Google Sheets as a JavaScript `Date` object, while the overlap logic accepted only string dates; the same assumption also caused long date strings in the UI.

A fix has been applied to normalize sheet date values to `YYYY-MM-DD` before checking overlapping requests, computing today's leave status, or returning leave dates to the UI. Invalid dates in existing pending/approved requests now fail closed rather than being skipped. The labeller's redundant final status cell is also simplified.

**Re-test required:** copy the updated browser bundle into the TEST Apps Script project, deploy a new version, and verify that a same-date duplicate request is rejected without adding a row. The duplicate PENDING row already created during the test must be resolved by an Admin through the app (reject it with a note such as `Duplicate created during regression test`); do not delete audit rows manually. Production remains blocked until this browser-based regression is confirmed fixed.
