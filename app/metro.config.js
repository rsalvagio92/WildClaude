const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Resolve @/ imports from src/
config.resolver.alias = {
  '@': path.resolve(__dirname, 'src'),
};

module.exports = config;
