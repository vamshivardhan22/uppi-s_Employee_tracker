# Verification Log

This log records checks run against files read back from the GitHub development branch. It distinguishes source-level and in-memory mock checks from tests executed in the real Google Apps Script environment.

## Current source under test

- Branch: `build/phase-0-1-dashboard`
- Browser bundle `browser-deploy/Main.gs` content SHA: `78d015c61dbf361698754c5f35fb8cab11dc71f0`
- Modular `apps-script/Attendance.gs` content SHA: `3a8c8ac9cbc4b46fc0d39876dfd2a0be19508768`
- UI `apps-script/Index.html` content SHA: `6973c92313fde1225a5f91303dbaa95ce5bc1d5f`
- No OS or terminal commands were used.
- No external repositories were used as implementation or design references.

## Browser-only deployment bundle

**Checks passed**
- `browser-deploy/Main.gs` matches the exact concatenation of the current modular Apps Script files.
- `browser-deploy/Index.html` exactly matches `apps-script/Index.html`.
- `browser-deploy/appsscript.json` exactly matches the modular source manifest.
- The combined Apps Script bundle parses.
- The inline dashboard JavaScript parses.
- `docs/BROWSER_ONLY_SETUP.md` describes a browser-only TEST workflow and explicitly requires the real intended `/exec` audience to be tested; a `/dev` editor-only test is not enough.
- Project documentation excludes the five external repository references rejected by the user.

## Phase 0 — identity gate

**Source checks passed**
- The identity diagnostic reads no spreadsheet data.
- `IDENTITY_GATE_PASSED` must equal the literal string `true`.
- The My Work endpoint checks the gate before reading employee or task-sheet data.
- Attendance read/write paths enforce the gate and server-side identity.

**Still required in Google Apps Script TEST**
- Deploy a versioned TEST web app with the intended access audience.
- Verify active-user identity independently as admin and labeller using the deployed `/exec` URL.
- If either identity is blank or incorrect, leave the gate closed. Phase 0 is not runtime-approved.

## Phase 1 — read-only My Work

**Source checks passed**
- User identity is derived server-side; data APIs do not accept a browser-provided email as the authenticated identity.
- Project access is checked before source project reads.
- The task-source code remains read-only.
- Attendance writes target only app-owned tabs in the private master spreadsheet.

**Still required in Google Apps Script TEST**
- Confirm mappings, row filtering, completion-status semantics, date/timezone behavior, HTML escaping, partial failures, and actual UI behavior against synthetic sheets.

## Phase 2 — attendance, breaks and leave

**In-memory behavior checks passed: 20/20**
1. Closed gate blocks My Work.
2. Closed gate blocks attendance reads.
3. Closed gate blocks attendance writes.
4. Admin initializes the five app-owned attendance/leave tabs.
5. Clock-in creates a session using an ISO date key.
6. Replaying the same request ID does not add a duplicate session.
7. Clock-in with a new request while already clocked in is rejected.
8. Break start is accepted after clock-in.
9. Clock-out is rejected while a break is open.
10. Break end closes the active break.
11. Clock-out closes the attendance session.
12. Reusing a request ID for a different action is rejected.
13. Half-day leave stores timezone-safe ISO dates.
14. Overlapping pending leave is rejected.
15. One labeller cannot see another employee's leave request.
16. A labeller cannot review leave.
17. An admin can approve pending leave.
18. A full-day leave date range can be submitted.
19. Stale-session closure refuses to run without explicit policy configuration.
20. Unexpected attendance-tab header columns are rejected.

Additional syntax checks passed for the combined Apps Script bundle and dashboard inline JavaScript.

These checks run against in-memory mocks of the Apps Script and Sheets interfaces using source read back from GitHub. They are not a real Apps Script deployment and do not prove live Google account identity, actual Google Sheets behavior, concurrent requests, or recovery from a write failing between tabs.

**Still required in Google Apps Script TEST**
- Run the Phase 2 checklist in `docs/TEST_PLAN.md` with synthetic users.
- Test genuine concurrent calls and failure recovery across multiple sheet writes.
- Confirm the approved value for `ATTENDANCE_MAX_SESSION_HOURS`.
- Verify automatic closure behavior before any trigger is installed. Trigger installation belongs to Phase 3.

## Release decision

**Do not merge or deploy to production yet.** Phase 0 identity verification remains a hard blocker. Phases 1–2 have passed source checks and mocked behavior checks, but real Apps Script TEST execution is outstanding. The browser-only setup guide is ready to follow in the Google Apps Script web editor.
