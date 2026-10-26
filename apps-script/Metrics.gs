function buildMyWorkPayload_(authenticatedEmail, projects) {
  const rows = [];
  const errors = [];
  const distinctSets = new Set();
  let completedTasks = 0;

  projects.forEach(project => {
    try {
      const source = readProjectTable_(project);
      const mapping = getColumnMappings_(project.projectId);

      const setHeader = mapping[APP.FIELDS.SET_ID];
      const emailHeader = mapping[APP.FIELDS.ANNOTATOR_EMAIL];
      const statusHeader = mapping[APP.FIELDS.STATUS];
      if (!setHeader || !emailHeader || !statusHeader) {
        throw new Error('Column_Map must map Dataset Set Id, Annotator Mail and Status.');
      }

      const setIndex = findHeaderIndex_(source.headers, setHeader);
      const emailIndex = findHeaderIndex_(source.headers, emailHeader);
      const statusIndex = findHeaderIndex_(source.headers, statusHeader);
      if ([setIndex, emailIndex, statusIndex].some(index => index < 0)) {
        throw new Error('A mapped source header was not found. Check Column_Map and the configured tab.');
      }

      source.rows.forEach(row => {
        if (normalizeEmail_(row[emailIndex]) !== authenticatedEmail) return;

        const setId = safeText_(row[setIndex]);
        const status = safeText_(row[statusIndex]);
        if (setId) distinctSets.add(project.projectId + '|' + setId);
        if (APP.COMPLETED_STATUSES.includes(status.toLowerCase())) completedTasks += 1;

        rows.push({
          projectId: project.projectId,
          projectName: project.projectName,
          datasetSetId: setId,
          status: status,
          assignedDate: dateOnlyForClient_(
            valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.ASSIGNED_DATE),
            project.timeZone
          ),
          submittedDate: dateOnlyForClient_(
            valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.SUBMITTED_DATE),
            project.timeZone
          ),
          approvedObjects: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.APPROVED_OBJECTS)),
          rejectedObjects: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.REJECTED_OBJECTS)),
          reviewerRejectedCount: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.REVIEWER_REJECTED_COUNT)),
          holdNote: safeText_(valueByCanonicalField_(row, source.headers, mapping, APP.FIELDS.HOLD_NOTE))
        });
      });
    } catch (error) {
      errors.push({
        projectId: project.projectId,
        projectName: project.projectName,
        message: String(error && error.message ? error.message : error)
      });
    }
  });

  return {
    cards: {
      assignedTasks: rows.length,
      completedTasks: completedTasks,
      distinctSets: distinctSets.size,
      assignedProjects: projects.length
    },
    rows: rows,
    projectErrors: errors,
    hasPartialData: errors.length > 0,
    refreshedAt: Utilities.formatDate(new Date(), APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
}
