import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Third-party throws have no faultline tags, so uncovered-catch correctly does not report.
  { rule: 'uncovered-catch', line: 4, shouldNotReport: true, note: 'no faultline-typed throw in try' },
  { rule: 'uncovered-catch', line: 13, shouldNotReport: true, note: 'fetch is not faultline-typed' },
  { rule: 'uncovered-catch', line: 22, shouldNotReport: true, note: 'JSON.parse is not faultline-typed' },
  // no-raw-throw fires on `throw e` because e is typed `unknown` (rule does not infer narrowing through e/err)
  { rule: 'no-raw-throw', line: 26, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw e even for third-party re-throws' },
];
