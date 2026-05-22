import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  {
    rule: 'throw-type-mismatch',
    line: 22,
    messageId: 'transitiveError',
    note: 'all overload signatures now inspected — E.B from overload 2 is detected as undeclared',
  },
];
