/**
 * Phase 4 admin console: people, projects, access grants, mappings, team reports and snapshots.
 * Only admin sessions may call these APIs. Data remains in the private master spreadsheet.
 */
const ADMIN_CONSOLE = Object.freeze({
  SHEETS: Object.freeze({
    AUDIT: 'Admin_Audit_Log',
    SNAPSHOTS: 'Team_Snapshots'
  }),
  HEADERS: Object.freeze({
    Admin_Audit_Log: [
      'Event ID', 'Actor Email', 'Action', 'Entity Type', 'Entity Key',
      'Before JSON', 'After JSON', 'Created At'
    ],
    Team_Snapshots: [
      'Snapshot ID', 'Captured At', 'Window Start', 'Window End',
      'Date Field', 'Created By', 'Payload JSON'
    ],
    Backup_Log: [
      'Backup ID', 'Created At', 'Created By', 'Environment', 'Source Master ID',
      'Backup Spreadsheet ID', 'Backup URL', 'Status', 'Details'
    ]
  }),
  MAX_SNAPSHOT_JSON: 40000
});

function adminEnsureSheet_(master, name, expectedHeaders, created) {
  let sheet = master.getSheetByName(name);
  if (!sheet) {
    sheet = master.insertSheet(name);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    created.push(name);
    return sheet;
  }
  const width = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || width === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    created.push(name);
    return sheet;
  }
  const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
    .map(value => String(value == null ? '' : value).trim());
  if (actual.length !== expectedHeaders.length ||
      expectedHeaders.some((header, index) => actual[index] !== header)) {
    throw new Error('Existing tab "' + name + '" has unexpected headers. No data was overwritten.');
  }
  return sheet;
}

function initializeAdminStorage(authToken) {
  requireAdmin_(authToken);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const master = getMasterSpreadsheet_();
    const created = [];
    Object.keys(ADMIN_CONSOLE.HEADERS).forEach(name => {
      adminEnsureSheet_(master, name, ADMIN_CONSOLE.HEADERS[name], created);
    });
    return {
      ok: true,
      created: created,
      message: created.length
        ? 'Admin storage initialized. New tabs: ' + created.join(', ')
        : 'Admin storage already exists and headers were verified.'
    };
  } finally {
    lock.releaseLock();
  }
}

function adminRequireStorage_() {
  const master = getMasterSpreadsheet_();
  Object.keys(ADMIN_CONSOLE.HEADERS).forEach(name => {
    const sheet = master.getSheetByName(name);
    if (!sheet) throw new Error('Admin storage is not initialized. Use Initialize admin storage first.');
    const expected = ADMIN_CONSOLE.HEADERS[name];
    const width = sheet.getLastColumn();
    const actual = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
      .map(value => String(value == null ? '' : value).trim()) : [];
    if (actual.length !== expected.length ||
        expected.some((header, index) => actual[index] !== header)) {
      throw new Error('Admin tab "' + name + '" has unexpected headers. No data was changed.');
    }
  });
  return master;
}

function adminWriteAudit_(actor, action, entityType, entityKey, beforeValue, afterValue) {
  const sheet = getMasterSpreadsheet_().getSheetByName(ADMIN_CONSOLE.SHEETS.AUDIT);
  if (!sheet) throw new Error('Admin audit log is missing. Initialize Admin storage before making changes.');
  sheet.appendRow([
    Utilities.getUuid(), actor.email, action, entityType, String(entityKey || ''),
    JSON.stringify(beforeValue == null ? null : beforeValue).slice(0, 10000),
    JSON.stringify(afterValue == null ? null : afterValue).slice(0, 10000),
    new Date()
  ]);
}

function adminWriteAuditSafely_(actor, action, entityType, entityKey, beforeValue, afterValue) {
  try {
    adminWriteAudit_(actor, action, entityType, entityKey, beforeValue, afterValue);
    return '';
  } catch (error) {
    try { Logger.log('Admin audit write failed after action %s: %s', action, String(error && error.message ? error.message : error)); } catch (logError) {}
    return ' WARNING: the change may have saved, but its audit row could not be written. Check the record and Admin_Audit_Log before retrying.';
  }
}

function adminReadRows_(sheet, requiredHeaders) {
  const table = readTable_(sheet);
  const map = headerMap_(table.headers);
  requiredHeaders.forEach(name => {
    if (map[name] === undefined) throw new Error('Tab "' + sheet.getName() + '" is missing header: ' + name);
  });
  return { sheet: sheet, headers: table.headers, headerMap: map, rows: table.rows };
}

function adminEmployeeObjects_() {
  const master = getMasterSpreadsheet_();
  const data = adminReadRows_(master.getSheetByName(APP.SHEETS.EMPLOYEES),
    ['Email', 'Display Name', 'Role', 'Active']);
  return data.rows.map(row => ({
    email: normalizeEmail_(row[data.headerMap.Email]),
    displayName: String(row[data.headerMap['Display Name']] || ''),
    role: String(row[data.headerMap.Role] || '').trim().toLowerCase(),
    active: isActiveValue_(row[data.headerMap.Active])
  })).filter(row => row.email);
}

function adminProjectObjects_() {
  const master = getMasterSpreadsheet_();
  const data = adminReadRows_(master.getSheetByName(APP.SHEETS.PROJECTS),
    ['Project ID', 'Project Name', 'Spreadsheet ID', 'Tab Name', 'Timezone', 'Active']);
  return data.rows.map(row => ({
    projectId: String(row[data.headerMap['Project ID']] || '').trim(),
    projectName: String(row[data.headerMap['Project Name']] || '').trim(),
    spreadsheetId: String(row[data.headerMap['Spreadsheet ID']] || '').trim(),
    tabName: String(row[data.headerMap['Tab Name']] || '').trim(),
    timeZone: String(row[data.headerMap.Timezone] || APP.TIME_ZONE).trim(),
    active: isActiveValue_(row[data.headerMap.Active])
  })).filter(row => row.projectId);
}

function adminAccessObjects_() {
  const master = getMasterSpreadsheet_();
  const data = adminReadRows_(master.getSheetByName(APP.SHEETS.ACCESS),
    ['Email', 'Project ID', 'Active']);
  return data.rows.map(row => ({
    email: normalizeEmail_(row[data.headerMap.Email]),
    projectId: String(row[data.headerMap['Project ID']] || '').trim(),
    active: isActiveValue_(row[data.headerMap.Active])
  })).filter(row => row.email && row.projectId);
}

function adminMappingObjects_() {
  const master = getMasterSpreadsheet_();
  const data = adminReadRows_(master.getSheetByName(APP.SHEETS.COLUMN_MAP),
    ['Project ID', 'Canonical Field', 'Sheet Header', 'Required']);
  return data.rows.map(row => ({
    projectId: String(row[data.headerMap['Project ID']] || '').trim(),
    canonicalField: String(row[data.headerMap['Canonical Field']] || '').trim(),
    sheetHeader: String(row[data.headerMap['Sheet Header']] || '').trim(),
    required: adminBoolean_(row[data.headerMap.Required])
  })).filter(row => row.projectId && row.canonicalField);
}

function getAdminConsoleData(authToken) {
  const user = requireAdmin_(authToken);
  const master = getMasterSpreadsheet_();
  const employees = adminEmployeeObjects_();
  const projects = adminProjectObjects_();
  const access = adminAccessObjects_();
  const missingStorage = Object.keys(ADMIN_CONSOLE.HEADERS)
    .filter(name => !master.getSheetByName(name));
  return {
    ok: true,
    user: { email: user.email, role: user.role },
    storageReady: missingStorage.length === 0,
    missingStorage: missingStorage,
    employees: employees,
    projects: projects,
    access: access,
    mappings: adminMappingObjects_()
  };
}

function adminBoolean_(value) {
  if (value === true) return true;
  return ['true', 'yes', '1', 'active'].includes(String(value == null ? '' : value).trim().toLowerCase());
}

function adminValidateEmail_(value) {
  const email = normalizeEmail_(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid employee email address.');
  }
  return email;
}

function adminGetRawTable_(sheet, requiredHeaders) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const width = sheet.getLastColumn();
  if (!width) throw new Error('Tab "' + sheet.getName() + '" has no header row.');
  const values = sheet.getRange(1, 1, lastRow, width).getValues();
  const headers = values[0].map(value => String(value == null ? '' : value).trim());
  const indexes = {};
  requiredHeaders.forEach(name => {
    indexes[name] = findHeaderIndex_(headers, name);
    if (indexes[name] < 0) throw new Error('Tab "' + sheet.getName() + '" is missing header: ' + name);
  });
  return { sheet: sheet, headers: headers, indexes: indexes, rows: values.slice(1) };
}

function adminEmployeeSummary_(row, headers) {
  const i = {};
  ['Email', 'Display Name', 'Role', 'Active'].forEach(name => i[name] = findHeaderIndex_(headers, name));
  return {
    email: normalizeEmail_(row[i.Email]),
    displayName: String(row[i['Display Name']] || ''),
    role: String(row[i.Role] || '').trim().toLowerCase(),
    active: isActiveValue_(row[i.Active])
  };
}

function adminDisableEmployeeCredential_(email) {
  const sheet = authCredentialSheet_();
  const raw = adminGetRawTable_(sheet, ['Email', 'Access Code Hash', 'Active', 'Updated At']);
  const matches = [];
  raw.rows.forEach((row,index) => {
    if (normalizeEmail_(row[raw.indexes.Email]) === email) matches.push(index);
  });
  if (matches.length > 1) throw new Error('Duplicate credential rows exist for this employee. Resolve them before changing employee access.');
  if (!matches.length) return false;
  const index = matches[0];
  const row = raw.rows[index].slice();
  row[raw.indexes.Active] = false;
  row[raw.indexes['Updated At']] = new Date();
  sheet.getRange(index + 2, 1, 1, raw.headers.length).setValues([row]);
  return true;
}

function adminDisableEmployeeAccess_(email) {
  const sheet = getMasterSpreadsheet_().getSheetByName(APP.SHEETS.ACCESS);
  const raw = adminGetRawTable_(sheet, ['Email', 'Project ID', 'Active']);
  let revoked = 0;
  raw.rows.forEach((row,index) => {
    if (normalizeEmail_(row[raw.indexes.Email]) !== email || !isActiveValue_(row[raw.indexes.Active])) return;
    const next = row.slice();
    next[raw.indexes.Active] = false;
    sheet.getRange(index + 2, 1, 1, raw.headers.length).setValues([next]);
    revoked += 1;
  });
  return revoked;
}

function adminAssertAtLeastOneActiveAdmin_(raw, newRow, targetIndex) {
  let activeAdmins = 0;
  raw.rows.forEach((row, index) => {
    const candidate = index === targetIndex ? newRow : row;
    if (String(candidate[raw.indexes.Role] || '').trim().toLowerCase() === 'admin' &&
        isActiveValue_(candidate[raw.indexes.Active])) activeAdmins += 1;
  });
  if (targetIndex < 0 &&
      String(newRow[raw.indexes.Role] || '').trim().toLowerCase() === 'admin' &&
      isActiveValue_(newRow[raw.indexes.Active])) activeAdmins += 1;
  if (activeAdmins < 1) throw new Error('At least one active administrator must remain.');
}

function adminWithLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function saveEmployeeAdmin(authToken, payload) {
  const actor = requireAdmin_(authToken);
  const data = payload && typeof payload === 'object' ? payload : {};
  const email = adminValidateEmail_(data.email);
  const displayName = String(data.displayName || '').trim().slice(0, 100);
  const role = String(data.role || '').trim().toLowerCase();
  const active = adminBoolean_(data.active);
  if (!displayName) throw new Error('Display name is required.');
  if (!['admin', 'labeller'].includes(role)) throw new Error('Role must be admin or labeller.');
  if (email === actor.email && (!active || role !== 'admin')) {
    throw new Error('You cannot deactivate or demote your own admin account.');
  }
  return adminWithLock_(function() {
    const master = adminRequireStorage_();
    const sheet = master.getSheetByName(APP.SHEETS.EMPLOYEES);
    const raw = adminGetRawTable_(sheet, ['Email', 'Display Name', 'Role', 'Active']);
    const matches = [];
    raw.rows.forEach((row, index) => {
      if (normalizeEmail_(row[raw.indexes.Email]) === email) matches.push(index);
    });
    if (matches.length > 1) throw new Error('Duplicate Employees rows exist for this email. Resolve duplicates before saving.');
    const targetIndex = matches.length ? matches[0] : -1;
    const before = targetIndex >= 0 ? adminEmployeeSummary_(raw.rows[targetIndex], raw.headers) : null;
    const newRow = targetIndex >= 0 ? raw.rows[targetIndex].slice() : raw.headers.map(() => '');
    newRow[raw.indexes.Email] = email;
    newRow[raw.indexes['Display Name']] = displayName;
    newRow[raw.indexes.Role] = role;
    newRow[raw.indexes.Active] = active;
    adminAssertAtLeastOneActiveAdmin_(raw, newRow, targetIndex);
    if (targetIndex >= 0) {
      sheet.getRange(targetIndex + 2, 1, 1, raw.headers.length).setValues([newRow]);
    } else {
      sheet.appendRow(newRow);
    }
    const mustReissueAccessCode = Boolean(before && (before.active !== active || before.role !== role));
    if (mustReissueAccessCode) adminDisableEmployeeCredential_(email);
    const revokedProjectAccessGrants = Boolean(before && before.active && !active)
      ? adminDisableEmployeeAccess_(email) : 0;
    const after = { email: email, displayName: displayName, role: role, active: active,
      accessCodeProvisioning: targetIndex < 0 ? 'issue-access-code-privately-in-Apps-Script-editor'
        : (mustReissueAccessCode ? 'previous-code-and-sessions-revoked; issue-a-new-code' : 'existing-code-preserved'),
      revokedProjectAccessGrants: revokedProjectAccessGrants };
    const auditWarning = adminWriteAuditSafely_(actor, targetIndex >= 0 ? 'EMPLOYEE_UPDATED' : 'EMPLOYEE_CREATED', 'EMPLOYEE', email, before, after);
    return {
      ok: true, message: (targetIndex >= 0 ? 'Employee updated.' : 'Employee created. Generate and deliver an access code privately before the employee signs in.') + auditWarning,
      auditWarning: auditWarning, employee: after
    };
  });
}

function saveProjectAdmin(authToken, payload) {
  const actor = requireAdmin_(authToken);
  const data = payload && typeof payload === 'object' ? payload : {};
  const projectId = String(data.projectId || '').trim();
  const projectName = String(data.projectName || '').trim().slice(0, 120);
  const spreadsheetId = String(data.spreadsheetId || '').trim();
  const tabName = String(data.tabName || '').trim().slice(0, 150);
  const timeZone = String(data.timeZone || APP.TIME_ZONE).trim();
  const active = adminBoolean_(data.active);
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(projectId)) throw new Error('Project ID must use 3–64 letters, numbers, underscores or hyphens.');
  if (!projectName) throw new Error('Project name is required.');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId)) throw new Error('Enter a valid Google Spreadsheet ID, not the full URL.');
  if (!tabName) throw new Error('Source tab name is required.');
  try {
    Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  } catch (error) {
    throw new Error('Enter a valid timezone such as Asia/Kolkata.');
  }
  return adminWithLock_(function() {
    const master = adminRequireStorage_();
    const sheet = master.getSheetByName(APP.SHEETS.PROJECTS);
    const raw = adminGetRawTable_(sheet, ['Project ID', 'Project Name', 'Spreadsheet ID', 'Tab Name', 'Timezone', 'Active']);
    const matches = [];
    raw.rows.forEach((row, index) => {
      if (String(row[raw.indexes['Project ID']] || '').trim() === projectId) matches.push(index);
    });
    if (matches.length > 1) throw new Error('Duplicate Projects rows exist for this Project ID.');
    const targetIndex = matches.length ? matches[0] : -1;
    const before = targetIndex >= 0 ? {
      projectId: projectId, projectName: raw.rows[targetIndex][raw.indexes['Project Name']],
      spreadsheetId: raw.rows[targetIndex][raw.indexes['Spreadsheet ID']],
      tabName: raw.rows[targetIndex][raw.indexes['Tab Name']],
      timeZone: raw.rows[targetIndex][raw.indexes.Timezone],
      active: isActiveValue_(raw.rows[targetIndex][raw.indexes.Active])
    } : null;
    const row = targetIndex >= 0 ? raw.rows[targetIndex].slice() : raw.headers.map(() => '');
    row[raw.indexes['Project ID']] = projectId;
    row[raw.indexes['Project Name']] = projectName;
    row[raw.indexes['Spreadsheet ID']] = spreadsheetId;
    row[raw.indexes['Tab Name']] = tabName;
    row[raw.indexes.Timezone] = timeZone;
    row[raw.indexes.Active] = active;
    if (targetIndex >= 0) sheet.getRange(targetIndex + 2, 1, 1, raw.headers.length).setValues([row]);
    else sheet.appendRow(row);
    const after = { projectId: projectId, projectName: projectName, spreadsheetId: spreadsheetId,
      tabName: tabName, timeZone: timeZone, active: active };
    const auditWarning = adminWriteAuditSafely_(actor, targetIndex >= 0 ? 'PROJECT_UPDATED' : 'PROJECT_CREATED', 'PROJECT', projectId, before, after);
    return { ok: true, message: (targetIndex >= 0 ? 'Project updated.' : 'Project created.') + auditWarning, auditWarning: auditWarning, project: after };
  });
}

function setProjectAccessAdmin(authToken, emailValue, projectIdValue, activeValue) {
  const actor = requireAdmin_(authToken);
  const email = adminValidateEmail_(emailValue);
  const projectId = String(projectIdValue || '').trim();
  const active = adminBoolean_(activeValue);
  if (!projectId) throw new Error('Choose a project.');
  return adminWithLock_(function() {
    const master = adminRequireStorage_();
    const employees = adminEmployeeObjects_();
    const employeeMatches = employees.filter(item => item.email === email);
    if (employeeMatches.length !== 1 || !employeeMatches[0].active) throw new Error('Project access can be changed only for one active Employees record.');
    const projects = adminProjectObjects_().filter(item => item.projectId === projectId);
    if (projects.length !== 1 || !projects[0].active) throw new Error('Project access can be changed only for one active project.');
    const sheet = master.getSheetByName(APP.SHEETS.ACCESS);
    const raw = adminGetRawTable_(sheet, ['Email', 'Project ID', 'Active']);
    const matches = [];
    raw.rows.forEach((row,index) => {
      if (normalizeEmail_(row[raw.indexes.Email]) === email &&
          String(row[raw.indexes['Project ID']] || '').trim() === projectId) matches.push(index);
    });
    const before = matches.map(index => ({ active: isActiveValue_(raw.rows[index][raw.indexes.Active]) }));
    if (matches.length > 1) {
      matches.forEach(index => {
        const row = raw.rows[index].slice();
        row[raw.indexes.Active] = active;
        sheet.getRange(index + 2, 1, 1, raw.headers.length).setValues([row]);
      });
    } else if (matches.length === 1) {
      const row = raw.rows[matches[0]].slice();
      row[raw.indexes.Active] = active;
      sheet.getRange(matches[0] + 2, 1, 1, raw.headers.length).setValues([row]);
    } else if (active) {
      const row = raw.headers.map(() => '');
      row[raw.indexes.Email] = email;
      row[raw.indexes['Project ID']] = projectId;
      row[raw.indexes.Active] = true;
      sheet.appendRow(row);
    }
    const after = { email: email, projectId: projectId, active: active };
    const auditWarning = adminWriteAuditSafely_(actor, active ? 'PROJECT_ACCESS_GRANTED' : 'PROJECT_ACCESS_REVOKED',
      'PROJECT_ACCESS', email + '|' + projectId, before, after);
    return { ok: true, message: (active ? 'Project access granted.' : 'Project access revoked.') + auditWarning, auditWarning: auditWarning };
  });
}

function saveProjectMappingAdmin(authToken, payload) {
  const actor = requireAdmin_(authToken);
  const data = payload && typeof payload === 'object' ? payload : {};
  const projectId = String(data.projectId || '').trim();
  const canonicalField = String(data.canonicalField || '').trim();
  const sheetHeader = String(data.sheetHeader || '').trim().slice(0, 150);
  const required = adminBoolean_(data.required);
  const allowedFields = Object.keys(APP.FIELDS).map(key => APP.FIELDS[key]);
  if (!projectId) throw new Error('Choose a project.');
  if (!allowedFields.includes(canonicalField)) throw new Error('Choose a supported canonical field.');
  if (!sheetHeader) throw new Error('Source sheet header is required.');
  if ([APP.FIELDS.SET_ID, APP.FIELDS.ANNOTATOR_EMAIL, APP.FIELDS.STATUS].includes(canonicalField) && !required) {
    throw new Error('Dataset Set Id, Annotator Mail and Status must remain required mappings.');
  }
  return adminWithLock_(function() {
    const master = adminRequireStorage_();
    if (!adminProjectObjects_().some(item => item.projectId === projectId)) throw new Error('Project was not found.');
    const sheet = master.getSheetByName(APP.SHEETS.COLUMN_MAP);
    const raw = adminGetRawTable_(sheet, ['Project ID', 'Canonical Field', 'Sheet Header', 'Required']);
    const matches = [];
    raw.rows.forEach((row,index) => {
      if (String(row[raw.indexes['Project ID']] || '').trim() === projectId &&
          String(row[raw.indexes['Canonical Field']] || '').trim() === canonicalField) matches.push(index);
    });
    if (matches.length > 1) throw new Error('Duplicate mapping rows exist for this project and canonical field. Resolve duplicates first.');
    const targetIndex = matches.length ? matches[0] : -1;
    const before = targetIndex >= 0 ? {
      projectId: projectId, canonicalField: canonicalField,
      sheetHeader: raw.rows[targetIndex][raw.indexes['Sheet Header']],
      required: adminBoolean_(raw.rows[targetIndex][raw.indexes.Required])
    } : null;
    const row = targetIndex >= 0 ? raw.rows[targetIndex].slice() : raw.headers.map(() => '');
    row[raw.indexes['Project ID']] = projectId;
    row[raw.indexes['Canonical Field']] = canonicalField;
    row[raw.indexes['Sheet Header']] = sheetHeader;
    row[raw.indexes.Required] = required;
    if (targetIndex >= 0) sheet.getRange(targetIndex + 2, 1, 1, raw.headers.length).setValues([row]);
    else sheet.appendRow(row);
    const after = { projectId: projectId, canonicalField: canonicalField, sheetHeader: sheetHeader, required: required };
    const auditWarning = adminWriteAuditSafely_(actor, targetIndex >= 0 ? 'PROJECT_MAPPING_UPDATED' : 'PROJECT_MAPPING_CREATED',
      'COLUMN_MAPPING', projectId + '|' + canonicalField, before, after);
    return { ok: true, message: (targetIndex >= 0 ? 'Column mapping updated.' : 'Column mapping created.') + auditWarning, auditWarning: auditWarning, mapping: after };
  });
}

function adminDateOnly_(value, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone || APP.TIME_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(text + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0,10) === text ? text : '';
  }
  return '';
}

function adminValidateOptionalDate_(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(label + ' must use YYYY-MM-DD.');
  const parsed = new Date(text + 'T00:00:00Z');
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(label + ' is not a valid calendar date.');
  return text;
}

function adminBuildTeamReport_(filters) {
  const opts = filters && typeof filters === 'object' ? filters : {};
  const fromDate = adminValidateOptionalDate_(opts.fromDate, 'Start date');
  const toDate = adminValidateOptionalDate_(opts.toDate, 'End date');
  if (fromDate && toDate && toDate < fromDate) throw new Error('End date cannot be before start date.');
  const dateField = String(opts.dateField || 'Assigned Date').trim();
  if (!['Assigned Date', 'Submitted Date'].includes(dateField)) throw new Error('Report date field must be Assigned Date or Submitted Date.');

  const employees = adminEmployeeObjects_();
  const employeeByEmail = new Map(employees.map(item => [item.email, item]));
  const projects = adminProjectObjects_().filter(item => item.active);
  const byEmployee = new Map();
  const byProject = new Map();
  const byStatus = new Map();
  const trend = new Map();
  const distinctSets = new Set();
  const projectErrors = [];
  let totalTasks = 0;
  let completedTasks = 0;
  let rowsWithSetId = 0;
  let rowsWithEmail = 0;

  projects.forEach(project => {
    try {
      const source = readProjectTable_(project);
      const mapping = getColumnMappings_(project.projectId);
      const setIndex = findHeaderIndex_(source.headers, mapping[APP.FIELDS.SET_ID] || '');
      const emailIndex = findHeaderIndex_(source.headers, mapping[APP.FIELDS.ANNOTATOR_EMAIL] || '');
      const statusIndex = findHeaderIndex_(source.headers, mapping[APP.FIELDS.STATUS] || '');
      if ([setIndex, emailIndex, statusIndex].some(index => index < 0)) {
        throw new Error('Required task fields are not fully mapped to source headers.');
      }
      const dateIndex = findHeaderIndex_(source.headers, mapping[dateField] || '');
      if ((fromDate || toDate) && dateIndex < 0) {
        throw new Error('Date-filter field "' + dateField + '" is not mapped or its source header is missing.');
      }
      const projectTotals = byProject.get(project.projectId) || {
        projectId: project.projectId, projectName: project.projectName,
        tasks: 0, completed: 0, sets: new Set()
      };
      source.rows.forEach(row => {
        const taskDate = dateIndex >= 0 ? adminDateOnly_(row[dateIndex], project.timeZone) : '';
        if (fromDate || toDate) {
          if (!taskDate || (fromDate && taskDate < fromDate) || (toDate && taskDate > toDate)) return;
        }
        const email = normalizeEmail_(row[emailIndex]);
        const setId = safeText_(row[setIndex]);
        const status = safeText_(row[statusIndex]) || '(blank)';
        const statusLower = status.toLowerCase();
        const completed = APP.COMPLETED_STATUSES.includes(statusLower);
        totalTasks += 1;
        if (completed) completedTasks += 1;
        if (setId) {
          rowsWithSetId += 1;
          distinctSets.add(project.projectId + '|' + setId.toLowerCase());
          projectTotals.sets.add(setId.toLowerCase());
        }
        if (email) rowsWithEmail += 1;
        projectTotals.tasks += 1;
        if (completed) projectTotals.completed += 1;

        const priorStatus = byStatus.get(status) || { status: status, tasks: 0, completed: 0 };
        priorStatus.tasks += 1;
        if (completed) priorStatus.completed += 1;
        byStatus.set(status, priorStatus);

        if (email) {
          const employee = employeeByEmail.get(email);
          const name = employee ? employee.displayName : email;
          const person = byEmployee.get(email) || {
            email: email, displayName: name, role: employee ? employee.role : 'unknown',
            tasks: 0, completed: 0, open: 0, sets: new Set()
          };
          person.tasks += 1;
          if (completed) person.completed += 1;
          else person.open += 1;
          if (setId) person.sets.add(project.projectId + '|' + setId.toLowerCase());
          byEmployee.set(email, person);
        }

        const assignedIndex = findHeaderIndex_(source.headers, mapping[APP.FIELDS.ASSIGNED_DATE] || '');
        const assignedDate = assignedIndex >= 0 ? adminDateOnly_(row[assignedIndex], project.timeZone) : '';
        if (assignedDate) {
          const point = trend.get(assignedDate) || { date: assignedDate, tasks: 0, completed: 0 };
          point.tasks += 1;
          if (completed) point.completed += 1;
          trend.set(assignedDate, point);
        }
      });
      byProject.set(project.projectId, projectTotals);
    } catch (error) {
      projectErrors.push({
        projectId: project.projectId, projectName: project.projectName,
        message: String(error && error.message ? error.message : error)
      });
    }
  });

  const attendance = { ready: false, today: issueDateKey_(issueNow_()), openSessions: 0, sessionsToday: 0 };
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(ATTENDANCE.SHEETS.SESSIONS);
    if (sheet) {
      const data = adminReadRows_(sheet, ['Email', 'Work Date', 'Status']);
      attendance.ready = true;
      data.rows.forEach(row => {
        if (adminDateOnly_(row[data.headerMap['Work Date']], APP.TIME_ZONE) === attendance.today) {
          attendance.sessionsToday += 1;
          if (String(row[data.headerMap.Status] || '') === 'OPEN') attendance.openSessions += 1;
        }
      });
    }
  } catch (error) {
    attendance.error = String(error && error.message ? error.message : error);
  }

  const leave = { ready: false, pending: 0, approved: 0, rejected: 0 };
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(ATTENDANCE.SHEETS.LEAVE);
    if (sheet) {
      const data = adminReadRows_(sheet, ['Status']);
      leave.ready = true;
      data.rows.forEach(row => {
        const status = String(row[data.headerMap.Status] || '').toUpperCase();
        if (status === 'PENDING') leave.pending += 1;
        else if (status === 'APPROVED') leave.approved += 1;
        else if (status === 'REJECTED') leave.rejected += 1;
      });
    }
  } catch (error) {
    leave.error = String(error && error.message ? error.message : error);
  }

  const issues = { ready: false, open: 0, critical: 0, high: 0, medium: 0, resolved: 0 };
  try {
    const sheet = getMasterSpreadsheet_().getSheetByName(ISSUE_SCAN.SHEETS.REGISTRY);
    if (sheet) {
      const data = adminReadRows_(sheet, ['Status', 'Severity']);
      issues.ready = true;
      data.rows.forEach(row => {
        const status = String(row[data.headerMap.Status] || '').toUpperCase();
        const severity = String(row[data.headerMap.Severity] || '').toUpperCase();
        if (status === 'OPEN') {
          issues.open += 1;
          if (severity === 'CRITICAL') issues.critical += 1;
          else if (severity === 'HIGH') issues.high += 1;
          else if (severity === 'MEDIUM') issues.medium += 1;
        } else if (status === 'RESOLVED') issues.resolved += 1;
      });
    }
  } catch (error) {
    issues.error = String(error && error.message ? error.message : error);
  }

  const employeeRows = Array.from(byEmployee.values()).map(item => ({
    email: item.email, displayName: item.displayName, role: item.role,
    tasks: item.tasks, completed: item.completed, open: item.open, distinctSets: item.sets.size
  })).sort((a,b) => b.tasks - a.tasks || a.email.localeCompare(b.email));
  const projectRows = Array.from(byProject.values()).map(item => ({
    projectId: item.projectId, projectName: item.projectName,
    tasks: item.tasks, completed: item.completed, distinctSets: item.sets.size
  })).sort((a,b) => b.tasks - a.tasks || a.projectId.localeCompare(b.projectId));
  const statusRows = Array.from(byStatus.values()).sort((a,b) => b.tasks - a.tasks || a.status.localeCompare(b.status));
  const trendRows = Array.from(trend.values()).sort((a,b) => a.date.localeCompare(b.date)).slice(-60);
  const partialData = projectErrors.length > 0;
  return {
    ok: true,
    filters: { fromDate: fromDate, toDate: toDate, dateField: dateField },
    partialData: partialData,
    projectErrors: projectErrors,
    summary: {
      tasks: totalTasks, completed: completedTasks, openTasks: totalTasks - completedTasks,
      distinctSets: distinctSets.size, activeProjects: projects.length,
      activeEmployees: employees.filter(item => item.active).length,
      rowsWithSetId: rowsWithSetId, rowsWithEmail: rowsWithEmail
    },
    byEmployee: employeeRows,
    byProject: projectRows,
    byStatus: statusRows,
    trend: trendRows,
    attendance: attendance,
    leave: leave,
    issues: issues,
    capturedAt: issueTimestamp_(issueNow_())
  };
}

function getTeamReport(authToken, filters) {
  requireAdmin_(authToken);
  return adminBuildTeamReport_(filters);
}

function createTeamSnapshot(authToken, filters) {
  const actor = requireAdmin_(authToken);
  const report = adminBuildTeamReport_(filters);
  if (report.partialData) {
    throw new Error('Snapshot not saved because one or more projects failed. Resolve project errors and generate a complete report first.');
  }
  const payload = {
    summary: report.summary, byEmployee: report.byEmployee, byProject: report.byProject,
    byStatus: report.byStatus, trend: report.trend, attendance: report.attendance,
    leave: report.leave, issues: report.issues
  };
  const json = JSON.stringify(payload);
  if (json.length > ADMIN_CONSOLE.MAX_SNAPSHOT_JSON) {
    throw new Error('Report snapshot exceeds the safe spreadsheet-cell size. Narrow the date range before saving.');
  }
  return adminWithLock_(function() {
    const master = adminRequireStorage_();
    const sheet = master.getSheetByName(ADMIN_CONSOLE.SHEETS.SNAPSHOTS);
    const snapshotId = Utilities.getUuid();
    const now = issueNow_();
    sheet.appendRow([
      snapshotId, now, report.filters.fromDate, report.filters.toDate,
      report.filters.dateField, actor.email, json
    ]);
    const auditWarning = adminWriteAuditSafely_(actor, 'TEAM_SNAPSHOT_CREATED', 'SNAPSHOT', snapshotId, null, {
      fromDate: report.filters.fromDate, toDate: report.filters.toDate,
      dateField: report.filters.dateField, bytes: json.length
    });
    return { ok: true, snapshotId: snapshotId, auditWarning: auditWarning, message: 'Team report snapshot saved.' + auditWarning };
  });
}

function listTeamSnapshots(authToken) {
  requireAdmin_(authToken);
  const master = getMasterSpreadsheet_();
  const sheet = master.getSheetByName(ADMIN_CONSOLE.SHEETS.SNAPSHOTS);
  if (!sheet) return { ok: true, storageReady: false, snapshots: [] };
  const data = adminReadRows_(sheet, ADMIN_CONSOLE.HEADERS[ADMIN_CONSOLE.SHEETS.SNAPSHOTS]);
  return {
    ok: true,
    storageReady: true,
    snapshots: data.rows.slice(-25).reverse().map(row => ({
      snapshotId: String(row[data.headerMap['Snapshot ID']] || ''),
      capturedAt: issueFormatDateTime_(row[data.headerMap['Captured At']]),
      fromDate: String(row[data.headerMap['Window Start']] || ''),
      toDate: String(row[data.headerMap['Window End']] || ''),
      dateField: String(row[data.headerMap['Date Field']] || ''),
      createdBy: String(row[data.headerMap['Created By']] || '')
    }))
  };
}

function getReleaseReadiness(authToken) {
  const actor = requireAdmin_(authToken);
  const props = PropertiesService.getScriptProperties();
  const configuredEnv = String(props.getProperty('APP_ENV_LABEL') || '').trim().toUpperCase();
  const env = configuredEnv || 'UNSET';
  const masterId = getMasterSpreadsheetId_();
  const expectedMasterProperty = env === 'TEST' ? 'TEST_MASTER_SPREADSHEET_ID'
    : (env === 'PROD' ? 'PROD_MASTER_SPREADSHEET_ID' : '');
  const expectedMasterId = expectedMasterProperty
    ? String(props.getProperty(expectedMasterProperty) || '').trim() : '';
  const currentMasterMatchesExpected = Boolean(masterId && expectedMasterId && masterId === expectedMasterId);
  const productionId = String(props.getProperty('PROD_MASTER_SPREADSHEET_ID') || '').trim();
  const gate = isIdentityGatePassed_();
  const emailEnabled = props.getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true';
  const scheduleEnabled = props.getProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY) === 'true';
  const productionApproved = props.getProperty('PRODUCTION_RELEASE_APPROVED') === 'true';
  const issues = [];
  if (!['TEST', 'PROD'].includes(env)) issues.push('APP_ENV_LABEL must be TEST or PROD.');
  if (env !== 'TEST') issues.push('Current project is not explicitly labeled TEST. Stop until environment is reviewed.');
  if (!expectedMasterId || !currentMasterMatchesExpected) issues.push('MASTER_SPREADSHEET_ID must match the environment-specific expected master ID property.');
  if (!gate) issues.push('Data gate is locked because the gate, environment label, expected master ID or production approval is missing/mismatched.');
  if (env === 'TEST' && productionId) issues.push('Do not store PROD_MASTER_SPREADSHEET_ID inside the TEST project. Configure production in a separate Apps Script project.');
  if (env === 'PROD' && !productionApproved) issues.push('Production release approval is not enabled.');
  if (emailEnabled) issues.push('Issue email reminders are enabled; verify consent, recipient behavior and quota before release.');
  if (scheduleEnabled) issues.push('Scheduled issue scanning is enabled in this project.');
  return {
    ok: true,
    environment: env || 'UNSET',
    currentMasterConfigured: Boolean(masterId),
    currentMasterMatchesExpected: currentMasterMatchesExpected,
    expectedMasterProperty: expectedMasterProperty,
    dataGatePassed: gate,
    emailEnabled: emailEnabled,
    scheduleEnabled: scheduleEnabled,
    productionMasterConfigured: Boolean(productionId),
    productionApproved: productionApproved,
    checks: [
      { key: 'environment', passed: env === 'TEST', label: 'Explicitly labeled TEST' },
      { key: 'gate', passed: gate, label: 'TEST data gate enabled' },
      { key: 'master_binding', passed: currentMasterMatchesExpected, label: 'Current master matches environment-specific master ID' },
      { key: 'prod_property', passed: env !== 'TEST' || !productionId, label: 'PROD master is not configured inside TEST project' },
      { key: 'email_off', passed: !emailEnabled, label: 'Email reminders off by default' },
      { key: 'schedule_off', passed: !scheduleEnabled, label: 'Scheduled scans off by default' }
    ],
    warnings: issues,
    message: 'This is a configuration readiness view, not approval to deploy to production. A human release review is still required.'
  };
}
