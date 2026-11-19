// ESLint setup for Nexthlon, based on the Google JavaScript Style Guide:
// https://google.github.io/styleguide/jsguide.html
//
// ESLint checks code quality (bugs, risky patterns, Google's language rules).
// Prettier (.prettierrc) handles formatting: quotes, indentation, line length.
// eslint-config-prettier (last in the list) turns off every ESLint rule that
// would fight Prettier over formatting.
//
//   npm run lint        report problems
//   npm run lint:fix    fix what can be fixed safely
//   npm run format      reformat every file with Prettier

const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

// Google's language rules ("2. Language features" in the guide).
const googleRules = {
  // Variables: const by default, let when reassigned, never var.
  'no-var': 'error',
  'prefer-const': ['error', {destructuring: 'all'}],
  'one-var': ['error', {var: 'never', let: 'never', const: 'never'}],

  // Equality and control flow.
  eqeqeq: ['error', 'always', {null: 'ignore'}],
  curly: ['error', 'all'],
  'guard-for-in': 'error',
  'no-fallthrough': 'error',

  // Objects, arrays, functions.
  'no-array-constructor': 'error',
  'no-object-constructor': 'error',
  'no-new-wrappers': 'error',
  'prefer-rest-params': 'error',
  'prefer-spread': 'error',
  'prefer-arrow-callback': ['error', {allowNamedFunctions: true}],
  'no-caller': 'error',
  'no-with': 'error',
  'no-extend-native': 'error',
  'no-multi-str': 'error',

  // Errors: only throw/reject real Error objects.
  'no-throw-literal': 'error',
  'prefer-promise-reject-errors': 'error',

  // Naming: camelCase for code, PascalCase for constructors.
  // Properties are not checked: DB fields and API payloads use other cases.
  camelcase: ['error', {properties: 'never', ignoreDestructuring: true}],
  'new-cap': ['error', {capIsNew: false}],

  // Unused code is a bug or clutter. A leading _ marks "unused on purpose".
  'no-unused-vars': [
    'error',
    {
      args: 'after-used',
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrors: 'none',
      // `const {password, ...safe} = user` drops keys on purpose.
      ignoreRestSiblings: true,
    },
  ],
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'tmp/**',
      'backups/**',
      'public/uploads/**',
      'docs/screenshots/**',
      'linkedin-post/**',
    ],
  },

  js.configs.recommended,
  {rules: googleRules},

  // Server code, scripts and tests: Node + CommonJS (require).
  {
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {...globals.node},
    },
  },

  // Browser scripts loaded with a plain <script> tag.
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Shared helpers that public/js/app.js and motion/ticker.js put on window.
        Nx: 'readonly',
        NxTicker: 'readonly',
      },
    },
  },

  // ticker.js also exports itself through module.exports so tests can load it.
  {
    files: ['public/js/motion/ticker.js'],
    languageOptions: {globals: {module: 'writable'}},
  },

  // Browser ES modules (import/export).
  {
    files: [
      'public/js/3d/**/*.js',
      'public/js/fx/**/*.js',
      'public/js/auth3d.js',
      'public/js/home3d.js',
      'public/js/showroom3d.js',
    ],
    languageOptions: {sourceType: 'module'},
  },

  // Service worker.
  {
    files: ['public/sw.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {...globals.serviceworker},
    },
  },

  // Must stay last: switches off rules that clash with Prettier.
  prettier,
];
