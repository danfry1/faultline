import tseslint from 'typescript-eslint';
import faultline from './packages/eslint-plugin-faultline/src/index';

export default tseslint.config(
  {
    files: ['examples/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      faultline,
    },
    rules: {
      'faultline/uncovered-catch': 'error',
      'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
    },
  },
);
