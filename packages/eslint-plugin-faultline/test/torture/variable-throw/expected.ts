import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  { rule: 'throw-type-mismatch', line: 11, messageId: 'undeclaredThrow', note: 'thrown variable typed as unknown cannot be verified — should warn' },
  // no-raw-throw fires because wrong is typed unknown (rule does not infer narrowing through variable assignment)
  { rule: 'no-raw-throw', line: 11, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw of unknown-typed variable' },
];
