import { uncoveredCatch } from './rules/uncovered-catch';
import { noRawThrow } from './rules/no-raw-throw';

const plugin = {
  meta: {
    name: 'eslint-plugin-faultline',
    version: '0.1.0',
  },
  rules: {
    'uncovered-catch': uncoveredCatch,
    'no-raw-throw': noRawThrow,
  },
} as const;

export default plugin;
