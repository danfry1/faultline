import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 16, shouldNotReport: true, note: 'isErrorTag covers tag' },
  { rule: 'uncovered-catch', line: 27, shouldNotReport: true, note: 'narrowError covers tag' },
  { rule: 'no-raw-throw', line: 20, messageId: 'noRawThrowUseFactory', note: 're-throw of unknown after isErrorTag guard' },
  { rule: 'no-raw-throw', line: 31, messageId: 'noRawThrowUseFactory', note: 're-throw of unknown after narrowError guard' },
];
