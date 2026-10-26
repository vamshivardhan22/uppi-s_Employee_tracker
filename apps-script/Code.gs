function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Labeller Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Identity-only diagnostic: intentionally reads no employee or task spreadsheets.
function getIdentityDiagnostic() {
  const active = email_(Session.getActiveUser().getEmail());
  const effective = email_(Session.getEffectiveUser().getEmail());
  return {
    activeUserEmail: active,
    effectiveUserEmail: effective,
    timestamp: Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timezone: APP.TZ,
    identityGatePassed: gatePassed_()
  };
}

function getBootstrap() {
  const identity = getIdentityDiagnostic();
  if (!identity.activeUserEmail) {
    return { ok: false, phase: 0, identity: identity, message: 'Identity could not be verified.' };
  }
  if (!gatePassed_()) {
    return { ok: true, phase: 0, identity: identity, message: 'Identity gate is closed; no task data is available.' };
  }
  const user = requireEmployee_();
  return {
    ok: true,
    phase: 1,
    identity: identity,
    user: { email: user.email, name: user.name, role: user.role }
  };
}
