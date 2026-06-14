export type RuleName = 'no-raw-throw' | 'throw-type-mismatch' | 'uncovered-catch';

export interface RuleExpectation {
  rule: RuleName;
  line: number;
  /** ESLint messageId expected. Mutually exclusive with shouldNotReport. */
  messageId?: string;
  /** When true, asserts that no report is generated at `line` for `rule`. */
  shouldNotReport?: boolean;
  /** Optional: human-readable note for triage. */
  note?: string;
}
