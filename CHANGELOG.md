# Changelog

## [Unreleased]

### Breaking changes

- `TaskResult.toPromise()` removed. Use `.run()` instead — same signature.
- TaskResult chain methods (`.map`, `.andThen`, `.catchTag`, etc.) now widen their error union to include `System.Cancelled`. If you exhaustively `match()` against a TaskResult, add a `'System.Cancelled'` handler or a `default` branch.
- `TaskResult.fromPromise` return type now widens to include `System.Unexpected`. Factory rejections are no longer unhandled — they're caught and wrapped as `System.Unexpected` with the original throw preserved as `.cause`.

### Added

- TaskResult chain steps check `context.signal?.aborted` between every step. Aborting the signal mid-pipeline short-circuits the remaining steps to `System.Cancelled` instead of running them to completion.
- README: "How faultline differs" section comparing faultline to neverthrow, Effect, and typed Error subclasses.
- README: "When to use TaskResult vs Promise<Result>" decision guide.
- README: explicit error-code escape hatch is now documented (the feature already existed; this fills a docs gap).

### Tests

- Type-level assertion that explicit `code` values on `defineErrors` definitions are preserved as literal types.
- Cancellation propagation tests for TaskResult chains (pre-abort, mid-chain abort, no abort).
- `TaskResult.fromPromise` rejection-handling tests (Error and non-Error throws).

## 0.1.0

Initial release.

### Features

- `defineError` and `defineErrors` for type-safe error definitions with auto-generated tags and codes
- `Result<T, E>` type with `ok`, `err`, `isOk`, `isErr`, `match`, `catchTag`, and `all`
- `TaskResult` for lazy async computation with AbortSignal support
- `attempt` and `attemptAsync` for wrapping throwing code as Results
- `defineBoundary` for exhaustive cross-layer error mapping
- `serializeError` / `deserializeError` with JSON safety, circular reference handling, and redaction
- `narrowError` and `isErrorTag` for typed catch blocks
- `TypedPromise` for typed `.catch()` handlers
- Context frames for structured observability
- `configureErrors` for stack capture control and PII redaction
- Built-in system errors: Unexpected, Timeout, Cancelled, SerializationFailed, BoundaryViolation

### Ecosystem

- `eslint-plugin-faultline` with rules: `no-raw-throw`, `uncovered-catch`, `throw-type-mismatch`
- `faultline-cli` with commands: `catalog`, `graph`, `lint`, `doctor`
- VS Code extension with diagnostics, hover info, and quick fixes
