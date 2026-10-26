# Phase 0/1 Verification Plan

Use only synthetic data in a dedicated TEST master spreadsheet and fake source project sheet.

## A. Configuration checks

- [ ] Apps Script timezone is `Asia/Kolkata`.
- [ ] Script Property `MASTER_SPREADSHEET_ID` points to the private TEST master.
- [ ] Script Property `IDENTITY_GATE_PASSED` is exactly `false` before identity testing.
- [ ] All four required master tabs exist with exact headers.
- [ ] Duplicate or missing headers cause a visible configuration failure.
- [ ] Source spreadsheet and tab IDs are correct; owner account can open the source sheet.

## B. Identity gate checks (must pass before data access)

- [ ] Open the deployed `/exec` URL (not the editor's `/dev` URL) as the test admin.
- [ ] Record active-user email, effective-user email, timestamp, and deployment audience.
- [ ] Repeat in a separate normal/incognito session as the test labeller.
- [ ] Confirm active-user email is exact for each account and never confused with the script owner.
- [ ] Repeat after creating a new deployment version.
- [ ] If the active-user email is blank or wrong for either intended user type, keep the gate closed and stop.

## C. Privacy and authorization

- [ ] With gate false, `getMyWork` cannot return task records.
- [ ] With gate true, an unknown email is denied.
- [ ] An inactive employee is denied.
- [ ] Duplicate employee rows for an email are denied.
- [ ] Invalid roles are denied.
- [ ] Client-side changes cannot substitute another labeller's email (the API accepts no email argument).
- [ ] A labeller receives only projects with an active Access row for their authenticated email.
- [ ] A labeller receives no rows assigned to another email, including case/space variations other than normalized casing and surrounding whitespace.
- [ ] A source project read failure is visible and never silently presented as a complete dashboard.

## D. Metrics and mapping

- [ ] Create fake rows for all agreed statuses and hand-calculate expected assigned/completed counts.
- [ ] Confirm completed statuses match the final status list.
- [ ] Confirm distinct set count is distinct by project plus Dataset Set ID.
- [ ] Missing required mappings fail visibly.
- [ ] A mapped header missing from a source tab fails visibly.
- [ ] Rename a source header and verify the error is explicit.
- [ ] Test blank email, blank set ID, blank status and mixed-case/trailing-space email values.
- [ ] Confirm all returned values can be serialized through `google.script.run`.
- [ ] Check date rendering for actual date-only cells and date-time cells in Asia/Kolkata.

## E. UI and operational behavior

- [ ] First render performs identity diagnostic only.
- [ ] Refresh updates the last-refreshed timestamp.
- [ ] Empty assignments show a clear empty state.
- [ ] Project connection failures are visibly listed; partial totals are identified as partial before pilot.
- [ ] Table values are HTML-escaped; test source values containing angle brackets, quotes and ampersands.
- [ ] Test narrow/mobile screen layout.
- [ ] Record Apps Script execution duration and quota consumption on expected data size.

## Release rule

No real employee data, scheduled triggers, outgoing reminder emails, or production deployment until all applicable checks have passed and a reviewer has verified the exact metric definitions.
