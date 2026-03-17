import { uncoveredCatch } from './rules/uncovered-catch';
import { noRawThrow } from './rules/no-raw-throw';

const rules = {
  'uncovered-catch': uncoveredCatch,
  'no-raw-throw': noRawThrow,
};

/**
 * ESLint plugin for faultline typed error handling.
 *
 * Three preset configs for incremental adoption:
 *
 * - **recommended** — Stage 1: Replace `new Error()` with typed error factories.
 *   Allows `throw AppError`, warns on `throw new Error()`.
 *
 * - **strict** — Stage 2: Handle errors in catch blocks.
 *   Warns on `throw new Error()` and untyped catch blocks.
 *
 * - **all** — Stage 3: Use Result types everywhere.
 *   Errors on ALL throws (use attempt/Result instead) and untyped catches.
 */
const plugin = {
  meta: {
    name: 'eslint-plugin-faultline',
    version: '0.1.0',
  },
  rules,
  configs: {
    /** Stage 1: Replace `new Error()` with typed error factories */
    recommended: {
      plugins: { faultline: { rules } },
      rules: {
        'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
        'faultline/uncovered-catch': 'off',
      },
    },
    /** Stage 2: Handle errors in catch blocks with narrowError/isErrorTag */
    strict: {
      plugins: { faultline: { rules } },
      rules: {
        'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
        'faultline/uncovered-catch': 'warn',
      },
    },
    /** Stage 3: Use Result types everywhere — no throws, full typed handling */
    all: {
      plugins: { faultline: { rules } },
      rules: {
        'faultline/no-raw-throw': 'error',
        'faultline/uncovered-catch': 'error',
      },
    },
  },
} as const;

export default plugin;
