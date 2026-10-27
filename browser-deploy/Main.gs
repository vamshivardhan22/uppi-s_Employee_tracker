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

// ===== SOURCE: apps-script/IssueScanner.gs =====
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
      continue;
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

function attendanceDateValueKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, APP.TIME_ZONE, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parsedIso = new Date(text + 'T00:00:00Z');
    return !isNaN(parsedIso.getTime()) && parsedIso.toISOString().slice(0, 10) === text ? text : '';
  }
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : Utilities.formatDate(parsed, APP.TIME_ZONE, 'yyyy-MM-dd');
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
  const leave = attendanceRows_(sheets[ATTENDANCE.SHEETS.LEAVE]).filter(row => {
    const startKey = attendanceDateValueKey_(row['Start Date']);
    const endKey = attendanceDateValueKey_(row['End Date']);
    return row.Email === user.email && Boolean(startKey) && Boolean(endKey) &&
      startKey <= today && endKey >= today;
  });
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
      startDate: attendanceDateValueKey_(row['Start Date']),
      endDate: attendanceDateValueKey_(row['End Date'])
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
      const existingStart = attendanceDateValueKey_(row['Start Date']);
      const existingEnd = attendanceDateValueKey_(row['End Date']);
      if (!existingStart || !existingEnd) {
        throw new Error('An existing leave request has an invalid date. Ask the administrator to review it before submitting another request.');
      }
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
      startDate: attendanceDateValueKey_(row['Start Date']),
      endDate: attendanceDateValueKey_(row['End Date']),
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