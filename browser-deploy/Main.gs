// ===== SOURCE: apps-script/Config.gs =====
/** Shared configuration. Keep secrets and spreadsheet IDs in Script Properties. */
const APP = Object.freeze({
  TIME_ZONE: 'Asia/Kolkata',
  MASTER_ID_PROPERTY: 'MASTER_SPREADSHEET_ID',
  IDENTITY_GATE_PROPERTY: 'IDENTITY_GATE_PASSED',
  SHEETS: Object.freeze({
    EMPLOYEES: 'Employees',
    PROJECTS: 'Projects',
    ACCESS: 'Access',
    COLUMN_MAP: 'Column_Map'
  }),
  FIELDS: Object.freeze({
    SET_ID: 'Dataset Set Id',
    ANNOTATOR_EMAIL: 'Annotator Mail',
    STATUS: 'Status',
    ASSIGNED_DATE: 'Assigned Date',
    SUBMITTED_DATE: 'Submitted Date',
    APPROVED_OBJECTS: 'Approved Objects',
    REJECTED_OBJECTS: 'Rejected Objects',
    REVIEWER_REJECTED_COUNT: 'Reviewer Rejected Count',
    HOLD_NOTE: 'Hold Note'
  }),
  // Proposed completion list from the build plan; verify against the real workflow before reporting.
  COMPLETED_STATUSES: Object.freeze([
    'labelling done',
    'review done',
    'approved',
    'rework done'
  ])
});

function getMasterSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty(APP.MASTER_ID_PROPERTY);
  if (!id || !String(id).trim()) {
    throw new Error('Missing Script Property: ' + APP.MASTER_ID_PROPERTY);
  }
  return String(id).trim();
}

function getMasterSpreadsheet_() {
  return SpreadsheetApp.openById(getMasterSpreadsheetId_());
}

function isIdentityGatePassed_() {
  return PropertiesService.getScriptProperties().getProperty(APP.IDENTITY_GATE_PROPERTY) === 'true';
}

// ===== SOURCE: apps-script/Auth.gs =====
function normalizeEmail_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function isActiveValue_(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return value === true || ['true', 'yes', '1', 'active'].includes(normalized);
}

function readTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };

  const headers = values[0].map(value => String(value == null ? '' : value).trim());
  const nonBlank = headers.filter(Boolean).map(value => value.toLowerCase());
  if (new Set(nonBlank).size !== nonBlank.length) {
    throw new Error('Duplicate header names found in tab "' + sheet.getName() + '".');
  }

  return {
    headers: headers,
    rows: values.slice(1).filter(row => row.some(value => value !== '' && value !== null))
  };
}

function findHeaderIndex_(headers, expectedName) {
  const expected = String(expectedName == null ? '' : expectedName).trim().toLowerCase();
  return headers.findIndex(header => String(header || '').trim().toLowerCase() === expected);
}

function requireActiveEmployee_() {
  if (!isIdentityGatePassed_()) {
    throw new Error('Identity gate is closed. Task data endpoints are disabled.');
  }

  // Do not accept an email argument from the browser. Never use effective-user email as identity.
  const email = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!email) throw new Error('Google account email could not be verified. Contact the administrator.');

  const sheet = getMasterSpreadsheet_().getSheetByName(APP.SHEETS.EMPLOYEES);
  if (!sheet) throw new Error('Master configuration is missing the Employees tab.');

  const table = readTable_(sheet);
  const emailIndex = findHeaderIndex_(table.headers, 'Email');
  const nameIndex = findHeaderIndex_(table.headers, 'Display Name');
  const roleIndex = findHeaderIndex_(table.headers, 'Role');
  const activeIndex = findHeaderIndex_(table.headers, 'Active');

  if ([emailIndex, nameIndex, roleIndex, activeIndex].some(index => index < 0)) {
    throw new Error('Employees tab is missing one or more required headers.');
  }

  const matches = table.rows.filter(row => normalizeEmail_(row[emailIndex]) === email);
  if (matches.length !== 1) {
    throw new Error('Your account must have exactly one Employees row. Contact the administrator.');
  }

  const row = matches[0];
  if (!isActiveValue_(row[activeIndex])) throw new Error('Your account is inactive. Contact the administrator.');

  const role = String(row[roleIndex] == null ? '' : row[roleIndex]).trim().toLowerCase();
  if (!['admin', 'labeller'].includes(role)) throw new Error('Your account has an invalid role.');

  return {
    email: email,
    displayName: String(row[nameIndex] || email).trim(),
    role: role
  };
}

function requireAdmin_() {
  const user = requireActiveEmployee_();
  if (user.role !== 'admin') throw new Error('Administrator access is required.');
  return user;
}

// ===== SOURCE: apps-script/Validation.gs =====
function headerMap_(headers) {
  const result = {};
  headers.forEach((header, index) => {
    const key = String(header == null ? '' : header).trim();
    if (key) result[key] = index;
  });
  return result;
}

function safeText_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Date-only task fields are rendered as yyyy-MM-dd in the source spreadsheet timezone.
 * This avoids browser UTC conversion shifting a date into the previous/next day.
 */
function dateOnlyForClient_(value, timeZone) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone || APP.TIME_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  if (!text) return '';
  // Preserve a source date-only string as-is; don't parse ambiguous locale strings.
  return text;
}

function valueByCanonicalField_(row, headers, mapping, canonicalField) {
  const sourceHeader = mapping[canonicalField];
  if (!sourceHeader) return '';
  const index = findHeaderIndex_(headers, sourceHeader);
  return index < 0 ? '' : row[index];
}

// ===== SOURCE: apps-script/SheetsRepository.gs =====
function getAssignedProjects_(email) {
  const master = getMasterSpreadsheet_();
  const projectsSheet = master.getSheetByName(APP.SHEETS.PROJECTS);
  const accessSheet = master.getSheetByName(APP.SHEETS.ACCESS);
  if (!projectsSheet || !accessSheet) {
    throw new Error('Master configuration is missing the Projects or Access tab.');
  }

  const projectsTable = readTable_(projectsSheet);
  const accessTable = readTable_(accessSheet);
  const projectHeaders = headerMap_(projectsTable.headers);
  const accessHeaders = headerMap_(accessTable.headers);

  ['Project ID', 'Project Name', 'Spreadsheet ID', 'Tab Name', 'Timezone', 'Active'].forEach(name => {
    if (projectHeaders[name] === undefined) throw new Error('Projects tab is missing header: ' + name);
  });
  ['Email', 'Project ID', 'Active'].forEach(name => {
    if (accessHeaders[name] === undefined) throw new Error('Access tab is missing header: ' + name);
  });

  const allowedProjectIds = new Set(accessTable.rows
    .filter(row => normalizeEmail_(row[accessHeaders.Email]) === email &&
      isActiveValue_(row[accessHeaders.Active]))
    .map(row => String(row[accessHeaders['Project ID']] || '').trim()));

  return projectsTable.rows
    .filter(row => isActiveValue_(row[projectHeaders.Active]) &&
      allowedProjectIds.has(String(row[projectHeaders['Project ID']] || '').trim()))
    .map(row => ({
      projectId: String(row[projectHeaders['Project ID']] || '').trim(),
      projectName: String(row[projectHeaders['Project Name']] || '').trim(),
      spreadsheetId: String(row[projectHeaders['Spreadsheet ID']] || '').trim(),
      tabName: String(row[projectHeaders['Tab Name']] || '').trim(),
      timeZone: String(row[projectHeaders.Timezone] || APP.TIME_ZONE).trim()
    }))
    .filter(project => project.projectId && project.spreadsheetId && project.tabName);
}

function getColumnMappings_(projectId) {
  const sheet = getMasterSpreadsheet_().getSheetByName(APP.SHEETS.COLUMN_MAP);
  if (!sheet) throw new Error('Master configuration is missing the Column_Map tab.');

  const table = readTable_(sheet);
  const headers = headerMap_(table.headers);
  ['Project ID', 'Canonical Field', 'Sheet Header', 'Required'].forEach(name => {
    if (headers[name] === undefined) throw new Error('Column_Map tab is missing header: ' + name);
  });

  const mapping = {};
  table.rows
    .filter(row => String(row[headers['Project ID']] || '').trim() === projectId)
    .forEach(row => {
      const canonical = String(row[headers['Canonical Field']] || '').trim();
      const sourceHeader = String(row[headers['Sheet Header']] || '').trim();
      if (canonical && sourceHeader) {
        if (mapping[canonical]) throw new Error('Duplicate mapping for "' + canonical + '" in project ' + projectId + '.');
        mapping[canonical] = sourceHeader;
      }
    });
  return mapping;
}

function readProjectTable_(project) {
  let sourceSpreadsheet;
  try {
    sourceSpreadsheet = SpreadsheetApp.openById(project.spreadsheetId);
  } catch (error) {
    throw new Error('Cannot open source spreadsheet for project "' + project.projectId +
      '". Check its ID and the script owner’s access.');
  }

  const sourceSheet = sourceSpreadsheet.getSheetByName(project.tabName);
  if (!sourceSheet) {
    throw new Error('Configured source tab "' + project.tabName + '" was not found for project "' + project.projectId + '".');
  }

  return readTable_(sourceSheet);
}

// ===== SOURCE: apps-script/Metrics.gs =====
function buildMyWorkPayload_(authenticatedEmail, projects) {
  const rows = [];
  const errors = [];
  const distinctSets = new Set();
  let completedTasks = 0;

  projects.forEach(project => {
    try {
      const source = readProjectTable_(project);
      const mapping = getColumnMappings_(project.projectId);

      const setHeader = mapping[APP.FIELDS.SET_ID];
      const emailHeader = mapping[APP.FIELDS.ANNOTATOR_EMAIL];
      const statusHeader = mapping[APP.FIELDS.STATUS];
      if (!setHeader || !emailHeader || !statusHeader) {
        throw new Error('Column_Map must map Dataset Set Id, Annotator Mail and Status.');
      }

      const setIndex = findHeaderIndex_(source.headers, setHeader);
      const emailIndex = findHeaderIndex_(source.headers, emailHeader);
      const statusIndex = findHeaderIndex_(source.headers, statusHeader);
      if ([setIndex, emailIndex, statusIndex].some(index => index < 0)) {
        throw new Error('A mapped source header was not found. Check Column_Map and the configured tab.');
      }

      source.rows.forEach(row => {
        if (normalizeEmail_(row[emailIndex]) !== authenticatedEmail) return;

        const setId = safeText_(row[setIndex]);
        const status = safeText_(row[statusIndex]);
        if (setId) distinctSets.add(project.projectId + '|' + setId);
        if (APP.COMPLETED_STATUSES.includes(status.toLowerCase())) completedTasks += 1;

        rows.push({
          projectId: project.projectId,
          projectName: project.projectName,
          datasetSetId: setId,
          status: status,
          assignedDate: dateOnlyForClient_(
            valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.ASSIGNED_DATE),
            project.timeZone
          ),
          submittedDate: dateOnlyForClient_(
            valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.SUBMITTED_DATE),
            project.timeZone
          ),
          approvedObjects: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.APPROVED_OBJECTS)),
          rejectedObjects: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.REJECTED_OBJECTS)),
          reviewerRejectedCount: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.REVIEWER_REJECTED_COUNT)),
          holdNote: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.HOLD_NOTE))
        });
      });
    } catch (error) {
      errors.push({
        projectId: project.projectId,
        projectName: project.projectName,
        message: String(error && error.message ? error.message : error)
      });
    }
  });

  return {
    cards: {
      assignedTasks: rows.length,
      completedTasks: completedTasks,
      distinctSets: distinctSets.size,
      assignedProjects: projects.length
    },
    rows: rows,
    projectErrors: errors,
    hasPartialData: errors.length > 0,
    refreshedAt: Utilities.formatDate(new Date(), APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
}

// ===== SOURCE: apps-script/UserApi.gs =====
function getMyWork() {
  // Authorization derives identity server-side; this function accepts no email parameter.
  // Check the gate before opening the master spreadsheet or reading any task source.
  if (!isIdentityGatePassed_()) {
    throw new Error('Identity gate is closed. Task data endpoints are disabled.');
  }

  const user = requireActiveEmployee_();
  const projects = getAssignedProjects_(user.email);
  const payload = buildMyWorkPayload_(user.email, projects);

  return {
    ok: true,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    cards: payload.cards,
    rows: payload.rows,
    projectErrors: payload.projectErrors,
    hasPartialData: payload.hasPartialData,
    refreshedAt: payload.refreshedAt
  };
}

// ===== SOURCE: apps-script/Attendance.gs =====
/**
 * Phase 2 attendance storage.
 * All writes target app-owned tabs in the private master spreadsheet.
 * Existing task-source spreadsheets are never modified.
 */
const ATTENDANCE = Object.freeze({
  SHEETS: Object.freeze({
    SESSIONS: 'Attendance_Sessions',
    EVENTS: 'Attendance_Events',
    BREAKS: 'Attendance_Breaks',
    LEAVE: 'Leave_Requests',
    REQUESTS: 'Attendance_Requests'
  }),
  HEADERS: Object.freeze({
    Attendance_Sessions: [
      'Session ID', 'Email', 'Work Date', 'Clock In At', 'Clock Out At',
      'Status', 'Auto Closed At', 'Auto Close Reason', 'Created At', 'Updated At'
    ],
    Attendance_Events: [
      'Event ID', 'Request ID', 'Email', 'Session ID', 'Event Type',
      'Event At', 'Time Zone', 'Details'
    ],
    Attendance_Breaks: [
      'Break ID', 'Session ID', 'Email', 'Break Type', 'Start At',
      'End At', 'Status', 'Start Request ID', 'End Request ID'
    ],
    Leave_Requests: [
      'Leave ID', 'Email', 'Start Date', 'End Date', 'Leave Type',
      'Partial Period', 'Start Time', 'End Time', 'Reason', 'Status',
      'Requested At', 'Reviewed By', 'Reviewed At', 'Review Note'
    ],
    Attendance_Requests: [
      'Request ID', 'Email', 'Action', 'Result JSON', 'Created At'
    ]
  })
});

function attendanceNow_() {
  return new Date();
}

function attendanceTimestamp_(date) {
  return Utilities.formatDate(date, APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function attendanceDateKey_(date) {
  return Utilities.formatDate(date, APP.TIME_ZONE, 'yyyy-MM-dd');
}

function attendanceTimeKey_(date) {
  return Utilities.formatDate(date, APP.TIME_ZONE, 'HH:mm');
}

function attendanceSheets_() {
  const master = getMasterSpreadsheet_();
  const result = {};
  Object.keys(ATTENDANCE.HEADERS).forEach(name => {
    const sheet = master.getSheetByName(name);
    if (!sheet) {
      throw new Error('Attendance storage is not initialized. An administrator must initialize it first.');
    }
    const values = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
    const actual = values.map(value => String(value || '').trim());
    const expected = ATTENDANCE.HEADERS[name];
    if (expected.some((header, index) => actual[index] !== header) || actual.length !== expected.length) {
      throw new Error('Attendance tab "' + name + '" has an unexpected header layout. Do not rename or reorder its columns.');
    }
    result[name] = sheet;
  });
  return result;
}

function initializeAttendanceStorage() {
  const admin = requireAdmin_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const master = getMasterSpreadsheet_();
    const created = [];
    Object.keys(ATTENDANCE.HEADERS).forEach(name => {
      let sheet = master.getSheetByName(name);
      if (!sheet) {
        sheet = master.insertSheet(name);
        sheet.getRange(1, 1, 1, ATTENDANCE.HEADERS[name].length).setValues([ATTENDANCE.HEADERS[name]]);
        sheet.setFrozenRows(1);
        created.push(name);
        return;
      }
      const expected = ATTENDANCE.HEADERS[name];
      const lastColumn = sheet.getLastColumn();
      if (sheet.getLastRow() === 0 || lastColumn === 0) {
        sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
        sheet.setFrozenRows(1);
        created.push(name);
        return;
      }
      const actual = sheet.getRange(1, 1, 1, Math.max(lastColumn, 1)).getDisplayValues()[0]
        .map(value => String(value || '').trim());
      if (expected.some((header, index) => actual[index] !== header) || actual.length < expected.length) {
        throw new Error('Existing tab "' + name + '" has different headers. No data was overwritten.');
      }
    });
    return { ok: true, created: created, message: created.length
      ? 'Attendance storage initialized. New tabs: ' + created.join(', ')
      : 'Attendance storage already exists and headers were verified.' };
  } finally {
    lock.releaseLock();
  }
}

function attendanceRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return values.map((valuesRow, offset) => {
    const row = {};
    ATTENDANCE.HEADERS[sheet.getName()].forEach((header, index) => row[header] = valuesRow[index]);
    row.__rowNumber = offset + 2;
    return row;
  }).filter(row => row[ATTENDANCE.HEADERS[sheet.getName()][0]] !== '' &&
    row[ATTENDANCE.HEADERS[sheet.getName()][0]] !== null);
}

function attendanceAppend_(sheet, values) {
  const headers = ATTENDANCE.HEADERS[sheet.getName()];
  sheet.appendRow(headers.map(header => Object.prototype.hasOwnProperty.call(values, header) ? values[header] : ''));
  return sheet.getLastRow();
}

function attendanceUpdate_(sheet, rowNumber, values) {
  const headers = ATTENDANCE.HEADERS[sheet.getName()];
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const row = range.getValues()[0];
  headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(values, header)) row[index] = values[header];
  });
  range.setValues([row]);
}

function attendanceRequireRequestId_(requestId) {
  const value = String(requestId == null ? '' : requestId).trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
    throw new Error('A valid request ID is required. Refresh the page and try again.');
  }
  return value;
}

function attendanceReplay_(sheets, email, requestId, action) {
  const existing = attendanceRows_(sheets[ATTENDANCE.SHEETS.REQUESTS]).find(row =>
    row['Request ID'] === requestId && row.Email === email);
  if (!existing) return null;
  if (existing.Action !== action) {
    throw new Error('This request ID was already used for a different action. Refresh the page and retry.');
  }
  try {
    return JSON.parse(existing['Result JSON']);
  } catch (error) {
    throw new Error('A previous request result could not be read. Contact the administrator; do not repeat the action.');
  }
}

function attendanceSaveRequest_(sheets, email, requestId, action, result, now) {
  attendanceAppend_(sheets[ATTENDANCE.SHEETS.REQUESTS], {
    'Request ID': requestId, Email: email, Action: action,
    'Result JSON': JSON.stringify(result), 'Created At': now
  });
}

function attendanceWriteEvent_(sheets, email, sessionId, requestId, eventType, details, now) {
  attendanceAppend_(sheets[ATTENDANCE.SHEETS.EVENTS], {
    'Event ID': Utilities.getUuid(), 'Request ID': requestId, Email: email,
    'Session ID': sessionId || '', 'Event Type': eventType, 'Event At': now,
    'Time Zone': APP.TIME_ZONE, Details: details || ''
  });
}

function attendanceWithAction_(action, requestId, operation) {
  if (!isIdentityGatePassed_()) throw new Error('Identity gate is closed. Attendance actions are disabled.');
  const user = requireActiveEmployee_();
  const key = attendanceRequireRequestId_(requestId);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly; your action has not been processed.');
  try {
    const sheets = attendanceSheets_();
    const replay = attendanceReplay_(sheets, user.email, key, action);
    if (replay) return replay;
    const now = attendanceNow_();
    const result = operation(user, sheets, key, now);
    attendanceSaveRequest_(sheets, user.email, key, action, result, now);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function attendanceOpenSession_(sheets, email, dateKey) {
  return attendanceRows_(sheets[ATTENDANCE.SHEETS.SESSIONS]).find(row =>
    row.Email === email && row.Status === 'OPEN' && row['Work Date'] === dateKey);
}

function attendanceCurrentSession_(sheets, email) {
  return attendanceRows_(sheets[ATTENDANCE.SHEETS.SESSIONS]).find(row =>
    row.Email === email && row.Status === 'OPEN');
}

function attendanceOpenBreak_(sheets, sessionId) {
  return attendanceRows_(sheets[ATTENDANCE.SHEETS.BREAKS]).find(row =>
    row['Session ID'] === sessionId && row.Status === 'OPEN');
}

function attendanceStatusForUser_(user, sheets) {
  const now = attendanceNow_();
  const today = attendanceDateKey_(now);
  const session = attendanceOpenSession_(sheets, user.email, today) || null;
  const openSession = attendanceCurrentSession_(sheets, user.email) || null;
  const openBreak = openSession ? attendanceOpenBreak_(sheets, openSession['Session ID']) : null;
  const leave = attendanceRows_(sheets[ATTENDANCE.SHEETS.LEAVE]).filter(row =>
    row.Email === user.email && typeof row['Start Date'] === 'string' &&
    typeof row['End Date'] === 'string' && row['Start Date'] <= today && row['End Date'] >= today);
  return {
    ok: true,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    today: today,
    timeZone: APP.TIME_ZONE,
    now: attendanceTimestamp_(now),
    session: session ? {
      sessionId: session['Session ID'],
      clockInAt: session['Clock In At'] instanceof Date ? attendanceTimestamp_(session['Clock In At']) : '',
      clockOutAt: session['Clock Out At'] instanceof Date ? attendanceTimestamp_(session['Clock Out At']) : '',
      status: session.Status
    } : null,
    hasOpenSession: Boolean(openSession),
    openSessionDate: openSession ? String(openSession['Work Date'] || '') : '',
    openBreak: openBreak ? { breakId: openBreak['Break ID'], type: openBreak['Break Type'],
      startAt: openBreak['Start At'] instanceof Date ? attendanceTimestamp_(openBreak['Start At']) : '' } : null,
    todayLeaveRequests: leave.map(row => ({
      leaveId: row['Leave ID'], type: row['Leave Type'], status: row.Status,
      startDate: String(row['Start Date'] || ''),
      endDate: String(row['End Date'] || '')
    }))
  };
}

function getMyAttendanceStatus() {
  if (!isIdentityGatePassed_()) throw new Error('Identity gate is closed. Attendance data is unavailable.');
  const user = requireActiveEmployee_();
  const sheets = attendanceSheets_();
  return attendanceStatusForUser_(user, sheets);
}

function attendanceClockIn(requestId) {
  return attendanceWithAction_('CLOCK_IN', requestId, function(user, sheets, key, now) {
    const today = attendanceDateKey_(now);
    const existing = attendanceCurrentSession_(sheets, user.email);
    if (existing) {
      const existingDate = String(existing['Work Date'] || '');
      if (existingDate !== today) {
        throw new Error('A previous attendance session is still open. Ask an administrator to review and close it before clocking in again.');
      }
      throw new Error('You are already clocked in.');
    }
    const sessionId = Utilities.getUuid();
    attendanceAppend_(sheets[ATTENDANCE.SHEETS.SESSIONS], {
      'Session ID': sessionId, Email: user.email, 'Work Date': today,
      'Clock In At': now, 'Clock Out At': '', Status: 'OPEN',
      'Auto Closed At': '', 'Auto Close Reason': '', 'Created At': now, 'Updated At': now
    });
    attendanceWriteEvent_(sheets, user.email, sessionId, key, 'CLOCK_IN', '', now);
    return { ok: true, message: 'Clock-in recorded.', status: attendanceStatusForUser_(user, sheets) };
  });
}

function attendanceClockOut(requestId) {
  return attendanceWithAction_('CLOCK_OUT', requestId, function(user, sheets, key, now) {
    const session = attendanceCurrentSession_(sheets, user.email);
    if (!session) throw new Error('You are not clocked in.');
    if (attendanceOpenBreak_(sheets, session['Session ID'])) {
      throw new Error('End your active break before clocking out.');
    }
    attendanceUpdate_(sheets[ATTENDANCE.SHEETS.SESSIONS], session.__rowNumber, {
      'Clock Out At': now, Status: 'CLOSED', 'Updated At': now
    });
    attendanceWriteEvent_(sheets, user.email, session['Session ID'], key, 'CLOCK_OUT', '', now);
    return { ok: true, message: 'Clock-out recorded.', status: attendanceStatusForUser_(user, sheets) };
  });
}

function attendanceStartBreak(requestId, breakType) {
  return attendanceWithAction_('BREAK_START', requestId, function(user, sheets, key, now) {
    const allowed = ['tea', 'lunch', 'personal', 'other'];
    const type = String(breakType == null ? '' : breakType).trim().toLowerCase();
    if (!allowed.includes(type)) throw new Error('Choose a valid break type.');
    const session = attendanceCurrentSession_(sheets, user.email);
    if (!session) throw new Error('Clock in before starting a break.');
    if (attendanceOpenBreak_(sheets, session['Session ID'])) throw new Error('A break is already active.');
    const breakId = Utilities.getUuid();
    attendanceAppend_(sheets[ATTENDANCE.SHEETS.BREAKS], {
      'Break ID': breakId, 'Session ID': session['Session ID'], Email: user.email,
      'Break Type': type, 'Start At': now, 'End At': '', Status: 'OPEN',
      'Start Request ID': key, 'End Request ID': ''
    });
    attendanceWriteEvent_(sheets, user.email, session['Session ID'], key, 'BREAK_START', type, now);
    return { ok: true, message: 'Break started.', status: attendanceStatusForUser_(user, sheets) };
  });
}

function attendanceEndBreak(requestId) {
  return attendanceWithAction_('BREAK_END', requestId, function(user, sheets, key, now) {
    const session = attendanceCurrentSession_(sheets, user.email);
    if (!session) throw new Error('You do not have an open attendance session.');
    const openBreak = attendanceOpenBreak_(sheets, session['Session ID']);
    if (!openBreak) throw new Error('There is no active break to end.');
    attendanceUpdate_(sheets[ATTENDANCE.SHEETS.BREAKS], openBreak.__rowNumber, {
      'End At': now, Status: 'CLOSED', 'End Request ID': key
    });
    attendanceWriteEvent_(sheets, user.email, session['Session ID'], key, 'BREAK_END', openBreak['Break Type'], now);
    return { ok: true, message: 'Break ended.', status: attendanceStatusForUser_(user, sheets) };
  });
}

function attendanceValidateDate_(value, fieldName) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(fieldName + ' must be a valid YYYY-MM-DD date.');
  const parsed = new Date(text + 'T00:00:00Z');
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(fieldName + ' is not a valid calendar date.');
  return text;
}

function attendanceValidateTime_(value, fieldName) {
  const text = String(value == null ? '' : value).trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error(fieldName + ' must use 24-hour HH:mm format.');
  return text;
}

function attendanceSubmitLeaveRequest(payload, requestId) {
  const data = payload && typeof payload === 'object' ? payload : {};
  return attendanceWithAction_('LEAVE_REQUEST', requestId, function(user, sheets, key, now) {
    const start = attendanceValidateDate_(data.startDate, 'Start date');
    const end = attendanceValidateDate_(data.endDate, 'End date');
    if (end < start) throw new Error('End date cannot be before start date.');
    const type = String(data.leaveType || '').trim().toLowerCase();
    if (!['full_day', 'half_day', 'short_leave'].includes(type)) throw new Error('Choose full-day, half-day or short leave.');
    const period = String(data.partialPeriod || '').trim().toUpperCase();
    let startTime = '', endTime = '';
    if (type === 'half_day' && !['AM', 'PM'].includes(period)) {
      throw new Error('Choose AM or PM for a half-day leave request.');
    }
    if (type !== 'half_day' && period) throw new Error('Partial period is only used for half-day leave.');
    if (type === 'short_leave') {
      if (start !== end) throw new Error('Short leave must be requested for one date.');
      startTime = attendanceValidateTime_(data.startTime, 'Short-leave start time');
      endTime = attendanceValidateTime_(data.endTime, 'Short-leave end time');
      if (endTime <= startTime) throw new Error('Short-leave end time must be later than its start time.');
    } else if (data.startTime || data.endTime) {
      throw new Error('Start and end times are only used for short leave.');
    }
    const today = attendanceDateKey_(now);
    if (start < today) throw new Error('Leave requests cannot start on dates that have already passed.');
    if (type === 'half_day' && start !== end) throw new Error('Half-day leave must be requested for one date.');
    const existingLeave = attendanceRows_(sheets[ATTENDANCE.SHEETS.LEAVE]).find(row => {
      if (row.Email !== user.email || !['PENDING', 'APPROVED'].includes(row.Status)) return false;
      if (typeof row['Start Date'] !== 'string' || typeof row['End Date'] !== 'string') return false;
      const existingStart = row['Start Date'];
      const existingEnd = row['End Date'];
      return start <= existingEnd && end >= existingStart;
    });
    if (existingLeave) throw new Error('You already have a pending or approved leave request overlapping these dates.');
    const reason = String(data.reason || '').trim().slice(0, 500);
    const leaveId = Utilities.getUuid();
    attendanceAppend_(sheets[ATTENDANCE.SHEETS.LEAVE], {
      'Leave ID': leaveId, Email: user.email, 'Start Date': start,
      'End Date': end, 'Leave Type': type, 'Partial Period': period,
      'Start Time': startTime, 'End Time': endTime, Reason: reason, Status: 'PENDING',
      'Requested At': now, 'Reviewed By': '', 'Reviewed At': '', 'Review Note': ''
    });
    attendanceWriteEvent_(sheets, user.email, '', key, 'LEAVE_REQUESTED',
      JSON.stringify({ leaveId: leaveId, type: type, startDate: start, endDate: end }), now);
    return { ok: true, message: 'Leave request submitted for admin review.', leaveId: leaveId };
  });
}

function getAttendanceLeaveRequests() {
  if (!isIdentityGatePassed_()) throw new Error('Identity gate is closed. Attendance data is unavailable.');
  const user = requireActiveEmployee_();
  const sheets = attendanceSheets_();
  const rows = attendanceRows_(sheets[ATTENDANCE.SHEETS.LEAVE]);
  const visible = user.role === 'admin' ? rows : rows.filter(row => row.Email === user.email);
  return {
    ok: true,
    role: user.role,
    rows: visible.map(row => ({
      leaveId: row['Leave ID'], email: user.role === 'admin' ? row.Email : '',
      startDate: String(row['Start Date'] || ''),
      endDate: String(row['End Date'] || ''),
      leaveType: row['Leave Type'], partialPeriod: row['Partial Period'],
      startTime: row['Start Time'], endTime: row['End Time'], reason: row.Reason,
      status: row.Status, requestedAt: row['Requested At'] instanceof Date ? attendanceTimestamp_(row['Requested At']) : ''
    }))
  };
}

function attendanceReviewLeaveRequest(leaveId, decision, reviewNote, requestId) {
  return attendanceWithAction_('LEAVE_REVIEW', requestId, function(user, sheets, key, now) {
    if (user.role !== 'admin') throw new Error('Administrator access is required to review leave.');
    const id = String(leaveId == null ? '' : leaveId).trim();
    const action = String(decision == null ? '' : decision).trim().toUpperCase();
    if (!id || !['APPROVED', 'REJECTED'].includes(action)) throw new Error('A leave request and valid decision are required.');
    const sheet = sheets[ATTENDANCE.SHEETS.LEAVE];
    const row = attendanceRows_(sheet).find(item => item['Leave ID'] === id);
    if (!row) throw new Error('Leave request not found.');
    if (row.Status !== 'PENDING') throw new Error('Only pending leave requests can be reviewed.');
    attendanceUpdate_(sheet, row.__rowNumber, {
      Status: action, 'Reviewed By': user.email, 'Reviewed At': now,
      'Review Note': String(reviewNote || '').trim().slice(0, 500)
    });
    attendanceWriteEvent_(sheets, user.email, '', key, 'LEAVE_' + action,
      JSON.stringify({ leaveId: id, employeeEmail: row.Email }), now);
    return { ok: true, message: 'Leave request ' + action.toLowerCase() + '.', leaveId: id, status: action };
  });
}

/**
 * Automatic closure policy is deliberately configuration-gated.
 * Set ATTENDANCE_MAX_SESSION_HOURS only after the business rule is approved.
 * This function records both the closure and reason in the session row and event log.
 */
function closeStaleAttendanceSessions() {
  requireAdmin_();
  const configured = PropertiesService.getScriptProperties().getProperty('ATTENDANCE_MAX_SESSION_HOURS');
  const maxHours = Number(configured);
  if (!configured || !isFinite(maxHours) || maxHours < 1 || maxHours > 24) {
    throw new Error('Set ATTENDANCE_MAX_SESSION_HOURS to an approved value between 1 and 24 before enabling stale-session closure.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const sheets = attendanceSheets_();
    const now = attendanceNow_();
    const cutoff = now.getTime() - maxHours * 60 * 60 * 1000;
    let closed = 0;
    attendanceRows_(sheets[ATTENDANCE.SHEETS.SESSIONS]).forEach(session => {
      if (session.Status !== 'OPEN' || !(session['Clock In At'] instanceof Date) ||
          session['Clock In At'].getTime() > cutoff) return;
      const closeAt = new Date(session['Clock In At'].getTime() + maxHours * 60 * 60 * 1000);
      const openBreak = attendanceOpenBreak_(sheets, session['Session ID']);
      if (openBreak) {
        attendanceUpdate_(sheets[ATTENDANCE.SHEETS.BREAKS], openBreak.__rowNumber, {
          'End At': closeAt, Status: 'AUTO_CLOSED'
        });
        attendanceWriteEvent_(sheets, session.Email, session['Session ID'], Utilities.getUuid(),
          'BREAK_AUTO_CLOSED', 'Automatically closed with stale attendance session.', now);
      }
      attendanceUpdate_(sheets[ATTENDANCE.SHEETS.SESSIONS], session.__rowNumber, {
        'Clock Out At': closeAt, Status: 'AUTO_CLOSED', 'Auto Closed At': now,
        'Auto Close Reason': 'Exceeded configured maximum session duration (' + maxHours + ' hours).',
        'Updated At': now
      });
      attendanceWriteEvent_(sheets, session.Email, session['Session ID'], Utilities.getUuid(),
        'SESSION_AUTO_CLOSED', 'Exceeded configured maximum session duration (' + maxHours + ' hours).', now);
      closed += 1;
    });
    return { ok: true, closed: closed, checkedAt: attendanceTimestamp_(now), maxHours: maxHours };
  } finally {
    lock.releaseLock();
  }
}

// ===== SOURCE: apps-script/Code.gs =====
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Labeller Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Phase 0 diagnostic only. Intentionally reads no master or task spreadsheet.
 * Verify the deployed /exec URL as both a test admin and test labeller.
 */
function getIdentityDiagnostic() {
  const activeEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  // Keep the owner's effective identity in server-side execution logs, not in the public response.
  Logger.log('Identity diagnostic activeUserEmail=%s; effectiveUserEmail=%s', activeEmail, effectiveEmail);

  return {
    activeUserEmail: activeEmail,
    timestamp: Utilities.formatDate(new Date(), APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timeZone: APP.TIME_ZONE,
    identityGatePassed: isIdentityGatePassed_(),
    message: activeEmail
      ? 'Compare activeUserEmail with the account used to open this deployed app.'
      : 'Active-user email is blank. Keep the identity gate closed.'
  };
}

function getBootstrap() {
  const identity = getIdentityDiagnostic();

  if (!identity.activeUserEmail) {
    return { ok: false, phase: 0, identity: identity, message: 'Identity could not be verified.' };
  }

  if (!isIdentityGatePassed_()) {
    return { ok: true, phase: 0, identity: identity, message: 'Identity gate is closed; no task data is available.' };
  }

  const user = requireActiveEmployee_();
  return {
    ok: true,
    phase: 1,
    identity: identity,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    message: 'Identity and employee access verified.'
  };
}