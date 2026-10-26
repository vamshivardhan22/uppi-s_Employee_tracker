function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Labeller Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Phase 0 status endpoint. Reads no spreadsheet and reveals no account identity. */
function getIdentityDiagnostic() {
  return {
    authMethod: 'employee_access_code',
    timestamp: Utilities.formatDate(new Date(), APP.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    timeZone: APP.TIME_ZONE,
    dataGatePassed: isIdentityGatePassed_(),
    message: 'Sign in with your Employees email and privately issued access code.'
  };
}

function getBootstrap(authToken) {
  if (!authToken) {
    return { ok: false, phase: 0, message: 'Sign in with your employee email and access code.' };
  }
  let user;
  try {
    user = getAuthenticatedEmployee_(authToken);
  } catch (error) {
    return { ok: false, phase: 0, message: 'Your session is expired or invalid. Sign in again.' };
  }
  const gatePassed = isIdentityGatePassed_();
  return {
    ok: true,
    phase: gatePassed ? 1 : 0,
    dataGatePassed: gatePassed,
    user: { email: user.email, displayName: user.displayName, role: user.role },
    timeZone: APP.TIME_ZONE,
    message: gatePassed
      ? 'Signed in. Server-side access checks are applied to each request.'
      : 'Signed in, but app data is locked until the administrator enables the TEST data gate.'
  };
}