const APP = Object.freeze({
  TZ: 'Asia/Kolkata',
  MASTER_PROP: 'MASTER_SPREADSHEET_ID',
  GATE_PROP: 'IDENTITY_GATE_PASSED',
  EMPLOYEES: 'Employees',
  PROJECTS: 'Projects',
  ACCESS: 'Access',
  MAP: 'Column_Map',
  COMPLETED: ['labelling done', 'review done', 'approved', 'rework done']
});

function masterId_() {
  const id = PropertiesService.getScriptProperties().getProperty(APP.MASTER_PROP);
  if (!id) throw new Error('Missing Script Property: ' + APP.MASTER_PROP);
  return id.trim();
}
function master_() {
  return SpreadsheetApp.openById(masterId_());
}
function gatePassed_() {
  return PropertiesService.getScriptProperties().getProperty(APP.GATE_PROP) === 'true';
}
