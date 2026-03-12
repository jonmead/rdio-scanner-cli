'use strict';

const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType:  'commonjs',
            globals: {
                require:        'readonly',
                module:         'readonly',
                exports:        'readonly',
                __dirname:      'readonly',
                __filename:     'readonly',
                process:        'readonly',
                Buffer:         'readonly',
                setTimeout:     'readonly',
                clearTimeout:   'readonly',
                setInterval:    'readonly',
                clearInterval:  'readonly',
                console:        'readonly',
            },
        },
        rules: {
            // Errors
            'no-unused-vars':   ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-undef':         'error',
            'no-empty':         ['error', { allowEmptyCatch: true }],

            // The renderer intentionally uses \x1b in regexes to strip ANSI escape codes.
            'no-control-regex': 'off',

            // Style (warn only — not blocking)
            'eqeqeq':           ['warn', 'always', { null: 'ignore' }],
            'no-var':           'warn',
            'prefer-const':     ['warn', { destructuring: 'all' }],
            'semi':             ['warn', 'always'],
            'quotes':           ['warn', 'single', { avoidEscape: true }],
        },
    },
    {
        // Ignore generated / third-party directories
        ignores: ['node_modules/**'],
    },
];
