/**
 * Phase 3: read-only issue/TAT scanning, registry, reminder digest and opt-in scheduler.
 * All source project sheets are read-only. Issues/runs/rules/reminder logs live in the private master.
 * Email and schedule features are disabled unless explicitly enabled by an administrator.
 */
const ISSUE_SCAN = Object.freeze({
  SHEETS: Object.freeze({
    REGISTRY: 'Issue_Registry',
    RUNS: 'Issue_Scan_Runs',
    RULES: 'TAT_Rules',
    REMINDERS: 'Issue_Reminder_Log'
  }),
  HEADERS: Object.freeze({
    Issue_Registry: [
      'Issue Key', 'Project ID', 'Project Name', 'Entity Key', 'Dataset Set Id',
      'Issue Type', 'Severity', 'Status', 'Assigned To', 'Details', 'Source Row',
      'First Seen At', 'Last Seen At', 'Resolved At', 'Resolution Note'
    ],
    Issue_Scan_Runs: [
      'Scan ID', 'Started At', 'Finished At', 'Duration Ms', 'Projects Attempted',
      'Projects Completed', 'Rows Scanned', 'Issues Found', 'Issues Opened',
      'Issues Updated', 'Issues Resolved', 'Project Errors', 'Truncated',
      'Next Project ID', 'Next Row', 'Outcome'
    ],
    TAT_Rules: [
      'Project ID', 'Status', 'Start Canonical Field', 'Warning Hours',
      'Critical Hours', 'Active'
    ],
    Issue_Reminder_Log: [
      'Date Key', 'Recipient Email', 'Sent At', 'Issue Count', 'Issue Keys',
      'Status', 'Details'
    ]
  }),
  CURSOR_PROPERTY: 'ISSUE_SCAN_CURSOR',
  RUN_LEASE_PROPERTY: 'ISSUE_SCAN_RUN_LEASE',
  SCHEDULE_ENABLED_PROPERTY: 'ISSUE_SCAN_TRIGGER_ENABLED',
  EMAIL_ENABLED_PROPERTY: 'ISSUE_EMAILS_ENABLED',
  CHUNK_ROWS: 200,
  DEFAULT_MAX_ROWS: 1000,
  MAX_ALLOWED_ROWS: 5000,
  DEFAULT_BUDGET_MS: 180000,
  MAX_BUDGET_MS: 240000
});

function issueNow_() {
  return new Date();
}

function issueDateKey_(date) {
  return Utilities.formatDate(date, APP.TIME_ZONE, 'yyyy-MM-dd');
}

function issueTimestamp_(date) {
  return Utilities.formatDate(date, APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function issueFormatDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, APP.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(value == null ? '' : value);
}

function issueAsArray_(sheet, expectedHeaders) {
  const lastColumn = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastColumn === 0) {
    throw new Error('Tab "' + sheet.getName() + '" has no header row. Initialize Issue/TAT storage first.');
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(value => String(value == null ? '' : value).trim());
  if (headers.length !== expectedHeaders.length ||
      expectedHeaders.some((header, index) => headers[index] !== header)) {
    throw new Error('Tab "' + sheet.getName() + '" has unexpected headers. Do not rename or reorder its columns.');
  }
  const lastRow = sheet.getLastRow();
  const rawRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, expectedHeaders.length).getValues()
    : [];
  return {
    sheet: sheet,
    headers: headers,
    rows: rawRows.filter(row => row.some(value => value !== '' && value !== null))
  };
}

function issueGetSheets_() {
  const master = getMasterSpreadsheet_();
  const result = {};
  Object.keys(ISSUE_SCAN.HEADERS).forEach(name => {
    const sheet = master.getSheetByName(name);
    if (!sheet) throw new Error('Issue/TAT storage is not initialized. An administrator must initialize it first.');
    result[name] = issueAsArray_(sheet, ISSUE_SCAN.HEADERS[name]);
  });
  return result;
}

function initializeIssueStorage(authToken) {
  requireAdmin_(authToken);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const master = getMasterSpreadsheet_();
    const created = [];
    Object.keys(ISSUE_SCAN.HEADERS).forEach(name => {
      let sheet = master.getSheetByName(name);
      if (!sheet) {
        sheet = master.insertSheet(name);
        sheet.getRange(1, 1, 1, ISSUE_SCAN.HEADERS[name].length)
          .setValues([ISSUE_SCAN.HEADERS[name]]);
        sheet.setFrozenRows(1);
        created.push(name);
        return;
      }
      const lastColumn = sheet.getLastColumn();
      if (sheet.getLastRow() === 0 || lastColumn === 0) {
        sheet.getRange(1, 1, 1, ISSUE_SCAN.HEADERS[name].length)
          .setValues([ISSUE_SCAN.HEADERS[name]]);
        sheet.setFrozenRows(1);
        created.push(name);
        return;
      }
      const actual = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
        .map(value => String(value == null ? '' : value).trim());
      const expected = ISSUE_SCAN.HEADERS[name];
      if (actual.length !== expected.length ||
          expected.some((header, index) => actual[index] !== header)) {
        throw new Error('Existing tab "' + name + '" has different headers. No data was overwritten.');
      }
    });
    return {
      ok: true,
      created: created,
      message: created.length
        ? 'Issue/TAT storage initialized. New tabs: ' + created.join(', ')
        : 'Issue/TAT storage already exists and its headers were verified.'
    };
  } finally {
    lock.releaseLock();
  }
}

function issueActiveProjects_() {
  const master = getMasterSpreadsheet_();
  const sheet = master.getSheetByName(APP.SHEETS.PROJECTS);
  if (!sheet) throw new Error('Master configuration is missing the Projects tab.');
  const table = readTable_(sheet);
  const h = headerMap_(table.headers);
  ['Project ID', 'Project Name', 'Spreadsheet ID', 'Tab Name', 'Timezone', 'Active'].forEach(name => {
    if (h[name] === undefined) throw new Error('Projects tab is missing header: ' + name);
  });
  return table.rows.filter(row => isActiveValue_(row[h.Active])).map(row => ({
    projectId: String(row[h['Project ID']] || '').trim(),
    projectName: String(row[h['Project Name']] || '').trim(),
    spreadsheetId: String(row[h['Spreadsheet ID']] || '').trim(),
    tabName: String(row[h['Tab Name']] || '').trim(),
    timeZone: String(row[h.Timezone] || APP.TIME_ZONE).trim()
  })).filter(project => project.projectId && project.spreadsheetId && project.tabName);
}

function issueReadTATRules_() {
  const sheets = issueGetSheets_();
  const table = sheets[ISSUE_SCAN.SHEETS.RULES];
  const h = headerMap_(table.headers);
  const required = ['Project ID', 'Status', 'Start Canonical Field', 'Warning Hours', 'Critical Hours', 'Active'];
  required.forEach(name => {
    if (h[name] === undefined) throw new Error('TAT_Rules is missing header: ' + name);
  });
  const rules = new Map();
  const errors = [];
  table.rows.forEach((row, offset) => {
    if (!row.some(value => value !== '' && value !== null)) return;
    if (!isActiveValue_(row[h.Active])) return;
    const projectId = String(row[h['Project ID']] || '').trim();
    const status = String(row[h.Status] || '').trim().toLowerCase();
    const startField = String(row[h['Start Canonical Field']] || '').trim();
    const warning = Number(row[h['Warning Hours']]);
    const critical = Number(row[h['Critical Hours']]);
    if (!projectId || !status || !startField || !isFinite(warning) || !isFinite(critical) ||
        warning <= 0 || critical < warning) {
      errors.push({
        projectId: projectId,
        message: 'TAT_Rules row ' + (offset + 2) +
          ' needs Project ID, Status, Start Canonical Field, Warning Hours > 0, and Critical Hours >= Warning Hours.'
      });
      return;
    }
    const key = projectId + '|' + status;
    if (rules.has(key)) {
      errors.push({ projectId: projectId, message: 'Duplicate TAT rule for project/status: ' + key + '.' });
      rules.delete(key);
      rules.set(key, null);
      return;
    }
    rules.set(key, {
      projectId: projectId,
      status: status,
      startField: startField,
      warningHours: warning,
      criticalHours: critical
    });
  });
  return { rules: rules, errors: errors };
}

function issueParseDateMillis_(value, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getTime();
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const parsedDate = Utilities.parseDate(text, timeZone || APP.TIME_ZONE, 'yyyy-MM-dd');
      return parsedDate instanceof Date && !isNaN(parsedDate.getTime()) ? parsedDate.getTime() : null;
    }
    const parsed = new Date(text);
    return isNaN(parsed.getTime()) ? null : parsed.getTime();
  } catch (error) {
    return null;
  }
}

function issueStableKey_(projectId, entityKey, issueType) {
  return authDigestHex_(projectId + '|' + entityKey + '|' + issueType).slice(0, 40);
}

function issueAddFinding_(context, item) {
  item.issueKey = issueStableKey_(item.projectId, item.entityKey, item.issueType);
  if (!context.findings.has(item.issueKey)) context.findings.set(item.issueKey, item);
}

function issueRowIsBlank_(row) {
  return !row.some(value => value !== '' && value !== null);
}

function issueNumberProperty_(name, defaultValue, minValue, maxValue) {
  const raw = PropertiesService.getScriptProperties().getProperty(name);
  const parsed = Number(raw);
  const valid = raw !== null && raw !== '' && isFinite(parsed) && parsed >= minValue && parsed <= maxValue;
  return valid ? Math.floor(parsed) : defaultValue;
}

function issueGetCursor_() {
  const raw = PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.CURSOR_PROPERTY);
  if (!raw) return null;
  try {
    const cursor = JSON.parse(raw);
    if (cursor && cursor.projectId && Number(cursor.rowNumber) >= 2) {
      return { projectId: String(cursor.projectId), rowNumber: Math.floor(Number(cursor.rowNumber)) };
    }
  } catch (error) {}
  return null;
}

function issueAcquireRunLease_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty(ISSUE_SCAN.RUN_LEASE_PROPERTY);
    if (raw) {
      try {
        const existing = JSON.parse(raw);
        if (existing && Number(existing.startedAt) > Date.now() - 5 * 60 * 1000) {
          throw new Error('An issue scan is already running. Wait for it to finish before starting another.');
        }
      } catch (error) {
        if (String(error && error.message || error).indexOf('already running') >= 0) throw error;
      }
    }
    const runId = Utilities.getUuid();
    props.setProperty(ISSUE_SCAN.RUN_LEASE_PROPERTY, JSON.stringify({ runId: runId, startedAt: Date.now() }));
    return runId;
  } finally {
    lock.releaseLock();
  }
}

function issueReleaseRunLease_(runId) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty(ISSUE_SCAN.RUN_LEASE_PROPERTY);
    if (!raw) return;
    try {
      const lease = JSON.parse(raw);
      if (lease.runId === runId) props.deleteProperty(ISSUE_SCAN.RUN_LEASE_PROPERTY);
    } catch (error) {
      props.deleteProperty(ISSUE_SCAN.RUN_LEASE_PROPERTY);
    }
  } finally {
    lock.releaseLock();
  }
}

function issueSeverityRank_(severity) {
  return ({ CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 })[String(severity || '').toUpperCase()] || 0;
}

function issueBuildFindingsForRow_(context, project, mapping, headers, indexes, rulesForProject, row, sourceRowNumber, nowMillis) {
  context.scannedEntityKeys.add(project.projectId + '|ROW:' + sourceRowNumber);
  if (issueRowIsBlank_(row)) return;

  const setId = safeText_(row[indexes.setId]);
  const emailRaw = safeText_(row[indexes.annotatorEmail]);
  const email = normalizeEmail_(emailRaw);
  const status = safeText_(row[indexes.status]);
  const statusLower = status.toLowerCase();
  const entityKey = setId ? 'SET:' + setId.toLowerCase() : 'ROW:' + sourceRowNumber;
  context.scannedEntityKeys.add(project.projectId + '|' + entityKey);
  const base = {
    projectId: project.projectId,
    projectName: project.projectName,
    entityKey: entityKey,
    datasetSetId: setId,
    assignedTo: email,
    sourceRow: sourceRowNumber
  };

  if (!setId) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'MISSING_DATASET_SET_ID',
      severity: 'HIGH',
      details: 'Dataset Set Id is blank on source row ' + sourceRowNumber + '.'
    }));
  }
  if (!email) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'MISSING_ANNOTATOR',
      severity: 'HIGH',
      details: 'Annotator Mail is blank for this task.'
    }));
  } else if (!context.activeEmployeeEmails.has(email)) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'ANNOTATOR_NOT_ACTIVE',
      severity: 'MEDIUM',
      details: 'Annotator Mail does not match an active Employees record.'
    }));
  }
  if (!status) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'MISSING_STATUS',
      severity: 'MEDIUM',
      details: 'Status is blank for this task.'
    }));
  }

  const holdNote = indexes.holdNote >= 0 ? safeText_(row[indexes.holdNote]) : '';
  if (holdNote || statusLower === 'hold' || statusLower === 'on hold') {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'TASK_ON_HOLD',
      severity: 'MEDIUM',
      details: 'Task is marked on hold' + (holdNote ? ': ' + holdNote.slice(0, 300) : '.')
    }));
  }

  const rule = rulesForProject.get(statusLower);
  if (!rule || !setId || !status || APP.COMPLETED_STATUSES.includes(statusLower)) return;
  const startIndex = indexes.ruleStartIndexes.get(rule.startField);
  if (startIndex === undefined || startIndex < 0) {
    const errorKey = project.projectId + '|TAT_FIELD|' + rule.startField;
    if (!context.errorKeys.has(errorKey)) {
      context.errorKeys.add(errorKey);
      context.projectErrors.push({
        projectId: project.projectId,
        message: 'TAT rule uses unmapped canonical field "' + rule.startField + '" or a source header that does not exist.'
      });
    }
    context.incompleteProjects.add(project.projectId);
    return;
  }

  const startMillis = issueParseDateMillis_(row[startIndex], project.timeZone);
  if (startMillis === null) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'TAT_START_MISSING',
      severity: 'MEDIUM',
      details: 'TAT rule for status "' + status + '" requires a valid ' + rule.startField + ' value.'
    }));
    return;
  }
  const elapsedHours = (nowMillis - startMillis) / 3600000;
  if (elapsedHours < 0) return;
  if (elapsedHours >= rule.criticalHours) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'TAT_BREACH',
      severity: 'CRITICAL',
      details: 'Status "' + status + '" has been active for ' + elapsedHours.toFixed(1) +
        ' hours; the configured critical threshold is ' + rule.criticalHours + ' hours.'
    }));
  } else if (elapsedHours >= rule.warningHours) {
    issueAddFinding_(context, Object.assign({}, base, {
      issueType: 'TAT_WARNING',
      severity: 'HIGH',
      details: 'Status "' + status + '" has been active for ' + elapsedHours.toFixed(1) +
        ' hours; the configured warning threshold is ' + rule.warningHours + ' hours.'
    }));
  }
}

function issueGetActiveEmployeeEmails_() {
  const sheet = getMasterSpreadsheet_().getSheetByName(APP.SHEETS.EMPLOYEES);
  if (!sheet) throw new Error('Master configuration is missing the Employees tab.');
  const table = readTable_(sheet);
  const h = headerMap_(table.headers);
  ['Email', 'Role', 'Active'].forEach(name => {
    if (h[name] === undefined) throw new Error('Employees tab is missing header: ' + name);
  });
  const emails = new Set();
  table.rows.forEach(row => {
    if (isActiveValue_(row[h.Active])) {
      const email = normalizeEmail_(row[h.Email]);
      if (email) emails.add(email);
    }
  });
  return emails;
}

function issuePrepareProject_(project) {
  const sourceSpreadsheet = SpreadsheetApp.openById(project.spreadsheetId);
  const sheet = sourceSpreadsheet.getSheetByName(project.tabName);
  if (!sheet) throw new Error('Configured source tab "' + project.tabName + '" was not found.');
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1 || sheet.getLastRow() < 1) throw new Error('Source tab has no header row.');
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(value => String(value == null ? '' : value).trim());
  const nonBlank = headers.filter(Boolean).map(value => value.toLowerCase());
  if (new Set(nonBlank).size !== nonBlank.length) throw new Error('Duplicate header names found in source tab.');
  const mapping = getColumnMappings_(project.projectId);
  const setHeader = mapping[APP.FIELDS.SET_ID];
  const emailHeader = mapping[APP.FIELDS.ANNOTATOR_EMAIL];
  const statusHeader = mapping[APP.FIELDS.STATUS];
  if (!setHeader || !emailHeader || !statusHeader) {
    throw new Error('Column_Map must map Dataset Set Id, Annotator Mail and Status.');
  }
  const indexes = {
    setId: findHeaderIndex_(headers, setHeader),
    annotatorEmail: findHeaderIndex_(headers, emailHeader),
    status: findHeaderIndex_(headers, statusHeader),
    holdNote: mapping[APP.FIELDS.HOLD_NOTE]
      ? findHeaderIndex_(headers, mapping[APP.FIELDS.HOLD_NOTE]) : -1,
    ruleStartIndexes: new Map()
  };
  if ([indexes.setId, indexes.annotatorEmail, indexes.status].some(index => index < 0)) {
    throw new Error('A required mapped source header was not found.');
  }
  return { sheet: sheet, headers: headers, lastRow: sheet.getLastRow(), mapping: mapping, indexes: indexes };
}

function issueRecordArray_(headers, finding, now, priorRow) {
  const row = priorRow ? priorRow.slice() : headers.map(() => '');
  const set = (name, value) => { row[findHeaderIndex_(headers, name)] = value; };
  const priorStatus = priorRow ? String(priorRow[findHeaderIndex_(headers, 'Status')] || '') : '';
  set('Issue Key', finding.issueKey);
  set('Project ID', finding.projectId);
  set('Project Name', finding.projectName);
  set('Entity Key', finding.entityKey);
  set('Dataset Set Id', finding.datasetSetId);
  set('Issue Type', finding.issueType);
  set('Severity', finding.severity);
  set('Status', 'OPEN');
  set('Assigned To', finding.assignedTo);
  set('Details', finding.details);
  set('Source Row', finding.sourceRow);
  set('First Seen At', priorRow && priorStatus === 'OPEN'
    ? priorRow[findHeaderIndex_(headers, 'First Seen At')] : now);
  set('Last Seen At', now);
  set('Resolved At', '');
  if (!priorRow || priorStatus !== 'OPEN') set('Resolution Note', '');
  return row;
}

function issuePersistScan_(context, startedAt, scanId, elapsedMs, cursor) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Could not save issue scan results. Run the scan again.');
  try {
    const sheets = issueGetSheets_();
    const registry = sheets[ISSUE_SCAN.SHEETS.REGISTRY];
    const headers = registry.headers;
    const rows = registry.rows.map(row => row.slice());
    const indexOf = name => findHeaderIndex_(headers, name);
    const keyIndex = indexOf('Issue Key');
    const projectIndex = indexOf('Project ID');
    const entityIndex = indexOf('Entity Key');
    const statusIndex = indexOf('Status');
    const resolutionIndex = indexOf('Resolved At');
    const noteIndex = indexOf('Resolution Note');
    const existingIndex = new Map();
    rows.forEach((row, index) => existingIndex.set(String(row[keyIndex] || ''), index));
    const findingKeys = new Set();
    let opened = 0;
    let updated = 0;
    let resolved = 0;
    const now = issueNow_();

    Array.from(context.findings.values()).forEach(finding => {
      findingKeys.add(finding.issueKey);
      const priorIndex = existingIndex.get(finding.issueKey);
      if (priorIndex === undefined) {
        rows.push(issueRecordArray_(headers, finding, now, null));
        existingIndex.set(finding.issueKey, rows.length - 1);
        opened += 1;
      } else {
        const prior = rows[priorIndex];
        const wasOpen = String(prior[statusIndex] || '') === 'OPEN';
        rows[priorIndex] = issueRecordArray_(headers, finding, now, prior);
        if (wasOpen) updated += 1;
        else opened += 1;
      }
    });

    rows.forEach(row => {
      if (String(row[statusIndex] || '') !== 'OPEN') return;
      const issueKey = String(row[keyIndex] || '');
      if (findingKeys.has(issueKey)) return;
      const projectId = String(row[projectIndex] || '');
      if (context.incompleteProjects.has(projectId)) return;
      const entityKey = String(row[entityIndex] || '');
      const wasScanned = context.scannedEntityKeys.has(projectId + '|' + entityKey);
      const projectFullyScanned = context.fullProjectsCompleted.has(projectId);
      if (!wasScanned && !projectFullyScanned) return;
      row[statusIndex] = 'RESOLVED';
      row[resolutionIndex] = now;
      row[noteIndex] = wasScanned
        ? 'Automatically resolved: no longer detected on the scanned source row.'
        : 'Automatically resolved: not present after a complete project scan.';
      resolved += 1;
    });

    if (rows.length) {
      registry.sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    const finishedAt = issueNow_();
    const run = {
      'Scan ID': scanId,
      'Started At': startedAt,
      'Finished At': finishedAt,
      'Duration Ms': elapsedMs,
      'Projects Attempted': context.projectsAttempted,
      'Projects Completed': context.fullProjectsCompleted.size,
      'Rows Scanned': context.rowsScanned,
      'Issues Found': context.findings.size,
      'Issues Opened': opened,
      'Issues Updated': updated,
      'Issues Resolved': resolved,
      'Project Errors': context.projectErrors.map(item => item.projectId + ': ' + item.message).join(' | ').slice(0, 4000),
      'Truncated': Boolean(context.truncated),
      'Next Project ID': cursor && cursor.projectId || '',
      'Next Row': cursor && cursor.rowNumber || '',
      'Outcome': context.truncated || context.projectErrors.length ? 'PARTIAL' : 'COMPLETE'
    };
    const runHeaders = sheets[ISSUE_SCAN.SHEETS.RUNS].headers;
    sheets[ISSUE_SCAN.SHEETS.RUNS].sheet.appendRow(runHeaders.map(header =>
      Object.prototype.hasOwnProperty.call(run, header) ? run[header] : ''));
    return {
      ok: true,
      scanId: scanId,
      startedAt: issueTimestamp_(startedAt),
      finishedAt: issueTimestamp_(finishedAt),
      durationMs: elapsedMs,
      projectsAttempted: context.projectsAttempted,
      projectsCompleted: context.fullProjectsCompleted.size,
      rowsScanned: context.rowsScanned,
      issuesFound: context.findings.size,
      issuesOpened: opened,
      issuesUpdated: updated,
      issuesResolved: resolved,
      projectErrors: context.projectErrors,
      truncated: Boolean(context.truncated),
      nextProjectId: cursor && cursor.projectId || '',
      nextRow: cursor && cursor.rowNumber || '',
      outcome: run.Outcome,
      message: run.Outcome === 'COMPLETE'
        ? 'Issue/TAT scan completed.'
        : 'Scan saved as PARTIAL. Check project errors and continue from the saved cursor.'
    };
  } finally {
    lock.releaseLock();
  }
}

function issueRunScanInternal_() {
  if (!isIdentityGatePassed_()) throw new Error('Application data is locked. The TEST data gate must be enabled to scan synthetic projects.');
  const sheets = issueGetSheets_();
  const leaseId = issueAcquireRunLease_();
  const startMillis = Date.now();
  const startedAt = new Date(startMillis);
  const scanId = Utilities.getUuid();
  const properties = PropertiesService.getScriptProperties();
  const maxRows = issueNumberProperty_('ISSUE_SCAN_MAX_ROWS', ISSUE_SCAN.DEFAULT_MAX_ROWS, 1, ISSUE_SCAN.MAX_ALLOWED_ROWS);
  const timeBudgetMs = issueNumberProperty_('ISSUE_SCAN_BUDGET_MS', ISSUE_SCAN.DEFAULT_BUDGET_MS, 30000, ISSUE_SCAN.MAX_BUDGET_MS);
  const context = {
    findings: new Map(),
    scannedEntityKeys: new Set(),
    fullProjectsCompleted: new Set(),
    incompleteProjects: new Set(),
    projectErrors: [],
    errorKeys: new Set(),
    activeEmployeeEmails: issueGetActiveEmployeeEmails_(),
    rowsScanned: 0,
    projectsAttempted: 0,
    truncated: false
  };
  let cursor = null;
  try {
    const projectList = issueActiveProjects_();
    const ruleRead = issueReadTATRules_();
    ruleRead.errors.forEach(error => {
      context.projectErrors.push(error);
      if (error.projectId) context.incompleteProjects.add(error.projectId);
    });
    const ruleMap = ruleRead.rules;
    const priorCursor = issueGetCursor_();
    let startIndex = priorCursor ? projectList.findIndex(project => project.projectId === priorCursor.projectId) : 0;
    if (startIndex < 0) startIndex = 0;
    const ordered = projectList.slice(startIndex).concat(projectList.slice(0, startIndex));
    let truncatedAt = null;

    for (let orderedIndex = 0; orderedIndex < ordered.length; orderedIndex++) {
      const project = ordered[orderedIndex];
      const startRow = orderedIndex === 0 && priorCursor && project.projectId === priorCursor.projectId
        ? priorCursor.rowNumber : 2;
      if (context.rowsScanned >= maxRows || Date.now() - startMillis >= timeBudgetMs) {
        context.truncated = true;
        truncatedAt = { projectId: project.projectId, rowNumber: startRow };
        break;
      }
      context.projectsAttempted += 1;
      let prepared;
      try {
        prepared = issuePrepareProject_(project);
      } catch (error) {
        context.incompleteProjects.add(project.projectId);
        context.projectErrors.push({
          projectId: project.projectId,
          message: String(error && error.message ? error.message : error)
        });
        continue;
      }

      const rulesForProject = new Map();
      ruleMap.forEach((rule, key) => {
        if (rule && rule.projectId === project.projectId) rulesForProject.set(rule.status, rule);
      });
      rulesForProject.forEach(rule => {
        if (prepared.mapping[rule.startField]) {
          const idx = findHeaderIndex_(prepared.headers, prepared.mapping[rule.startField]);
          prepared.indexes.ruleStartIndexes.set(rule.startField, idx);
          if (idx < 0) {
            context.incompleteProjects.add(project.projectId);
            context.projectErrors.push({
              projectId: project.projectId,
              message: 'TAT rule source header is missing for canonical field "' + rule.startField + '".'
            });
          }
        } else {
          prepared.indexes.ruleStartIndexes.set(rule.startField, -1);
          const errKey = project.projectId + '|TAT_FIELD|' + rule.startField;
          if (!context.errorKeys.has(errKey)) {
            context.errorKeys.add(errKey);
            context.incompleteProjects.add(project.projectId);
            context.projectErrors.push({
              projectId: project.projectId,
              message: 'TAT rule uses unmapped canonical field "' + rule.startField + '".'
            });
          }
        }
      });

      if (prepared.lastRow < 2) {
        if (startRow <= 2) context.fullProjectsCompleted.add(project.projectId);
        continue;
      }

      let rowNumber = Math.max(2, startRow);
      let hitEnd = false;
      while (rowNumber <= prepared.lastRow) {
        if (context.rowsScanned >= maxRows || Date.now() - startMillis >= timeBudgetMs) {
          context.truncated = true;
          truncatedAt = { projectId: project.projectId, rowNumber: rowNumber };
          break;
        }
        const chunkSize = Math.min(
          ISSUE_SCAN.CHUNK_ROWS,
          prepared.lastRow - rowNumber + 1,
          maxRows - context.rowsScanned
        );
        if (chunkSize < 1) {
          context.truncated = true;
          truncatedAt = { projectId: project.projectId, rowNumber: rowNumber };
          break;
        }
        const values = prepared.sheet.getRange(rowNumber, 1, chunkSize, prepared.headers.length).getValues();
        const nowMillis = Date.now();
        values.forEach((row, offset) => {
          const currentRowNumber = rowNumber + offset;
          issueBuildFindingsForRow_(context, project, prepared.mapping, prepared.headers,
            prepared.indexes, rulesForProject, row, currentRowNumber, nowMillis);
        });
        context.rowsScanned += values.length;
        rowNumber += values.length;
        if (rowNumber <= prepared.lastRow &&
            (context.rowsScanned >= maxRows || Date.now() - startMillis >= timeBudgetMs)) {
          context.truncated = true;
          truncatedAt = { projectId: project.projectId, rowNumber: rowNumber };
          break;
        }
        if (rowNumber > prepared.lastRow) hitEnd = true;
      }
      if (hitEnd && startRow <= 2 && !context.incompleteProjects.has(project.projectId)) {
        context.fullProjectsCompleted.add(project.projectId);
      }
      if (context.truncated) break;
    }

    if (context.truncated) {
      cursor = truncatedAt || { projectId: projectList[0] ? projectList[0].projectId : '', rowNumber: 2 };
    } else {
      cursor = projectList.length ? { projectId: projectList[0].projectId, rowNumber: 2 } : null;
    }
    if (cursor && cursor.projectId) properties.setProperty(ISSUE_SCAN.CURSOR_PROPERTY, JSON.stringify(cursor));
    else properties.deleteProperty(ISSUE_SCAN.CURSOR_PROPERTY);

    const elapsed = Date.now() - startMillis;
    return issuePersistScan_(context, startedAt, scanId, elapsed, context.truncated ? cursor : null);
  } finally {
    issueReleaseRunLease_(leaseId);
  }
}

function runIssueScan(authToken) {
  requireAdmin_(authToken);
  return issueRunScanInternal_();
}

function issueRegistryObjects_(sheets) {
  const table = sheets[ISSUE_SCAN.SHEETS.REGISTRY];
  const h = headerMap_(table.headers);
  return table.rows.map(row => ({
    issueKey: String(row[h['Issue Key']] || ''),
    projectId: String(row[h['Project ID']] || ''),
    projectName: String(row[h['Project Name']] || ''),
    entityKey: String(row[h['Entity Key']] || ''),
    datasetSetId: String(row[h['Dataset Set Id']] || ''),
    issueType: String(row[h['Issue Type']] || ''),
    severity: String(row[h.Severity] || ''),
    status: String(row[h.Status] || ''),
    assignedTo: normalizeEmail_(row[h['Assigned To']]),
    details: String(row[h.Details] || ''),
    sourceRow: String(row[h['Source Row']] || ''),
    firstSeenAt: issueFormatDateTime_(row[h['First Seen At']]),
    lastSeenAt: issueFormatDateTime_(row[h['Last Seen At']]),
    resolvedAt: issueFormatDateTime_(row[h['Resolved At']]),
    resolutionNote: String(row[h['Resolution Note']] || '')
  }));
}

function getIssueDashboard(authToken) {
  const user = requireAdmin_(authToken);
  const master = getMasterSpreadsheet_();
  const missing = Object.keys(ISSUE_SCAN.HEADERS).filter(name => !master.getSheetByName(name));
  if (missing.length) {
    return {
      ok: true,
      storageReady: false,
      message: 'Issue/TAT storage is not initialized. Click Initialize issue/TAT storage.',
      user: { email: user.email, role: user.role },
      issues: [],
      summary: { open: 0, critical: 0, high: 0, medium: 0, resolved: 0 },
      lastScan: null,
      emailEnabled: PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true',
      scheduleEnabled: PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY) === 'true'
    };
  }

  const sheets = issueGetSheets_();
  const all = issueRegistryObjects_(sheets);
  const open = all.filter(item => item.status === 'OPEN');
  open.sort((a, b) => issueSeverityRank_(b.severity) - issueSeverityRank_(a.severity) ||
    String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  const runs = sheets[ISSUE_SCAN.SHEETS.RUNS];
  const lastRun = runs.rows.length ? runs.rows[runs.rows.length - 1] : null;
  const runHeader = headerMap_(runs.headers);
  const lastScan = lastRun ? {
    scanId: String(lastRun[runHeader['Scan ID']] || ''),
    startedAt: issueFormatDateTime_(lastRun[runHeader['Started At']]),
    finishedAt: issueFormatDateTime_(lastRun[runHeader['Finished At']]),
    durationMs: Number(lastRun[runHeader['Duration Ms']] || 0),
    rowsScanned: Number(lastRun[runHeader['Rows Scanned']] || 0),
    issuesFound: Number(lastRun[runHeader['Issues Found']] || 0),
    outcome: String(lastRun[runHeader.Outcome] || '')
  } : null;
  return {
    ok: true,
    storageReady: true,
    user: { email: user.email, role: user.role },
    issues: open.slice(0, 100),
    summary: {
      open: open.length,
      critical: open.filter(item => item.severity === 'CRITICAL').length,
      high: open.filter(item => item.severity === 'HIGH').length,
      medium: open.filter(item => item.severity === 'MEDIUM').length,
      resolved: all.filter(item => item.status === 'RESOLVED').length
    },
    lastScan: lastScan,
    emailEnabled: PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true',
    scheduleEnabled: PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY) === 'true'
  };
}

function resolveIssue(authToken, issueKey, resolutionNote) {
  requireAdmin_(authToken);
  const key = String(issueKey == null ? '' : issueKey).trim();
  if (!key) throw new Error('Issue key is required.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const table = issueGetSheets_()[ISSUE_SCAN.SHEETS.REGISTRY];
    const keyIndex = findHeaderIndex_(table.headers, 'Issue Key');
    const statusIndex = findHeaderIndex_(table.headers, 'Status');
    const resolvedIndex = findHeaderIndex_(table.headers, 'Resolved At');
    const noteIndex = findHeaderIndex_(table.headers, 'Resolution Note');
    const rowIndex = table.rows.findIndex(row => String(row[keyIndex] || '') === key);
    if (rowIndex < 0) throw new Error('Issue was not found.');
    const row = table.rows[rowIndex];
    if (String(row[statusIndex] || '') !== 'OPEN') throw new Error('Only open issues can be resolved.');
    row[statusIndex] = 'RESOLVED';
    row[resolvedIndex] = issueNow_();
    row[noteIndex] = String(resolutionNote || '').trim().slice(0, 500);
    table.sheet.getRange(rowIndex + 2, 1, 1, table.headers.length).setValues([row]);
    return { ok: true, message: 'Issue marked resolved.' };
  } finally {
    lock.releaseLock();
  }
}

function issueReadActiveEmployees_() {
  const master = getMasterSpreadsheet_();
  const sheet = master.getSheetByName(APP.SHEETS.EMPLOYEES);
  if (!sheet) throw new Error('Master configuration is missing the Employees tab.');
  const table = readTable_(sheet);
  const h = headerMap_(table.headers);
  ['Email', 'Display Name', 'Role', 'Active'].forEach(name => {
    if (h[name] === undefined) throw new Error('Employees tab is missing header: ' + name);
  });
  return table.rows.filter(row => isActiveValue_(row[h.Active])).map(row => ({
    email: normalizeEmail_(row[h.Email]),
    displayName: String(row[h['Display Name']] || row[h.Email] || '').trim(),
    role: String(row[h.Role] || '').trim().toLowerCase()
  })).filter(user => user.email && ['admin', 'labeller'].includes(user.role));
}

function issueDigestGroups_() {
  const sheets = issueGetSheets_();
  const issues = issueRegistryObjects_(sheets).filter(item => item.status === 'OPEN');
  const employees = issueReadActiveEmployees_();
  const employeeByEmail = new Map(employees.map(user => [user.email, user]));
  const admins = employees.filter(user => user.role === 'admin');
  const groups = new Map();
  function add(user, issue) {
    if (!groups.has(user.email)) groups.set(user.email, { email: user.email, displayName: user.displayName, issues: [] });
    groups.get(user.email).issues.push(issue);
  }
  issues.forEach(issue => {
    const assigned = employeeByEmail.get(issue.assignedTo);
    if (assigned) {
      add(assigned, issue);
    } else {
      admins.forEach(admin => add(admin, issue));
    }
  });
  return Array.from(groups.values()).sort((a, b) => a.email.localeCompare(b.email));
}

function previewIssueDigest(authToken) {
  requireAdmin_(authToken);
  const groups = issueDigestGroups_();
  return {
    ok: true,
    emailEnabled: PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true',
    openIssues: groups.reduce((sum, group) => sum + group.issues.length, 0),
    recipients: groups.map(group => ({ email: group.email, issueCount: group.issues.length })),
    message: PropertiesService.getScriptProperties().getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true'
      ? 'Digest preview is ready. Sending still requires an explicit admin action; scheduled email remains separately gated.'
      : 'Digest preview is ready. Email sending is disabled because ISSUE_EMAILS_ENABLED is not true.'
  };
}

function issueReserveReminder_(recipient, dateKey, issueCount, issueKeys) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const table = issueGetSheets_()[ISSUE_SCAN.SHEETS.REMINDERS];
    const h = headerMap_(table.headers);
    const duplicate = table.rows.some(row =>
      String(row[h['Date Key']] || '') === dateKey &&
      normalizeEmail_(row[h['Recipient Email']]) === recipient);
    if (duplicate) return null;
    const record = {
      'Date Key': dateKey,
      'Recipient Email': recipient,
      'Sent At': issueNow_(),
      'Issue Count': issueCount,
      'Issue Keys': issueKeys.join(',').slice(0, 4000),
      'Status': 'SENDING',
      'Details': ''
    };
    table.sheet.appendRow(table.headers.map(header =>
      Object.prototype.hasOwnProperty.call(record, header) ? record[header] : ''));
    return table.sheet.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

function issueFinishReminder_(rowNumber, status, details) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('The application is busy. The reminder log may need admin review.');
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(ISSUE_SCAN.SHEETS.REMINDERS);
    if (!sheet) throw new Error('Issue reminder log is missing.');
    const h = headerMap_(ISSUE_SCAN.HEADERS[ISSUE_SCAN.SHEETS.REMINDERS]);
    sheet.getRange(rowNumber, h.Status + 1).setValue(status);
    sheet.getRange(rowNumber, h.Details + 1).setValue(String(details || '').slice(0, 1000));
  } finally {
    lock.releaseLock();
  }
}

function issueSendDigestInternal_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) !== 'true') {
    return { ok: false, sent: 0, skipped: 0, message: 'Email reminders are disabled. No email was sent.' };
  }
  const groups = issueDigestGroups_();
  if (!groups.length) return { ok: true, sent: 0, skipped: 0, message: 'No open issues need a reminder.' };
  const remainingQuota = MailApp.getRemainingDailyQuota();
  const maxRecipients = issueNumberProperty_('ISSUE_EMAIL_MAX_RECIPIENTS', 10, 1, 20);
  let sent = 0;
  let skipped = 0;
  const dateKey = issueDateKey_(issueNow_());
  const label = String(props.getProperty('APP_ENV_LABEL') || 'TEST').trim().slice(0, 30);
  for (const group of groups) {
    if (sent >= maxRecipients || sent >= remainingQuota) {
      skipped += 1;
      continue;
    }
    const keyList = group.issues.map(issue => issue.issueKey);
    const reservationRow = issueReserveReminder_(group.email, dateKey, group.issues.length, keyList);
    if (!reservationRow) {
      skipped += 1;
      continue;
    }
    const list = group.issues.slice(0, 50).map(issue =>
      '- [' + issue.severity + '] ' + issue.projectName + ' / ' +
      (issue.datasetSetId || ('source row ' + issue.sourceRow)) + ' / ' +
      issue.issueType + ': ' + issue.details);
    const body = 'Labeller Dashboard ' + label + ' issue digest\n' +
      'Date: ' + dateKey + ' (' + APP.TIME_ZONE + ')\n' +
      'Open issues for your account: ' + group.issues.length + '\n\n' +
      list.join('\n') +
      (group.issues.length > 50 ? '\n\nAdditional issues omitted from this email. Open the dashboard for the complete list.' : '') +
      '\n\nThis reminder was generated by the Labeller Dashboard. Do not reply with access codes or passwords.';
    try {
      MailApp.sendEmail({
        to: group.email,
        subject: '[' + label + '] Labeller Dashboard issue digest (' + group.issues.length + ')',
        body: body,
        name: 'Labeller Dashboard'
      });
      issueFinishReminder_(reservationRow, 'SENT', 'Sent successfully.');
      sent += 1;
    } catch (error) {
      try {
        issueFinishReminder_(reservationRow, 'FAILED', String(error && error.message ? error.message : error));
      } catch (logError) {}
      skipped += 1;
    }
  }
  return {
    ok: true,
    sent: sent,
    skipped: skipped,
    quotaAtStart: remainingQuota,
    maxRecipients: maxRecipients,
    message: 'Digest run finished. Sent: ' + sent + '; skipped or failed: ' + skipped +
      '. A recipient is reserved once per calendar day to prevent duplicate sends.'
  };
}

function sendIssueDigest(authToken) {
  requireAdmin_(authToken);
  return issueSendDigestInternal_();
}

function installIssueScanTrigger(authToken, intervalHours) {
  requireAdmin_(authToken);
  if (!isIdentityGatePassed_()) throw new Error('Enable the TEST data gate before installing a scan schedule.');
  issueGetSheets_();
  const hours = Number(intervalHours);
  if (![6, 12].includes(hours)) throw new Error('Choose a scan interval of 6 or 12 hours.');
  const runTable = issueGetSheets_()[ISSUE_SCAN.SHEETS.RUNS];
  const runH = headerMap_(runTable.headers);
  if (!runTable.rows.length || String(runTable.rows[runTable.rows.length - 1][runH.Outcome] || '') !== 'COMPLETE') {
    throw new Error('Run a complete manual issue/TAT scan before enabling a schedule.');
  }
  const triggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === 'scheduledIssueScan_');
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('scheduledIssueScan_').timeBased().everyHours(hours).create();
  PropertiesService.getScriptProperties().setProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY, 'true');
  PropertiesService.getScriptProperties().setProperty('ISSUE_SCAN_INTERVAL_HOURS', String(hours));
  return { ok: true, message: 'Scheduled issue/TAT scan enabled every ' + hours + ' hours. Email remains controlled separately by ISSUE_EMAILS_ENABLED.' };
}

function disableIssueScanTrigger(authToken) {
  requireAdmin_(authToken);
  const triggers = ScriptApp.getProjectTriggers().filter(trigger =>
    trigger.getHandlerFunction() === 'scheduledIssueScan_');
  triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
  PropertiesService.getScriptProperties().setProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY, 'false');
  return { ok: true, message: 'Scheduled issue/TAT scan disabled.' };
}

function scheduledIssueScan_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY) !== 'true' || !isIdentityGatePassed_()) return;
  try {
    const result = issueRunScanInternal_();
    Logger.log('Scheduled issue scan finished: %s', JSON.stringify(result));
    if (props.getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true') {
      const digest = issueSendDigestInternal_();
      Logger.log('Scheduled digest result: %s', JSON.stringify(digest));
    }
  } catch (error) {
    Logger.log('Scheduled issue scan failed: %s', String(error && error.message ? error.message : error));
  }
}
