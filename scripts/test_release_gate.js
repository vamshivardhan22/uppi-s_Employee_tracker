#!/usr/bin/env node
"use strict";

// In-memory behavior tests for the fail-closed identity/environment gate.
// This uses fake Script Properties; it is not a live Apps Script deployment test.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const properties = Object.create(null);
const context = {
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) {
          return Object.prototype.hasOwnProperty.call(properties, key) ? properties[key] : null;
        }
      };
    }
  }
};
vm.createContext(context);
const configPath = path.join(__dirname, "..", "apps-script", "Config.gs");
const configSource = fs.readFileSync(configPath, "utf8");
vm.runInContext(configSource + "\nthis.__gateUnderTest = isIdentityGatePassed_;", context);

let passed = 0;
function test(name, values, expected) {
  for (const key of Object.keys(properties)) delete properties[key];
  Object.assign(properties, values);
  const actual = context.__gateUnderTest();
  if (actual !== expected) {
    console.error("FAIL  " + name + ": expected " + expected + ", received " + actual);
    process.exitCode = 1;
    return;
  }
  passed += 1;
  console.log("PASS  " + name);
}

test("missing settings fail closed", {}, false);
test("identity gate property must be exact lowercase true", {
  IDENTITY_GATE_PASSED: "TRUE",
  APP_ENV_LABEL: "TEST",
  MASTER_SPREADSHEET_ID: "test-master-a",
  TEST_MASTER_SPREADSHEET_ID: "test-master-a"
}, false);
test("TEST opens only when identity gate and master binding match", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "TEST",
  MASTER_SPREADSHEET_ID: "test-master-a",
  TEST_MASTER_SPREADSHEET_ID: "test-master-a"
}, true);
test("TEST master mismatch fails closed", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "TEST",
  MASTER_SPREADSHEET_ID: "test-master-a",
  TEST_MASTER_SPREADSHEET_ID: "test-master-b"
}, false);
test("TEST with missing expected master fails closed", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "TEST",
  MASTER_SPREADSHEET_ID: "test-master-a"
}, false);
test("unknown environment fails closed", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "STAGING",
  MASTER_SPREADSHEET_ID: "test-master-a",
  TEST_MASTER_SPREADSHEET_ID: "test-master-a"
}, false);
test("PROD without explicit approval fails closed", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "PROD",
  MASTER_SPREADSHEET_ID: "prod-master-a",
  PROD_MASTER_SPREADSHEET_ID: "prod-master-a"
}, false);
test("PROD with matching master and explicit approval passes", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "PROD",
  MASTER_SPREADSHEET_ID: "prod-master-a",
  PROD_MASTER_SPREADSHEET_ID: "prod-master-a",
  PRODUCTION_RELEASE_APPROVED: "true"
}, true);
test("PROD master mismatch fails even with approval", {
  IDENTITY_GATE_PASSED: "true",
  APP_ENV_LABEL: "PROD",
  MASTER_SPREADSHEET_ID: "prod-master-a",
  PROD_MASTER_SPREADSHEET_ID: "prod-master-b",
  PRODUCTION_RELEASE_APPROVED: "true"
}, false);

console.log("\n" + passed + "/9 identity-gate behavior checks passed.");
if (passed !== 9) process.exitCode = 1;
