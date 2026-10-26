# Verification Log

This log records checks run against files read back from the GitHub development branch. It distinguishes source-level and mocked checks from real Google Apps Script deployment tests.

## Current verified source revision

- Source revision under test: `4a8c3e26f288931b2a9ce21a0e9c6519e5229818`
- Branch: `build/phase-0-1-dashboard`
- Test method: GitHub connector read-back plus in-memory JavaScript checks. No OS commands were used.
- External repositories: none used as implementation or design references.

## Phase 0 — identity gate

**Source checks passed**
- The identity diagnostic reads no spreadsheets.
- `IDENTITY_GATE_PASSED` must equal the literal string `true`.
- The My Work endpoint checks the gate before employee or task-sheet access.
- Attendance read/write endpoints also check the gate or pass through the server-side employee authorization guard.

**Still required in Apps Script TEST**
- Deploy for the intended audience.
- Verify active-user identity independently as admin and labeller.
- If either identity is blank or incorrect, keep the gate closed. This phase is not runtime-approved.

## Phase 1 — read-only My Work

**Source checks passed**
- Combined Apps Script source parses successfully.
- Inline JavaScript in `Index.html` parses successfully.
- User email is derived server-side; the API does not accept an email argument.
- Project access is checked before source project reads.
- Attendance module writes only to app-owned master tabs, not source task sheets.
- Documentation contains no references to the five external repositories explicitly rejected by the user.

**Still required in Apps Script TEST**
- Confirm mappings, row filtering, status semantics, timezone behavior, escaping, partial failures and actual mobile UI behavior against synthetic sheets.

## Phase 2 — attendance, breaks and leave

**In-memory mock checks passed (15/15)**
1. Closed gate blocks My Work.
2. Closed gate blocks attendance reads.
3. Admin initializes the five app-owned tabs.
4. Clock-in creates one open session.
5. Replaying the same request ID does not add a duplicate session.
6. A separate clock-in while already clocked in is rejected.
7. Break start works after clock-in.
8. Clock-out is rejected while a break is active.
9. Break end closes the active break.
10. Clock-out closes the attendance session.
11. Half-day leave is saved as pending.
12. Overlapping pending leave is rejected.
13. One labeller cannot see another employee's leave request.
14. Admin can approve a pending leave request.
15. Stale-session closure refuses to run without an explicit maximum-session setting.

These tests used in-memory mocks of Google Apps Script and Sheets interfaces. They validate application logic paths, but do **not** prove Google Apps Script runtime behavior, spreadsheet date coercion, deployment identity, real concurrency, or multi-tab write-failure recovery.

**Still required in Apps Script TEST**
- Run the Phase 2 checklist in `TEST_PLAN.md` with synthetic users.
- Test concurrent requests and failure injection across multiple sheet writes.
- Confirm the business-approved value for `ATTENDANCE_MAX_SESSION_HOURS`.
- Confirm the stale-session closure behavior before installing any scheduled trigger. Trigger installation is Phase 3.

## Release decision

**Do not merge or deploy to production yet.** Phase 0 identity verification is a hard blocker, and Phases 1–2 still require real Apps Script TEST execution. Phase 2 source is implemented but is not marked complete until its runtime checklist passes.
