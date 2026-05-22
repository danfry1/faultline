import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Design constraint: uncovered-catch requires the called method/function to have a
  // declared error return type. Class methods without such annotation are invisible to the rule.
  { rule: 'uncovered-catch', line: 22, shouldNotReport: true, note: 'design: requires declared error return type' },
  { rule: 'uncovered-catch', line: 31, shouldNotReport: true, note: 'getter access is MemberExpression, not CallExpression' },
];
