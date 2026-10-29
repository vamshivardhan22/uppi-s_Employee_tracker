# Phase 3 — Live TEST Runbook

**Purpose:** verify the issue/TAT scanner against the dedicated synthetic TEST project before beginning Phase 4 acceptance. This runbook requires browser access only; no terminal or local installation is needed.

**Environment:** the existing `Labeller Dashboard TEST` Apps Script project, private synthetic TEST master, and synthetic project `TEST-PROJECT-01`. Do not run these steps against production data.

## Release-safe preflight

Before touching the script editor, confirm all of the following in **Apps Script → Project Settings → Script Properties**:

- `APP_ENV_LABEL` is exactly `TEST`.
- `MASTER_SPREADSHEET_ID` exactly equals `TEST_MASTER_SPREADSHEET_ID`.
- `IDENTITY_GATE_PASSED` is `true` for the already-approved synthetic data-flow test. Set it back to `false` before any future authentication-only test.
- `ISSUE_EMAILS_ENABLED` and `ISSUE_SCAN_TRIGGER_ENABLED` are absent or `false`.
- `TEST_BACKUP_ENABLED` is absent or `false`.
- Do not set a production master ID or production approval properties in TEST.

If any property is missing or mismatched, stop; the intended result is for the app to fail closed. Do not paste spreadsheet IDs, access codes, tokens or private employee data into GitHub issues or chat.

## Deploy the current source

1. Open the development-branch [browser deployment bundle](../browser-deploy/Main.gs), [dashboard UI](../browser-deploy/Index.html), and [manifest](../browser-deploy/appsscript.json) on GitHub.
2. In the existing `Labeller Dashboard TEST` project, replace the entire contents of `Main.gs` and `Index.html` with the current files. Confirm the manifest still has timezone `Asia/Kolkata` and runtime `V8`. Save.
3. Use **Deploy → Manage deployments → Edit → New version → Deploy**. Preserve **Execute as: owner** and signed-in Google-account-only access. Do not allow anonymous access and do not create a production deployment.
4. Open the versioned `/exec` URL and sign in as the synthetic Admin. Confirm the issue/TAT controls are not visible to the Labeller account.

## Test A — storage initialization

1. Click **Initialize issue/TAT storage** once.
2. Verify these four tabs appear in the private TEST master: `Issue_Registry`, `Issue_Scan_Runs`, `TAT_Rules`, and `Issue_Reminder_Log`.
3. Verify their header rows match the exact names in `apps-script/IssueScanner.gs`. Click initialization a second time; it must not duplicate tabs or overwrite data.

**Pass:** initialization succeeds, the four expected tabs exist, and a second call is safe. If any existing tab has unexpected columns, stop and record the visible error instead of renaming/reordering columns blindly.

## Test B — baseline scan on the current synthetic rows

The current synthetic project was set up with three rows:

| Synthetic Set ID | Expected assignment/status | Expected baseline finding |
|---|---|---|
| `TEST-SET-001` | Active synthetic Labeller; `done` | No annotator/missing-field issue when all required fields are populated |
| `TEST-SET-002` | `someone-else@example.com`; `in progress` | `ANNOTATOR_NOT_ACTIVE` if that address is not an active Employees record |
| `TEST-SET-003` | Active synthetic Labeller; `in progress` | No TAT finding unless a matching explicit TAT rule is configured |

1. Keep `TAT_Rules` empty for the baseline run.
2. Click **Run issue/TAT scan** once.
3. Confirm the result is **COMPLETE** with one project completed, all three nonblank task rows scanned, and no project errors (if the synthetic source is still exactly these three rows).
4. In `Issue_Registry`, confirm the unknown/inactive annotator finding for `TEST-SET-002`. Do not expect TAT alerts without a configured TAT rule.
5. In `Issue_Scan_Runs`, confirm the latest row has outcome `COMPLETE`, the correct project/row counts, and no truncation.
6. Inspect the synthetic source `Tasks` tab. The scan must not change any source values, row count, or headers.

**Pass:** the output matches the current synthetic rows; the scan is complete; the source tab is unchanged. If `someone-else@example.com` was deliberately added as active, the expected `ANNOTATOR_NOT_ACTIVE` finding does not apply—use an address that is not an active employee only in synthetic TEST data.

## Test C — repeat scan and stable issue key

1. Without changing the synthetic source or Employees tab, run the same complete scan again.
2. Verify the existing `ANNOTATOR_NOT_ACTIVE` row is updated in place. The Issue Registry must not contain a duplicate for the same project, set ID and issue type.
3. Verify a new run-history row is appended to `Issue_Scan_Runs`.

**Pass:** one registry row per stable issue key, with a second run record.

## Test D — explicit synthetic TAT thresholds

Only run this test if the project's `Column_Map` includes a valid date field such as `Assigned Date`, and the source tab actually contains that mapped date header.

1. In `TAT_Rules`, add one temporary test row using the existing synthetic project ID:
   - `Project ID`: `TEST-PROJECT-01`
   - `Status`: `in progress`
   - `Start Canonical Field`: the mapped date field verified above
   - `Warning Hours`: `1`
   - `Critical Hours`: `2`
   - `Active`: `true`
2. In the fake `Tasks` source only, ensure `TEST-SET-003` has a valid mapped start date older than two hours. This is a manual edit to synthetic test data; the application itself must still remain read-only to source tabs.
3. Run a scan. Expected result for that row: `TAT_BREACH` with `CRITICAL` severity. For a date between one and two hours old, the expected result is `TAT_WARNING` with `HIGH` severity.
4. Blank the mapped start date on that synthetic row and scan again; expected finding is `TAT_START_MISSING`.
5. Restore the original synthetic date and remove the temporary TAT rule after evidence is recorded. If the needed canonical field/header is not available, skip this test and record the missing mapping; do not invent a mapping against an unrelated source column.

**Pass:** explicit rules alone drive TAT findings; invalid or missing start dates are reported; no business SLA is inferred from defaults.

## Test E — source correction and automatic resolution

1. On the synthetic source `Tasks` tab only, change the annotator for `TEST-SET-002` to an existing active synthetic employee, keeping the set ID and status populated.
2. Run the scan to completion.
3. Verify the previous `ANNOTATOR_NOT_ACTIVE` issue is marked `RESOLVED` with the automatic-resolution note and a resolved timestamp, rather than being deleted.
4. Confirm the latest run is `COMPLETE`, because automatic resolution is not safe when a project scan is partial.
5. Restore the original synthetic assignment if you want to preserve the baseline scenario for later checks.

**Pass:** a fully scanned corrected row resolves the issue; it does not delete history. Do not interpret a partial scan as evidence that an issue disappeared.

## Test F — digest preview only; no outbound email

1. Click **Preview digest**. Inspect the grouped recipients, issue counts and any admin-routed unknown assignment.
2. Confirm that preview reports what would be sent but sends no email.
3. Verify `ISSUE_EMAILS_ENABLED` remains absent or `false` and `ISSUE_SCAN_TRIGGER_ENABLED` remains absent or `false`.
4. Do **not** click Send Digest as a live-send test. Any email test requires separate approval and an explicitly synthetic recipient.

**Pass:** preview is readable; no messages are sent; no scheduled trigger is installed.

## Optional fail-safe checks

Perform these only after the baseline tests pass, using TEST data:

- In the synthetic project configuration, temporarily make the source tab unavailable, run a scan, and confirm the result is `PARTIAL` with a project error. Restore the source-tab setting immediately, rerun to a `COMPLETE` result, and verify prior issues are not automatically resolved while coverage is incomplete.
- Add a temporary synthetic row with a blank Set ID, annotator, or status to verify the matching missing-field finding. Remove the temporary row after verification.
- Confirm a Labeller cannot call admin scan/resolve/digest/schedule APIs by manipulating the browser UI alone. A hidden control is not sufficient if a direct server call still succeeds; the server must reject non-admin sessions.

Never alter the app-owned registry headers to manufacture errors. Do not use real employee data or change the real source project.

## Record results

Use a checklist to capture the date/time, deployed version, result, and any visible error text. Do not record access codes, session tokens, private spreadsheet IDs, or real employee data.

| Test | Result |
|---|---|
| Preflight properties verified | ☐ Pass / ☐ Fail |
| New TEST version deployed with same access restrictions | ☐ Pass / ☐ Fail |
| Issue/TAT storage initialization and repeat initialization | ☐ Pass / ☐ Fail |
| Baseline scan complete and source unchanged | ☐ Pass / ☐ Fail |
| Stable key and repeat scan | ☐ Pass / ☐ Fail |
| Explicit TAT rules (or documented mapping blocker) | ☐ Pass / ☐ Blocked |
| Source correction and automatic resolution | ☐ Pass / ☐ Fail |
| Digest preview only; email and schedule remain off | ☐ Pass / ☐ Fail |
| Optional partial scan / API role denial | ☐ Pass / ☐ Not run |

Phase 3 is accepted only when required tests pass in the deployed TEST web app. CI/static tests alone are insufficient. Keep the draft PR unmerged and do not proceed to production. Phase 4 live verification starts after this checklist has been reviewed.
