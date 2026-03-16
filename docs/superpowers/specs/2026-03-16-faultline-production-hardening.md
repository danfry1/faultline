# Faultline Production Hardening Spec

**Goal:** Bring every module in `packages/faultline/src/` to production-grade quality with comprehensive test coverage. Test-first: every fix starts as a failing test.

**Trust target:** 9+/10 on every file. Zero silent failures. Zero crashes on unexpected input. Every edge case tested.

---

## 1. Serialization & Round-trip Integrity

**Current trust: 5/10 — Target: 9/10**

### 1.1 `deserializeError` and `deserializeResult` must return `Result`, not throw

**Problem:** These functions throw `SystemErrors.SerializationFailed` on invalid input. Functions that parse untrusted data (message queues, APIs, localStorage) must never throw.

**Fix:**
- Change `deserializeError` signature to return `Result<AppError, AppError>` (err case is `SerializationFailed`)
- Change `deserializeResult` signature to return `Result<Result<T, AppError>, AppError>`
- All internal validation returns `err(SystemErrors.SerializationFailed(...))` instead of throwing
- Remove the dead `_catalog?: readonly unknown[]` parameter from `deserializeError`

**Tests:**
- Malformed JSON object (missing `_tag`, missing `code`)
- Wrong `_format` version
- `null`, `undefined`, empty object, array, number, string inputs
- Valid input round-trips correctly

### 1.2 Circular reference protection

**Problem:** `cloneValue` in `redaction.ts` and `serializeCauseValue` in `error.ts` recurse infinitely on circular references. `fromUnknown` stores arbitrary `thrown` values which can be circular. Any circular data in an error causes `toJSON()` to throw.

**Fix:**
- Add `seen: WeakSet` parameter to `cloneValue` — replace circular refs with `'[Circular]'`
- Add cycle detection to `serializeCauseValue` — same approach
- `toJSON()` must never throw under any input

**Tests:**
- Circular object in `error.data`
- Circular object in `error.cause`
- Self-referencing `thrown` value through `fromUnknown` → `serializeError`
- Deeply nested (100+ levels) but non-circular object
- `toJSON()` on every error type with circular data returns valid JSON string

### 1.3 Cause chain fidelity after round-trip

**Problem:** `deserializeError` produces plain objects for `.cause`, not `AppError` instances. After deserialization, `isAppError(error.cause)` returns `false`.

**Fix:**
- `deserializeError` recursively deserializes the `cause` field when it has `kind: 'app-error'`
- Non-AppError causes (kind: `'cause'`) remain as `SerializedCause` objects (this is correct — we can't reconstruct the original `Error` instance)
- Document this behavior: AppError causes survive round-trip, native Error causes become serialized representations

**Tests:**
- `AppError.withCause(anotherAppError)` → serialize → deserialize → `isAppError(result.cause)` is `true`
- `AppError.withCause(new TypeError('x'))` → serialize → deserialize → cause is `SerializedCause` object
- Three-level cause chain round-trip

### 1.4 `SerializableError` type cleanup

**Problem:** `export type SerializableError = AppError | Error | unknown` collapses to `unknown`.

**Fix:** Remove the type alias entirely. Use `unknown` directly where it appears (it only appears in one place).

---

## 2. Config & Global State

**Current trust: 5/10 — Target: 9/10**

### 2.1 Config reset and isolation

**Problem:** `configureErrors` mutates a global singleton with no reset mechanism. Tests leak state.

**Fix:**
- Add `resetErrorConfig()` that restores defaults — exported for test use
- Add `getErrorConfig()` public export so users can inspect current config
- Document that `configureErrors` is global and should be called once at app startup

**Tests:**
- `configureErrors` changes behavior, `resetErrorConfig` restores it
- Config changes in one test don't affect the next (test isolation proof)
- `getErrorConfig()` returns current state without mutation

### 2.2 Environment detection robustness

**Problem:** `process.env.NODE_ENV` is `undefined` in Cloudflare Workers, Deno, and some bundlers. Current code: `process.env.NODE_ENV !== 'production'` evaluates `undefined !== 'production'` → `true` → stacks captured in production Workers.

**Fix:**
```ts
const defaultCaptureStack =
  typeof process !== 'undefined' && process?.env?.NODE_ENV === 'production'
    ? false
    : true;
```
Invert the logic: only disable stacks when we positively detect production. Unknown environments default to capturing stacks (safer for debugging).

**Tests:**
- Verify default behavior when `process` is undefined
- Verify `captureStack: false` when `NODE_ENV=production`

### 2.3 `getErrorConfig()` allocation on hot path

**Problem:** Every `toJSON()` call allocates a new array via `[...currentConfig.redactPaths]`.

**Fix:**
- Cache the config object and only recreate when `configureErrors` is called
- Use `Object.freeze` on the cached config so callers can't mutate it

**Tests:**
- `getErrorConfig()` returns frozen object
- `getErrorConfig() === getErrorConfig()` is `true` (same reference when config hasn't changed)
- After `configureErrors(...)`, reference changes

---

## 3. Error Creation & Core Types

**Current trust: 6/10 — Target: 9/10**

### 3.1 `isAppError` cleanup

**Problem:** Redundant checks after `instanceof Error` — `value !== null` and `typeof value === 'object'` are dead code.

**Fix:** Simplify to:
```ts
export function isAppError(value: unknown): value is AppError {
  return value instanceof Error && APP_ERROR_SYMBOL in value;
}
```

**Tests:** Already tested, just verify behavior unchanged.

### 3.2 Symbol key alignment

**Problem:** Symbol keys use `'typescript-error-system.*'` prefix — stale name from before the rename.

**Fix:** Change all `Symbol.for` keys to use `'faultline.*'` prefix:
- `'faultline.app-error'`
- `'faultline.error-factory-meta'`
- `'faultline.error-group-meta'`
- `'faultline.boundary-meta'`

### 3.3 Fix `isErrorTag` symbol string literal

**Problem:** `typed-promise.ts:143` uses a hardcoded `Symbol.for('typescript-error-system.error-factory-meta')` string instead of importing the constant. If the key changes, `isErrorTag` silently breaks.

**Fix:** Import `ERROR_FACTORY_META` from `error.ts` and use it directly. No string duplication.

**Tests:**
- `isErrorTag(error, MyErrors.NotFound)` works (already tested)
- `isErrorTag(error, 'My.NotFound')` works (string form)
- `isErrorTag` with a factory that has no meta returns `false`

### 3.4 `serializeCauseValue` Symbol crash

**Problem:** `String(Symbol('x'))` throws a `TypeError`. If someone does `error.withCause(Symbol('debug'))`, `toJSON()` throws.

**Fix:** Handle Symbol in `serializeCauseValue`:
```ts
if (typeof cause === 'symbol') {
  return { kind: 'cause', name: 'Symbol', message: cause.toString() };
}
```

**Tests:**
- `withCause(Symbol('test'))` → `toJSON()` works
- `withCause(null)` → `toJSON()` works
- `withCause(undefined)` → `toJSON()` works
- `withCause(42)` → `toJSON()` works
- `withCause(BigInt(9007199254740991))` → `toJSON()` works

### 3.5 Deep clone improvements in `withContext`

**Problem:** `cloneFrame` shallow-copies `meta`. Nested objects are shared references.

**Fix:** Use the improved `cloneValue` (with circular ref protection) for the `meta` field in context frames.

**Tests:**
- Mutating original meta object after `withContext` does not affect the error's stored context
- Deeply nested meta is properly isolated

---

## 4. Result & TaskResult

**Current trust: 7/10 — Target: 9/10**

### 4.1 `matchErr` should throw `SystemErrors.Unexpected`, not plain `Error`

**Problem:** When no handler matches and there's no `_` wildcard, the match throws `new Error(...)`. An error library's own internal failure should use its own error system.

**Fix:**
```ts
throw SystemErrors.Unexpected({
  message: `No handler for error tag "${error._tag}" and no wildcard "_" handler provided`,
  name: 'MatchExhaustion',
});
```

**Tests:**
- Exhaustive match with all handlers works (already tested)
- Match with `_` wildcard catches unhandled tags
- Match without handler for a tag throws `SystemErrors.Unexpected` (verify it's an AppError)

### 4.2 `TaskResult.fromPromise` laziness contract

**Problem:** The underlying promise is already running before `.run()` is called. This violates the lazy semantics of `TaskResult`.

**Fix:** Accept a factory function instead of a promise:
```ts
static fromPromise<T, E extends AppError>(
  factory: () => Promise<Result<T, E>>,
): TaskResult<T, E>
```
The factory is called inside `.run()`, making it truly lazy.

**Deprecation:** If this is a breaking change, add `fromEagerPromise` for the old behavior and deprecate it. Or just fix `fromPromise` since we're pre-1.0.

**Tests:**
- Side effect in factory only runs when `.run()` is called
- Multiple `.run()` calls execute the factory each time (lazy re-execution)
- Compare with `attemptAsync` behavior (should be consistent)

### 4.3 Abort signal listener cleanup

**Problem:** `createAbortSignalRace` attaches a listener that is only cleaned up when the signal fires. If the user's promise wins the race, the listener leaks.

**Fix:** Use `AbortSignal.addEventListener` with `{ once: true }` (already done) but also remove the listener explicitly when the race settles via the non-abort path. Use an `AbortController` internally or `signal.removeEventListener` in a `.finally()` cleanup.

**Tests:**
- Run a TaskResult that completes before abort — verify no lingering listeners
- Run a TaskResult that is aborted — verify cancellation works
- Run 100 TaskResults against the same signal — verify no listener accumulation

### 4.4 `all()` with empty array

**Problem:** `all([])` falls through to the Result branch even for TaskResult inputs due to `results[0] instanceof TaskResult` check on empty array.

**Fix:** `all([])` should return `ok([] as const)` for both Result and TaskResult paths. The type already handles this correctly — just add an explicit early return for empty arrays.

**Tests:**
- `all([])` returns `ok([])`
- `all([ok(1), ok(2)])` returns `ok([1, 2])`
- `all([ok(1), err(e)])` returns err with combined error containing 1 failure

### 4.5 Add `toJSON()` on Result

**Problem:** `JSON.stringify(result)` exposes internal `OkImpl`/`ErrImpl` structure instead of the stable serialized format.

**Fix:** Add `toJSON()` method on both `OkImpl` and `ErrImpl` that delegates to `serializeResult`.

**Tests:**
- `JSON.stringify(ok(42))` produces `{ "_type": "ok", "value": 42, ... }`
- `JSON.stringify(err(myError))` produces serialized error format
- Round-trip: `deserializeResult(JSON.parse(JSON.stringify(result)))` works

---

## 5. Boundary Layer

**Current trust: 6/10 — Target: 9/10**

### 5.1 Preserve original error in cause chain when handler sets its own cause

**Problem:** If the boundary handler returns an error with its own cause, the original triggering error is lost.

**Fix:** When the handler's mapped error already has a cause, chain them: set the handler's cause as-is but store the original error in the boundary context frame's `originalError` field. The original error is always accessible.

Actually, simpler: always set the original error as cause. If the handler already set a cause, the handler's cause becomes the cause of the original. This preserves the full chain: `mapped.cause → original → original.cause`.

**Tests:**
- Handler returns bare error → original is set as cause (already works)
- Handler returns error with custom cause → both original and custom cause are preserved in chain
- `error.cause.cause` chain is intact

### 5.2 `BoundaryViolation` should include expected tags

**Problem:** `BoundaryViolation` reports `fromTag` (what arrived) but not what tags the boundary expected.

**Fix:** Add `expectedTags: string[]` to `BoundaryViolation` data.

**Tests:**
- Unknown tag triggers `BoundaryViolation` with correct `expectedTags` list
- `BoundaryViolation` message includes expected tags

### 5.3 Silent empty `extractTags` for unknown input

**Problem:** `extractTags` returns `[]` for factories without metadata, with no warning.

**Fix:** This is acceptable behavior (graceful degradation) but add a JSDoc comment explaining it. No code change needed.

---

## 6. `narrowError` & TypedPromise

**Current trust: 6/10 — Target: 9/10**

### 6.1 `narrowError` runtime validation

**Problem:** `narrowError` ignores the `sources` parameter at runtime. Users expect it validates; it doesn't. A `PaymentError` passes through `narrowError(e, [UserErrors])` typed as `UserErrors | UnexpectedError`.

**Fix:** Add runtime validation:
- Check if the thrown value is an `AppError`
- If it is, check if its `_tag` is in the set of tags from the provided sources
- If the tag is not covered, wrap it as `SystemErrors.Unexpected` with the original as cause
- If the thrown value is not an `AppError`, wrap via `fromUnknown` (current behavior)

This makes the runtime behavior match the type signature. The type says you get `Infer<Sources> | UnexpectedError` — the runtime should enforce that.

**Tests:**
- `narrowError(userError, [UserErrors])` returns the error as-is (tag matches)
- `narrowError(paymentError, [UserErrors])` returns `UnexpectedError` wrapping the payment error (tag doesn't match)
- `narrowError(new Error('x'), [UserErrors])` returns `UnexpectedError` (not an AppError)
- `narrowError(null, [UserErrors])` returns `UnexpectedError`
- `narrowError('string', [UserErrors])` returns `UnexpectedError`
- Tags from error groups are correctly collected for matching

### 6.2 `typedAsync` documentation

**Problem:** The double-call pattern `typedAsync<T, E>()(fn)` is confusing with no explanation.

**Fix:** Add JSDoc explaining why the double call is needed (TypeScript can't partially apply type parameters) and showing the usage pattern clearly.

---

## 7. Redaction

**Current trust: 5/10 — Target: 9/10**

### 7.1 `cloneValue` robustness

**Problem:** `cloneValue` destroys `Date`, `RegExp`, `Map`, `Set` instances (turns them into plain objects). It also crashes on circular references (addressed in 1.2).

**Fix:**
- `Date` → clone via `new Date(original.getTime())`
- `RegExp` → clone via `new RegExp(original.source, original.flags)`
- `Map` → clone entries into new `Map`
- `Set` → clone values into new `Set`
- All other class instances → store as `String(value)` with `[ClassName]` prefix to avoid losing type info silently

**Tests:**
- `Date` survives clone with correct value
- `RegExp` survives clone with correct pattern and flags
- `Map` survives clone with correct entries
- `Set` survives clone with correct values
- Custom class instance is serialized as string representation
- Deeply nested objects with mixed types

### 7.2 Performance: avoid full deep clone when no redaction needed

**Problem:** `cloneValue` deep-clones the entire object even when `redactPaths` is empty.

**Fix:** Early return in `applyRedactions` if `paths.length === 0` — skip the clone entirely.

**Tests:**
- Empty redact paths returns original object (identity, no clone)
- Non-empty redact paths returns cloned + redacted object

---

## 8. System Errors

**Current trust: 7/10 — Target: 9/10**

### 8.1 `combinedError` should use the factory system

**Problem:** `combinedError` uses `createAppError` directly, bypassing `defineErrors`. No factory metadata attached.

**Fix:** Define `SystemErrors.Combined` as a proper factory via `defineError` and use it in `combinedError()`.

**Tests:**
- `getFactoryMeta(combinedError(...))` returns valid metadata
- `combinedError` message grammar: use "1 failure" vs "N failures" correctly
- `combinedError` with 0 errors (edge case)

### 8.2 `UnexpectedError.data` duplication

**Problem:** `UnexpectedError` stores `message` and `name` in `.data` which duplicates `.message` and `.name` on the error itself.

**Fix:** This is intentional — `.data.message` is the *original* thrown value's message, while `.message` is the AppError's message (which may differ). Document this clearly with JSDoc. No code change.

---

## 9. Test Coverage Targets

Every module needs comprehensive tests. Target: **every public function, every edge case from this spec, every error path.**

### New test files to create:
- `test/serialize.test.ts` — round-trip, malformed input, circular refs, cause chains
- `test/config.test.ts` — config isolation, reset, environment detection
- `test/redaction.test.ts` — all types, circular refs, performance, empty paths
- `test/boundary.test.ts` — cause preservation, violation, unknown tags
- `test/narrow-error.test.ts` — runtime validation, all input types

### Existing test files to extend:
- `test/error-system.test.ts` — Symbol cause, null cause, `isAppError` edge cases, `withContext` isolation
- `test/typed-promise.test.ts` — `isErrorTag` with/without meta, `typedAsync` ergonomics

### Test quality standards:
- Every test has a descriptive name that reads as a spec: `"narrowError wraps unrecognized AppError tag as UnexpectedError"`
- No shared mutable state between tests — each test creates its own errors
- Config tests use `resetErrorConfig()` in afterEach
- No `any` in test code

---

## 10. API Surface Polish

### 10.1 Export audit
- Export `getErrorConfig` and `resetErrorConfig` from index
- Add JSDoc `@internal` or `@advanced` tag to `createAppError` export
- Verify every public type is exported

### 10.2 Naming consistency review
- `attempt` (sync) → `Result` and `attemptAsync` (async) → `TaskResult` — add JSDoc linking them
- `ok()`/`err()` free functions vs `TaskResult.ok()`/`TaskResult.err()` static methods — document the pattern

### 10.3 JSDoc on all public exports
Every exported function and type gets a JSDoc comment with:
- One-line description
- `@param` for each parameter
- `@returns` description
- `@example` for non-obvious usage
- `@throws` if it can throw (should be almost never after this hardening)

---

## Non-goals (out of scope for this spec)

- README, CHANGELOG, CI/CD, publishing infrastructure (separate effort)
- ESLint plugin and VS Code extension hardening (separate spec)
- Performance benchmarking (after correctness is solid)
- New features beyond what's needed to fix the issues above
