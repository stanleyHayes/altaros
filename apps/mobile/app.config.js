const { resolveGoogleServicesFile } = require('./native-build-config.cjs');

module.exports = ({ config }) => {
  const googleServicesFile = resolveGoogleServicesFile();

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
