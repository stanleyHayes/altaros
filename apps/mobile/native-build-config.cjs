const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function normalizeGoogleServicesFile(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const path = value.trim();
  if (!path) {
    return undefined;
  }

  if (path.length > 4096 || CONTROL_CHARACTER.test(path)) {
    throw new Error('GOOGLE_SERVICES_JSON must be a valid file path.');
  }

  return path;
}

function resolveGoogleServicesFile(environment = process.env) {
  const path = normalizeGoogleServicesFile(environment.GOOGLE_SERVICES_JSON);

  if (
    !path &&
    environment.EAS_BUILD === 'true' &&
    environment.EAS_BUILD_PLATFORM === 'android'
  ) {
    throw new Error(
      'Android EAS builds require GOOGLE_SERVICES_JSON as an EAS secret file variable.',
    );
  }

  return path;
}

module.exports = {
  normalizeGoogleServicesFile,
  resolveGoogleServicesFile,
};
