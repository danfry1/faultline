import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 21, messageId: 'uncheckedCatch', note: 'outer catch must handle E.Outer (Inner is handled inside)' },
  { rule: 'uncovered-catch', line: 31, shouldNotReport: true, note: 'closure inside try does not propagate throws to outer catch' },
];
