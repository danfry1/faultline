import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 14, shouldNotReport: true, note: 'aliased narrowError import should still cover' },
  // no-raw-throw fires on `throw err` because err is typed as unknown (rule does not infer narrowing)
  { rule: 'no-raw-throw', line: 19, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw err even after narrowError guard (known limitation)' },
];
