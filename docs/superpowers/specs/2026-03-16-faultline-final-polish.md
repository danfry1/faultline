# Faultline Final Polish Spec

**Goal:** Address the 6 remaining refinements from the post-DX review to reach world-class quality.

**Constraints:** Pre-1.0, all signatures can change freely. Public API surface must not change (all re-exports preserved).

---

## Fix 1: Split `result.ts` into 3 focused files

`result.ts` is 726 lines with too many responsibilities. Split into:

- **`result.ts`** (~300 lines) — `ResultOk`/`ResultErr` interfaces, `OkImpl`/`ErrImpl` classes, `ok`/`err`/`isOk`/`isErr`/`isErrTag`, `match`/`catchTag` standalones, `all()`, match handler types, utility types (`SuccessTuple`, `ErrorUnion`, etc.)
- **`task-result.ts`** (~200 lines) — `TaskResult` class, `TaskExecutor`, `TaskContext`, `TaskRunOptions`, `resolveTaskLike` helper
- **`attempt.ts`** (~150 lines) — `attempt`/`attemptAsync` with overloads, `AttemptOptions`/`AttemptAsyncOptions`, `wrapAsUnexpected`, `createAbortSignalRace`, `isAbortSignalReason`, `defaultAbortMapper`

`index.ts` re-exports everything from all three files. No public API change.

Import dependencies:
- `task-result.ts` imports from `result.ts` (needs `Result`, `ok`, `err`, `isOk`, `isErr`)
- `attempt.ts` imports from `result.ts` and `task-result.ts`
- `result.ts` imports `TaskResult` from `task-result.ts` (for `toTask()` method and `all()` TaskResult overload)
- `result.ts` imports `combinedError` from `system-errors.ts`

**Circular dependency resolution:** `result.ts` needs `TaskResult` for `toTask()` and `all()`. `task-result.ts` needs `Result`/`ok`/`err`/`isOk`/`isErr`. This is a value-level circular dependency.

**Safe because of deferred evaluation:** Neither module calls imported bindings at the top level — they're only used inside class methods and function bodies. By the time any method executes, both modules have fully loaded. This pattern is well-established in TypeScript/Bun ESM. The key invariant: no top-level code in either module calls functions from the other.

The `.toTask()` method stays as-is on the `ResultOk`/`ResultErr` interfaces — no fluent API change needed.

## Fix 2: Remove `SerializableError` type alias

`SerializableError = AppError | Error | unknown` collapses to `unknown`. Remove it from `serialize.ts`. Change `serializeError(error: SerializableError)` to `serializeError(error: unknown)`. Remove from index.ts exports if present (it's not currently exported — only used internally).

## Fix 3: Consistent serialization field naming

`SerializedAppError` uses `kind`/`version` (no underscore). `SerializedResult` uses `_format`/`_version` (with underscore). Unify to underscore-prefixed:

```ts
export interface SerializedAppError<Tag, Code, Data> {
  readonly _format: 'faultline';         // was: kind: 'app-error'
  readonly _version: 1;                   // was: version: 1
  readonly _tag: Tag;
  readonly name: string;
  readonly code: Code;
  readonly message: string;
  readonly data: Data;
  readonly status?: number;
  readonly context: readonly ContextFrame[];
  readonly cause?: SerializedError;
}
```

Update all consumers:
- `isSerializedAppError` — check `_format === 'faultline'` instead of `kind === 'app-error'`
- `serializeAppError` — produce `_format`/`_version` instead of `kind`/`version`
- `deserializeError` — check `_version` instead of `version`
- **`deserializeError` cause-chain walk** — the guard at `'kind' in cause` / `causeObj.kind === 'app-error'` must change to `'_format' in cause` / `causeObj._format === 'faultline'`. Without this, recursive AppError cause deserialization silently breaks.
- `serializeError` — the non-AppError path still uses `SerializedCause` with `kind: 'cause'` (this is fine — `SerializedCause` is a different type for non-AppError causes)
- All tests that check `kind: 'app-error'` → check `_format: 'faultline'` (specific locations: `serialize.test.ts`, `error-system.test.ts` serialization tests)
- `SERIALIZED_ERROR_FORMAT_VERSION` constant stays as `1`

The `SerializedCause` type keeps its `kind: 'cause'` field — it's a different concept (serialized native Error or primitive) and doesn't need the versioned envelope.

`SerializedError` union discriminates on `_format` for AppErrors and `kind` for causes:
```ts
export type SerializedError =
  | SerializedCause           // { kind: 'cause', ... }
  | SerializedAppError;       // { _format: 'faultline', ... }
```

**Important:** `SerializedError` is no longer a standard TypeScript discriminated union (no shared discriminant field). All runtime narrowing must use `'_format' in x` guards to distinguish AppErrors from causes:

```ts
if ('_format' in serialized) {
  // SerializedAppError — has _format, _version, _tag, etc.
} else {
  // SerializedCause — has kind: 'cause'
}
```

## Fix 4: Add explicit TaskResult method tests

Create `packages/faultline/test/task-result.test.ts` with tests for:
- `TaskResult.mapErr` — transforms error type
- `TaskResult.catchTag` — recovers from specific tag
- `TaskResult.tap` — side effect on success, doesn't change result
- `TaskResult.tapError` — side effect on error, doesn't change result
- `TaskResult.withContext` — adds context frame to error results

## Fix 5: Zero-arg error `data` typed as `undefined`

Change `ErrorDefinitionWithoutParams` so zero-arg factories produce `data: undefined` instead of `data: void`:

In `define-error.ts`:
```ts
// ErrorFactory for zero-arg: Data parameter becomes `undefined`
// FactoryArgs for undefined: still produces [] (no args)
export type FactoryArgs<Input> = [Input] extends [undefined]
  ? []
  : [input: Input];
```

And `ErrorDefinitionWithoutParams`:
```ts
export interface ErrorDefinitionWithoutParams<Code extends string = string> {
  readonly code: Code;
  readonly status?: number;
  readonly message?: string | ((data: undefined) => string);
  readonly params?: undefined;
}
```

`FactoryFromDefinition` changes the zero-arg branch:
```ts
: Def extends ErrorDefinitionWithoutParams<infer Code>
    ? ErrorFactory<Tag, Code, undefined, undefined>
    : never;
```

Update `defineError` implementation: when `params` is undefined, pass `undefined` (same runtime behavior, different type).

Update `typecheck.ts`: `_zeroArgData` assertion changes from `void` to `undefined`.

**Note:** The `ErrorDefinitionWithoutParams.message` callback changes from `(data: void) => string` to `(data: undefined) => string`. Since `void` is not assignable to `undefined` in parameter position, any existing user code with `message: (data: void) => ...` will need updating. This is acceptable for pre-1.0.

## Fix 6: Document allocation cost

Add JSDoc note to `withCause` and `withContext` in the `AppError` interface in `error.ts`:

```ts
/**
 * Returns a new AppError with the given cause. Each call allocates a new error instance.
 * For hot paths, consider building the error with cause at creation time via the factory.
 */
withCause(cause: unknown): AppError<Tag, Code, Data>;

/**
 * Returns a new AppError with an additional context frame. Each call allocates a new error instance.
 * Chain multiple context additions before error creation when possible.
 */
withContext(frame: ContextFrame): AppError<Tag, Code, Data>;
```

---

## Files Modified

| File | Changes |
|------|---------|
| `packages/faultline/src/result.ts` | Split: keep Result/Ok/Err/all/match/catchTag |
| `packages/faultline/src/task-result.ts` | New: TaskResult class extracted |
| `packages/faultline/src/attempt.ts` | New: attempt/attemptAsync extracted |
| `packages/faultline/src/serialize.ts` | Remove SerializableError, update field names |
| `packages/faultline/src/error.ts` | Update SerializedAppError fields, JSDoc on withCause/withContext |
| `packages/faultline/src/define-error.ts` | void → undefined for zero-arg errors |
| `packages/faultline/src/index.ts` | Re-export from new files, remove SerializableError |
| `packages/faultline/test/task-result.test.ts` | New: explicit TaskResult method tests |
| `packages/faultline/test/*.test.ts` | Update for new serialization field names |
| `packages/faultline/test/typecheck.ts` | Update void → undefined assertion |
