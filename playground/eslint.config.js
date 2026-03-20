import tsParser from '@typescript-eslint/parser';
import faultline from 'eslint-plugin-faultline';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { faultline },
    rules: {
      'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
      'faultline/uncovered-catch': 'warn',
      'faultline/throw-type-mismatch': 'error',
    },
  },
];
