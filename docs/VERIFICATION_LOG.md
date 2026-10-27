# Verification Log

This log records checks run against code read back from the GitHub development branch. It separates static/source checks and in-memory mocks from tests performed on the live Google Apps Script platform.

## Current source under test

- Branch: `build/phase-0-1-dashboard`
- Browser bundle `browser-deploy/Main.gs` SHA: `6b6cd2f6065930243c77f793c467c0990c45be30`
- Modular `apps-script/Auth.gs` SHA: `f68809bfa20ab54d4d9eb0589be8194e57617043`
- Modular `apps-script/Attendance.gs` SHA: `237a5e52fb1d6adfe2ba9dd87e4b666ef74715f4`
- Modular `apps-script/IssueScanner.gs` SHA: `389bd93a9fbaeabaa659a7c8a64b36f640c72f78`
- Modular `apps-script/Code.gs` SHA: `6b30e23c1887420af3b9a393247e4de46a5657e7`
- Modular `apps-script/UserApi.gs` SHA: `a3d38e14df704d37db0df1384392f0b6693b8584`
- UI `apps-script/Index.html` SHA: `0eccae7b7f1ebf7edc08bbf0cee2f0f768facf84`
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

## Previous revision: Phase 0–2 in-memory behavior checks — 28/28 passed

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

The combined Apps Script bundle and inline JavaScript were parsed successfully after the Phase 3 update. The browser server bundle matches the concatenation of the current modular source files; browser and modular Index.html files match; the manifests match.

These 28 Phase 0–2 mock checks were run before the live date-normalization regression was found. They are not evidence that every current revision path is tested. The current Phase 3 combined bundle and inline UI passed syntax parsing, and a separate in-memory Phase 3 scanner smoke test is recorded below; live Phase 3 verification remains outstanding.

**Limitations:** These checks use in-memory stand-ins, not real Google Apps Script services. They do not prove that Apps Script authorizations succeed, that the browser UI behaves correctly, or that real Sheets and Script Cache have identical behavior. Real concurrent calls, partial multi-tab write recovery, and deployed access settings still require TEST.



## Phase 3 in-memory smoke test — passed (not live TEST)

A harness with in-memory Sheets, Script Properties, LockService and Utilities ran the scanner against three synthetic task rows. The first complete scan opened two findings (`ANNOTATOR_NOT_ACTIVE` and a configured `TAT_BREACH`) and wrote a `COMPLETE` scan-run log. A second scan after correcting the synthetic row returned zero current findings and resolved the two prior issues. The scanner did not write to the source project sheet. These are code-level simulation results only; they do not prove live Apps Script behavior, actual quota use, TAT rules, or email delivery.

## Live TEST observations — 2026-10-27

### Confirmed in the deployed browser app
- Admin and Labeller signed in with their own access codes; an incorrect code was rejected.
- Sign-out followed by refresh returned to “Sign in required.” Rotating the Labeller's access code invalidated the previously active session; the replacement code worked.
- The data gate initially prevented task data exposure. When enabled in TEST, the labeller saw exactly two assigned tasks, while the other synthetic user's task remained hidden.
- Admin initialized the five attendance/leave tabs in the private master spreadsheet.
- Labeller clock-in created one `OPEN` session; clock-out changed it to `CLOSED`.
- A tea break was recorded as `OPEN`, then `CLOSED` with an end request ID.
- A full-day leave request was submitted and approved by Admin. The Labeller could view their own request without approval controls.
- Invalid short-leave times (end earlier than start) were rejected; a valid short-leave interval was accepted.
- The first live overlap check exposed a date-type bug and created an extra pending request. After the normalization fix, an overlapping request was rejected with the expected message. The extra regression request was rejected through the app with an audit note, and the sheet showed only the original approved row and that rejected test row; no row was added by the latest blocked attempt.

### Still required in Google Apps Script TEST
- Verify all deployment properties and restricted sign-in audience from the deployment screen; test inactive/duplicate users and direct API role-denial behavior.
- Test half-day leave (AM/PM), past-date blocking, and confirm leave dates render as ISO date-only values after the latest bundle deployment.
- Verify clock-out while a break is open is rejected; test duplicate/unmatched break actions, repeated request IDs, and concurrent attendance/leave actions against live Sheets.
- Verify event-log completeness, previous-day open-session behavior, timezone edge cases, and partial-write recovery for multi-tab operations.
- Approve `ATTENDANCE_MAX_SESSION_HOURS` before enabling stale-session closure; trigger installation belongs to Phase 3.
- Finish remaining Phase 3–6 features and reliability/security tests. Keep using synthetic data only.

## Release decision

**Do not merge or deploy to production yet.** Core Phase 0/1 and selected Phase 2 flows have been verified live using synthetic data; the 28/28 mock checks are separate and predate the date-normalization fix. Phase 2 edge-case tests and Phase 3–6 remain. Keep production blocked until critical access-control, concurrency, data-integrity, metric-definition, quota, backup/restore and pilot acceptance gates pass.


## Live TEST date-normalization regression — fixed and re-tested on 2026-10-27

The first same-date overlap attempt created an extra pending row because Google Sheets returned date values as JavaScript `Date` objects while overlap logic assumed ISO strings. The fix normalizes sheet date values to `YYYY-MM-DD` before overlap checks, attendance status calculations and UI response construction. After deploying the corrected bundle, the duplicate attempt returned the expected overlap error and created no additional row. Admin rejected the one duplicate regression record through the app with the audit note `Duplicate created during regression test`; the original approved request remained unchanged.

A valid and invalid short-leave time interval were also tested in the deployed UI. The optional reason and minor display issues are deferred to the planned polish version.


## Phase 3 deployment status

Phase 3 source and Admin UI are committed on `build/phase-0-1-dashboard`, but the live TEST Apps Script project has not yet been updated to this revision. Parser checks and the synthetic in-memory smoke test passed. All Phase 3 live TEST items in Section I of `docs/TEST_PLAN.md` remain outstanding. Emails and scheduled triggers must remain disabled during initial TEST validation.
