import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'uncovered-catch', line: 23, messageId: 'uncheckedCatch', note: 'method throws Svc.Bad (catch at line 23)' },
  // Getter access is a MemberExpression, not a CallExpression — likely missed. TRIAGE.
  { rule: 'uncovered-catch', line: 32, shouldNotReport: true, note: 'TRIAGE: getter access not detected as throwing (catch at line 32)' },
];
