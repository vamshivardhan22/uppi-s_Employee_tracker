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
