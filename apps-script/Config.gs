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
