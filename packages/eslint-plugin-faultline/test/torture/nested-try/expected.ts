import type { RuleExpectation } from '../types';

export const expected: RuleExpectation[] = [
  // Design constraint: uncovered-catch requires the called function to have a declared
  // error return type (TypedPromise/Result). `outer()` / `inner()` here have no such annotation.
  { rule: 'uncovered-catch', line: 21, shouldNotReport: true, note: 'design: requires declared error return type' },
  { rule: 'uncovered-catch', line: 31, shouldNotReport: true, note: 'closure inside try does not propagate throws to outer catch' },
  // TypedPromise-annotated call inside a closure — closure throws must not be attributed to outer catch.
  { rule: 'uncovered-catch', line: 49, shouldNotReport: true, note: 'TypedPromise call inside async closure does not escape to outer catch' },
];
