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

function initializeAttendanceStorage() {
  const admin = requireAdmin_();
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
      if (expected.some((header, index) => actual[index] !== header) || actual.length < expected.length) {
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

function attendanceWithAction_(action, requestId, operation) {
  if (!isIdentityGatePassed_()) throw new Error('Identity gate is closed. Attendance actions are disabled.');
  const user = requireActiveEmployee_();
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
    row.Email === email && row.Status === 'OPEN' && row['Work Date'] instanceof Date &&
    attendanceDateKey_(row['Work Date']) === dateKey);
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
  const leave = attendanceRows_(sheets[ATTENDANCE.SHEETS.LEAVE]).filter(row =>
    row.Email === user.email && row['Start Date'] instanceof Date &&
    attendanceDateKey_(row['Start Date']) === today);
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
    openSessionDate: openSession && openSession['Work Date'] instanceof Date ? attendanceDateKey_(openSession['Work Date']) : '',
    openBreak: openBreak ? { breakId: openBreak['Break ID'], type: openBreak['Break Type'],
      startAt: openBreak['Start At'] instanceof Date ? attendanceTimestamp_(openBreak['Start At']) : '' } : null,
    todayLeaveRequests: leave.map(row => ({
      leaveId: row['Leave ID'], type: row['Leave Type'], status: row.Status,
      startDate: row['Start Date'] instanceof Date ? attendanceDateKey_(row['Start Date']) : '',
      endDate: row['End Date'] instanceof Date ? attendanceDateKey_(row['End Date']) : ''
    }))
  };
}

function getMyAttendanceStatus() {
  if (!isIdentityGatePassed_()) throw new Error('Identity gate is closed. Attendance data is unavailable.');
  const user = requireActiveEmployee_();
  const sheets = attendanceSheets_();
  return attendanceStatusForUser_(user, sheets);
}

function attendanceClockIn(requestId) {
  return attendanceWithAction_('CLOCK_IN', requestId, function(user, sheets, key, now) {
    const today = attendanceDateKey_(now);
    const existing = attendanceCurrentSession_(sheets, user.email);
    if (existing) {
      const existingDate = existing['Work Date'] instanceof Date ? attendanceDateKey_(existing['Work Date']) : '';
      if (existingDate !== today) {
        throw new Error('A previous attendance session is still open. Ask an administrator to review and close it before clocking in again.');
      }
      throw new Error('You are already clocked in.');
    }
    const sessionId = Utilities.getUuid();
    attendanceAppend_(sheets[ATTENDANCE.SHEETS.SESSIONS], {
      'Session ID': sessionId, Email: user.email, 'Work Date': new Date(today + 'T00:00:00'),
      'Clock In At': now, 'Clock Out At': '', Status: 'OPEN',
      'Auto Closed At': '', 'Auto Close Reason': '', 'Created At': now, 'Updated At': now
    });
    attendanceWriteEvent_(sheets, user.email, sessionId, key, 'CLOCK_IN', '', now);
    return { ok: true, message: 'Clock-in recorded.', status: attendanceStatusForUser_(user, sheets) };
  });
}

function attendanceClockOut(requestId) {
  return attendanceWithAction_('CLOCK_OUT', requestId, function(user, sheets, key, now) {
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

function attendanceStartBreak(requestId, breakType) {
  return attendanceWithAction_('BREAK_START', requestId, function(user, sheets, key, now) {
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

function attendanceEndBreak(requestId) {
  return attendanceWithAction_('BREAK_END', requestId, function(user, sheets, key, now) {
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

function attendanceSubmitLeaveRequest(payload, requestId) {
  const data = payload && typeof payload === 'object' ? payload : {};
  return attendanceWithAction_('LEAVE_REQUEST', requestId, function(user, sheets, key, now) {
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
      if (!(row['Start Date'] instanceof Date) || !(row['End Date'] instanceof Date)) return false;
      const existingStart = attendanceDateKey_(row['Start Date']);
      const existingEnd = attendanceDateKey_(row['End Date']);
      return start <= existingEnd && end >= existingStart;
    });
    if (existingLeave) throw new Error('You already have a pending or approved leave request overlapping these dates.');
    const reason = String(data.reason || '').trim().slice(0, 500);
    const leaveId = Utilities.getUuid();
    const dateToSheetDate = text => new Date(text + 'T00:00:00');
    attendanceAppend_(sheets[ATTENDANCE.SHEETS.LEAVE], {
      'Leave ID': leaveId, Email: user.email, 'Start Date': dateToSheetDate(start),
      'End Date': dateToSheetDate(end), 'Leave Type': type, 'Partial Period': period,
      'Start Time': startTime, 'End Time': endTime, Reason: reason, Status: 'PENDING',
      'Requested At': now, 'Reviewed By': '', 'Reviewed At': '', 'Review Note': ''
    });
    attendanceWriteEvent_(sheets, user.email, '', key, 'LEAVE_REQUESTED',
      JSON.stringify({ leaveId: leaveId, type: type, startDate: start, endDate: end }), now);
    return { ok: true, message: 'Leave request submitted for admin review.', leaveId: leaveId };
  });
}

function getAttendanceLeaveRequests() {
  if (!isIdentityGatePassed_()) throw new Error('Identity gate is closed. Attendance data is unavailable.');
  const user = requireActiveEmployee_();
  const sheets = attendanceSheets_();
  const rows = attendanceRows_(sheets[ATTENDANCE.SHEETS.LEAVE]);
  const visible = user.role === 'admin' ? rows : rows.filter(row => row.Email === user.email);
  return {
    ok: true,
    role: user.role,
    rows: visible.map(row => ({
      leaveId: row['Leave ID'], email: user.role === 'admin' ? row.Email : '',
      startDate: row['Start Date'] instanceof Date ? attendanceDateKey_(row['Start Date']) : '',
      endDate: row['End Date'] instanceof Date ? attendanceDateKey_(row['End Date']) : '',
      leaveType: row['Leave Type'], partialPeriod: row['Partial Period'],
      startTime: row['Start Time'], endTime: row['End Time'], reason: row.Reason,
      status: row.Status, requestedAt: row['Requested At'] instanceof Date ? attendanceTimestamp_(row['Requested At']) : ''
    }))
  };
}

function attendanceReviewLeaveRequest(leaveId, decision, reviewNote, requestId) {
  return attendanceWithAction_('LEAVE_REVIEW', requestId, function(user, sheets, key, now) {
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
function closeStaleAttendanceSessions() {
  requireAdmin_();
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
