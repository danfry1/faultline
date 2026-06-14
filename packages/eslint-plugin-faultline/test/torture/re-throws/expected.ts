import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Design constraint: uncovered-catch requires the called function to have a declared
  // error return type (TypedPromise/Result). `getUser` here has no such annotation,
  // so the rule produces zero tags and does not report. See LIMITATIONS.md.
  { rule: 'uncovered-catch', line: 17, shouldNotReport: true, note: 'design: requires declared error return type' },
  // no-raw-throw fires on `throw e` because e is typed `unknown` (rule does not infer narrowing through e/err)
  { rule: 'no-raw-throw', line: 18, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw e even in a bare rethrow' },
  { rule: 'uncovered-catch', line: 26, shouldNotReport: true, note: 'design: requires declared error return type' },
  // no-raw-throw fires on `throw e` because e is typed `unknown` (rule does not infer narrowing through e/err)
  { rule: 'no-raw-throw', line: 27, messageId: 'noRawThrowUseFactory', note: 'expected: rule flags throw e in conditional rethrow' },
  { rule: 'uncovered-catch', line: 37, shouldNotReport: true, note: 'throwing a typed factory is fine' },
];
