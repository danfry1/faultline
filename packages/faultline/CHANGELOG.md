# Changelog

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
