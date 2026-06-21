// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle the self-contained reader (assets/reader/reader.html) as an asset so it
// can be loaded into the WebView reader offline.
config.resolver.assetExts.push('html');

module.exports = config;
