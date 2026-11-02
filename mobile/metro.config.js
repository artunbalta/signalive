// The Metro bundler's config: Expo's defaults, plus one folder outside this app.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// src/shared.ts imports the bridge's messages and the earbuds' GATT UUIDs from the
// web app's own files in ../lib/sense, so the page and the shell share one copy.
// Neither file imports anything, so nothing else is needed from outside.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../lib/sense")];

module.exports = config;
