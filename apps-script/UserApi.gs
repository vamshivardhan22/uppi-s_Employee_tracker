function getMyWork(authToken) {
  // This token is issued only after the server validates the per-employee access code.
  // The data gate is checked before master/task source sheets are read.
  const user = requireActiveEmployee_(authToken);
  const projects = getAssignedProjects_(user.email);
  const payload = buildMyWorkPayload_(user.email, projects);

  return {
    ok: true,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    cards: payload.cards,
    rows: payload.rows,
    projectErrors: payload.projectErrors,
    hasPartialData: payload.hasPartialData,
    refreshedAt: payload.refreshedAt
  };
}