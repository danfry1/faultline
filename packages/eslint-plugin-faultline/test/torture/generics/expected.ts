import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // The plugin DOES detect throws through generic helpers — the rule reports on the catch clause line.
  // The throw inside the generic lambda is detected because the rule descends into the arrow function argument.
  { rule: 'uncovered-catch', line: 18, messageId: 'uncheckedCatch', note: 'rule descends into inline lambda passed to generic helper' },
  // Mapped type returns still hide throws — rule cannot trace through mapped type return
  { rule: 'uncovered-catch', line: 30, shouldNotReport: true, note: 'TRIAGE: mapped return type hides throws' },
];
