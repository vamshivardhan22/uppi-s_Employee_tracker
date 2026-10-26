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
