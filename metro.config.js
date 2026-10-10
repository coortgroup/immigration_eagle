const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// Keep local builds independent of an installed or stalled Watchman daemon.
// Metro's Node file watcher is sufficient for this project and also works in CI.
config.resolver.useWatchman = false;

// pdf-lib pins tslib 1.x. Its `exports.import` wrapper imports a nonexistent
// CommonJS default and crashes with Metro's ESM interop. Resolve only pdf-lib's
// tslib imports to that same package's direct named-export implementation.
// Keep package exports enabled for Expo and the rest of the application.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib' && /[/\\]node_modules[/\\]pdf-lib[/\\]/.test(context.originModulePath)) {
    const entry = require.resolve('tslib', { paths: [path.dirname(context.originModulePath)] });
    return { type: 'sourceFile', filePath: path.join(path.dirname(entry), 'tslib.es6.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
