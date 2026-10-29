#!/usr/bin/env node
"use strict";

// In-memory behavior tests for the leave-overlap guard. All rows are synthetic;
// the harness replaces spreadsheet/storage adapters and never writes to Sheets.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function dateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(date.getTime()));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return fields.year + "-" + fields.month + "-" + fields.day;
}

const context = {
  Utilities: {
    formatDate(date, timeZone, pattern) {
      if (pattern === "yyyy-MM-dd") return dateParts(date, timeZone);
      throw new Error("Unexpected format in leave overlap test: " + pattern);
    },
    getUuid() { return "synthetic-leave-id"; }
  }
};
vm.createContext(context);

const root = path.join(__dirname, "..");
const configSource = fs.readFileSync(path.join(root, "apps-script", "Config.gs"), "utf8");
const attendanceSource = fs.readFileSync(path.join(root, "apps-script", "Attendance.gs"), "utf8");
vm.runInContext(configSource + "\n" + attendanceSource, context);
vm.runInContext(`
  this.__configureLeaveTest = function(rows) {
    const leaveSheet = {
      rows: rows.map(row => ({
        Email: row.email,
        "Start Date": row.start ? new Date(row.start) : "",
        "End Date": row.end ? new Date(row.end) : "",
        Status: row.status
      }))
    };
    const sheets = {};
    sheets[ATTENDANCE.SHEETS.LEAVE] = leaveSheet;
    attendanceRows_ = sheet => sheet.rows || [];
    attendanceAppend_ = (sheet, values) => { sheet.rows.push(values); };
    attendanceWriteEvent_ = () => {};
    attendanceWithAction_ = function(authToken, action, requestId, callback) {
      return callback(
        { email: "labeller@example.com", role: "labeller" },
        sheets,
        String(requestId || "request_12345678"),
        new Date("2026-10-28T05:00:00.000Z")
      );
    };
    this.__leaveRows = leaveSheet.rows;
  };
  this.__submitLeave = attendanceSubmitLeaveRequest;
`, context);

let passed = 0;
function attempt(name, existingRows, payload, expectedMessage, expectedCount) {
  context.__configureLeaveTest(existingRows);
  let errorMessage = "";
  let result = null;
  try {
    result = context.__submitLeave("fake-session", payload, "request_12345678");
  } catch (error) {
    errorMessage = String(error && error.message ? error.message : error);
  }

  const actualCount = context.__leaveRows.length;
  const messageMatches = expectedMessage
    ? errorMessage.includes(expectedMessage)
    : !errorMessage;
  const countMatches = actualCount === expectedCount;
  if (!messageMatches || !countMatches) {
    console.error("FAIL  " + name +
      ": error=" + JSON.stringify(errorMessage) +
      ", rowCount=" + actualCount +
      ", expectedError=" + JSON.stringify(expectedMessage) +
      ", expectedRowCount=" + expectedCount);
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log("PASS  " + name);
}

const request = {
  startDate: "2026-10-28",
  endDate: "2026-10-29",
  leaveType: "full_day",
  reason: "synthetic regression test"
};

attempt(
  "overlapping pending leave stored as Date objects is rejected",
  [{ email: "labeller@example.com", start: "2026-10-27T18:30:00.000Z", end: "2026-10-28T18:29:00.000Z", status: "PENDING" }],
  request,
  "overlapping these dates",
  1
);
attempt(
  "overlapping approved leave stored as Date objects is rejected",
  [{ email: "labeller@example.com", start: "2026-10-28T00:00:00.000Z", end: "2026-10-29T00:00:00.000Z", status: "APPROVED" }],
  request,
  "overlapping these dates",
  1
);
attempt(
  "a non-overlapping prior leave does not block the request",
  [{ email: "labeller@example.com", start: "2026-10-25T18:30:00.000Z", end: "2026-10-26T18:29:00.000Z", status: "APPROVED" }],
  request,
  "",
  2
);
attempt(
  "another employee's overlapping leave does not block this employee",
  [{ email: "another@example.com", start: "2026-10-28T00:00:00.000Z", end: "2026-10-29T00:00:00.000Z", status: "PENDING" }],
  request,
  "",
  2
);
attempt(
  "rejected historical leave does not block a new request",
  [{ email: "labeller@example.com", start: "2026-10-28T00:00:00.000Z", end: "2026-10-29T00:00:00.000Z", status: "REJECTED" }],
  request,
  "",
  2
);
attempt(
  "an invalid existing leave date fails closed instead of allowing a new request",
  [{ email: "labeller@example.com", start: "not-a-date", end: "not-a-date", status: "APPROVED" }],
  request,
  "existing leave request has an invalid date",
  1
);
attempt("no existing leave allows a request to be saved", [], request, "", 1);

console.log("\n" + passed + "/7 leave-overlap behavior checks passed.");
if (passed !== 7) process.exitCode = 1;
