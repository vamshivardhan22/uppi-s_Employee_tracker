function getMyWork() {
  // Authorization derives identity server-side; this function accepts no email parameter.
  const user = requireActiveEmployee_();
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
