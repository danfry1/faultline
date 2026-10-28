# Changelog

## 0.3.0

### Minor Changes

- 7a010cc: Add `boundary.try(error)` — a non-throwing variant of a boundary that returns `Result<To, System.BoundaryViolation>` instead of throwing on an unmapped tag. Boundaries usually sit at a transport edge where an uncaught throw is costly; `.try()` lets you handle an unexpected (untyped/foreign) error tag as a value. Exposes the `BoundaryViolationError` type.
- 79611e7: The `faultline` package now ships the CLI (`npx faultline <catalog|graph|lint|doctor> [path] [--json]`), previously the unpublished `faultline-cli` workspace package. `typescript` is an optional peer dependency used only by the CLI, which loads it on demand and explains how to install it when it is missing; the library entry points do not import it.
- 7a010cc: Redaction: support a `**` globstar segment in `redactPaths` to redact a key at any depth (e.g. `**.password`). Redaction paths are matched against the serialized error structure and a non-matching path is a silent no-op (it fails open), so `**.<key>` is now the recommended form for sensitive keys — it can't silently miss a nested occurrence the way a brittle exact path can. Documented this behavior in the README and SECURITY.md.

  Also clarified (docs only, no behavior change): `attemptAsync`/`TaskResult` cancellation is cooperative — aborting short-circuits _subsequent_ steps and stops the caller waiting, but does not preempt in-flight work unless your function threads the `AbortSignal` through. And `defineBoundary` throws `System.BoundaryViolation` (preserving the original as cause) when an unmapped error tag reaches it.

- 7a010cc: TaskResult cancellation, rejection safety, and API pruning.

  Breaking changes:

  - `TaskResult.toPromise()` removed. Use `.run()` instead — same signature.
  - TaskResult chain methods (`.map`, `.andThen`, `.catchTag`, etc.) now widen their error union to include `System.Cancelled`. Exhaustive `match()` over a TaskResult needs a `'System.Cancelled'` handler or a `_` branch.
  - `TaskResult.fromPromise` return type now widens to include `System.Unexpected`. Factory rejections are no longer unhandled — they are caught and wrapped as `System.Unexpected` with the original throw preserved as `.cause`.

  Added:

  - TaskResult chain steps check `context.signal?.aborted` between every step. Aborting the signal mid-pipeline short-circuits the remaining steps to `System.Cancelled` instead of running them to completion.

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
