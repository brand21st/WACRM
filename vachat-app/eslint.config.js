const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    rules: {
      // React Native loads static assets with require().
      '@typescript-eslint/no-require-imports': 'off',
      // Starter web color-scheme hook hydrates after mount.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
