import { uncoveredCatch } from './rules/uncovered-catch';
import { noRawThrow } from './rules/no-raw-throw';
import { throwTypeMismatch } from './rules/throw-type-mismatch';

const rules = {
  'uncovered-catch': uncoveredCatch,
  'no-raw-throw': noRawThrow,
  'throw-type-mismatch': throwTypeMismatch,
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
 *   Warns on `throw new Error()`, enforces typed catches, catches throw/type drift.
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
        'faultline/throw-type-mismatch': 'off',
      },
    },
    /** Stage 2: Handle errors in catch blocks, catch throw/type drift */
    strict: {
      plugins: { faultline: { rules } },
      rules: {
        'faultline/no-raw-throw': ['warn', { allowAppErrors: true }],
        'faultline/uncovered-catch': 'warn',
        'faultline/throw-type-mismatch': 'error',
      },
    },
    /** Stage 3: Use Result types everywhere — no throws, full typed handling */
    all: {
      plugins: { faultline: { rules } },
      rules: {
        'faultline/no-raw-throw': 'error',
        'faultline/uncovered-catch': 'error',
        'faultline/throw-type-mismatch': 'error',
      },
    },
  },
} as const;

export default plugin;
