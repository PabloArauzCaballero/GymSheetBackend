import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint configuration.
 *
 * The repository declared a `lint` script and shipped ESLint 9 without a flat
 * config, so the gate always aborted before inspecting a single file. Type-aware
 * rules are enabled because most defects this gate must catch (floating promises,
 * unsafe `any` propagation) are only visible with type information.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'graphify-out/**',
      'docs/**',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused symbols are dead code; underscore prefix marks a deliberate discard.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // An unawaited promise in a request handler silently drops errors.
      '@typescript-eslint/no-floating-promises': 'error',
      // Swallowing an error without handling hides production failures.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Adapters implement an async port contract; some backends complete
      // synchronously and legitimately have no `await` in the body.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // Specs legitimately use loose typing for mocks and partial fixtures.
    // HTTP response bodies in e2e specs are untyped JSON by nature.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      // Passing `service.method` to `jest.spyOn`/assertions is the intended
      // Jest idiom and does not suffer the `this`-binding hazard this rule targets.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
