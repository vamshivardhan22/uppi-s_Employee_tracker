function headerMap_(headers) {
  const result = {};
  headers.forEach((header, index) => {
    const key = String(header || '').trim();
    if (key) result[key] = index;
  });
  return result;
}

function assignedProjects_(email) {
  const master = master_();
  const projectsSheet = master.getSheetByName(APP.PROJECTS);
  const accessSheet = master.getSheetByName(APP.ACCESS);
  if (!projectsSheet || !accessSheet) throw new Error('Projects or Access tab is missing.');

  const projects = readTable_(projectsSheet);
  const access = readTable_(accessSheet);
  const p = headerMap_(projects.headers);
  const a = headerMap_(access.headers);

  ['Project ID', 'Project Name', 'Spreadsheet ID', 'Tab Name', 'Timezone', 'Active']
    .forEach(key => { if (p[key] === undefined) throw new Error('Projects tab is missing: ' + key); });
  ['Email', 'Project ID', 'Active']
    .forEach(key => { if (a[key] === undefined) throw new Error('Access tab is missing: ' + key); });

  const allowedIds = new Set(access.rows
    .filter(row => email_(row[a.Email]) === email && active_(row[a.Active]))
    .map(row => String(row[a['Project ID']] || '').trim()));

  return projects.rows
    .filter(row => active_(row[p.Active]) && allowedIds.has(String(row[p['Project ID']] || '').trim()))
    .map(row => ({
      id: String(row[p['Project ID']] || '').trim(),
      name: String(row[p['Project Name']] || '').trim(),
      spreadsheetId: String(row[p['Spreadsheet ID']] || '').trim(),
      tab: String(row[p['Tab Name']] || '').trim(),
      timezone: String(row[p.Timezone] || APP.TZ).trim()
    }))
    .filter(project => project.id && project.spreadsheetId && project.tab);
}

function mapping_(projectId) {
  const sheet = master_().getSheetByName(APP.MAP);
  if (!sheet) throw new Error('Column_Map tab is missing.');
  const table = readTable_(sheet);
  const h = headerMap_(table.headers);
  ['Project ID', 'Canonical Field', 'Sheet Header', 'Required']
    .forEach(key => { if (h[key] === undefined) throw new Error('Column_Map tab is missing: ' + key); });

  const mapping = {};
  table.rows
    .filter(row => String(row[h['Project ID']] || '').trim() === projectId)
    .forEach(row => {
      const canonical = String(row[h['Canonical Field']] || '').trim();
      const sourceHeader = String(row[h['Sheet Header']] || '').trim();
      if (canonical && sourceHeader) mapping[canonical] = sourceHeader;
    });
  return mapping;
}

function readProjectTable_(project) {
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(project.spreadsheetId);
  } catch (error) {
    throw new Error('Cannot open source spreadsheet for project ' + project.id + '; verify the ID and owner access.');
  }
  const sheet = spreadsheet.getSheetByName(project.tab);
  if (!sheet) throw new Error('Configured tab "' + project.tab + '" was not found for project ' + project.id + '.');
  return readTable_(sheet);
}

function mappedValue_(row, headers, mapping, canonicalField) {
  const sourceHeader = mapping[canonicalField];
  if (!sourceHeader) return '';
  const index = indexOfHeader_(headers, sourceHeader);
  return index < 0 ? '' : row[index];
}

function safeValue_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  return String(value).trim();
}
