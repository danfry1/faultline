import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Current rule picks callSigs[0] — likely misses one of the overloads. TRIAGE candidate.
  { rule: 'uncovered-catch', line: 20, shouldNotReport: true, note: 'TRIAGE: overloads — current code only inspects signature [0]' },
];
