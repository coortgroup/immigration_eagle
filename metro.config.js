const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Keep local builds independent of an installed or stalled Watchman daemon.
// Metro's Node file watcher is sufficient for this project and also works in CI.
config.resolver.useWatchman = false;

module.exports = config;
