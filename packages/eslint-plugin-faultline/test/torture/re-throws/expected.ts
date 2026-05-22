import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 17, messageId: 'uncheckedCatch', note: 'bare rethrow does not constitute typed handling' },
  // no-raw-throw fires on `throw e` because e is typed `unknown` (rule does not infer narrowing through e/err)
  { rule: 'no-raw-throw', line: 18, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw e even in a bare rethrow' },
  { rule: 'uncovered-catch', line: 26, messageId: 'uncheckedCatch', note: 'conditional rethrow without narrowing' },
  // no-raw-throw fires on `throw e` because e is typed `unknown` (rule does not infer narrowing through e/err)
  { rule: 'no-raw-throw', line: 27, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw e in conditional rethrow' },
  { rule: 'uncovered-catch', line: 37, shouldNotReport: true, note: 'throwing a typed factory is fine' },
];
