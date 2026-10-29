#!/usr/bin/env python3
"""Static repository checks for the browser-deployable Labeller Dashboard.

These checks catch source drift and key release-gate regressions. They do not
replace live Apps Script TEST verification or a restore drill.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []
CHECKS = 0


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if condition:
        print(f"PASS  {message}")
    else:
        ERRORS.append(message)
        print(f"FAIL  {message}")


def function_prefix(source: str, name: str, limit: int = 400) -> str:
    match = re.search(
        r"function\s+" + re.escape(name) + r"\s*\([^)]*\)\s*\{",
        source,
    )
    return source[match.end():match.end() + limit] if match else ""


def normalize_endings(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")


def check_bundle_sync() -> None:
    bundle = read("browser-deploy/Main.gs")
    marker = re.compile(r"^// ===== SOURCE: (.+?) =====\s*$", re.MULTILINE)
    matches = list(marker.finditer(bundle))
    embedded: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(bundle)
        content = bundle[match.end():end].lstrip("\n").rstrip("\n")
        embedded[match.group(1)] = content

    module_paths = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "apps-script").glob("*.gs")
    }
    check(bool(matches), "browser bundle contains source markers")
    check(len(embedded) == len(matches), "browser bundle source markers are unique")
    check(set(embedded) == module_paths, "browser bundle contains every modular .gs file and no missing module")

    mismatches = []
    for relative in sorted(module_paths & set(embedded)):
        if normalize_endings(embedded[relative]) != normalize_endings(read(relative)):
            mismatches.append(relative)
    check(not mismatches, "embedded bundle modules match modular source files" +
          (f" ({', '.join(mismatches)})" if mismatches else ""))


def check_deploy_copies() -> None:
    check(
        normalize_endings(read("apps-script/Index.html")) ==
        normalize_endings(read("browser-deploy/Index.html")),
        "dashboard HTML deployment copy matches source",
    )
    manifest_source = read("apps-script/appsscript.json")
    manifest_deploy = read("browser-deploy/appsscript.json")
    check(
        normalize_endings(manifest_source) == normalize_endings(manifest_deploy),
        "Apps Script manifest deployment copy matches source",
    )
    try:
        manifest = json.loads(manifest_source)
        check(manifest.get("timeZone") == "Asia/Kolkata", "Apps Script manifest uses Asia/Kolkata timezone")
        check(manifest.get("runtimeVersion") == "V8", "Apps Script manifest uses V8 runtime")
    except (json.JSONDecodeError, AttributeError) as error:
        check(False, f"Apps Script manifest is valid JSON ({error})")


def check_release_gates() -> None:
    config = read("apps-script/Config.gs")
    gate = function_prefix(config, "isIdentityGatePassed_", 1200)
    required_gate_fragments = [
        "props.getProperty(APP.IDENTITY_GATE_PROPERTY) !== 'true'",
        "APP_ENV_LABEL",
        "TEST_MASTER_SPREADSHEET_ID",
        "PROD_MASTER_SPREADSHEET_ID",
        "currentMasterId !== expectedMasterId",
        "PRODUCTION_RELEASE_APPROVED",
    ]
    check(bool(gate), "identity data-gate function exists")
    check(
        all(fragment in gate for fragment in required_gate_fragments),
        "identity gate fails closed unless environment, expected master ID, and PROD approval match",
    )

    issue = read("apps-script/IssueScanner.gs")
    digest = function_prefix(issue, "issueSendDigestInternal_", 1200)
    check(
        "ISSUE_EMAILS_ENABLED" in issue and
        "issueAutomationReleaseGuard_();" in digest and
        "isIdentityGatePassed_()" in digest and
        "!== 'true'" in digest,
        "issue email digest is opt-in and checks environment plus data gate",
    )
    scheduled = function_prefix(issue, "scheduledIssueScan_", 1000)
    check(
        "SCHEDULE_ENABLED_PROPERTY" in scheduled and "isIdentityGatePassed_()" in scheduled,
        "scheduled scanner checks explicit schedule flag and data gate",
    )

    health = read("apps-script/OperationsHealth.gs")
    backup = function_prefix(health, "createPrivateTestBackup", 1300)
    check(
        "env !== 'TEST'" in backup and
        "TEST_BACKUP_ENABLED" in backup and
        "isIdentityGatePassed_()" in backup,
        "private backup requires TEST environment, explicit opt-in, and matching data gate",
    )


def check_admin_guards() -> None:
    modules = {
        "apps-script/IssueScanner.gs": [
            "initializeIssueStorage", "runIssueScan", "getIssueDashboard",
            "sendIssueDigest", "installIssueScanTrigger", "disableIssueScanTrigger",
        ],
        "apps-script/AdminConsole.gs": [
            "initializeAdminStorage", "getAdminConsoleData", "saveEmployeeAdmin",
            "saveProjectAdmin", "setProjectAccessAdmin", "saveProjectMappingAdmin",
            "getTeamReport", "createTeamSnapshot", "listTeamSnapshots",
        ],
        "apps-script/OperationsHealth.gs": [
            "getOperationalHealth", "runConfigurationAudit", "getReleaseChecklist",
            "createPrivateTestBackup", "verifyPrivateTestBackup",
        ],
    }
    for path, names in modules.items():
        source = read(path)
        missing = [
            name for name in names
            if "requireAdmin_(authToken)" not in function_prefix(source, name, 600)
        ]
        check(
            not missing,
            f"admin APIs enforce requireAdmin_ in {path}" +
            (f" (missing/unguarded: {', '.join(missing)})" if missing else ""),
        )


def check_report_safety() -> None:
    admin = read("apps-script/AdminConsole.gs")
    snapshot = function_prefix(admin, "createTeamSnapshot", 1800)
    check(
        "if (report.partialData)" in snapshot and
        "MAX_SNAPSHOT_JSON" in snapshot,
        "team snapshots reject partial reports and enforce a payload-size limit",
    )


def main() -> int:
    check_bundle_sync()
    check_deploy_copies()
    check_release_gates()
    check_admin_guards()
    check_report_safety()
    print(f"\n{CHECKS - len(ERRORS)}/{CHECKS} checks passed.")
    if ERRORS:
        print("Failed checks:")
        for error in ERRORS:
            print(f"- {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
