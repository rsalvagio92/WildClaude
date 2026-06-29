module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // worklets/reanimated disabled: app doesn't use them, but they leak in
      // transitively (reanimated >=3.6.2) and babel-preset-expo then fails to
      // resolve react-native-worklets/plugin during the release JS bundle.
      ['babel-preset-expo', { jsxImportSource: 'nativewind', worklets: false, reanimated: false }],
      'nativewind/babel',
    ],
    plugins: [],
  };
};
