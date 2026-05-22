# Torture Fixtures

Real-world ESLint rule stress tests. Each subdirectory exercises one pattern category against `faultline/no-raw-throw`, `faultline/throw-type-mismatch`, and `faultline/uncovered-catch`.

## Layout

Each category directory contains:

- `input.ts` — the code under test
- `expected.ts` — exported expectations array, typed as `RuleExpectation[]`

## Expectation shape

```ts
export const expected: RuleExpectation[] = [
  { rule: 'throw-type-mismatch', line: 12, messageId: 'mismatch' },
  // ...or...
  { rule: 'uncovered-catch', shouldNotReport: true, line: 20 },
];
```

The harness in `run-torture.test.ts` walks the directory, runs ESLint against each `input.ts` with the faultline plugin enabled, and asserts the produced reports match `expected.ts`.

Surprises (rule reports a violation not in `expected.ts`) and misses (rule fails to report an expected violation) both fail the test.

## Triage

Findings from this corpus are triaged into:

- **Fix** — bug in the rule, patched in this PR or a follow-up.
- **Limitation** — documented in `../../LIMITATIONS.md`. Fixture's `expected.ts` is annotated with a comment explaining why.
- **Out of scope** — fixture removed; rationale recorded in commit message.
