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
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(APP.IDENTITY_GATE_PROPERTY) !== 'true') return false;
  const env = String(props.getProperty('APP_ENV_LABEL') || '').trim().toUpperCase();
  const currentMasterId = String(props.getProperty(APP.MASTER_ID_PROPERTY) || '').trim();
  const expectedMasterProperty = env === 'TEST' ? 'TEST_MASTER_SPREADSHEET_ID'
    : (env === 'PROD' ? 'PROD_MASTER_SPREADSHEET_ID' : '');
  if (!expectedMasterProperty) return false;
  const expectedMasterId = String(props.getProperty(expectedMasterProperty) || '').trim();
  if (!currentMasterId || !expectedMasterId || currentMasterId !== expectedMasterId) return false;
  if (env === 'TEST') return true;
  return env === 'PROD' && props.getProperty('PRODUCTION_RELEASE_APPROVED') === 'true';
}
