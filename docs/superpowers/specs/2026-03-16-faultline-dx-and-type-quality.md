# Faultline DX & Type Quality Spec

**Goal:** Make every type honest, every cast justified, and every API intuitive enough that enterprise teams adopt faultline without hesitation.

**Scope:** Linting strictness, type system fixes, serialization convergence, performance polish. No new features (retry, logging, catalog) — those come post-v1.

**Constraints:** Pre-1.0 — all signatures can change freely. No backwards compatibility with any prior serialization format (nothing is in production yet).

---

## Phase 1: Linting Strictness

### oxlint configuration

Add rules to `oxlint.json` targeting `packages/faultline/src/**/*.ts`:

| Rule | Level | Purpose |
|------|-------|---------|
| `typescript/no-explicit-any` | error | Ban `any` in source |
| `typescript/no-non-null-assertion` | error | Ban `!` postfix — use proper narrowing |
| `no-unused-vars` | error | Upgrade from warn — dead code is a bug |

**Note:** oxlint (v0.16) does not support `typescript/consistent-type-assertions` or `typescript/no-unnecessary-type-assertion` — these are typescript-eslint rules that require type-checked linting. The cast audit (below) handles this concern manually. If oxlint adds type-aware rules in a future version, adopt them.

Scope: `packages/faultline/src/**/*.ts` only. Test files are excluded — they need flexibility for edge case testing.

### Cast audit

Every existing `as` assertion in `src/` gets one of two treatments:

- **Eliminated**: rewritten with better types so the cast isn't needed.
- **Justified**: gets an `// oxlint-ignore-next-line <rule> -- <reason>` with a reason comment explaining why the cast is necessary (e.g., "Generic type narrowing — TypeScript can't track discriminated union through Result transformers").

Primary targets: the 7 `as unknown as` patterns in result.ts and the 50+ single `as` assertions across all source files. `as const` assertions are exempt — they are safe and idiomatic.

---

## Phase 2: Type System Fixes

### 2a. `attempt`/`attemptAsync` — type-safe overloads

**Problem:** `attempt<T, E extends AppError = AppError>` returns `Result<T, AppError>` which erases the specific `System.Unexpected` tag. Changing the default to `UnexpectedError` is unsound because `fromUnknown` passes AppErrors through unmodified — if the wrapped code throws an AppError, the runtime value is that AppError, not `UnexpectedError`.

**Fix:** Use overloads to separate the two use cases:

```ts
// No options → always wraps as UnexpectedError (including re-thrown AppErrors)
function attempt<T>(fn: () => T): Result<T, UnexpectedError>;
// With mapUnknown → user controls the error type
function attempt<T, E extends AppError>(fn: () => T, options: AttemptOptions<E>): Result<T, E>;
```

The no-options overload uses a default mapper that **always** wraps in `SystemErrors.Unexpected`, even for AppErrors. This makes the type honest — if you don't provide a mapper, everything becomes `UnexpectedError`. If you want to preserve specific AppError types, provide `mapUnknown`.

Same pattern for `attemptAsync`:

```ts
function attemptAsync<T>(fn: (signal?: AbortSignal) => Promise<T>): TaskResult<T, UnexpectedError | ReturnType<typeof SystemErrors.Cancelled>>;
function attemptAsync<T, E extends AppError, C extends AppError = ReturnType<typeof SystemErrors.Cancelled>>(
  fn: (signal?: AbortSignal) => Promise<T>,
  options: AttemptAsyncOptions<E, C>,
): TaskResult<T, E | C>;
```

**Default mapper implementation** (used when no `mapUnknown` is provided):

```ts
function wrapAsUnexpected(thrown: unknown): UnexpectedError {
  const message = thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : 'Unexpected error';
  const name = thrown instanceof Error ? thrown.name : undefined;
  const error = SystemErrors.Unexpected({ name, message });
  return (thrown !== undefined && thrown !== null ? error.withCause(thrown) : error) as UnexpectedError;
}
```

This is separate from `fromUnknown` — `fromUnknown` still preserves AppErrors for its own callers.

### 2b. `Boundary` — throw on violation (like match exhaustion)

**Problem:** The boundary can return `SystemErrors.BoundaryViolation` when no handler matches, but the return type says `To`. Adding `BoundaryViolationError` to the return type would infect every `mapErr(boundary)` call site, forcing consumers to handle what is essentially a programmer bug in every `match` block.

**Fix:** Throw `BoundaryViolation` instead of returning it, consistent with how match exhaustion throws `SystemErrors.Unexpected`. A missing handler in a boundary map IS a programming error — it should fail fast, not propagate silently.

```ts
// In boundary.ts — the violation branch:
if (!handler) {
  throw SystemErrors.BoundaryViolation({
    boundary: config.name,
    fromTag: error._tag,
    expectedTags: Object.keys(config.map),
  }).withCause(error);
}
```

The `Boundary` return type stays clean:

```ts
interface Boundary<From extends AppError, To extends AppError> {
  (error: From): To;
  readonly definition: BoundaryDefinition<From, To>;
}
```

The type is now honest — it returns `To` for all typed inputs, and throws for programmer errors. Same semantics as match exhaustion.

### 2c. `_output` → symbol key

**Problem:** `_output` is visible in autocomplete on every error group and factory, confusing users.

**Fix:** Replace with a unique symbol key:

```ts
// In define-error.ts — exported for advanced use, invisible in autocomplete
export declare const ErrorOutput: unique symbol;
export type ErrorOutputKey = typeof ErrorOutput;

export interface ErrorFactory<Tag extends string, Code extends string, Input, Data> {
  (...args: FactoryArgs<Input>): AppError<Tag, Code, Data>;
  readonly [ErrorOutput]: AppError<Tag, Code, Data>;
}

export type ErrorGroup<Namespace extends string, Defs extends Record<string, ErrorDefinition>> = {
  readonly [K in keyof Defs]: FactoryFromDefinition<`${Namespace}.${K & string}`, Defs[K]>;
} & {
  readonly [ErrorOutput]: { /* union of all inferred error types */ };
};

export type Infer<T extends { readonly [ErrorOutput]: unknown }> = T[ErrorOutputKey];
```

**All locations using `{ readonly _output: ... }` as a structural constraint must be migrated:**

| File | Location | Change |
|------|----------|--------|
| `define-error.ts` | `ErrorFactory`, `ErrorGroup`, `Infer` | Use `[ErrorOutput]` key |
| `boundary.ts:10` | `OutputCarrier` type | Use `[ErrorOutput]` key |
| `typed-promise.ts:53-54` | `ErrorSource` type | Use `[ErrorOutput]` key |
| `typed-promise.ts:60-63` | `InferErrors` type | Use `[ErrorOutput]` key |
| `typed-promise.ts:149` | `isErrorTag` overload | Use `[ErrorOutput]` key |
| `typed-promise.ts:159` | `isErrorTag` implementation | Use `[ErrorOutput]` key |

All of these change from `{ readonly _output: ... }` to `{ readonly [ErrorOutput]: ... }`.

### 2d. `ContextFrame.layer` → extensible string

**Problem:** Closed union `'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport'` blocks enterprise architectures.

**Fix:** Use the `string & {}` pattern for autocomplete with extensibility:

```ts
export interface ContextFrame {
  readonly layer?: 'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport' | (string & {});
  readonly operation: string;
  readonly component?: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly meta?: Record<string, unknown>;
}
```

Standard TypeScript pattern — autocomplete suggests the common values, any string is accepted.

### 2e. Match handler overloads on Result interfaces

**Problem:** Single `match` method with a union parameter type causes TypeScript to sometimes pick the wrong branch, leading to confusing error messages.

**Fix:** Use method overloads on the interfaces:

```ts
export interface ResultOk<T, E extends AppError = never> {
  // ... other methods ...
  match<R>(handlers: ExhaustiveMatchHandlers<T, E, R>): R;
  match<R>(handlers: PartialMatchHandlers<T, E, R>): R;
}

export interface ResultErr<T, E extends AppError> {
  // ... other methods ...
  match<R>(handlers: ExhaustiveMatchHandlers<T, E, R>): R;
  match<R>(handlers: PartialMatchHandlers<T, E, R>): R;
}
```

TypeScript tries overloads in declaration order — exhaustive first (stricter), partial second (has `_`). Better inference, better error messages when a handler is missing.

### 2f. Remove `createAppError` from barrel export

**Problem:** Marked `@internal` but exported from `index.ts`. Enterprise teams will use it and depend on it.

**Fix:** Remove from `packages/faultline/src/index.ts` exports. Users who need it can deep-import from `faultline/src/error` at their own risk, but the public API surface should not include internals.

Also remove from export: `AppErrorInit` (internal type used only by `createAppError`).

---

## Phase 3: Serialization Convergence

### 3a. Unify `toJSON()` and `serializeResult()`/`serializeError()` formats

**Problem:** Two incompatible serialization formats for the same concept:

- `serializeResult(ok(42))` → `{ kind: 'result', version: 1, state: 'ok', value: 42 }`
- `ok(42).toJSON()` → `{ _type: 'ok', value: 42 }`

**Fix:** `toJSON()` becomes the canonical serialization. It produces the full versioned format:

```ts
// OkImpl.toJSON():
{
  _format: 'faultline-result',
  _version: 1,
  _type: 'ok',
  value: this.value,
}

// ErrImpl.toJSON():
{
  _format: 'faultline-result',
  _version: 1,
  _type: 'err',
  error: this.error.toJSON(),
}
```

`serializeResult()` delegates to `result.toJSON()`. One format, one source of truth.

For `AppError.toJSON()`, the format stays as-is (it already uses the versioned `kind: 'app-error'` envelope). `serializeError()` delegates to `error.toJSON()` for AppErrors.

Update the `SerializedResult` types to match the new format:

```ts
export interface SerializedResultOk<T> {
  readonly _format: 'faultline-result';
  readonly _version: typeof SERIALIZED_RESULT_FORMAT_VERSION;
  readonly _type: 'ok';
  readonly value: T;
}

export interface SerializedResultErr {
  readonly _format: 'faultline-result';
  readonly _version: typeof SERIALIZED_RESULT_FORMAT_VERSION;
  readonly _type: 'err';
  readonly error: SerializedError;
}
```

**Migration:** Pre-1.0, no backwards compatibility needed. `deserializeResult` only accepts the new `_format`/`_type` format. The old `kind`/`state` format is dropped entirely.

### 3b. Flatten `deserializeResult` return type

**Problem:** `Result<Result<T, AppError>, AppError>` requires double unwrapping.

**Fix:** Return `Result<T, AppError>` directly:

```ts
function deserializeResult<T>(input: unknown): Result<T, AppError>
```

Semantics:
- Input was serialized `ok(value)` → returns `ok(value)`
- Input was serialized `err(SomeError)` → returns `err(SomeError)`
- Input was invalid/garbage → returns `err(SerializationFailed)`

The caller gets a flat Result. To distinguish "deserialization failed" from "the original was an error", check `isErrTag(result, 'System.SerializationFailed')`. The tag system already handles this — no need for nesting.

**Implementation:** `deserializeResult` checks `_format`, `_version`, `_type` on the input. If `_type === 'ok'`, returns `ok(value)`. If `_type === 'err'`, delegates to `deserializeError` for the error payload and returns `err(deserializedError)`. If the input is malformed, returns `err(SerializationFailed)`.

### 3c. Specific error type on `deserializeError`

**Problem:** `Result<AppError, AppError>` — both sides are `AppError`, confusing.

**Fix:**

```ts
type SerializationFailedError = Infer<typeof SystemErrors.SerializationFailed>;

function deserializeError(input: unknown): Result<AppError, SerializationFailedError>
```

Success is an `AppError` (the deserialized error). Failure is specifically `SerializationFailed` — not a vague `AppError`.

---

## Phase 4: Performance & Polish

### 4a. Cache tag sets in `narrowError`

**Problem:** Rebuilds a `new Set<string>()` on every call by iterating all sources and extracting metadata. Wasteful in hot catch blocks.

**Fix:** Cache each source's tags in a module-scoped `WeakMap`:

```ts
const tagCache = new WeakMap<object, ReadonlySet<string>>();

function getTagsForSource(source: object): ReadonlySet<string> {
  let cached = tagCache.get(source);
  if (cached) return cached;

  const tags = new Set<string>();
  const groupMeta = getGroupMeta(source);
  if (groupMeta) {
    for (const tag of groupMeta.tags) tags.add(tag);
  } else {
    const factoryMeta = getFactoryMeta(source);
    if (factoryMeta) tags.add(factoryMeta.tag);
  }

  tagCache.set(source, tags);
  return tags;
}
```

Error groups and factories are stable objects — they never change after creation. WeakMap means no memory leak. Per-call work becomes a WeakMap lookup per source rather than iterating all tags.

### 4b. `all()` preserves error indices

**Problem:** `CombinedAppError.data.errors` is a flat array with no information about which index each error came from.

**Fix:** Change the data shape to include indices:

```ts
export type CombinedAppError<E extends AppError = AppError> = AppError<
  'System.Combined',
  'SYSTEM_COMBINED',
  { readonly errors: readonly { readonly index: number; readonly error: E }[] }
>;
```

**Updated `combinedError` signature:**

```ts
function combinedError<E extends AppError>(
  errors: readonly { readonly index: number; readonly error: E }[],
): CombinedAppError<E>
```

**Updated `CombinedFactory`:**

```ts
const CombinedFactory = defineError({
  tag: 'System.Combined',
  code: 'SYSTEM_COMBINED',
  params: (input: { errors: readonly { readonly index: number; readonly error: AppError }[] }) => input,
  message: (data) =>
    `Combined error with ${data.errors.length} ${data.errors.length === 1 ? 'failure' : 'failures'}`,
});
```

**Updated `all()` loop** — uses index-based iteration instead of `for...of`:

```ts
// In the sync path of all():
const values: unknown[] = [];
const errors: { index: number; error: AppError }[] = [];

for (let i = 0; i < results.length; i++) {
  const result = results[i]!;
  if (isOk(result)) {
    values.push(result.value);
  } else {
    errors.push({ index: i, error: result.error });
  }
}

if (errors.length > 0) {
  return err(combinedError(errors));
}
```

The `TaskResult` overload of `all()` resolves all tasks via `Promise.all()` (which preserves order), then delegates to the sync `all()` — indices remain accurate.

---

## Files Modified

| File | Changes |
|------|---------|
| `oxlint.json` | Add strict TypeScript rules |
| `packages/faultline/src/config.ts` | Cast audit |
| `packages/faultline/src/error.ts` | `ContextFrame.layer` extensibility, `ErrorOutput` symbol declaration, remove `createAppError` from barrel, cast audit |
| `packages/faultline/src/define-error.ts` | `_output` → `[ErrorOutput]` on factories/groups, `Infer` updated, `ErrorOutput` symbol export, cast audit |
| `packages/faultline/src/result.ts` | Match overloads, `attempt`/`attemptAsync` overloads + `wrapAsUnexpected`, `toJSON` format, `all()` indices, cast audit |
| `packages/faultline/src/serialize.ts` | Flatten `deserializeResult`/`deserializeError`, delegate to `toJSON`, update `SerializedResult` types, drop old format |
| `packages/faultline/src/boundary.ts` | Throw on BoundaryViolation, `OutputCarrier` → `[ErrorOutput]`, cast audit |
| `packages/faultline/src/typed-promise.ts` | `narrowError` caching, `ErrorSource`/`InferErrors`/`isErrorTag` → `[ErrorOutput]`, cast audit |
| `packages/faultline/src/system-errors.ts` | `CombinedAppError` data shape, `CombinedFactory` params, `combinedError` signature, cast audit |
| `packages/faultline/src/from-unknown.ts` | Cast audit |
| `packages/faultline/src/index.ts` | Remove `createAppError`/`AppErrorInit`, export `ErrorOutput` symbol, update re-exports |
| `packages/faultline/test/*.test.ts` | Update all tests for changed signatures |
| `packages/faultline/test/typecheck.ts` | Update boundary return type assertion (no longer includes `BoundaryViolationError`) |

## Test Impact

All existing tests need updating for:
- `deserializeResult` now returns flat `Result<T, AppError>` instead of nested
- `CombinedAppError.data.errors` is now `{ index, error }[]` instead of flat `E[]`
- `combinedError` now accepts `{ index, error }[]` instead of `E[]`
- Boundary now throws on violation instead of returning `BoundaryViolation`
- `toJSON` on Results now includes `_format` and `_version` fields
- `_output` references in tests change to `[ErrorOutput]` or `Infer<>`
- `createAppError` is no longer importable from `../src/index`
- `attempt`/`attemptAsync` without options now always wraps as `UnexpectedError`

New tests needed for:
- oxlint rule compliance (ensure no violations in src/)
- `narrowError` caching behavior (multiple calls, same result)
- `ContextFrame.layer` accepts custom strings
- Match overload inference (verify TypeScript picks correct overload)
- `attempt` overloads: no-options wraps AppErrors as Unexpected, with-options preserves user mapping
- Boundary violation throws instead of returning
