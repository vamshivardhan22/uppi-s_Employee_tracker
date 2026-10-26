function email_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function active_(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return value === true || ['true', 'yes', '1', 'active'].includes(s);
}

function readTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };
  const headers = values.shift().map(v => String(v == null ? '' : v).trim());
  const nonblank = headers.filter(Boolean).map(v => v.toLowerCase());
  if (new Set(nonblank).size !== nonblank.length) {
    throw new Error('Duplicate headers in tab: ' + sheet.getName());
  }
  return {
    headers: headers,
    rows: values.filter(row => row.some(v => v !== '' && v !== null))
  };
}

function indexOfHeader_(headers, name) {
  const target = String(name).trim().toLowerCase();
  return headers.findIndex(h => String(h || '').trim().toLowerCase() === target);
}

function requireEmployee_() {
  if (!gatePassed_()) throw new Error('Identity gate is closed.');
  // Never trust a browser-supplied email. The caller cannot provide one.
  const email = email_(Session.getActiveUser().getEmail());
  if (!email) throw new Error('Google account email could not be verified.');

  const sheet = master_().getSheetByName(APP.EMPLOYEES);
  if (!sheet) throw new Error('Employees tab is missing.');
  const table = readTable_(sheet);
  const emailCol = indexOfHeader_(table.headers, 'Email');
  const nameCol = indexOfHeader_(table.headers, 'Display Name');
  const roleCol = indexOfHeader_(table.headers, 'Role');
  const activeCol = indexOfHeader_(table.headers, 'Active');
  if ([emailCol, nameCol, roleCol, activeCol].some(i => i < 0)) {
    throw new Error('Employees tab headers are incomplete.');
  }

  const rows = table.rows.filter(row => email_(row[emailCol]) === email);
  if (rows.length !== 1) throw new Error('Account must have exactly one Employees row.');
  const row = rows[0];
  const role = String(row[roleCol] || '').trim().toLowerCase();
  if (!active_(row[activeCol])) throw new Error('Account is inactive.');
  if (!['admin', 'labeller'].includes(role)) throw new Error('Invalid role configured.');
  return { email: email, name: String(row[nameCol] || email).trim(), role: role };
}

function requireAdmin_() {
  const user = requireEmployee_();
  if (user.role !== 'admin') throw new Error('Administrator access is required.');
  return user;
}
