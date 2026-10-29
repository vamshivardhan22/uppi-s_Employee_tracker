/**
 * Phase 5 operational health, configuration audit, environment gates and private TEST backups.
 * Audits only read configured task sources; all application-owned writes stay in the private master.
 */

function getOperationalHealth(authToken) {
  requireAdmin_(authToken);
  const props = PropertiesService.getScriptProperties();
  const master = getMasterSpreadsheet_();
  const managedTabs = [
    APP.SHEETS.EMPLOYEES, APP.SHEETS.PROJECTS, APP.SHEETS.ACCESS,
    APP.SHEETS.COLUMN_MAP, AUTH.CREDENTIAL_SHEET
  ].concat(Object.keys(ATTENDANCE.HEADERS), Object.keys(ISSUE_SCAN.HEADERS),
    Object.keys(ADMIN_CONSOLE.HEADERS));
  const tabs = managedTabs.map(name => {
    const sheet = master.getSheetByName(name);
    return {
      name: name, exists: Boolean(sheet),
      dataRows: sheet ? Math.max(0, sheet.getLastRow() - 1) : 0,
      columns: sheet ? sheet.getLastColumn() : 0
    };
  });
  const employees = adminEmployeeObjects_();
  const projects = adminProjectObjects_();
  const triggers = ScriptApp.getProjectTriggers().map(trigger => ({
    handler: trigger.getHandlerFunction(),
    eventType: String(trigger.getEventType ? trigger.getEventType() : '')
  }));
  return {
    ok: true,
    environment: String(props.getProperty('APP_ENV_LABEL') || 'UNSET').trim().toUpperCase(),
    timeZone: APP.TIME_ZONE,
    dataGatePassed: isIdentityGatePassed_(),
    activeEmployees: employees.filter(item => item.active).length,
    activeAdmins: employees.filter(item => item.active && item.role === 'admin').length,
    activeProjects: projects.filter(item => item.active).length,
    issueEmailEnabled: props.getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true',
    issueScheduleEnabled: props.getProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY) === 'true',
    triggerHandlers: triggers,
    sheets: tabs,
    message: 'Health overview is read-only. Row counts are metadata, not a completeness guarantee.'
  };
}

function adminCheckProjectSource_(project) {
  try {
    const spreadsheet = SpreadsheetApp.openById(project.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(project.tabName);
    if (!sheet) return { passed: false, details: 'Configured source tab was not found.' };
    if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
      return { passed: false, details: 'Source tab has no header row.' };
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      .map(value => String(value == null ? '' : value).trim());
    const nonBlank = headers.filter(Boolean).map(value => value.toLowerCase());
    if (new Set(nonBlank).size !== nonBlank.length) {
      return { passed: false, details: 'Duplicate source header names were found.' };
    }
    const mapping = getColumnMappings_(project.projectId);
    const required = [APP.FIELDS.SET_ID, APP.FIELDS.ANNOTATOR_EMAIL, APP.FIELDS.STATUS];
    const missing = required.filter(field => !mapping[field] ||
      findHeaderIndex_(headers, mapping[field]) < 0);
    if (missing.length) {
      return { passed: false, details: 'Missing required mapping/header: ' + missing.join(', ') + '.' };
    }
    return { passed: true, details: 'Source spreadsheet and required mappings are readable.' };
  } catch (error) {
    return { passed: false, details: String(error && error.message ? error.message : error) };
  }
}

function runConfigurationAudit(authToken) {
  const actor = requireAdmin_(authToken);
  adminRequireStorage_();
  const props = PropertiesService.getScriptProperties();
  const checks = [];
  function add(severity, key, label, passed, details) {
    checks.push({
      severity: severity, key: key, label: label,
      passed: Boolean(passed), details: String(details || '')
    });
  }
  const employees = adminEmployeeObjects_();
  const projects = adminProjectObjects_();
  const access = adminAccessObjects_();
  const mappings = adminMappingObjects_();
  const activeAdmins = employees.filter(item => item.active && item.role === 'admin');
  const duplicateEmails = Array.from(employees.reduce((map, item) => {
    map.set(item.email, (map.get(item.email) || 0) + 1); return map;
  }, new Map()).entries()).filter(item => item[1] > 1).map(item => item[0]);
  const duplicateProjects = Array.from(projects.reduce((map, item) => {
    map.set(item.projectId, (map.get(item.projectId) || 0) + 1); return map;
  }, new Map()).entries()).filter(item => item[1] > 1).map(item => item[0]);

  add('BLOCKER', 'active_admin', 'At least one active administrator', activeAdmins.length > 0,
    activeAdmins.length ? activeAdmins.length + ' active admin account(s).' : 'No active admin account exists.');
  add('BLOCKER', 'employee_unique', 'Employee email uniqueness', duplicateEmails.length === 0,
    duplicateEmails.length ? 'Duplicate emails: ' + duplicateEmails.join(', ') : 'No duplicate normalized emails.');
  add('BLOCKER', 'project_unique', 'Project ID uniqueness', duplicateProjects.length === 0,
    duplicateProjects.length ? 'Duplicate IDs: ' + duplicateProjects.join(', ') : 'No duplicate project IDs.');
  const validPeople = employees.every(item =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email) && ['admin', 'labeller'].includes(item.role));
  add('BLOCKER', 'employee_rows', 'Employee records have valid email and role', validPeople,
    validPeople ? 'All employee records pass basic field checks.' : 'At least one employee record has an invalid email or role.');

  const employeeByEmail = new Map();
  employees.forEach(item => { if (!employeeByEmail.has(item.email)) employeeByEmail.set(item.email, item); });
  const projectById = new Map();
  projects.forEach(item => { if (!projectById.has(item.projectId)) projectById.set(item.projectId, item); });
  const danglingAccess = access.filter(row => row.active &&
    (!employeeByEmail.has(row.email) || !employeeByEmail.get(row.email).active ||
      !projectById.has(row.projectId) || !projectById.get(row.projectId).active));
  add('BLOCKER', 'access_references', 'Active access references active people and projects',
    danglingAccess.length === 0,
    danglingAccess.length ? danglingAccess.length + ' active Access row(s) reference missing/inactive records.' :
      'No dangling active Access rows.');

  const mappingCounts = new Map();
  mappings.forEach(item => {
    const key = item.projectId + '|' + item.canonicalField.toLowerCase();
    mappingCounts.set(key, (mappingCounts.get(key) || 0) + 1);
  });
  const duplicateMappings = Array.from(mappingCounts.entries()).filter(item => item[1] > 1);
  add('BLOCKER', 'mapping_unique', 'One mapping per project and canonical field',
    duplicateMappings.length === 0,
    duplicateMappings.length ? 'Duplicate mappings: ' + duplicateMappings.map(item => item[0]).join(', ') :
      'No duplicate mappings.');

  const mappingByProject = new Map();
  mappings.forEach(item => {
    if (!mappingByProject.has(item.projectId)) mappingByProject.set(item.projectId, new Set());
    mappingByProject.get(item.projectId).add(item.canonicalField);
  });
  const missingMappingProjects = projects.filter(item => item.active).filter(project => {
    const present = mappingByProject.get(project.projectId) || new Set();
    return [APP.FIELDS.SET_ID, APP.FIELDS.ANNOTATOR_EMAIL, APP.FIELDS.STATUS].some(field => !present.has(field));
  }).map(item => item.projectId);
  add('BLOCKER', 'required_mappings', 'Required task mappings exist for active projects',
    missingMappingProjects.length === 0,
    missingMappingProjects.length ? 'Projects missing required mappings: ' + missingMappingProjects.join(', ') :
      'All active projects have required mappings.');

  const sourceChecks = projects.filter(item => item.active).map(project => {
    const result = adminCheckProjectSource_(project);
    return { projectId: project.projectId, projectName: project.projectName,
      passed: result.passed, details: result.details };
  });
  sourceChecks.forEach(item => add('BLOCKER', 'source_' + item.projectId,
    'Source integrity: ' + item.projectName, item.passed, item.details));

  const credentialSheet = getMasterSpreadsheet_().getSheetByName(AUTH.CREDENTIAL_SHEET);
  const credentialWarnings = [];
  if (!credentialSheet) {
    credentialWarnings.push('Employee_Credentials is missing.');
  } else {
    const credentialData = adminReadRows_(credentialSheet, ['Email', 'Access Code Hash', 'Active']);
    const byEmail = new Map();
    credentialData.rows.forEach(row => {
      const email = normalizeEmail_(row[credentialData.headerMap.Email]);
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(row);
    });
    employees.filter(item => item.active).forEach(item => {
      const rows = byEmail.get(item.email) || [];
      if (rows.length !== 1 || !isActiveValue_(rows[0][credentialData.headerMap.Active]) ||
          !String(rows[0][credentialData.headerMap['Access Code Hash']] || '')) {
        credentialWarnings.push(item.email + ' needs code provisioning or duplicate credentials resolved.');
      }
    });
  }
  add('WARNING', 'credential_ready', 'Active employees have one active access-code record',
    credentialWarnings.length === 0,
    credentialWarnings.length ? credentialWarnings.join(' ') : 'Active employee credential records look ready.');

  const env = String(props.getProperty('APP_ENV_LABEL') || '').trim().toUpperCase();
  add('BLOCKER', 'environment', 'Environment is explicitly labeled TEST',
    env === 'TEST', env === 'TEST' ? 'APP_ENV_LABEL=TEST.' : 'Set APP_ENV_LABEL=TEST in TEST.');
  const masterId = getMasterSpreadsheetId_();
  const testMasterId = String(props.getProperty('TEST_MASTER_SPREADSHEET_ID') || '').trim();
  const prodMasterId = String(props.getProperty('PROD_MASTER_SPREADSHEET_ID') || '').trim();
  const masterMatchesTest = Boolean(masterId && testMasterId && masterId === testMasterId);
  add('BLOCKER', 'master_binding', 'MASTER_SPREADSHEET_ID matches TEST_MASTER_SPREADSHEET_ID',
    env === 'TEST' && masterMatchesTest,
    masterMatchesTest ? 'Current and expected TEST master IDs match.' :
      'Set TEST_MASTER_SPREADSHEET_ID equal to MASTER_SPREADSHEET_ID.');
  add('BLOCKER', 'prod_property_separation', 'TEST project does not contain a PROD master ID',
    env === 'TEST' && !prodMasterId,
    prodMasterId ? 'Remove PROD_MASTER_SPREADSHEET_ID from TEST. Production uses a separate project.' :
      'No PROD master ID is stored in TEST.');
  const emailEnabled = props.getProperty(ISSUE_SCAN.EMAIL_ENABLED_PROPERTY) === 'true';
  const scheduleEnabled = props.getProperty(ISSUE_SCAN.SCHEDULE_ENABLED_PROPERTY) === 'true';
  add('WARNING', 'email_off', 'Issue email reminders remain disabled', !emailEnabled,
    emailEnabled ? 'Email reminders are enabled; verify recipient policy and quota.' : 'Email reminders are disabled.');
  add('WARNING', 'schedule_off', 'Scheduled scans remain disabled during initial validation', !scheduleEnabled,
    scheduleEnabled ? 'A scheduled scan is enabled; review its trigger.' : 'No scheduled scan is enabled.');

  const blockers = checks.filter(item => item.severity === 'BLOCKER' && !item.passed).length;
  const warnings = checks.filter(item => item.severity === 'WARNING' && !item.passed).length;
  const summary = { checks: checks.length, passed: checks.filter(item => item.passed).length, blockers: blockers, warnings: warnings };
  const auditWarning = adminWriteAuditSafely_(actor, 'CONFIGURATION_AUDIT_RUN', 'CONFIGURATION', 'MASTER',
    null, { summary: summary });
  return {
    ok: true, summary: summary, checks: checks, sourceChecks: sourceChecks,
    passed: blockers === 0, auditWarning: auditWarning,
    message: (blockers === 0
      ? 'Configuration audit found no blockers. Review warnings and live-test limitations before release.'
      : 'Configuration audit found ' + blockers + ' blocker(s). Do not promote this environment.') + auditWarning
  };
}

function getReleaseChecklist(authToken) {
  requireAdmin_(authToken);
  const readiness = getReleaseReadiness(authToken);
  const health = getOperationalHealth(authToken);
  const audit = runConfigurationAudit(authToken);
  const props = PropertiesService.getScriptProperties();
  const steps = [
    { key: 'synthetic_only', label: 'Operator confirms only synthetic data in TEST',
      passed: readiness.environment === 'TEST' && props.getProperty('SYNTHETIC_TEST_DATA_CONFIRMED') === 'true' },
    { key: 'environment', label: 'Explicit APP_ENV_LABEL=TEST', passed: readiness.environment === 'TEST' },
    { key: 'master_binding', label: 'TEST master matches TEST_MASTER_SPREADSHEET_ID', passed: readiness.currentMasterMatchesExpected },
    { key: 'gate', label: 'TEST data gate enabled for test execution', passed: readiness.dataGatePassed },
    { key: 'email_off', label: 'Email reminders disabled until approved', passed: !readiness.emailEnabled },
    { key: 'schedule_off', label: 'Scheduled scanners disabled until approved', passed: !readiness.scheduleEnabled },
    { key: 'admin_exists', label: 'At least one active admin exists', passed: health.activeAdmins > 0 },
    { key: 'config_audit', label: 'Configuration audit has no blockers', passed: audit.passed }
  ];
  const passed = steps.filter(item => item.passed).length;
  return {
    ok: true, steps: steps,
    summary: { total: steps.length, passed: passed, failed: steps.length - passed },
    audit: audit.summary,
    message: 'TEST readiness checklist only. It is not production deployment approval.'
  };
}

/**
 * Explicit TEST-only backup. Backups include access-code hashes and all app-owned data.
 * Enable only for a deliberate TEST backup drill; never overwrite the active master in place.
 */
function createPrivateTestBackup(authToken) {
  const actor = requireAdmin_(authToken);
  const props = PropertiesService.getScriptProperties();
  const env = String(props.getProperty('APP_ENV_LABEL') || '').trim().toUpperCase();
  if (env !== 'TEST') throw new Error('Backups are restricted to an explicitly labeled TEST environment.');
  if (props.getProperty('TEST_BACKUP_ENABLED') !== 'true') {
    throw new Error('Backup creation is disabled. Set TEST_BACKUP_ENABLED=true only for the approved TEST backup drill.');
  }
  if (!isIdentityGatePassed_()) throw new Error('Environment/master identity check failed. Backup blocked.');
  adminRequireStorage_();
  const sourceId = getMasterSpreadsheetId_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('The application is busy. Try again shortly.');
  let copy = null;
  try {
    const stamp = Utilities.formatDate(new Date(), APP.TIME_ZONE, 'yyyyMMdd-HHmmss');
    copy = DriveApp.getFileById(sourceId).makeCopy('Labeller Dashboard TEST master backup ' + stamp);
    try {
      copy.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      if (copy.getSharingAccess() !== DriveApp.Access.PRIVATE) {
        throw new Error('Backup copy is not private after setting sharing.');
      }
      const backupSpreadsheet = SpreadsheetApp.openById(copy.getId());
      const required = Object.keys(ATTENDANCE.HEADERS)
        .concat(Object.keys(ISSUE_SCAN.HEADERS), Object.keys(ADMIN_CONSOLE.HEADERS))
        .concat([APP.SHEETS.EMPLOYEES, APP.SHEETS.PROJECTS, APP.SHEETS.ACCESS, APP.SHEETS.COLUMN_MAP, AUTH.CREDENTIAL_SHEET]);
      const missing = required.filter(name => !backupSpreadsheet.getSheetByName(name));
      if (missing.length) throw new Error('Backup copy is missing required tabs: ' + missing.join(', '));
      const log = getMasterSpreadsheet_().getSheetByName('Backup_Log');
      if (!log) throw new Error('Backup_Log is missing. Initialize admin storage first.');
      const backupId = Utilities.getUuid();
      const url = copy.getUrl();
      log.appendRow([backupId, new Date(), actor.email, env, sourceId, copy.getId(), url, 'CREATED',
        'Private copy verified; a separate restore drill is still required.']);
      const auditWarning = adminWriteAuditSafely_(actor, 'TEST_MASTER_BACKUP_CREATED', 'BACKUP', backupId, null,
        { backupSpreadsheetId: copy.getId(), status: 'CREATED' });
      return {
        ok: true, backupId: backupId, spreadsheetId: copy.getId(), url: url,
        message: 'Private TEST master backup created and required tabs verified.' + auditWarning,
        restoreNote: 'For a restore drill, make another private copy of this backup and point a separate TEST Apps Script project at that copy. Never overwrite the active master in place.'
      };
    } catch (error) {
      try { copy.setTrashed(true); } catch (trashError) {}
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function verifyPrivateTestBackup(authToken, backupSpreadsheetIdValue) {
  requireAdmin_(authToken);
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('APP_ENV_LABEL') || '').trim().toUpperCase() !== 'TEST') {
    throw new Error('Backup verification is restricted to an explicitly labeled TEST environment.');
  }
  if (props.getProperty('TEST_BACKUP_ENABLED') !== 'true') {
    throw new Error('Backup verification is disabled. Enable TEST_BACKUP_ENABLED only for the approved drill.');
  }
  const backupId = String(backupSpreadsheetIdValue || '').trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(backupId)) throw new Error('Enter a valid backup spreadsheet ID.');
  const master = adminRequireStorage_();
  const log = adminReadRows_(master.getSheetByName('Backup_Log'), ADMIN_CONSOLE.HEADERS.Backup_Log);
  const logged = log.rows.find(row =>
    String(row[log.headerMap['Backup Spreadsheet ID']] || '') === backupId &&
    String(row[log.headerMap.Status] || '') === 'CREATED');
  if (!logged) throw new Error('Backup ID is not a successfully created backup in Backup_Log.');
  const file = DriveApp.getFileById(backupId);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('Backup is not private. Stop and correct sharing before any restore drill.');
  }
  const spreadsheet = SpreadsheetApp.openById(backupId);
  const required = Object.keys(ATTENDANCE.HEADERS)
    .concat(Object.keys(ISSUE_SCAN.HEADERS), Object.keys(ADMIN_CONSOLE.HEADERS))
    .concat([APP.SHEETS.EMPLOYEES, APP.SHEETS.PROJECTS, APP.SHEETS.ACCESS, APP.SHEETS.COLUMN_MAP, AUTH.CREDENTIAL_SHEET]);
  const missing = required.filter(name => !spreadsheet.getSheetByName(name));
  if (missing.length) throw new Error('Backup is incomplete. Missing tabs: ' + missing.join(', '));
  return {
    ok: true, backupSpreadsheetId: backupId, name: file.getName(), private: true,
    tabCount: spreadsheet.getSheets().length, requiredTabCount: required.length,
    message: 'Backup privacy and required-tab checks passed. A separate TEST restore drill is still required.'
  };
}

function listPrivateTestBackups(authToken) {
  requireAdmin_(authToken);
  const master = getMasterSpreadsheet_();
  const sheet = master.getSheetByName('Backup_Log');
  if (!sheet) return { ok: true, ready: false, backups: [] };
  const data = adminReadRows_(sheet, ADMIN_CONSOLE.HEADERS.Backup_Log);
  return {
    ok: true, ready: true,
    backups: data.rows.slice(-20).reverse().map(row => ({
      backupId: String(row[data.headerMap['Backup ID']] || ''),
      createdAt: issueFormatDateTime_(row[data.headerMap['Created At']]),
      createdBy: String(row[data.headerMap['Created By']] || ''),
      backupSpreadsheetId: String(row[data.headerMap['Backup Spreadsheet ID']] || ''),
      url: String(row[data.headerMap['Backup URL']] || ''),
      status: String(row[data.headerMap.Status] || ''),
      details: String(row[data.headerMap.Details] || '')
    }))
  };
}
