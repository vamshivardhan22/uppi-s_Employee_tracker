function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Labeller Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Phase 0 diagnostic only. Intentionally reads no master or task spreadsheet.
 * Verify the deployed /exec URL as both a test admin and test labeller.
 */
function getIdentityDiagnostic() {
  const activeEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  // Keep the owner's effective identity in server-side execution logs, not in the public response.
  Logger.log('Identity diagnostic activeUserEmail=%s; effectiveUserEmail=%s', activeEmail, effectiveEmail);

  return {
    activeUserEmail: activeEmail,
    timestamp: Utilities.formatDate(new Date(), APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timeZone: APP.TIME_ZONE,
    identityGatePassed: isIdentityGatePassed_(),
    message: activeEmail
      ? 'Compare activeUserEmail with the account used to open this deployed app.'
      : 'Active-user email is blank. Keep the identity gate closed.'
  };
}

function getBootstrap() {
  const identity = getIdentityDiagnostic();

  if (!identity.activeUserEmail) {
    return { ok: false, phase: 0, identity: identity, message: 'Identity could not be verified.' };
  }

  if (!isIdentityGatePassed_()) {
    return { ok: true, phase: 0, identity: identity, message: 'Identity gate is closed; no task data is available.' };
  }

  const user = requireActiveEmployee_();
  return {
    ok: true,
    phase: 1,
    identity: identity,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    message: 'Identity and employee access verified.'
  };
}
