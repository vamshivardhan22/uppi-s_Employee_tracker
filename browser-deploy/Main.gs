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

const AUTH = Object.freeze({
  CREDENTIAL_SHEET: 'Employee_Credentials',
  PROVISION_EMAIL_PROPERTY: 'ACCESS_CODE_FOR_EMAIL',
  CREDENTIAL_HEADERS: Object.freeze([
    'Email', 'Access Code Hash', 'Active', 'Created At', 'Updated At'
  ]),
  SESSION_TTL_SECONDS: 14400,
  LOGIN_FAILURE_LIMIT: 10,
  LOGIN_FAILURE_WINDOW_SECONDS: 900
});

/** Run from the Apps Script editor as the owner, after MASTER_SPREADSHEET_ID is set. */
function initializeAuthStorage_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const master = getMasterSpreadsheet_();
    let sheet = master.getSheetByName(AUTH.CREDENTIAL_SHEET);
    if (!sheet) {
      sheet = master.insertSheet(AUTH.CREDENTIAL_SHEET);
      sheet.getRange(1, 1, 1, AUTH.CREDENTIAL_HEADERS.length).setValues([AUTH.CREDENTIAL_HEADERS]);
      sheet.setFrozenRows(1);
      return { ok: true, message: 'Employee_Credentials created in the private master spreadsheet.' };
    }
    const width = sheet.getLastColumn();
    if (sheet.getLastRow() === 0 || width === 0) {
      sheet.getRange(1, 1, 1, AUTH.CREDENTIAL_HEADERS.length).setValues([AUTH.CREDENTIAL_HEADERS]);
      sheet.setFrozenRows(1);
      return { ok: true, message: 'Employee_Credentials initialized.' };
    }
    const actual = sheet.getRange(1, 1, 1, width).getDisplayValues()[0]
      .map(value => String(value || '').trim());
    if (actual.length !== AUTH.CREDENTIAL_HEADERS.length ||
        AUTH.CREDENTIAL_HEADERS.some((header, index) => actual[index] !== header)) {
      throw new Error('Employee_Credentials has unexpected headers. No data was changed.');
    }
    return { ok: true, message: 'Employee_Credentials exists and its headers were verified.' };
  } finally {
    lock.releaseLock();
  }
}

function authCredentialSheet_() {
  const sheet = getMasterSpreadsheet_().getSheetByName(AUTH.CREDENTIAL_SHEET);
  if (!sheet) throw new Error('Access-code storage is not initialized. Ask the administrator to initialize it.');
  const width = sheet.getLastColumn();
  const actual = sheet.getRange(1, 1, 1, Math.max(width, 1)).getDisplayValues()[0]
    .map(value => String(value || '').trim());
  if (actual.length !== AUTH.CREDENTIAL_HEADERS.length ||
      AUTH.CREDENTIAL_HEADERS.some((header, index) => actual[index] !== header)) {
    throw new Error('Employee_Credentials has unexpected headers. Contact the administrator.');
  }
  return sheet;
}

function authDigestHex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(byte => {
    const normalized = (byte + 256) % 256;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function newAccessCode_() {
  // Two UUIDs produce a high-entropy per-employee bearer code. Store only its SHA-256 hash.
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function findActiveEmployeeByEmail_(email) {
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
  if (matches.length !== 1 || !isActiveValue_(matches[0][activeIndex])) return null;

  const role = String(matches[0][roleIndex] == null ? '' : matches[0][roleIndex]).trim().toLowerCase();
  if (!['admin', 'labeller'].includes(role)) return null;

  return {
    email: email,
    displayName: String(matches[0][nameIndex] || email).trim(),
    role: role
  };
}

/**
 * Admin/editor-only helper. Run manually from the Apps Script editor.
 * It logs a one-time access code; copy it directly to the intended employee using a private channel.
 * Do not expose this function through the browser UI.
 */
function provisionEmployeeAccessCode_() {
  const props = PropertiesService.getScriptProperties();
  const email = normalizeEmail_(props.getProperty(AUTH.PROVISION_EMAIL_PROPERTY));
  if (!email) throw new Error('Set Script Property ' + AUTH.PROVISION_EMAIL_PROPERTY + ' to the employee email before running this helper.');
  const user = findActiveEmployeeByEmail_(email);
  if (!user) throw new Error('The email must match exactly one active Employees row with a valid role.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  try {
    const sheet = authCredentialSheet_();
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(value => String(value == null ? '' : value).trim());
    const indices = {};
    AUTH.CREDENTIAL_HEADERS.forEach(header => {
      indices[header] = findHeaderIndex_(headers, header);
    });

    const matchingRows = [];
    for (let i = 1; i < values.length; i++) {
      if (normalizeEmail_(values[i][indices.Email]) === email) matchingRows.push(i + 1);
    }
    if (matchingRows.length > 1) {
      throw new Error('Duplicate credential rows exist for this email. Resolve them before issuing a new code.');
    }

    const code = newAccessCode_();
    const now = new Date();
    const record = [
      email, authDigestHex_(code), true,
      matchingRows.length ? (values[matchingRows[0] - 1][indices['Created At']] || now) : now,
      now
    ];
    if (matchingRows.length) {
      sheet.getRange(matchingRows[0], 1, 1, record.length).setValues([record]);
    } else {
      sheet.appendRow(record);
    }

    Logger.log('ONE-TIME ACCESS CODE for %s: %s', email, code);
    props.deleteProperty(AUTH.PROVISION_EMAIL_PROPERTY);
    return 'Access code generated and stored as a hash. Copy the one-time code from the execution log and deliver it privately.';
  } finally {
    lock.releaseLock();
  }
}

function authFailureKey_(email) {
  return 'AUTH_FAIL_' + authDigestHex_(email).slice(0, 32);
}

function authSessionKey_(token) {
  return 'AUTH_SESSION_' + authDigestHex_(token);
}

/**
 * Public sign-in endpoint. The email is only an account lookup; possession of the unique
 * per-employee access code is the credential. It does not claim to verify a Google login.
 */
function login(emailValue, accessCodeValue) {
  const email = normalizeEmail_(emailValue);
  const code = String(accessCodeValue == null ? '' : accessCodeValue).trim().toLowerCase();
  if (!email || !/^[a-f0-9]{64}$/.test(code)) {
    return { ok: false, message: 'Invalid email or access code.' };
  }

  const cache = CacheService.getScriptCache();
  const failureKey = authFailureKey_(email);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, message: 'Sign-in is busy. Try again shortly.' };
  }

  try {
    const failures = Number(cache.get(failureKey) || 0);
    if (failures >= AUTH.LOGIN_FAILURE_LIMIT) {
      return { ok: false, message: 'Sign-in is temporarily locked for this email. Try again in 15 minutes.' };
    }

    let user = null;
    let storedHash = '';
    let credentialActive = false;
    try {
      user = findActiveEmployeeByEmail_(email);
      const sheet = authCredentialSheet_();
      const table = readTable_(sheet);
      const emailIndex = findHeaderIndex_(table.headers, 'Email');
      const hashIndex = findHeaderIndex_(table.headers, 'Access Code Hash');
      const activeIndex = findHeaderIndex_(table.headers, 'Active');
      if ([emailIndex, hashIndex, activeIndex].some(index => index < 0)) {
        throw new Error('Credential storage is missing required headers.');
      }
      const rows = table.rows.filter(row => normalizeEmail_(row[emailIndex]) === email);
      if (rows.length === 1) {
        storedHash = String(rows[0][hashIndex] || '').trim().toLowerCase();
        credentialActive = isActiveValue_(rows[0][activeIndex]);
      }
      if (rows.length > 1) throw new Error('Duplicate credential rows exist.');
    } catch (error) {
      Logger.log('Access-code sign-in configuration error: %s', String(error && error.message ? error.message : error));
      return { ok: false, message: 'Sign-in is not configured correctly. Contact the administrator.' };
    }

    if (!user || !credentialActive || !/^[a-f0-9]{64}$/.test(storedHash) ||
        storedHash !== authDigestHex_(code)) {
      cache.put(failureKey, String(failures + 1), AUTH.LOGIN_FAILURE_WINDOW_SECONDS);
      return { ok: false, message: 'Invalid email or access code.' };
    }

    cache.remove(failureKey);
    const token = newAccessCode_();
    const now = Date.now();
    const session = {
      email: user.email,
      credentialHash: storedHash,
      issuedAt: now,
      expiresAt: now + AUTH.SESSION_TTL_SECONDS * 1000
    };
    cache.put(authSessionKey_(token), JSON.stringify(session), AUTH.SESSION_TTL_SECONDS);
    return {
      ok: true,
      token: token,
      expiresAt: session.expiresAt,
      user: { email: user.email, displayName: user.displayName, role: user.role },
      dataGatePassed: isIdentityGatePassed_(),
      message: isIdentityGatePassed_()
        ? 'Signed in. Access permissions will be checked for each request.'
        : 'Signed in, but application data remains locked until the administrator enables the TEST data gate.'
    };
  } finally {
    lock.releaseLock();
  }
}

function getAuthenticatedEmployee_(authToken) {
  const token = String(authToken == null ? '' : authToken).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error('Your session is missing or invalid. Sign in again.');
  }
  const cache = CacheService.getScriptCache();
  const rawSession = cache.get(authSessionKey_(token));
  if (!rawSession) throw new Error('Your session has expired. Sign in again.');

  let session;
  try {
    session = JSON.parse(rawSession);
  } catch (error) {
    throw new Error('Your session is invalid. Sign in again.');
  }
  if (!session.email || !session.expiresAt || Number(session.expiresAt) <= Date.now()) {
    cache.remove(authSessionKey_(token));
    throw new Error('Your session has expired. Sign in again.');
  }

  const user = findActiveEmployeeByEmail_(normalizeEmail_(session.email));
  if (!user) {
    cache.remove(authSessionKey_(token));
    throw new Error('Your employee access is inactive or misconfigured.');
  }
  const credentialTable = readTable_(authCredentialSheet_());
  const emailIndex = findHeaderIndex_(credentialTable.headers, 'Email');
  const hashIndex = findHeaderIndex_(credentialTable.headers, 'Access Code Hash');
  const activeIndex = findHeaderIndex_(credentialTable.headers, 'Active');
  const credentialRows = credentialTable.rows.filter(row => normalizeEmail_(row[emailIndex]) === user.email);
  if (credentialRows.length !== 1 || !isActiveValue_(credentialRows[0][activeIndex]) ||
      String(credentialRows[0][hashIndex] || '').toLowerCase() !== String(session.credentialHash || '')) {
    cache.remove(authSessionKey_(token));
    throw new Error('Your access code has been changed or disabled. Sign in again.');
  }
  return user;
}

function requireActiveEmployee_(authToken) {
  if (!isIdentityGatePassed_()) {
    throw new Error('Application data is locked. The administrator must enable the TEST data gate after checking access.');
  }
  return getAuthenticatedEmployee_(authToken);
}

function requireAdmin_(authToken) {
  const user = requireActiveEmployee_(authToken);
  if (user.role !== 'admin') throw new Error('Administrator access is required.');
  return user;
}

function logout(authToken) {
  const token = String(authToken == null ? '' : authToken).trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(token)) CacheService.getScriptCache().remove(authSessionKey_(token));
  return { ok: true };
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
function getMyWork(authToken) {
  // This token is issued only after the server validates the per-employee access code.
  // The data gate is checked before master/task source sheets are read.
  const user = requireActiveEmployee_(authToken);
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

function initializeAttendanceStorage(authToken) {
  const admin = requireAdmin_(authToken);
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
      if (expected.some((header, index) => actual[index] !== header) || actual.length !== expected.length) {
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

function attendanceWithAction_(authToken, action, requestId, operation) {
  const user = requireActiveEmployee_(authToken);
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

function getMyAttendanceStatus(authToken) {
  const user = requireActiveEmployee_(authToken);
  const sheets = attendanceSheets_();
  return attendanceStatusForUser_(user, sheets);
}

function attendanceClockIn(authToken, requestId) {
  return attendanceWithAction_(authToken, 'CLOCK_IN', requestId, function(user, sheets, key, now) {
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

function attendanceClockOut(authToken, requestId) {
  return attendanceWithAction_(authToken, 'CLOCK_OUT', requestId, function(user, sheets, key, now) {
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

function attendanceStartBreak(authToken, requestId, breakType) {
  return attendanceWithAction_(authToken, 'BREAK_START', requestId, function(user, sheets, key, now) {
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

function attendanceEndBreak(authToken, requestId) {
  return attendanceWithAction_(authToken, 'BREAK_END', requestId, function(user, sheets, key, now) {
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

function attendanceSubmitLeaveRequest(authToken, payload, requestId) {
  const data = payload && typeof payload === 'object' ? payload : {};
  return attendanceWithAction_(authToken, 'LEAVE_REQUEST', requestId, function(user, sheets, key, now) {
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

function getAttendanceLeaveRequests(authToken) {
  const user = requireActiveEmployee_(authToken);
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

function attendanceReviewLeaveRequest(authToken, leaveId, decision, reviewNote, requestId) {
  return attendanceWithAction_(authToken, 'LEAVE_REVIEW', requestId, function(user, sheets, key, now) {
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
function closeStaleAttendanceSessions_() {
  if (!isIdentityGatePassed_()) throw new Error('Application data is locked. Enable the data gate before running maintenance.');
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

/** Phase 0 status endpoint. Reads no spreadsheet and reveals no account identity. */
function getIdentityDiagnostic() {
  return {
    authMethod: 'employee_access_code',
    timestamp: Utilities.formatDate(new Date(), APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timeZone: APP.TIME_ZONE,
    dataGatePassed: isIdentityGatePassed_(),
    message: 'Sign in with your Employees email and privately issued access code.'
  };
}

function getBootstrap(authToken) {
  if (!authToken) {
    return { ok: false, phase: 0, message: 'Sign in with your employee email and access code.' };
  }
  let user;
  try {
    user = getAuthenticatedEmployee_(authToken);
  } catch (error) {
    return { ok: false, phase: 0, message: 'Your session is expired or invalid. Sign in again.' };
  }
  const gatePassed = isIdentityGatePassed_();
  return {
    ok: true,
    phase: gatePassed ? 1 : 0,
    dataGatePassed: gatePassed,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    timeZone: APP.TIME_ZONE,
    message: gatePassed
      ? 'Signed in. Server-side access checks are applied to each request.'
      : 'Signed in, but app data is locked until the administrator enables the TEST data gate.'
  };
}