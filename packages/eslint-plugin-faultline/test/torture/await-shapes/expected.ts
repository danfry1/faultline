import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Likely missed by current rule — TRIAGE
  { rule: 'throw-type-mismatch', line: 15, shouldNotReport: true, note: 'TRIAGE: await ternary not handled by transitive check' },
  { rule: 'throw-type-mismatch', line: 20, shouldNotReport: true, note: 'TRIAGE: await Promise.all not handled' },
  // This one SHOULD be flagged — plain await of mismatching call
  { rule: 'throw-type-mismatch', line: 25, messageId: 'transitiveError', note: 'plain await of mismatched call' },
];
