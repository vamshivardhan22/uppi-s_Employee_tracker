#!/usr/bin/env node
"use strict";

// Regression tests for the Google-Sheets Date-vs-string normalization issue
// that previously affected overlapping leave-request validation.
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
      if (pattern !== "yyyy-MM-dd") {
        throw new Error("Unexpected format in date-key test: " + pattern);
      }
      return dateParts(date, timeZone);
    }
  }
};
vm.createContext(context);

const root = path.join(__dirname, "..");
const configSource = fs.readFileSync(path.join(root, "apps-script", "Config.gs"), "utf8");
const source = fs.readFileSync(path.join(root, "apps-script", "Attendance.gs"), "utf8");
vm.runInContext(
  configSource + "\n" + source + "\nthis.__dateKeyUnderTest = attendanceDateValueKey_; this.__makeDate = iso => new Date(iso);",
  context
);

let passed = 0;
function test(name, input, expected) {
  const actual = context.__dateKeyUnderTest(input);
  if (actual !== expected) {
    console.error("FAIL  " + name + ": expected " + JSON.stringify(expected) +
      ", received " + JSON.stringify(actual));
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log("PASS  " + name);
}

test(
  "Sheets Date values normalize to Asia/Kolkata work date",
  context.__makeDate("2026-10-28T00:00:00.000Z"),
  "2026-10-28"
);
test(
  "UTC evening Date value crosses to the correct India calendar date",
  context.__makeDate("2026-10-27T20:00:00.000Z"),
  "2026-10-28"
);
test("ISO date strings remain on their stated calendar day", "2026-10-28", "2026-10-28");
test(
  "ISO timestamps normalize using the configured timezone",
  "2026-10-27T20:00:00.000Z",
  "2026-10-28"
);
test("empty string stays empty", "", "");
test("null stays empty", null, "");
test("undefined stays empty", undefined, "");
test("invalid text is rejected", "not-a-date", "");
test("invalid ISO rollover date is rejected", "2026-02-30", "");
test(
  "invalid Date objects are rejected",
  context.__makeDate("not-a-date"),
  ""
);

console.log("\n" + passed + "/10 attendance date-key regression checks passed.");
if (passed !== 10) process.exitCode = 1;
