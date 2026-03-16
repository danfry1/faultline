# Faultline DX & Type Quality Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every type honest, every cast justified, and every API intuitive — world-class DX for v1 publish.

**Architecture:** Four phases executed sequentially. Phase 1 (linting) establishes rules. Phases 2-4 fix types, serialization, and performance under those rules. Cast audit runs last since earlier phases change the casts. All work is in `packages/faultline/`.

**Tech Stack:** TypeScript 5.9+, Bun test runner, oxlint, tsdown (build)

**Spec:** `docs/superpowers/specs/2026-03-16-faultline-dx-and-type-quality.md`

---

## Chunk 1: Linting & Foundations

### Task 1: Update oxlint configuration

**Files:**
- Modify: `oxlint.json`

- [ ] **Step 1: Update oxlint.json with strict rules**

```json
{
  "$schema": "https://raw.githubusercontent.com/nicolo-ribaudo/oxlint-config-inspector/main/oxlint_config_schema.json",
  "rules": {
    "no-unused-vars": "error",
    "no-console": "off",
    "eqeqeq": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error"
  },
  "ignorePatterns": [
    "dist",
    "out",
    "node_modules",
    "*.d.ts",
    "packages/faultline/test"
  ]
}
```

- [ ] **Step 2: Run oxlint to see current violations**

Run: `bunx oxlint`
Expected: Multiple violations in src/ files. Note them — they'll be fixed in later tasks.

- [ ] **Step 3: Commit config change only**

```bash
git add oxlint.json
git commit -m "chore: add strict oxlint rules for type safety"
```

### Task 2: `_output` → symbol key and other type foundations

**Files:**
- Modify: `packages/faultline/src/define-error.ts`
- Modify: `packages/faultline/src/error.ts`
- Modify: `packages/faultline/src/boundary.ts`
- Modify: `packages/faultline/src/typed-promise.ts`
- Modify: `packages/faultline/src/index.ts`
- Modify: `packages/faultline/test/typecheck.ts`

This task combines three related foundation changes: `_output` → symbol, `ContextFrame.layer` extensibility, and removing `createAppError` from barrel exports.

- [ ] **Step 1: Add `ErrorOutput` symbol and migrate types in define-error.ts**

In `packages/faultline/src/define-error.ts`:

1. Add the symbol declaration after imports:
```ts
export declare const ErrorOutput: unique symbol;
export type ErrorOutputKey = typeof ErrorOutput;
```

2. Change `ErrorFactory` interface — replace `readonly _output:` with `readonly [ErrorOutput]:`:
```ts
export interface ErrorFactory<
  Tag extends string,
  Code extends string,
  Input,
  Data,
> {
  (...args: FactoryArgs<Input>): AppError<Tag, Code, Data>;
  readonly [ErrorOutput]: AppError<Tag, Code, Data>;
}
```

3. Change `Infer` type:
```ts
export type Infer<T extends { readonly [ErrorOutput]: unknown }> = T[ErrorOutputKey];
```

4. Change `ErrorGroup` type — replace `readonly _output:` with `readonly [ErrorOutput]:`:
```ts
export type ErrorGroup<
  Namespace extends string,
  Defs extends Record<string, ErrorDefinition>,
> = {
  readonly [K in keyof Defs]: FactoryFromDefinition<
    `${Namespace}.${K & string}`,
    Defs[K]
  >;
} & {
  readonly [ErrorOutput]: {
    readonly [K in keyof Defs]: Infer<
      FactoryFromDefinition<`${Namespace}.${K & string}`, Defs[K]>
    >;
  }[keyof Defs];
};
```

- [ ] **Step 2: Migrate `_output` references in boundary.ts**

In `packages/faultline/src/boundary.ts`:

1. Add import for `ErrorOutput`:
```ts
import type { Infer, ErrorOutputKey } from './define-error';
import { ErrorOutput } from './define-error';
```
(Replace the existing `import type { Infer } from './define-error';`)

2. Change `OutputCarrier` type (line 10):
```ts
type OutputCarrier<E extends AppError = AppError> = { readonly [ErrorOutput]: E };
```

- [ ] **Step 3: Migrate `_output` references in typed-promise.ts**

In `packages/faultline/src/typed-promise.ts`:

1. Add import for `ErrorOutput`:
```ts
import type { Infer, ErrorOutputKey } from './define-error';
import { ErrorOutput } from './define-error';
```
(Replace the existing `import type { Infer } from './define-error';`)

2. Change `ErrorSource` type (lines 52-54):
```ts
type ErrorSource =
  | { readonly [ErrorOutput]: unknown }
  | readonly { readonly [ErrorOutput]: unknown }[];
```

3. Change `InferErrors` type (lines 59-65):
```ts
type InferErrors<T extends ErrorSource> = T extends readonly (infer Item)[]
  ? Item extends { readonly [ErrorOutput]: infer O }
    ? O
    : never
  : T extends { readonly [ErrorOutput]: infer O }
    ? O
    : never;
```

4. Change `isErrorTag` factory overload (line 149):
```ts
export function isErrorTag<F extends { readonly [ErrorOutput]: AppError }>(
  value: unknown,
  factory: F,
): value is Infer<F>;
```

5. Change `isErrorTag` implementation signature (line 157-159):
```ts
export function isErrorTag(
  value: unknown,
  tagOrFactory: string | { readonly [ErrorOutput]: unknown },
): boolean {
```

- [ ] **Step 4: Make `ContextFrame.layer` extensible**

In `packages/faultline/src/error.ts`, change line 5:

```ts
  readonly layer?: 'ui' | 'client' | 'service' | 'domain' | 'infra' | 'transport' | (string & {});
```

- [ ] **Step 5: Update barrel exports in index.ts**

In `packages/faultline/src/index.ts`:

1. Remove `createAppError` from the value exports and `AppErrorInit` from the type exports:
```ts
export {
  getBoundaryMeta,
  getFactoryMeta,
  getGroupMeta,
  isAppError,
  isSerializedAppError,
  isSerializedCause,
  SERIALIZED_ERROR_FORMAT_VERSION,
} from './error';
export type {
  AppError,
  BoundaryRuntimeMeta,
  ContextFrame,
  ErrorFactoryRuntimeMeta,
  ErrorGroupRuntimeMeta,
  SerializedAppError,
  SerializedError,
  SerializedCause,
} from './error';
```

2. Add `ErrorOutput` to the define-error exports:
```ts
export { defineError, defineErrors, ErrorOutput } from './define-error';
export type {
  ErrorDefinition,
  ErrorDefinitionWithParams,
  ErrorDefinitionWithoutParams,
  ErrorFactory,
  ErrorGroup,
  ErrorOutputKey,
  FactoryArgs,
  Infer,
} from './define-error';
```

- [ ] **Step 6: Update typecheck.ts**

In `packages/faultline/test/typecheck.ts`:
- Keep the `type AppError` import (it's used in the `@ts-expect-error` boundary test).
- No `_output` references to update (typecheck.ts uses `Infer<>` which will just work with the new symbol key).
- Remove `createAppError` from the import if present (it's not currently imported there).

- [ ] **Step 7: Add test for ContextFrame.layer extensibility**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('ContextFrame extensibility', () => {
  test('layer accepts custom string values', () => {
    const error = UserErrors.NotFound({ userId: '1' }).withContext({
      layer: 'gateway',
      operation: 'route',
    });
    expect(error.context[0]?.layer).toBe('gateway');
  });
});
```

- [ ] **Step 8: Run typecheck and tests**

Run: `cd packages/faultline && bunx tsc --noEmit && bun test`
Expected: All pass. If typecheck fails on `_output` references in test files, update them.

- [ ] **Step 9: Commit**

```bash
git add packages/faultline/src/ packages/faultline/test/
git commit -m "fix: replace _output with symbol key, extensible layer type, remove createAppError from public API"
```

---

## Chunk 2: Type System Fixes

### Task 3: Match handler overloads on Result interfaces

**Files:**
- Modify: `packages/faultline/src/result.ts`

- [ ] **Step 1: Replace single `match` with overloads on both interfaces**

In `packages/faultline/src/result.ts`:

In `ResultOk` interface, replace line 37:
```ts
  match<R>(handlers: ExhaustiveMatchHandlers<T, E, R>): R;
  match<R>(handlers: PartialMatchHandlers<T, E, R>): R;
```

In `ResultErr` interface, replace line 59:
```ts
  match<R>(handlers: ExhaustiveMatchHandlers<T, E, R>): R;
  match<R>(handlers: PartialMatchHandlers<T, E, R>): R;
```

- [ ] **Step 2: Add type-level test for match overload inference**

In `packages/faultline/test/typecheck.ts`, add after the existing `matched` test:

```ts
// Partial match with wildcard — should infer R = string
const partialMatched = err(UserErrors.NotFound({ userId: '1' })).match({
  ok: (value) => String(value),
  _: (error) => error.message,
});

type _partialMatched = Expect<Equal<typeof partialMatched, string>>;
```

- [ ] **Step 3: Run typecheck and tests**

Run: `cd packages/faultline && bunx tsc --noEmit && bun test`
Expected: All pass. The implementation classes already handle both handler shapes.

- [ ] **Step 4: Commit**

```bash
git add packages/faultline/src/result.ts packages/faultline/test/typecheck.ts
git commit -m "fix: match handler overloads for better TypeScript inference"
```

### Task 4: `attempt`/`attemptAsync` type-safe overloads

**Files:**
- Modify: `packages/faultline/src/result.ts`
- Modify: `packages/faultline/test/error-system.test.ts`
- Modify: `packages/faultline/test/typecheck.ts`

- [ ] **Step 1: Write failing tests for new attempt behavior**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('attempt overloads', () => {
  test('attempt without options always wraps as UnexpectedError', () => {
    const result = attempt(() => {
      throw UserErrors.NotFound({ userId: '1' });
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      // Even though an AppError was thrown, without mapUnknown it gets wrapped
      expect(result.error._tag).toBe('System.Unexpected');
      expect(isAppError(result.error.cause)).toBe(true);
    }
  });

  test('attempt with mapUnknown preserves user mapping', () => {
    const result = attempt(
      () => { throw new Error('parse failed'); },
      { mapUnknown: (thrown) => fromUnknown(thrown) },
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Unexpected');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify the first test fails**

Run: `cd packages/faultline && bun test test/error-system.test.ts`
Expected: First test FAILS — currently attempt preserves AppErrors via fromUnknown.

- [ ] **Step 3: Add `wrapAsUnexpected` helper and refactor `attempt` with overloads**

In `packages/faultline/src/result.ts`:

Add the import for `UnexpectedError`:
```ts
import type { UnexpectedError } from './system-errors';
```

Add the `wrapAsUnexpected` function (before `attempt`):
```ts
function wrapAsUnexpected(thrown: unknown): UnexpectedError {
  const message = thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : 'Unexpected error';
  const name = thrown instanceof Error ? thrown.name : undefined;
  const error = SystemErrors.Unexpected({ name, message });
  // oxlint-ignore-next-line -- withCause returns AppError<Tag,Code,Data>, narrowing to UnexpectedError is safe since we just created it via SystemErrors.Unexpected
  // oxlint-ignore-next-line -- withCause returns AppError<Tag,Code,Data>, narrowing to UnexpectedError is safe since we just created it via SystemErrors.Unexpected
  return (thrown !== null && thrown !== undefined ? error.withCause(thrown) : error) as UnexpectedError;
}
```

Replace the `attempt` function with overloads:
```ts
/**
 * Runs a synchronous function and captures thrown exceptions as typed errors.
 *
 * @example
 * ```ts
 * const result = attempt(() => JSON.parse(input));
 * ```
 */
export function attempt<T>(fn: () => T): Result<T, UnexpectedError>;
export function attempt<T, E extends AppError>(fn: () => T, options: AttemptOptions<E>): Result<T, E>;
export function attempt<T, E extends AppError>(
  fn: () => T,
  options?: AttemptOptions<E>,
): Result<T, E | UnexpectedError> {
  const mapUnknown = options?.mapUnknown ?? wrapAsUnexpected;

  try {
    return ok(fn());
  } catch (thrown) {
    return err(mapUnknown(thrown));
  }
}
```

- [ ] **Step 4: Refactor `attemptAsync` with overloads**

Replace the `attemptAsync` function:
```ts
/**
 * Runs an async function and captures thrown exceptions as typed errors.
 * Supports abort signals for cooperative cancellation.
 *
 * @example
 * ```ts
 * const task = attemptAsync(async (signal) => {
 *   const response = await fetch(url, { signal });
 *   return response.json();
 * });
 * const result = await task.run();
 * ```
 */
export function attemptAsync<T>(
  fn: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
): TaskResult<T, UnexpectedError | ReturnType<typeof SystemErrors.Cancelled>>;
export function attemptAsync<
  T,
  E extends AppError,
  C extends AppError = ReturnType<typeof SystemErrors.Cancelled>,
>(
  fn: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options: AttemptAsyncOptions<E, C>,
): TaskResult<T, E | C>;
export function attemptAsync<
  T,
  E extends AppError = UnexpectedError,
  C extends AppError = ReturnType<typeof SystemErrors.Cancelled>,
>(
  fn: ((signal?: AbortSignal) => Promise<T>) | (() => Promise<T>),
  options?: AttemptAsyncOptions<E, C>,
): TaskResult<T, E | C | UnexpectedError> {
  const mapUnknown = options?.mapUnknown ?? wrapAsUnexpected;
  const mapAbort =
    (options?.mapAbort as ((reason: unknown) => C) | undefined) ??
    ((reason: unknown) => defaultAbortMapper(reason) as C);

  return TaskResult.from(async ({ signal }) => {
    let cleanup: (() => void) | undefined;
    try {
      const promise = Promise.resolve().then(() =>
        (fn as (signal?: AbortSignal) => Promise<T>)(signal),
      );

      if (signal) {
        const race = createAbortSignalRace(signal);
        cleanup = race.cleanup;
        const value = await Promise.race([promise, race.promise]);
        return ok(value);
      }

      const value = await promise;
      return ok(value);
    } catch (thrown) {
      if (isAbortSignalReason(signal, thrown)) {
        return err(mapAbort(signal?.reason ?? thrown));
      }

      return err(mapUnknown(thrown));
    } finally {
      cleanup?.();
    }
  });
}
```

- [ ] **Step 5: Update existing tests that relied on old attempt behavior**

In `packages/faultline/test/error-system.test.ts`, the existing `attempt captures thrown exceptions` test needs updating — `attempt` without options now wraps everything as `System.Unexpected` (including `Error` instances) via `wrapAsUnexpected` instead of `fromUnknown`. The test should still pass since both produce `System.Unexpected`.

Check the existing `attemptAsync` test in `test/error-system.test.ts` — if it uses `attemptAsync` without options, verify it still expects `System.Unexpected`.

- [ ] **Step 6: Run tests**

Run: `cd packages/faultline && bun test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/result.ts packages/faultline/test/
git commit -m "fix: attempt/attemptAsync use overloads for type-safe error mapping"
```

### Task 5: Boundary throws on violation

**Files:**
- Modify: `packages/faultline/src/boundary.ts`
- Modify: `packages/faultline/test/boundary.test.ts`

- [ ] **Step 1: Write failing test for throw behavior**

In `packages/faultline/test/boundary.test.ts`, update the `BoundaryViolation` test:

Replace the existing test `'BoundaryViolation includes expected tags'` with:
```ts
  test('BoundaryViolation throws on unhandled tag', () => {
    const fakeError = DomainErrors.NotFound({ id: '1' });
    Object.defineProperty(fakeError, '_tag', { value: 'Unknown.Tag', writable: false });

    expect(() => boundary(fakeError as any)).toThrow();

    try {
      boundary(fakeError as any);
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) {
        expect(e._tag).toBe('System.BoundaryViolation');
        expect((e.data as any).expectedTags).toBeDefined();
      }
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — boundary currently returns BoundaryViolation instead of throwing.

- [ ] **Step 3: Change boundary to throw on violation**

In `packages/faultline/src/boundary.ts`, change lines 120-125:

From:
```ts
    if (!handler) {
      return SystemErrors.BoundaryViolation({
        boundary: config.name,
        fromTag: error._tag,
        expectedTags: Object.keys(config.map),
      }).withCause(error);
    }
```

To:
```ts
    if (!handler) {
      throw SystemErrors.BoundaryViolation({
        boundary: config.name,
        fromTag: error._tag,
        expectedTags: Object.keys(config.map),
      }).withCause(error);
    }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/faultline && bun test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/faultline/src/boundary.ts packages/faultline/test/boundary.test.ts
git commit -m "fix: boundary throws on violation instead of returning (fail-fast for programmer errors)"
```

---

## Chunk 3: Serialization Convergence

### Task 6: Unify serialization formats and flatten deserialize

**Files:**
- Modify: `packages/faultline/src/result.ts`
- Modify: `packages/faultline/src/serialize.ts`
- Modify: `packages/faultline/src/index.ts`
- Modify: `packages/faultline/test/serialize.test.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write tests for new serialization format**

Update `packages/faultline/test/serialize.test.ts`:

Replace the `deserializeResult` tests and update the round-trip tests to use the new format (`_format`, `_version`, `_type` instead of `kind`, `version`, `state`). Also test the flat return type:

```ts
describe('deserializeResult', () => {
  test('valid ok result round-trips', () => {
    const original = ok(42);
    const serialized = serializeResult(original);
    const result = deserializeResult(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe(42);
    }
  });

  test('valid err result round-trips', () => {
    const original = err(TestErrors.NotFound({ id: '1' }));
    const serialized = serializeResult(original);
    const result = deserializeResult(serialized);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('Test.NotFound');
    }
  });

  test('returns err for null input', () => {
    const result = deserializeResult(null as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for malformed input', () => {
    const result = deserializeResult({ bad: true } as any);
    expect(isErr(result)).toBe(true);
  });

  test('returns err for wrong version', () => {
    const result = deserializeResult({ _format: 'faultline-result', _version: 999, _type: 'ok', value: 1 } as any);
    expect(isErr(result)).toBe(true);
  });
});
```

Update the `deserializeError` round-trip test:
```ts
  test('valid serialized AppError round-trips correctly', () => {
    const original = TestErrors.NotFound({ id: '42' });
    const serialized = serializeError(original);
    const result = deserializeError(serialized);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value._tag).toBe('Test.NotFound');
      expect(result.value.code).toBe('TEST_NOT_FOUND');
    }
  });
```

Add test for toJSON format:
```ts
describe('Result toJSON format', () => {
  test('ok toJSON produces versioned format', () => {
    const json = JSON.parse(JSON.stringify(ok(42)));
    expect(json._format).toBe('faultline-result');
    expect(json._version).toBe(1);
    expect(json._type).toBe('ok');
    expect(json.value).toBe(42);
  });

  test('err toJSON produces versioned format', () => {
    const json = JSON.parse(JSON.stringify(err(TestErrors.NotFound({ id: '1' }))));
    expect(json._format).toBe('faultline-result');
    expect(json._version).toBe(1);
    expect(json._type).toBe('err');
    expect(json.error._tag).toBe('Test.NotFound');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: Multiple failures — old format doesn't match, deserializeResult was nested.

- [ ] **Step 3: Update `toJSON` in OkImpl and ErrImpl**

In `packages/faultline/src/result.ts`:

**Note:** `serialize.ts` imports from `result.ts`, so `result.ts` cannot import from `serialize.ts` (circular dependency). Inline the version constant directly in the `toJSON` methods. If the version changes, update both here and in `serialize.ts`.

In `OkImpl.toJSON()`:
```ts
  toJSON() {
    return {
      _format: 'faultline-result' as const,
      _version: 1 as const,
      _type: 'ok' as const,
      value: this.value,
    };
  }
```

In `ErrImpl.toJSON()`:
```ts
  toJSON() {
    return {
      _format: 'faultline-result' as const,
      _version: 1 as const,
      _type: 'err' as const,
      error: this.error.toJSON(),
    };
  }
```

Update the `ResultOk` interface `toJSON` signature:
```ts
  toJSON(): { readonly _format: 'faultline-result'; readonly _version: 1; readonly _type: 'ok'; readonly value: T };
```

Update the `ResultErr` interface `toJSON` signature:
```ts
  toJSON(): { readonly _format: 'faultline-result'; readonly _version: 1; readonly _type: 'err'; readonly error: SerializedAppError<E['_tag'], E['code'], E['data']> };
```

- [ ] **Step 4: Update serialize.ts — new format, flat deserialize**

Rewrite `packages/faultline/src/serialize.ts`:

1. Update `SerializedResultOk` and `SerializedResultErr` types:
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

2. Update `serializeResult` to delegate to `toJSON`:
```ts
export function serializeResult<T, E extends AppError>(
  result: Result<T, E>,
): SerializedResult<T> {
  return result.toJSON() as SerializedResult<T>;
}
```

3. Update `deserializeError` return type:
```ts
export function deserializeError(
  input: unknown,
): Result<AppError, SerializationFailedError> {
```

Add the type alias at top of file:
```ts
import type { UnexpectedError } from './system-errors';
type SerializationFailedError = ReturnType<typeof SystemErrors.SerializationFailed>;
```

Export it:
```ts
export type { SerializationFailedError };
```

4. Flatten `deserializeResult`:
```ts
export function deserializeResult<T>(
  input: unknown,
): Result<T, AppError> {
  if (
    input === null ||
    input === undefined ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return err(SystemErrors.SerializationFailed({
      reason: `Expected serialized result object, got ${input === null ? 'null' : typeof input}`,
    }));
  }

  const obj = input as Record<string, unknown>;

  if (obj._format !== 'faultline-result' || obj._version !== SERIALIZED_RESULT_FORMAT_VERSION) {
    return err(SystemErrors.SerializationFailed({
      reason: 'Input does not match serialized Result format',
    }));
  }

  if (obj._type === 'ok') {
    return ok(obj.value as T);
  }

  if (obj._type === 'err' && obj.error && typeof obj.error === 'object') {
    const errorResult = deserializeError(obj.error);
    if (isErr(errorResult)) {
      return err(errorResult.error);
    }
    return err(errorResult.value);
  }

  return err(SystemErrors.SerializationFailed({
    reason: `Unknown result type: ${String(obj._type)}`,
  }));
}
```

- [ ] **Step 5: Update index.ts to export `SerializationFailedError` type**

In `packages/faultline/src/index.ts`, add to the serialize exports:
```ts
export type {
  SerializationFailedError,
  SerializedResult,
  SerializedResultErr,
  SerializedResultOk,
} from './serialize';
```

- [ ] **Step 6: Update existing tests for new format**

In `packages/faultline/test/error-system.test.ts`, update the `'deserializes stable contracts'` test:
```ts
  test('deserializes stable contracts', () => {
    const serializedError = serializeError(UserErrors.NotFound({ userId: '77' }));

    const errorResult = deserializeError(serializedError);
    expect(isOk(errorResult)).toBe(true);
    if (isOk(errorResult)) {
      expect(errorResult.value._tag).toBe('User.NotFound');
    }

    const serializedResult = serializeResult(ok({ id: '8' }));
    const result = deserializeResult(serializedResult);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toEqual({ id: '8' });
    }
  });
```

Update the `'serializes results'` test to use new format fields:
```ts
  test('serializes results', () => {
    const serialized = serializeResult(err(UserErrors.Unauthorized()));
    expect(serialized).toMatchObject({
      _format: 'faultline-result',
      _version: 1,
      _type: 'err',
      error: {
        kind: 'app-error',
        _tag: 'User.Unauthorized',
      },
    });
  });
```

Update the `'Result toJSON'` tests in `error-system.test.ts` to use new format.

- [ ] **Step 7: Run all tests**

Run: `cd packages/faultline && bun test`
Expected: All pass.

- [ ] **Step 8: Run typecheck**

Run: `cd packages/faultline && bunx tsc --noEmit`
Expected: Clean.

- [ ] **Step 9: Commit**

```bash
git add packages/faultline/src/ packages/faultline/test/
git commit -m "fix: unify serialization format, flatten deserializeResult return type"
```

---

## Chunk 4: Performance, Polish & Cast Audit

### Task 7: `narrowError` caching

**Files:**
- Modify: `packages/faultline/src/typed-promise.ts`
- Modify: `packages/faultline/test/narrow-error.test.ts`

- [ ] **Step 1: Write test for caching behavior**

Add to `packages/faultline/test/narrow-error.test.ts`:

```ts
describe('narrowError performance', () => {
  test('repeated calls with same sources produce consistent results', () => {
    const error = UserErrors.NotFound({ userId: '1' });
    const result1 = narrowError(error, [UserErrors]);
    const result2 = narrowError(error, [UserErrors]);
    expect(result1).toBe(result2); // same reference — recognized tag passes through
    expect(result1._tag).toBe('User.NotFound');
  });
});
```

- [ ] **Step 2: Add WeakMap cache to narrowError**

In `packages/faultline/src/typed-promise.ts`, add the cache before `narrowError`:

```ts
const tagCache = new WeakMap<object, ReadonlySet<string>>();

function getTagsForSource(source: object): ReadonlySet<string> {
  const cached = tagCache.get(source);
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

Then refactor `narrowError` to use the cache:
```ts
export function narrowError<S extends ErrorSource>(
  thrown: unknown,
  sources: S,
): InferErrors<S> | UnexpectedError {
  const validTags = new Set<string>();
  const sourceArray = Array.isArray(sources) ? sources : [sources];

  for (const source of sourceArray) {
    for (const tag of getTagsForSource(source as object)) {
      validTags.add(tag);
    }
  }

  if (isAppError(thrown) && validTags.has(thrown._tag)) {
    return thrown as InferErrors<S>;
  }

  if (isAppError(thrown)) {
    return SystemErrors.Unexpected({
      name: thrown.name,
      message: thrown.message,
    }).withCause(thrown) as unknown as UnexpectedError;
  }

  return fromUnknown(thrown) as unknown as UnexpectedError;
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/faultline && bun test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add packages/faultline/src/typed-promise.ts packages/faultline/test/narrow-error.test.ts
git commit -m "perf: cache tag sets in narrowError via WeakMap"
```

### Task 8: `all()` preserves error indices

**Files:**
- Modify: `packages/faultline/src/system-errors.ts`
- Modify: `packages/faultline/src/result.ts`
- Modify: `packages/faultline/test/error-system.test.ts`

- [ ] **Step 1: Write tests for indexed errors**

Add to `packages/faultline/test/error-system.test.ts`:

```ts
describe('all() error indices', () => {
  test('combined error includes indices of failed results', () => {
    const result = all([
      ok('a'),
      err(UserErrors.NotFound({ userId: '1' })),
      ok('c'),
      err(UserErrors.Unauthorized()),
    ] as const);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Combined');
      expect(result.error.data.errors).toHaveLength(2);
      expect(result.error.data.errors[0]!.index).toBe(1);
      expect(result.error.data.errors[0]!.error._tag).toBe('User.NotFound');
      expect(result.error.data.errors[1]!.index).toBe(3);
      expect(result.error.data.errors[1]!.error._tag).toBe('User.Unauthorized');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `data.errors[0].index` is undefined.

- [ ] **Step 3: Update CombinedAppError type and CombinedFactory**

In `packages/faultline/src/system-errors.ts`:

Update the type:
```ts
export type CombinedAppError<E extends AppError = AppError> = AppError<
  'System.Combined',
  'SYSTEM_COMBINED',
  { readonly errors: readonly { readonly index: number; readonly error: E }[] }
>;
```

Update the factory:
```ts
const CombinedFactory = defineError({
  tag: 'System.Combined',
  code: 'SYSTEM_COMBINED',
  params: (input: { errors: readonly { readonly index: number; readonly error: AppError }[] }) => input,
  message: (data: { errors: readonly { readonly index: number; readonly error: AppError }[] }) =>
    `Combined error with ${data.errors.length} ${data.errors.length === 1 ? 'failure' : 'failures'}`,
});
```

Update the function:
```ts
export function combinedError<E extends AppError>(
  errors: readonly { readonly index: number; readonly error: E }[],
): CombinedAppError<E> {
  return CombinedFactory({ errors }) as CombinedAppError<E>;
}
```

- [ ] **Step 4: Update `all()` to track indices**

In `packages/faultline/src/result.ts`, update the sync path of `all()`:

```ts
  const values: unknown[] = [];
  const errors: { index: number; error: AppError }[] = [];

  for (let i = 0; i < (results as readonly Result<unknown, AppError>[]).length; i++) {
    const result = (results as readonly Result<unknown, AppError>[])[i]!;
    if (isOk(result)) {
      values.push(result.value);
    } else {
      errors.push({ index: i, error: result.error });
    }
  }
```

- [ ] **Step 5: Update existing `all` tests that check `data.errors`**

In `packages/faultline/test/error-system.test.ts`, update the `'accumulates sync errors'` test:
```ts
  test('accumulates sync errors', () => {
    const result = all([
      ok('name'),
      err(UserErrors.NotFound({ userId: '1' })),
      err(UserErrors.Unauthorized()),
    ] as const);

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.error._tag).toBe('System.Combined');
      expect(result.error.data.errors).toHaveLength(2);
      expect(result.error.data.errors[0]!.index).toBe(1);
      expect(result.error.data.errors[1]!.index).toBe(2);
    }
  });
```

Update the `combinedError` standalone tests — they call `combinedError([...errors])` with a flat array which no longer compiles. Replace:

```ts
describe('combinedError', () => {
  test('combined error has factory metadata', () => {
    const errors = [{ index: 0, error: UserErrors.NotFound({ userId: '1' }) }];
    const combined = combinedError(errors);
    const meta = getFactoryMeta(combined);
    expect(meta).toBeDefined();
    expect(meta?.tag).toBe('System.Combined');
  });

  test('combined error message uses correct grammar', () => {
    const one = combinedError([{ index: 0, error: UserErrors.NotFound({ userId: '1' }) }]);
    expect(one.message).toContain('1 failure');
    expect(one.message).not.toContain('failures');

    const two = combinedError([
      { index: 0, error: UserErrors.NotFound({ userId: '1' }) },
      { index: 1, error: UserErrors.NotFound({ userId: '2' }) },
    ]);
    expect(two.message).toContain('2 failures');
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd packages/faultline && bun test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add packages/faultline/src/system-errors.ts packages/faultline/src/result.ts packages/faultline/test/error-system.test.ts
git commit -m "feat: all() preserves error indices in CombinedAppError"
```

### Task 9: Cast audit across all source files

**Files:**
- Modify: All `packages/faultline/src/*.ts` files

This is the final pass. Review every `as` assertion in src/ and either eliminate it or add a justification comment.

- [ ] **Step 1: Run oxlint to find all violations**

Run: `bunx oxlint packages/faultline/src/`
Note all violations.

- [ ] **Step 2: For each file, audit every `as` assertion**

For each cast, apply one of:
- **Eliminate**: Rewrite to avoid the cast
- **Justify**: Add `// oxlint-ignore-next-line typescript/no-explicit-any -- <reason>` (for any usage) or a code comment explaining the cast's necessity

`as const` assertions are exempt.

Common justifications:
- `as Record<PropertyKey, unknown>` in type guards — "Type narrowing: checking property existence on unknown value"
- `as E` in Result transformers — "Generic variance: TypeScript can't track discriminated union narrowing through Result<T, E> transformers"
- `as unknown as` in catchTag/andThen — "Covariance: changing error type parameter on an ErrImpl that doesn't actually contain a different type"
- `as CombinedAppError<E>` — "Return type narrowing: factory produces AppError but we know it's CombinedAppError"
- `as Boundary<AppError, AppError>` — "Overload implementation: returning concrete type from union overload implementation"

- [ ] **Step 3: Run oxlint to verify clean**

Run: `bunx oxlint packages/faultline/src/`
Expected: No violations (only suppress comments for justified casts).

- [ ] **Step 4: Run full test suite and typecheck**

Run: `cd packages/faultline && bun test && bunx tsc --noEmit`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add packages/faultline/src/
git commit -m "fix: audit all type assertions — eliminate unnecessary casts, justify required ones"
```

### Task 10: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd packages/faultline && bun test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck from package**

Run: `cd packages/faultline && bunx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Run typecheck from root**

Run: `bunx tsc --noEmit`
Expected: Clean.

- [ ] **Step 4: Run CLI tests**

Run: `cd packages/faultline-cli && bun test`
Expected: All pass.

- [ ] **Step 5: Run ESLint on examples**

Run: `cd /Users/danielfry/dev/faultline && bunx eslint examples/`
Expected: Only expected warnings/errors on lint-demo.

- [ ] **Step 6: Run oxlint on src**

Run: `bunx oxlint packages/faultline/src/`
Expected: No violations.

- [ ] **Step 7: Build**

Run: `cd packages/faultline && bun run build`
Expected: Clean ESM + CJS + declarations.

---

## Summary

| Chunk | Tasks | Focus |
|-------|-------|-------|
| 1 | Tasks 1-2 | Linting config, `_output` → symbol, `ContextFrame.layer`, remove `createAppError` |
| 2 | Tasks 3-5 | Match overloads, `attempt`/`attemptAsync` overloads, boundary throw |
| 3 | Task 6 | Serialization format unification, flat `deserializeResult` |
| 4 | Tasks 7-10 | `narrowError` cache, `all()` indices, cast audit, final verification |

**Total tasks:** 10
**New test files:** 0 (all changes to existing test files)
**Estimated tests added/modified:** ~20
