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
